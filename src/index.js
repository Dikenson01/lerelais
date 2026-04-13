import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'node:crypto';
import logger from './utils/logger.js';
import supabase from './config/supabase.js';
import { createWhatsAppConnector as connectToWhatsApp } from './connectors/whatsapp.js';
import { connectToInstagram } from './connectors/instagram.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// State
const activeConnectors = {};
const relayMap = new Map();
const pairingCodes = new Map(); // Numéro -> Code

// --- API ROUTES ---

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

// --- WHATSAPP CONNECTION FACILITATORS ---

app.get('/whatsapp-qr', (req, res) => {
  const qrPath = path.resolve(__dirname, '../web/dist/whatsapp_qr.png');
  res.send(`
    <html>
      <head><title>WhatsApp QR</title><meta http-equiv="refresh" content="5"></head>
      <body style="background: #111; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif;">
        <h2>Scanner pour connecter LeRelais Hub</h2>
        <img src="/whatsapp_qr.png" style="border: 10px solid white; border-radius: 10px; width: 300px; background: white;" />
        <p>Actualisation automatique toutes les 5s</p>
      </body>
    </html>
  `);
});

app.get('/wa-pairing-code', async (req, res) => {
  const phone = req.query.phone;
  if (!phone) {
    return res.send(`
      <body style="background: #111; color: white; padding: 50px; font-family: sans-serif;">
        <h2>Jumelage par Code</h2>
        <form action="/wa-pairing-code" method="GET">
          Saisissez votre numéro (format international, ex: 33712345678) :<br><br>
          <input type="text" name="phone" placeholder="337..." style="padding: 10px; width: 300px;">
          <button type="submit" style="padding: 10px;">Générer le code</button>
        </form>
      </body>
    `);
  }

  const cleanPhone = phone.replace(/\D/g, '');
  
  // Si on n'a pas encore de code pour ce numéro, on lance la demande
  if (!pairingCodes.has(cleanPhone)) {
    pairingCodes.set(cleanPhone, "EN ATTENTE...");
    const accountId = crypto.randomUUID();
    await supabase.from('accounts').insert({ id: accountId, platform: 'whatsapp', status: 'pairing' });
    
    await connectToWhatsApp(accountId, (p, f, c, aid, eid) => relayToTelegram(p, f, c, aid, eid), {
      onPairingCode: (code) => pairingCodes.set(cleanPhone, code),
      onConnected: () => {
        pairingCodes.delete(cleanPhone);
        logger.info(`✅ Account ${accountId} connected via code`);
      }
    }, cleanPhone);
  }

  const code = pairingCodes.get(cleanPhone);
  res.send(`
    <body style="background: #111; color: white; padding: 50px; font-family: sans-serif; text-align: center;">
      <h2>Code de jumelage pour +${cleanPhone}</h2>
      <div style="font-size: 48px; font-weight: bold; background: #222; padding: 20px; border-radius: 10px; margin: 20px auto; border: 2px solid #555; width: fit-content; color: #00ff00; letter-spacing: 5px;">
        ${code}
      </div>
      <p>Entrez ce code sur votre téléphone dans <b>Appareils connectés > Associer avec un numéro de téléphone</b>.</p>
      <script>setTimeout(() => window.location.reload(), 3000);</script>
    </body>
  `);
});

app.get('/wa-restart', async (req, res) => {
  logger.info('⚠️ WA RESTART initiated...');
  try {
    // 1. Déconnecter les actifs
    for (const key in activeConnectors) {
      if (activeConnectors[key].end) activeConnectors[key].end();
      delete activeConnectors[key];
    }
    // 2. Vider les dossiers auth
    const authDir = path.resolve(__dirname, '../auth');
    if (fs.existsSync(authDir)) fs.rmSync(authDir, { recursive: true, force: true });
    fs.mkdirSync(authDir);
    // 3. Vider la DB session
    await supabase.from('account_sessions').delete().neq('account_id', '00000000-0000-0000-0000-000000000000');
    await supabase.from('accounts').update({ status: 'disconnected' }).eq('platform', 'whatsapp');
    
    res.send('✅ Session WhatsApp réinitialisée. Vous pouvez maintenant utiliser /whatsapp-qr ou /wa-pairing-code.');
  } catch (e) {
    res.status(500).send('Erreur: ' + e.message);
  }
});

app.get('/api/accounts', async (req, res) => {
  const { data, error } = await supabase.from('accounts').select('*');
  if (error) {
    logger.error('CRITICAL DB ERROR /api/accounts:', JSON.stringify(error, null, 2));
    return res.status(500).json({ error: error.message });
  }
  const mapped = (data || []).map(a => ({ ...a, account_name: a.username || (a.platform === 'whatsapp' ? 'WhatsApp' : 'Instagram') }));
  res.json(mapped);
});

app.get('/api/conversations', async (req, res) => {
  try {
    const { data: convs, error } = await supabase
      .from('conversations')
      .select('*, contacts(*)')
      .order('last_message_at', { ascending: false });
    
    if (error) throw error;

    // --- UNIFICATION MIROIR (V3) : Groupement par contact ---
    const unified = [];
    const seenContacts = new Set();
    const seenGroups = new Set();

    for (const conv of convs) {
      if (conv.is_group) {
        if (!seenGroups.has(conv.external_id)) {
          unified.push(conv);
          seenGroups.add(conv.external_id);
        }
        continue;
      }

      // LAZY IDENTIFICATION : Si pas de contact_id, tenter de le trouver par JID ou LID mapping
      if (!conv.contact_id) {
        const jid = conv.external_id;
        const { data: contacts } = await supabase.from('contacts').select('id, metadata').eq('account_id', conv.account_id);
        const match = contacts?.find(c => 
          c.external_id === jid || 
          (jid.endsWith('@lid') && c.metadata?.lid === jid) ||
          (c.external_id.split('@')[0] === jid.split('@')[0])
        );
        if (match) {
          conv.contact_id = match.id;
          // Mise à jour asynchrone pour la prochaine fois
          supabase.from('conversations').update({ contact_id: match.id }).eq('id', conv.id).then(() => {});
        }
      }

      if (conv.contact_id) {
        if (!seenContacts.has(conv.contact_id)) {
          unified.push(conv);
          seenContacts.add(conv.contact_id);
        }
      } else {
        unified.push(conv);
      }
    }

    res.json(unified);
  } catch (err) {
    logger.error('Error fetching unified conversations:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/contacts', async (req, res) => {
  const { data, error } = await supabase.from('contacts').select('*').order('display_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/conversations/ensure', async (req, res) => {
  const { contact_id } = req.body;
  if (!contact_id) return res.status(400).json({ error: 'contact_id is required' });

  try {
    // 1. Chercher le contact
    const { data: contact, error: contactErr } = await supabase.from('contacts').select('*').eq('id', contact_id).single();
    if (contactErr || !contact) return res.status(404).json({ error: 'Contact non trouvé' });

    // 2. Chercher ou Créer la conversation
    let { data: conv, error: convErr } = await supabase.from('conversations').select('*').eq('account_id', contact.account_id).eq('external_id', contact.external_id).maybeSingle();
    
    if (!conv) {
      const { data: newConv, error: createErr } = await supabase.from('conversations').insert({
        account_id: contact.account_id,
        external_id: contact.external_id,
        contact_id: contact.id,
        platform: 'whatsapp',
        title: contact.display_name,
        last_message_at: new Date()
      }).select().single();
      
      if (createErr) throw createErr;
      conv = newConv;
    }

    res.json(conv);
  } catch (err) {
    logger.error('Error in /api/conversations/ensure:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:convId', async (req, res) => {
  const { convId } = req.params;
  try {
    // 1. Trouver l'ID du contact pour cette conversation
    const { data: conv } = await supabase.from('conversations').select('contact_id, is_group').eq('id', convId).maybeSingle();
    
    let query = supabase.from('messages').select('*');
    if (conv?.is_group) {
      query = query.eq('conversation_id', convId);
    } else if (conv?.contact_id) {
      // MIROIR UNIFIÉ : On cherche tous les messages rattachés à ce contact ID
      const { data: siblingConvs } = await supabase.from('conversations').select('id').eq('contact_id', conv.contact_id);
      const convIds = siblingConvs.map(c => c.id);
      query = query.in('conversation_id', convIds);
    } else {
      query = query.eq('conversation_id', convId);
    }

    const { data, error } = await query.order('timestamp', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    logger.error('Error fetching unified messages:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  const { conversationId, content } = req.body;
  try {
    const { data: conv, error: convError } = await supabase.from('conversations').select('*').eq('id', conversationId).maybeSingle();
    
    if (!conv) {
      return res.status(404).json({ error: 'Conversation introuvable (elle a peut-être été fusionnée). Veuillez rafraîchir.' });
    }

    const sock = activeConnectors[conv.account_id];
    let remoteId = `temp-${crypto.randomUUID()}`; 
    
    if (sock) {
      try {
        const sent = await sock.sendMessage(conv.external_id, content);
        if (sent.success) {
          remoteId = sent.messageId;
        } else {
          throw new Error(sent.error || 'Erreur d\'envoi');
        }
      } catch (sendErr) {
        logger.error(`[WA-SEND-ERR] ${conv.external_id}:`, sendErr.message);
        return res.status(503).json({ error: `Échec de l'envoi: ${sendErr.message}` });
      }
    }

    const { data: msg, error: insertError } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      account_id: conv.account_id,
      remote_id: remoteId,
      sender_id: conv.account_id, // Utilise l'ID du compte comme expéditeur par défaut
      content,
      is_from_me: true,
      timestamp: new Date()
    }).select().single();

    if (insertError) {
      logger.error(`[SQL-ERR] Failed to insert message: ${insertError.message}`);
      throw insertError;
    }

    // Mise à jour MIROIR : On remonte la discussion
    await supabase.from('conversations').update({ 
      last_message_preview: content, 
      last_message_at: new Date() 
    }).eq('id', conversationId);

    res.json(msg);
  } catch (err) {
    logger.error(`[API-ERR] POST /api/messages: ${err.message}`);
    res.status(500).json({ error: 'Erreur interne lors de l\'envoi' });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  const { id } = req.params;
  await supabase.from('accounts').delete().eq('id', id);
  delete activeConnectors[id];
  res.json({ success: true });
});

app.post('/api/sync/all', async (req, res) => {
  for (const aid in activeConnectors) {
    const sock = activeConnectors[aid];
    if (sock?.ev) sock.ev.emit('messaging-history.sync', { chats: [], contacts: [], messages: [], isLatest: true });
  }
  res.json({ success: true });
});

// --- CONNECTORS LOGIC ---
const qrMap = new Map();

app.post('/api/connect/whatsapp', async (req, res) => {
  await supabase.from('accounts').delete().eq('platform', 'whatsapp').eq('status', 'pairing');
  
  const accountId = crypto.randomUUID();
  await supabase.from('accounts').insert({ id: accountId, platform: 'whatsapp', status: 'pairing' });
  
  const connector = await connectToWhatsApp(accountId, (type, payload) => {
    if (type === 'qr') {
      qrMap.set(accountId, payload);
    } else if (type === 'status') {
      logger.info(`[WA-STATUS] ${accountId} -> ${payload.status}`);
      supabase.from('accounts').update({ 
        status: payload.status,
        updated_at: new Date().toISOString()
      }).eq('id', accountId).then(({ error }) => {
        if (error) logger.error(`[DB-ERROR] Failed to update status: ${error.message}`);
      });
      
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

// --- TELEGRAM BOT ---

async function relayToTelegram(platform, from, content, accountId, externalId) {
  const adminId = process.env.ADMIN_ID;
  if (!adminId) return;
  const sent = await bot.telegram.sendMessage(adminId, `📥 *[${platform.toUpperCase()}]* ${from}:\n${content}`, { parse_mode: 'Markdown' });
  relayMap.set(sent.message_id, { accountId, externalId, platform });
}

bot.start((ctx) => {
  const webAppUrl = process.env.WEBAPP_URL || 'https://lerelais.up.railway.app';
  ctx.reply('✨ *Bienvenue sur LeRelais Hub*', { 
    parse_mode: 'Markdown', 
    reply_markup: { inline_keyboard: [[{ text: '🚀 Ouvrir le Hub', web_app: { url: webAppUrl } }]] } 
  });
});

async function setupMenuButton() {
  const url = process.env.WEBAPP_URL || 'https://lerelais.up.railway.app';
  await bot.telegram.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Le Relais', web_app: { url } } });
}

// --- STATIC FILES & SPA ---
const distPath = path.resolve(__dirname, '../web/dist');
app.use(express.static(distPath));

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// --- LIFECYCLE ---

async function repairContactLinks() {
  logger.info('🔧 Running maintenance: Repairing contact links...');
  const { data: orphans } = await supabase.from('conversations').select('id, external_id, account_id').is('contact_id', null);
  
  if (orphans && orphans.length > 0) {
    for (const conv of orphans) {
      if (conv.external_id.endsWith('@g.us')) continue; // Ignore groups for now
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('account_id', conv.account_id)
        .eq('external_id', conv.external_id)
        .single();
      
      if (contact) {
        await supabase.from('conversations').update({ contact_id: contact.id }).eq('id', conv.id);
      }
    }
    logger.info(`✅ Repaired ${orphans.length} conversation-contact links`);
  }
}

async function cleanupStaleAccounts() {
  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: stale } = await supabase
    .from('accounts')
    .delete()
    .eq('status', 'pairing')
    .lt('created_at', thirtyMinsAgo);
  if (stale) logger.info(`🧹 Cleaned up stale pairing sessions`);
}

async function restoreConnectors() {
  try {
    const { data: accounts, error } = await supabase.from('accounts').select('*').eq('status', 'connected');
    if (error) throw error;

    logger.info(`🔍 Startup DB Check: ${accounts?.length || 0} connected accounts found.`);
    if (accounts && accounts.length > 0) {
      for (const acc of accounts) {
        logger.info(`🔄 Restoring WhatsApp: ${acc.id} (${acc.account_name || 'No Name'})`);
        const connector = await connectToWhatsApp(acc.id, (type, payload) => {
          if (type === 'qr') {
            qrMap.set(acc.id, payload);
          } else if (type === 'status') {
            logger.info(`[WA-STATUS-RESTORE] ${acc.id} -> ${payload.status}`);
            supabase.from('accounts').update({ status: payload.status, updated_at: new Date().toISOString() }).eq('id', acc.id).then(() => {});
            if (payload.status === 'connected') {
              qrMap.delete(acc.id);
              activeConnectors[acc.id] = connector;
            }
          } else if (type === 'message') {
            relayToTelegram('whatsapp', payload.jid, payload.text, acc.id, payload.jid);
          }
        });
        activeConnectors[acc.id] = connector;
      }
    }
  } catch (err) {
    logger.error('Failed to restore connectors:', err.message);
  }
}

async function start() {
  if (process.env.RAILWAY_STATIC_URL) process.env.WEBAPP_URL = `https://${process.env.RAILWAY_STATIC_URL}`;
  
  // 1. Start HTTP Server First
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Server running on port ${PORT}`);
  });

  // 2. Setup Bot but don't block
  await setupMenuButton();
  
  // 3. Initialize Connectors
  setTimeout(async () => {
    try {
      await restoreConnectors();
    } catch (e) {
      logger.error('Restore Error:', e.message);
    }
  }, 1000);

  // 4. Launch Bot (Silent fail if conflict)
  try {
    bot.launch({ dropPendingUpdates: true }).catch(err => {
      if (err.response?.error_code === 409) {
        logger.warn('Telegram Conflict (409) - Another instance is running.');
      }
    });
  } catch (e) {}
}

start();

process.once('SIGINT', () => {
  bot.stop('SIGINT');
  setTimeout(() => process.exit(0), 1000);
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  setTimeout(() => process.exit(0), 1000);
});
