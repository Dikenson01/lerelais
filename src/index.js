import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import localtunnel from 'localtunnel';
import logger from './utils/logger.js';
import supabase from './config/supabase.js';
import { connectToWhatsApp } from './connectors/whatsapp.js';
import { connectToInstagram } from './connectors/instagram.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- PRODUCTION / RAILWAY OPTIMIZATION ---
app.get('/health', (req, res) => res.status(200).send('OK'));

const distPath = path.resolve(__dirname, '../web/dist');

if (process.env.NODE_ENV === 'production') {
  logger.info('Running in PRODUCTION mode');
  app.use(express.static(distPath));
  // The catch-all is moved to the bottom of the file
} else {
  // --- FRONTEND INTEGRATION (DEV) ---
  if (!process.env.NO_VITE) {
    logger.info('Starting Vite dev server for frontend...');
    const vite = spawn('npm', ['run', 'dev'], { 
      cwd: path.resolve(__dirname, '../web'),
      stdio: 'inherit',
      shell: true 
    });
    
    process.on('SIGINT', () => vite.kill());
    process.on('SIGTERM', () => vite.kill());
  }
}

// State
const activeConnectors = {};
const userState = {};
const relayMap = new Map();

// --- API ROUTES ---

app.get('/api/accounts', async (req, res) => {
  const { data, error } = await supabase.from('accounts').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/conversations', async (req, res) => {
  const { data, error } = await supabase
    .from('conversations')
    .select('*, contacts(*)')
    .order('updated_at', { ascending: false });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/messages/:conversationId', async (req, res) => {
  const { conversationId } = req.params;
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('timestamp', { ascending: true });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/messages', async (req, res) => {
  const { conversationId, content } = req.body;
  if (!conversationId || !content) return res.status(400).json({ error: 'Missing conversationId or content' });

  try {
    const { data: conv, error: cError } = await supabase
      .from('conversations')
      .select('*, accounts(*), contacts(*)')
      .eq('id', conversationId)
      .single();

    if (cError || !conv) throw new Error('Conversation not found');

    const connector = activeConnectors[conv.account_id];
    if (!connector) throw new Error('Account disconnected or not found');

    if (conv.platform === 'whatsapp') {
      await connector.sendMessage(conv.external_conversation_id, { text: content });
    } else if (conv.platform === 'instagram') {
      await connector.sendMessage(conv.external_conversation_id, content);
    }

    const { data: msg, error: mError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        content: content,
        is_from_me: true,
        timestamp: new Date()
      })
      .select()
      .single();

    if (mError) throw mError;

    await supabase.from('conversations').update({
      last_message_preview: content,
      updated_at: new Date()
    }).eq('id', conversationId);

    res.json(msg);
  } catch (err) {
    logger.error('Failed to send message:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/contacts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .order('display_name', { ascending: true });
    
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Search query required' });

  const { data: messages, error: mError } = await supabase
    .from('messages')
    .select('*, conversations(title, platform)')
    .ilike('content', `%${q}%`)
    .limit(20);

  const { data: contacts, error: cError } = await supabase
    .from('contacts')
    .select('*')
    .or(`display_name.ilike.%${q}%,external_id.ilike.%${q}%`)
    .limit(20);

  if (mError || cError) return res.status(500).json({ error: (mError || cError).message });
  res.json({ messages, contacts });
});

// --- BOT LOGIC ---

bot.catch((err, ctx) => {
  logger.error(`Bot Error for ${ctx.update_type}:`, err);
});

async function showStartMenu(ctx) {
  const webAppUrl = process.env.WEBAPP_URL || 'http://localhost:5173';
  const isHttps = webAppUrl?.startsWith('https://');
  
  let text = '✨ *Bienvenue sur LeRelais Hub*\n\nVotre centre de messagerie unifié. Gérez tous vos réseaux au même endroit.';
  
  const keyboard = [];
  if (isHttps) {
    keyboard.push([{ text: '🚀 Ouvrir l’Inbox Unifiée', web_app: { url: webAppUrl } }]);
  } else {
    keyboard.push([{ text: '🚀 Ouvrir l’Inbox (Browser)', url: webAppUrl }]);
  }
  
  keyboard.push([{ text: '🔗 Connecter un Compte', callback_data: 'menu_connect' }]);
  keyboard.push([{ text: '📊 État des Services', callback_data: 'menu_status' }]);

  try {
    if (ctx.callbackQuery) {
      return await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
    }
    return await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
  } catch (err) {
    logger.error('Failed to show start menu:', err);
  }
}

async function showStatus(ctx) {
  const { data: accounts, error } = await supabase
    .from('accounts')
    .select('id, platform, status');
  
  if (error) return ctx.reply('❌ Erreur de base de données.');

  if (!accounts || accounts.length === 0) {
    return ctx.reply('📭 Aucun compte connecté.', {
      reply_markup: { inline_keyboard: [[{ text: '🔗 Connecter un compte', callback_data: 'menu_connect' }]] }
    });
  }

  const statusMsg = accounts.map(a => {
    const icon = a.status === 'connected' ? '✅' : '⏳';
    const activeIcon = activeConnectors[a.id] ? '🔗' : '❌';
    return `${icon} ${activeIcon} *${a.platform.toUpperCase()}* - _${a.status}_`;
  }).join('\n');

  ctx.reply(`📊 *Connexions :*\n\n${statusMsg}`, {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '◀️ Retour', callback_data: 'menu_start' }]] }
  });
}

bot.start(showStartMenu);
bot.action('menu_start', ctx => showStartMenu(ctx));
bot.action('menu_status', ctx => showStatus(ctx));
bot.action('menu_connect', async (ctx) => {
  const keyboard = [
    [{ text: '🟢 WhatsApp', callback_data: 'connect_whatsapp' }],
    [{ text: '📸 Instagram', callback_data: 'connect_instagram' }],
    [{ text: '◀️ Retour', callback_data: 'menu_start' }]
  ];
  ctx.editMessageText('🌐 *Choisissez une plateforme :*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
});

bot.action('connect_instagram', async (ctx) => {
  userState[ctx.from.id] = { action: 'awaiting_ig_username' };
  ctx.reply('📸 Entrez votre nom d\'utilisateur Instagram :');
});

bot.action('connect_whatsapp', async (ctx) => {
  const keyboard = [
    [{ text: '🖼 Code QR', callback_data: 'wa_connect_qr' }],
    [{ text: '🔢 Code de Jumelage', callback_data: 'wa_connect_phone' }]
  ];
  ctx.editMessageText('📱 *Connexion WhatsApp*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
});

bot.action('wa_connect_qr', ctx => handleConnectWhatsApp(ctx));
bot.action('wa_connect_phone', ctx => {
  userState[ctx.from.id] = { action: 'awaiting_phone' };
  ctx.reply('📞 Entrez votre numéro (+33...) :');
});

bot.on('text', async (ctx, next) => {
  const state = userState[ctx.from.id];
  const text = ctx.message.text?.trim();
  if (!text) return next();

  // 1. Instagram Flow
  if (state?.action === 'awaiting_ig_username') {
    userState[ctx.from.id] = { action: 'awaiting_ig_password', username: text };
    return ctx.reply('🔐 Entrez le mot de passe Instagram :');
  }
  if (state?.action === 'awaiting_ig_password') {
    const { username } = state;
    delete userState[ctx.from.id];
    ctx.reply(`📸 Tentative de connexion pour ${username}...`);
    try {
      const accountId = crypto.randomUUID();
      await supabase.from('accounts').insert({ id: accountId, platform: 'instagram', status: 'pairing' });
      activeConnectors[accountId] = await connectToInstagram(accountId, username, text, (p, f, c, aid, eid) => {
        relayToTelegram(p, f, c, aid, eid);
      }, { onConnected: () => ctx.reply('✅ Instagram connecté !') });
    } catch (err) {
      ctx.reply(`❌ Échec : ${err.message}`);
    }
    return;
  }

  // 2. WhatsApp Flow
  if (state?.action === 'awaiting_phone') {
    delete userState[ctx.from.id];
    return handleConnectWhatsApp(ctx, text);
  }

  // 3. Replies
  if (ctx.message.reply_to_message) {
    const meta = relayMap.get(ctx.message.reply_to_message.message_id);
    if (meta) {
      try {
        const connector = activeConnectors[meta.accountId];
        if (!connector) return ctx.reply('❌ Compte non actif.');
        if (meta.platform === 'whatsapp') {
          await connector.sendMessage(meta.externalId, { text });
        } else {
          await connector.sendMessage(meta.externalId, text);
        }
        return ctx.reply('📤 Envoyé.');
      } catch (err) {
        return ctx.reply(`❌ Erreur : ${err.message}`);
      }
    }
  }

  return next();
});

async function handleConnectWhatsApp(ctx, phoneNumber = null) {
  const accountId = crypto.randomUUID();
  await supabase.from('accounts').insert({ id: accountId, platform: 'whatsapp', status: 'pairing', username: 'whatsapp_user' });
  const waitMsg = await ctx.reply('🔄 Initialisation...');
  try {
    const sock = await connectToWhatsApp(accountId, (p, f, c, aid, eid) => {
      relayToTelegram(p, f, c, aid, eid);
    }, {
      phoneNumber,
      onQR: async (qr) => {
        const qrBuffer = await QRCode.toBuffer(qr);
        ctx.replyWithPhoto({ source: qrBuffer }, { caption: '📸 Scannez pour vous connecter.' });
        ctx.deleteMessage(waitMsg.message_id).catch(() => {});
      },
      onPairingCode: (code) => {
        ctx.telegram.editMessageText(ctx.chat.id, waitMsg.message_id, null, `🔢 Code : \`${code}\``, { parse_mode: 'Markdown' });
      },
      onConnected: () => {
        ctx.reply('✅ connecté !');
        activeConnectors[accountId] = sock;
      }
    });
    activeConnectors[accountId] = sock;
  } catch (err) {
    logger.error(err);
    ctx.reply('❌ Erreur.');
  }
}

async function relayToTelegram(platform, from, content, accountId, externalId) {
  try {
    const adminId = process.env.ADMIN_ID;
    if (!adminId) return;
    const sent = await bot.telegram.sendMessage(adminId, `📥 *[${platform.toUpperCase()}]* ${from}:\n${content}`, { parse_mode: 'Markdown' });
    relayMap.set(sent.message_id, { accountId, externalId, platform });
    setTimeout(() => relayMap.delete(sent.message_id), 86400000);
  } catch (err) {
    logger.error('Relay error:', err);
  }
}

async function restoreConnectors() {
  const { data: accounts } = await supabase.from('accounts').select('*').eq('status', 'connected');
  if (accounts) {
    for (const acc of accounts) {
      if (acc.platform === 'whatsapp') {
        activeConnectors[acc.id] = await connectToWhatsApp(acc.id, (p, f, c, aid, eid) => relayToTelegram(p, f, c, aid, eid));
      }
    }
  }
}

async function setupMenuButton() {
  try {
    const webAppUrl = process.env.WEBAPP_URL || 'http://localhost:5173';
    if (webAppUrl.startsWith('https://')) {
      await bot.telegram.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Ouvrir LeRelais', web_app: { url: webAppUrl } } });
      logger.info('✅ Menu Button configured');
    }
  } catch (err) {
    logger.error('❌ Menu button failed:', err);
  }
}

// Serve index.html for any unknown routes (SPA support) - Production only
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

async function start() {
  await restoreConnectors();
  
  // Production / Railway URL handling
  if (process.env.RAILWAY_STATIC_URL) {
    process.env.WEBAPP_URL = `https://${process.env.RAILWAY_STATIC_URL}`;
    logger.info(`🌐 Railway Production URL: ${process.env.WEBAPP_URL}`);
  }

  // Tunneling for Mini App (Dev only)
  let pubUrl = process.env.WEBAPP_URL || 'http://localhost:5173';
  if (pubUrl.includes('localhost') && process.env.NODE_ENV !== 'production') {
    try {
      const tunnel = await localtunnel({ port: 5173 });
      pubUrl = tunnel.url;
      process.env.WEBAPP_URL = pubUrl;
      logger.info(`✨ Dev Tunnel: ${pubUrl}`);
    } catch (e) { logger.error('Tunnel failed'); }
  }

  await setupMenuButton();
  bot.launch();
  
  app.listen(port, '0.0.0.0', () => {
    logger.info(`🚀 Server on ${port} (0.0.0.0)`);
    logger.info(`📱 Hub URL: ${process.env.WEBAPP_URL}`);
  });
}

start();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
