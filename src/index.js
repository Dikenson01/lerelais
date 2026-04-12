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

app.post('/api/contacts/:id/rename', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  try {
    const { data: contact, error } = await supabase
      .from('contacts')
      .update({ display_name: name })
      .eq('id', id)
      .select().single();
    
    if (error) throw error;

    // Sync back to WhatsApp if connector is active
    const sock = activeConnectors[contact.account_id];
    if (sock) {
      // In Baileys, we can notify about the update (though sync to phone address book is limited)
      sock.ev.emit('contacts.update', [{ id: contact.external_id, name }]);
      logger.info(`🔄 Pushed name update for ${contact.external_id} to connector`);
    }

    res.json(contact);
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

// Define PORT early
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Log every API request for debugging
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    logger.info(`📡 ${req.method} ${req.path}`);
  }
  next();
});

// --- API ROUTES ---
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));

app.get('/api/accounts', async (req, res) => {
  const { data, error } = await supabase.from('accounts').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get('/api/conversations', async (req, res) => {
  const { data, error } = await supabase.from('conversations').select('*, contacts(*)').order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
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
  const { data: conv } = await supabase.from('conversations').select('*').eq('id', conversationId).single();
  if (conv) {
    const sock = activeConnectors[conv.account_id];
    if (sock) {
      if (conv.platform === 'whatsapp') {
        await sock.sendMessage(conv.external_id, { text: content });
      } else {
        await sock.sendMessage(conv.external_id, content);
      }
      const { data: msg } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        account_id: conv.account_id,
        content,
        is_from_me: true,
        timestamp: new Date()
      }).select().single();
      return res.json(msg);
    }
  }
  res.status(404).json({ error: 'Connector not found' });
});

// --- STATIC FILES & SPA ---
const distPath = path.resolve(__dirname, '../web/dist');
app.use(express.static(distPath));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// --- START ---
async function start() {
  await restoreConnectors();
  
  if (process.env.RAILWAY_STATIC_URL) {
    process.env.WEBAPP_URL = `https://${process.env.RAILWAY_STATIC_URL}`;
  }

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`📱 Hub URL: ${process.env.WEBAPP_URL || 'http://localhost:' + PORT}`);
  });

  await setupMenuButton();
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    bot.launch();
  } catch (e) {}
}

start();
