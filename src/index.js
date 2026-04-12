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
      await connector.sendMessage(conv.external_id, { text: content });
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

app.post('/api/sync/all', async (req, res) => {
  try {
    logger.info('🔄 Manual sync requested for all accounts');
    for (const accountId in activeConnectors) {
      const sock = activeConnectors[accountId];
      if (sock?.ev) {
        // Request aggressive history/contact sync from WA
        sock.ev.emit('messaging-history.sync', { chats: [], contacts: [], messages: [], isLatest: true });
        logger.info(`📡 Triggered deep sync for WA ${accountId}`);
      }
    }
    res.json({ success: true });
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

const qrMap = new Map();

app.post('/api/connect/whatsapp', async (req, res) => {
  const accountId = crypto.randomUUID();
  try {
    logger.info(`🌐 New WhatsApp connection request. ID: ${accountId}`);
    await supabase.from('accounts').insert({ id: accountId, platform: 'whatsapp', status: 'pairing' });
    const sock = await connectToWhatsApp(accountId, (p, f, c, aid, eid) => relayToTelegram(p, f, c, aid, eid), {
      onQR: (qr) => {
        logger.info(`📸 QR received for ${accountId}`);
        qrMap.set(accountId, qr);
      },
      onConnected: () => {
        logger.info(`✅ Account ${accountId} connected!`);
        qrMap.delete(accountId);
        activeConnectors[accountId] = sock;
      }
    });
    res.json({ accountId });
  } catch (err) {
    logger.error(`❌ WA Connect Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/connect/whatsapp/status/:id', async (req, res) => {
  const accountId = req.params.id;
  const qr = qrMap.get(accountId);
  const { data: account, error } = await supabase.from('accounts').select('status').eq('id', accountId).single();
  
  if (error) logger.error(`Poll error for ${accountId}: ${error.message}`);
  // logger.info(`🔍 Polling ${accountId}: status=${account?.status}, QR=${qr ? 'YES' : 'NO'}`);
  
  res.json({ qr: qr || null, status: account?.status || 'unknown' });
});

app.get('/api/accounts', async (req, res) => {
  try {
    const { data: accounts, error } = await supabase.from('accounts').select('*');
    if (error) {
      logger.error(`❌ Supabase error fetching accounts: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }
    logger.info(`📋 GET /api/accounts: returning ${accounts?.length || 0} accounts`);
    res.json(accounts);
  } catch (err) {
    logger.error('❌ Critical error in /api/accounts:', err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await supabase.from('accounts').delete().eq('id', id);
    if (activeConnectors[id]) {
      // Logic to actually disconnect the socket could go here
      delete activeConnectors[id];
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/connect/instagram', async (req, res) => {
  const { username, password } = req.body;
  const accountId = crypto.randomUUID();
  try {
    await supabase.from('accounts').insert({ id: accountId, platform: 'instagram', status: 'pairing' });
    activeConnectors[accountId] = await connectToInstagram(accountId, username, password, (p, f, c, aid, eid) => relayToTelegram(p, f, c, aid, eid), {
      onConnected: () => logger.info(`IG ${username} connected`)
    });
    res.json({ accountId, status: 'connecting' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- BOT LOGIC ---

bot.catch((err, ctx) => {
  logger.error(`Bot Error for ${ctx.update_type}:`, err);
});

async function showStartMenu(ctx) {
  const webAppUrl = process.env.WEBAPP_URL || 'http://localhost:5173';
  const isHttps = webAppUrl?.startsWith('https://');
  
  let text = '✨ *Bienvenue sur LeRelais Hub*\n\nVotre centre de messagerie unifiée. Cliquez ci-dessous pour commencer.';
  
  const keyboard = [];
  if (isHttps) {
    keyboard.push([{ text: '🚀 Le Relais', web_app: { url: webAppUrl } }]);
  } else {
    keyboard.push([{ text: '🚀 Le Relais (Browser)', url: webAppUrl }]);
  }
  
  try {
    if (ctx.callbackQuery) {
      return await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
    }
    return await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
  } catch (err) {
    logger.error('Failed to show start menu:', err);
  }
}

bot.start(showStartMenu);
bot.action('menu_start', ctx => showStartMenu(ctx));

async function setupMenuButton() {
  try {
    const webAppUrl = process.env.WEBAPP_URL || 'http://localhost:5173';
    if (webAppUrl.startsWith('https://')) {
      await bot.telegram.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Le Relais', web_app: { url: webAppUrl } } });
      logger.info('✅ Menu Button configured');
    }
  } catch (err) {
    logger.error('❌ Menu button failed:', err);
  }
}
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text?.trim();
  if (!text) return next();

  // Replies only - Connection logic moved to Mini App
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
        const sock = await connectToWhatsApp(acc.id, (p, f, c, aid, eid) => relayToTelegram(p, f, c, aid, eid));
        activeConnectors[acc.id] = sock;
      }
    }
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
  
  // Clean start for Telegram Bot (resolve 409 Conflict)
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    bot.launch().then(() => {
      logger.info('🚀 Telegram Bot launched successfully');
    }).catch(err => {
      if (err.response?.error_code === 409) {
        logger.warn('⚠️ Telegram Bot: 409 Conflict persists. Another instance is still active.');
      } else {
        logger.error('❌ Telegram Bot Launch Error:', err);
      }
    });
  } catch (e) {
    logger.error('❌ Failed to clean Telegram webhook:', e);
  }
  
  app.listen(port, '0.0.0.0', async () => {
    logger.info(`🚀 Server on ${port} (0.0.0.0)`);
    logger.info(`📱 Hub URL: ${process.env.WEBAPP_URL}`);

    // Quick DB check
    try {
      const { error } = await supabase.from('accounts').select('id').limit(1);
      if (error) {
        logger.error(`🚨 DATABASE SCHEMA ALERT: Table 'accounts' might be missing! Error: ${error.message}`);
      } else {
        logger.info(`✅ Database connection and 'accounts' table verified.`);
      }
    } catch (e) {
      logger.error(`🚨 Failed to reach database: ${e.message}`);
    }
  });
}

start();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
