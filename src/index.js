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
  const { data, error } = await supabase.from('conversations').select('*, contacts(*)').order('last_message_at', { ascending: false });
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
    const { data: conv, error: convError } = await supabase.from('conversations').select('*').eq('id', conversationId).single();
    if (!conv || convError) return res.status(404).json({ error: 'Conversation not found' });

    const sock = activeConnectors[conv.account_id];
    let remoteId = `temp-${crypto.randomUUID()}`; // Default temp ID
    
    if (sock) {
      try {
        if (conv.platform === 'whatsapp') {
          const sent = await sock.sendMessage(conv.external_id, content);
          remoteId = sent.messageId || remoteId;
        } else {
          const sent = await sock.sendMessage(conv.external_id, content);
          remoteId = sent.id || sent.pk || remoteId;
        }
      } catch (sendErr) {
        logger.error(`Failed to send via ${conv.platform}:`, sendErr.message);
        return res.status(503).json({ error: `Could not send: ${sendErr.message}` });
      }
    } else {
      logger.warn(`Connector missing for account ${conv.account_id}. Message saved locally only.`);
    }

    const { data: msg, error: insertError } = await supabase.from('messages').upsert({
      conversation_id: conversationId,
      account_id: conv.account_id,
      remote_id: remoteId,
      content,
      is_from_me: true,
      timestamp: new Date()
    }, { onConflict: 'remote_id' }).select().single();

    if (insertError) throw insertError;

    await supabase.from('conversations').update({ last_message_preview: content, last_message_at: new Date() }).eq('id', conversationId);
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

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
