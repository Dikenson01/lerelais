import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import logger from './utils/logger.js';
import supabase from './config/supabase.js';
import { createWhatsAppConnector } from './connectors/whatsapp.js';
import { connectToInstagram } from './connectors/instagram.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const MEDIA_BUCKET = 'Le Relais Media';

app.use(cors());
app.use(express.json());

// Upload en mémoire (pas de fichier temporaire)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024 } // 64MB
});

// State
const activeConnectors = {};
const relayMap = new Map();
const qrMap = new Map();

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

const requireAuth = async (req, res, next) => {
  // Routes publiques
  if (req.path.startsWith('/auth/')) return next();

  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    req.username = payload.username; // On utilise username ici
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Session expirée' });
  }
};

app.use('/api', requireAuth);

// ============================================================
// AUTH ROUTES
// ============================================================

// Inscription
app.post('/api/auth/register', async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 car. minimum)' });

  try {
    // Vérifier si l'identifiant existe déjà
    const { data: existing } = await supabase.from('relais_users').select('id').eq('email', username.toLowerCase().trim()).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Cet identifiant est déjà utilisé' });

    const passwordHash = await bcrypt.hash(password, 12);
    const { data: user, error } = await supabase.from('relais_users').insert({
      email: username.toLowerCase().trim(), // On utilise la colonne email pour stocker le pseudo
      password_hash: passwordHash,
      display_name: displayName || username
    }).select('id, email, display_name, created_at').single();

    if (error) throw error;

    const token = jwt.sign({ userId: user.id, username: user.email }, JWT_SECRET, { expiresIn: '30d' });
    logger.info(`[AUTH] New user registered: ${user.email}`);
    res.json({ token, user: { id: user.id, username: user.email, displayName: user.display_name } });
  } catch (err) {
    logger.error('[AUTH] Register error:', err.message);
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

// Connexion
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe requis' });

  try {
    const { data: user, error } = await supabase.from('relais_users')
      .select('id, email, display_name, password_hash, avatar_url')
      .eq('email', username.toLowerCase().trim())
      .maybeSingle();

    if (!user || error) return res.status(403).json({ error: 'Identifiant ou mot de passe incorrect' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(403).json({ error: 'Identifiant ou mot de passe incorrect' });

    // Mettre à jour last_login
    await supabase.from('relais_users').update({ last_login_at: new Date() }).eq('id', user.id);

    const token = jwt.sign({ userId: user.id, username: user.email }, JWT_SECRET, { expiresIn: '30d' });
    logger.info(`[AUTH] Login: ${user.email}`);
    res.json({
      token,
      user: { id: user.id, username: user.email, displayName: user.display_name, avatarUrl: user.avatar_url }
    });
  } catch (err) {
    logger.error('[AUTH] Login error:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Vérifier session
app.get('/api/auth/me', async (req, res) => {
  const { data: user } = await supabase.from('relais_users')
    .select('id, email, display_name, avatar_url, plan, created_at')
    .eq('id', req.userId).maybeSingle();
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  res.json({ id: user.id, username: user.email, displayName: user.display_name, avatarUrl: user.avatar_url, plan: user.plan });
});

// ============================================================
// API ROUTES
// ============================================================

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

app.get('/api/accounts', async (req, res) => {
  const { data, error } = await supabase.from('accounts').select('*').eq('user_id', req.userId);
  if (error) return res.status(500).json({ error: error.message });
  const mapped = (data || []).map(a => ({
    ...a,
    account_name: a.username || (a.platform === 'whatsapp' ? 'WhatsApp' : a.platform === 'instagram' ? 'Instagram' : a.platform)
  }));
  res.json(mapped);
});

app.get('/api/conversations', async (req, res) => {
  try {
    // Récupérer les account IDs de l'utilisateur
    const { data: userAccounts } = await supabase.from('accounts').select('id').eq('user_id', req.userId);
    if (!userAccounts?.length) return res.json([]);
    const accountIds = userAccounts.map(a => a.id);

    const { data: convs, error } = await supabase
      .from('conversations')
      .select('*, contacts(*)')
      .in('account_id', accountIds)
      .order('last_message_at', { ascending: false });

    if (error) throw error;

    // Déduplique par contact
    const unified = [];
    const seenContacts = new Set();
    const seenGroups = new Set();

    const { data: allContacts } = await supabase.from('contacts').select('id, external_id, metadata').in('account_id', accountIds);
    const contactMap = new Map();
    if (allContacts) {
      for (const c of allContacts) {
        contactMap.set(c.external_id, c.id);
        if (c.metadata?.lid) contactMap.set(c.metadata.lid, c.id);
      }
    }

    for (const conv of (convs || [])) {
      if (conv.is_group) {
        if (!seenGroups.has(conv.external_id)) { unified.push(conv); seenGroups.add(conv.external_id); }
        continue;
      }
      if (!conv.contact_id) {
        const matchId = contactMap.get(conv.external_id);
        if (matchId) {
          conv.contact_id = matchId;
          supabase.from('conversations').update({ contact_id: matchId }).eq('id', conv.id).then(() => {});
        }
      }
      if (conv.contact_id) {
        if (!seenContacts.has(conv.contact_id)) { unified.push(conv); seenContacts.add(conv.contact_id); }
      } else {
        unified.push(conv);
      }
    }

    res.json(unified);
  } catch (err) {
    logger.error('Error fetching conversations:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/contacts', async (req, res) => {
  const { data: userAccounts } = await supabase.from('accounts').select('id').eq('user_id', req.userId);
  if (!userAccounts?.length) return res.json([]);
  const accountIds = userAccounts.map(a => a.id);
  const { data, error } = await supabase.from('contacts').select('*').in('account_id', accountIds).order('display_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/conversations/ensure', async (req, res) => {
  const { contact_id } = req.body;
  if (!contact_id) return res.status(400).json({ error: 'contact_id requis' });

  try {
    const { data: contact } = await supabase.from('contacts').select('*').eq('id', contact_id).single();
    if (!contact) return res.status(404).json({ error: 'Contact introuvable' });

    let { data: conv } = await supabase.from('conversations')
      .select('*').eq('account_id', contact.account_id).eq('external_id', contact.external_id).maybeSingle();

    if (!conv) {
      const { data: newConv, error } = await supabase.from('conversations').insert({
        account_id: contact.account_id,
        external_id: contact.external_id,
        contact_id: contact.id,
        platform: 'whatsapp',
        title: contact.display_name,
        last_message_at: new Date()
      }).select('*, contacts(*)').single();
      if (error) throw error;
      conv = newConv;
    }
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:convId', async (req, res) => {
  const { convId } = req.params;
  try {
    const { data: conv } = await supabase.from('conversations').select('contact_id, is_group, account_id').eq('id', convId).maybeSingle();

    // Vérifier que la conversation appartient à l'utilisateur
    const { data: userAccounts } = await supabase.from('accounts').select('id').eq('user_id', req.userId);
    const accountIds = userAccounts?.map(a => a.id) || [];
    if (conv && !accountIds.includes(conv.account_id)) return res.status(403).json({ error: 'Accès refusé' });

    let query = supabase.from('messages').select('*');
    if (conv?.is_group) {
      query = query.eq('conversation_id', convId);
    } else if (conv?.contact_id) {
      const { data: siblingConvs } = await supabase.from('conversations').select('id').eq('contact_id', conv.contact_id).in('account_id', accountIds);
      const convIds = siblingConvs?.map(c => c.id) || [convId];
      query = query.in('conversation_id', convIds);
    } else {
      query = query.eq('conversation_id', convId);
    }

    const { data, error } = await query.order('timestamp', { ascending: true }).limit(200);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Envoi de message texte
app.post('/api/messages', async (req, res) => {
  const { conversationId, content } = req.body;
  try {
    const { data: conv } = await supabase.from('conversations').select('*').eq('id', conversationId).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'Conversation introuvable' });

    const connector = activeConnectors[conv.account_id];
    let remoteId = `temp-${crypto.randomUUID()}`;

    if (connector) {
      const sent = await connector.sendMessage(conv.external_id, content);
      if (sent.success) remoteId = sent.messageId;
      else return res.status(503).json({ error: sent.error });
    }

    const { data: msg } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      account_id: conv.account_id,
      remote_id: remoteId,
      sender_id: conv.account_id,
      content,
      is_from_me: true,
      timestamp: new Date()
    }).select().single();

    await supabase.from('conversations').update({ last_message_preview: content, last_message_at: new Date() }).eq('id', conversationId);
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// UPLOAD MÉDIAS (photo, audio, vidéo, doc)
// ============================================================
app.post('/api/messages/media', upload.single('file'), async (req, res) => {
  const { conversationId } = req.body;
  if (!req.file || !conversationId) return res.status(400).json({ error: 'Fichier et conversationId requis' });

  try {
    const { data: conv } = await supabase.from('conversations').select('*').eq('id', conversationId).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'Conversation introuvable' });

    const connector = activeConnectors[conv.account_id];
    if (!connector) return res.status(503).json({ error: 'WhatsApp non connecté' });

    const mime = req.file.mimetype;
    const buffer = req.file.buffer;
    let remoteId = `temp-${crypto.randomUUID()}`;
    let mediaType = 'document';
    let sentResult;

    // Déterminer le type et envoyer
    if (mime.startsWith('image/')) {
      mediaType = 'image';
      sentResult = await connector.sendMedia(conv.external_id, { image: buffer, mimetype: mime, caption: req.body.caption || '' });
    } else if (mime.startsWith('video/')) {
      mediaType = 'video';
      sentResult = await connector.sendMedia(conv.external_id, { video: buffer, mimetype: mime, caption: req.body.caption || '' });
    } else if (mime.startsWith('audio/')) {
      mediaType = 'audio';
      sentResult = await connector.sendMedia(conv.external_id, { audio: buffer, mimetype: mime, ptt: mime.includes('ogg') });
    } else {
      sentResult = await connector.sendMedia(conv.external_id, { document: buffer, mimetype: mime, fileName: req.file.originalname });
    }

    if (sentResult?.success) remoteId = sentResult.messageId;

    // Stocker dans Supabase Storage
    const ext = req.file.originalname.split('.').pop() || 'bin';
    const fileName = `${conv.account_id}/${remoteId}.${ext}`;
    const { error: storageErr } = await supabase.storage.from(MEDIA_BUCKET).upload(fileName, buffer, { contentType: mime, upsert: true });

    let mediaUrl = null;
    if (!storageErr) {
      const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(fileName);
      mediaUrl = urlData.publicUrl;
    }

    const { data: msg } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      account_id: conv.account_id,
      remote_id: remoteId,
      sender_id: conv.account_id,
      content: req.body.caption || '',
      media_type: mediaType,
      media_url: mediaUrl,
      is_from_me: true,
      timestamp: new Date()
    }).select().single();

    await supabase.from('conversations').update({
      last_message_preview: mediaType === 'image' ? '📷 Photo' : mediaType === 'audio' ? '🎵 Audio' : mediaType === 'video' ? '🎬 Vidéo' : '📄 Fichier',
      last_message_at: new Date()
    }).eq('id', conversationId);

    res.json(msg);
  } catch (err) {
    logger.error('[MEDIA-UPLOAD]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// WHATSAPP CONNECTION
// ============================================================

app.post('/api/connect/whatsapp', async (req, res) => {
  // Nettoyer les sessions pairing orphelines de cet utilisateur
  const { data: userAccounts } = await supabase.from('accounts').select('id').eq('user_id', req.userId);
  if (userAccounts?.length) {
    await supabase.from('accounts').delete()
      .in('id', userAccounts.map(a => a.id))
      .eq('status', 'pairing');
  }

  // Vérifier si déjà connecté
  const existing = userAccounts?.find(a => activeConnectors[a.id]);
  if (existing) return res.json({ accountId: existing.id });

  const accountId = crypto.randomUUID();
  await supabase.from('accounts').insert({ id: accountId, user_id: req.userId, platform: 'whatsapp', status: 'pairing' });

  const connector = await createWhatsAppConnector(accountId, (type, payload) => {
    if (type === 'qr') {
      qrMap.set(accountId, payload);
    } else if (type === 'status') {
      logger.info(`[WA-STATUS] ${accountId} -> ${payload.status}`);
      supabase.from('accounts').update({ status: payload.status }).eq('id', accountId).then(() => {});
      if (payload.status === 'connected') {
        qrMap.delete(accountId);
        activeConnectors[accountId] = connector;
      }
    } else if (type === 'message') {
      relayToTelegram('whatsapp', payload.jid, payload.text, accountId, payload.jid);
    }
  });

  res.json({ accountId });
});

app.get('/api/connect/whatsapp/status/:id', async (req, res) => {
  const qr = qrMap.get(req.params.id);
  const { data: acc } = await supabase.from('accounts').select('status').eq('id', req.params.id).single();
  res.json({ qr: qr || null, status: acc?.status || 'unknown' });
});

app.delete('/api/accounts/:id', async (req, res) => {
  await supabase.from('accounts').delete().eq('id', req.params.id).eq('user_id', req.userId);
  delete activeConnectors[req.params.id];
  res.json({ success: true });
});

// ============================================================
// PAGES WEB LEGACY (QR, pairing code)
// ============================================================

// FIN DES ROUTES API

// ============================================================
// TELEGRAM BOT
// ============================================================

async function relayToTelegram(platform, from, content, accountId, externalId) {
  const adminId = process.env.ADMIN_ID;
  if (!adminId) return;
  try {
    const sent = await bot.telegram.sendMessage(adminId, `📥 *[${platform.toUpperCase()}]* ${from}:\n${content}`, { parse_mode: 'Markdown' });
    relayMap.set(sent.message_id, { accountId, externalId, platform });
  } catch (e) {}
}

bot.start((ctx) => {
  const webAppUrl = process.env.WEBAPP_URL || 'https://lerelais.up.railway.app';
  ctx.reply('✨ *Bienvenue sur LeRelais Hub*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '🚀 Ouvrir le Hub', web_app: { url: webAppUrl } }]] }
  });
});

async function setupMenuButton() {
  try {
    const url = process.env.WEBAPP_URL || 'https://lerelais.up.railway.app';
    await bot.telegram.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Le Relais', web_app: { url } } });
  } catch (e) {}
}

// ============================================================
// STATIC FILES & SPA
// ============================================================

const distPath = path.resolve(__dirname, '../web/dist');
app.use(express.static(distPath));
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// ============================================================
// LIFECYCLE
// ============================================================

async function restoreConnectors() {
  try {
    // Restaure TOUS les comptes connectés — pas de verrou par ID
    let query = supabase.from('accounts').select('*').eq('status', 'connected').eq('platform', 'whatsapp');

    const { data: accounts } = await query;
    logger.info(`🔍 Startup: ${accounts?.length || 0} accounts à restaurer`);

    for (const acc of (accounts || [])) {
      logger.info(`🔄 Restoring: ${acc.id}`);
      const connector = await createWhatsAppConnector(acc.id, (type, payload) => {
        if (type === 'qr') qrMap.set(acc.id, payload);
        else if (type === 'status') {
          supabase.from('accounts').update({ status: payload.status }).eq('id', acc.id).then(() => {});
          if (payload.status === 'connected') { qrMap.delete(acc.id); activeConnectors[acc.id] = connector; }
        } else if (type === 'message') relayToTelegram('whatsapp', payload.jid, payload.text, acc.id, payload.jid);
      });
      activeConnectors[acc.id] = connector;
    }
  } catch (err) {
    logger.error('Restore error:', err.message);
  }
}

async function start() {
  if (process.env.RAILWAY_STATIC_URL) process.env.WEBAPP_URL = `https://${process.env.RAILWAY_STATIC_URL}`;

  app.listen(PORT, '0.0.0.0', () => logger.info(`🚀 LeRelais sur port ${PORT}`));

  await setupMenuButton().catch(() => {});
  setTimeout(restoreConnectors, 1500);

  try {
    bot.launch({ dropPendingUpdates: true }).catch(err => {
      if (err.response?.error_code === 409) logger.warn('Telegram 409 - autre instance active');
    });
  } catch (e) {}
}

start();

process.once('SIGINT', () => { bot.stop('SIGINT'); setTimeout(() => process.exit(0), 1000); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); setTimeout(() => process.exit(0), 1000); });
