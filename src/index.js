import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'node:crypto';
import logger from './utils/logger.js';
import supabase from './config/supabase.js';
import { connectToWhatsApp } from './connectors/whatsapp.js';
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

// --- API ROUTES ---

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

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
  // Ultra-simple select first to diagnose
  const { data, error } = await supabase.from('conversations').select('*');
  if (error) {
    logger.error('CRITICAL DB ERROR /api/conversations:', JSON.stringify(error, null, 2));
    return res.status(500).json({ error: error.message });
  }
  res.json(data || []);
});

app.get('/api/contacts', async (req, res) => {
  const { data, error } = await supabase.from('contacts').select('*').order('display_name');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/api/messages/:convId', async (req, res) => {
  const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', req.params.convId).order('timestamp', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/messages', async (req, res) => {
  const { conversationId, content } = req.body;
  try {
    const { data: conv } = await supabase.from('conversations').select('*').eq('id', conversationId).single();
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const sock = activeConnectors[conv.account_id];
    if (sock) {
      if (conv.platform === 'whatsapp') {
        await sock.sendMessage(conv.external_id, { text: content });
      } else {
        await sock.sendMessage(conv.external_id, content);
      }
    }

    const { data: msg } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      account_id: conv.account_id,
      content,
      is_from_me: true,
      timestamp: new Date()
    }).select().single();

    await supabase.from('conversations').update({ last_message_preview: content, updated_at: new Date() }).eq('id', conversationId);
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
  const accountId = crypto.randomUUID();
  await supabase.from('accounts').insert({ id: accountId, platform: 'whatsapp', status: 'pairing' });
  const sock = await connectToWhatsApp(accountId, (p, f, c, aid, eid) => relayToTelegram(p, f, c, aid, eid), {
    onQR: (qr) => qrMap.set(accountId, qr),
    onConnected: () => {
      qrMap.delete(accountId);
      activeConnectors[accountId] = sock;
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

async function restoreConnectors() {
  const { count: accCount } = await supabase.from('accounts').select('*', { count: 'exact', head: true });
  const { count: convCount } = await supabase.from('conversations').select('*', { count: 'exact', head: true });
  logger.info(`🔍 Startup DB Check: ${accCount || 0} accounts, ${convCount || 0} conversations in DB`);

  const { data: accounts } = await supabase.from('accounts').select('*').eq('status', 'connected');
  if (accounts) {
    logger.info(`🔄 Attempting to restore ${accounts.length} active connectors...`);
    for (const acc of accounts) {
      if (acc.platform === 'whatsapp') {
        activeConnectors[acc.id] = await connectToWhatsApp(acc.id, (p, f, c, aid, eid) => relayToTelegram(p, f, c, aid, eid));
      }
    }
  }
}

async function start() {
  await restoreConnectors();
  if (process.env.RAILWAY_STATIC_URL) process.env.WEBAPP_URL = `https://${process.env.RAILWAY_STATIC_URL}`;
  
  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Server running on port ${PORT}`);
  });

  await setupMenuButton();
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    bot.launch();
  } catch (e) {}
}

start();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
