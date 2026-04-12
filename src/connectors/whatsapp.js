import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage,
  delay
} from '@whiskeysockets/baileys';
import logger from '../utils/logger.js';
import supabase from '../config/supabase.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function connectToWhatsApp(accountId, onMessage, onEvents) {
  // 1. Initial Local Auth State (still needed for Baileys internal mechanics)
  const authPath = path.join(__dirname, `../../auth/wa-${accountId}`);
  if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });
  
  // 2. RESTORE from DATABASE if local is empty (Railway Restart)
  if (fs.readdirSync(authPath).length === 0) {
    logger.info(`🔍 Local session for ${accountId} is empty. Attempting restore from DB...`);
    const { data: account } = await supabase.from('accounts').select('credentials').eq('id', accountId).single();
    if (account?.credentials?.creds) {
      // Restore creds.json
      fs.writeFileSync(path.join(authPath, 'creds.json'), JSON.stringify(account.credentials.creds));
      logger.info(`✅ Successfully restored creds from DB for ${accountId}`);
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();
  
  const sock = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: state,
    logger: logger.child({ module: 'baileys' }),
    browser: Browsers.macOS('Desktop')
  });

  // 3. PERSIST to DATABASE on every update
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    // Also save the core creds to Supabase to survive container wipes
    const credsJson = JSON.parse(fs.readFileSync(path.join(authPath, 'creds.json'), 'utf-8'));
    await supabase.from('accounts').update({ credentials: { creds: credsJson } }).eq('id', accountId);
    logger.info(`💾 Session creds saved to DB for ${accountId}`);
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && onEvents?.onQR) onEvents.onQR(qr);

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn(`WhatsApp connection closed for ${accountId}. Reconnect: ${shouldReconnect}`);
      if (shouldReconnect) connectToWhatsApp(accountId, onMessage, onEvents);
    } else if (connection === 'open') {
      logger.info(`✅ WhatsApp OPEN for ${accountId}`);
      await supabase.from('accounts').update({ status: 'connected' }).eq('id', accountId);
      if (onEvents?.onConnected) onEvents.onConnected();
      
      // Fetch Profile Pics for all contacts with no avatar
      const { data: emptyContacts } = await supabase.from('contacts').select('external_id').eq('account_id', accountId).is('avatar_url', null);
      if (emptyContacts) {
        logger.info(`📸 Syncing ${emptyContacts.length} profile pictures...`);
        for (const c of emptyContacts) {
          try {
            const url = await sock.profilePictureUrl(c.external_id, 'image');
            if (url) await supabase.from('contacts').update({ avatar_url: url }).eq('account_id', accountId).eq('external_id', c.external_id);
            await delay(1000); // Respect stability
          } catch(e) {}
        }
      }
    }
  });

  // --- HISTORICAL SYNC --- (Unified table usage)
  sock.ev.on('messaging-history.sync', async ({ chats, contacts, messages }) => {
    logger.info(`📥 History Sync: ${chats.length} chats, ${contacts.length} contacts, ${messages.length} messages`);
    
    // Contacts
    if (contacts.length > 0) {
      await supabase.from('contacts').upsert(contacts.map(c => ({
        account_id: accountId,
        external_id: c.id,
        display_name: c.name || c.verifiedName || c.notify || c.id.split('@')[0],
        metadata: { source: 'whatsapp_sync' }
      })), { onConflict: 'account_id, external_id' });
    }

    // Conversations & Messages
    for (const chat of chats) {
      const { data: contact } = await supabase.from('contacts').upsert({
        account_id: accountId,
        external_id: chat.id,
        display_name: chat.name || chat.id.split('@')[0],
      }, { onConflict: 'account_id, external_id' }).select().single();

      if (contact) {
        const { data: conv } = await supabase.from('conversations').upsert({
          account_id: accountId,
          contact_id: contact.id,
          external_id: chat.id,
          platform: 'whatsapp',
          title: chat.name || chat.id.split('@')[0],
          updated_at: new Date()
        }, { onConflict: 'account_id, external_id' }).select().single();

        // Process a few recent messages per chat from the history sync batch
        const chatMessages = messages.filter(m => m.key.remoteJid === chat.id).slice(-20);
        for (const m of chatMessages) {
          const content = m.message?.conversation || m.message?.extendedTextMessage?.text || '[Média]';
          await supabase.from('messages').upsert({
            conversation_id: conv.id,
            account_id: accountId,
            remote_id: m.key.id,
            sender_id: m.key.fromMe ? 'me' : m.key.remoteJid,
            content: content,
            is_from_me: !!m.key.fromMe,
            timestamp: new Date((m.messageTimestamp || Date.now() / 1000) * 1000),
            metadata: { ...m.message }
          }, { onConflict: 'remote_id' });
        }
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    for (const msg of m.messages) {
      const key = msg.key;
      const remoteJid = key.remoteJid;
      if (!remoteJid) continue;

      const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[Média]';
      
      const { data: contact } = await supabase.from('contacts').upsert({
        account_id: accountId,
        external_id: remoteJid,
        display_name: msg.pushName || remoteJid.split('@')[0]
      }, { onConflict: 'account_id, external_id' }).select().single();

      if (contact) {
        const { data: conv } = await supabase.from('conversations').upsert({
          account_id: accountId,
          contact_id: contact.id,
          external_id: remoteJid,
          platform: 'whatsapp',
          last_message_preview: content?.slice(0, 100),
          updated_at: new Date()
        }, { onConflict: 'account_id, external_id' }).select().single();

        if (conv) {
          await supabase.from('messages').upsert({
            conversation_id: conv.id,
            account_id: accountId,
            remote_id: key.id,
            sender_id: key.fromMe ? 'me' : remoteJid,
            content,
            is_from_me: !!key.fromMe,
            timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000),
            metadata: { ...msg.message }
          }, { onConflict: 'remote_id' });
        }
      }

      if (onMessage && !key.fromMe) {
        onMessage('whatsapp', msg.pushName || remoteJid, content, accountId, remoteJid);
      }
    }
  });

  return sock;
}
