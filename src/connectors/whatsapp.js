import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import logger from '../utils/logger.js';
import supabase from '../config/supabase.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function connectToWhatsApp(accountId, onMessage, onEvents) {
  const authPath = path.join(__dirname, `../../auth/wa-${accountId}`);
  if (!fs.existsSync(authPath)) {
    fs.mkdirSync(authPath, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  
  logger.info(`Starting WhatsApp connector for account ${accountId} (v${version.join('.')}, latest: ${isLatest})`);

  const sock = makeWASocket({
    version,
    printQRInTerminal: !onEvents?.onQR, 
    auth: state,
    logger: logger.child({ module: 'baileys' }),
    browser: Browsers.macOS('Desktop')
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr, pairingCode } = update;

    if (qr && onEvents?.onQR) {
      onEvents.onQR(qr);
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.warn(`WhatsApp connection closed for ${accountId}. Reconnecting: ${shouldReconnect}`);
      if (shouldReconnect) {
        connectToWhatsApp(accountId, onMessage, onEvents);
      }
    } else if (connection === 'open') {
      logger.info(`🌐 WhatsApp connection OPENED for account ${accountId}`);
      try {
        const { error } = await supabase.from('accounts').update({ status: 'connected' }).eq('id', accountId);
        if (error) {
          logger.error(`❌ Failed to update account status to connected: ${error.message}`);
        } else {
          logger.info(`✅ Account status updated to 'connected' in DB for ${accountId}`);
        }
      } catch (err) {
        logger.error(`❌ Unexpected error updating account status: ${err.message}`);
      }
      if (onEvents?.onConnected) onEvents.onConnected();
    }
  });

  // Handle Pairing Code Request if phoneNumber provided
  if (onEvents?.phoneNumber && !sock.authState.creds.registered) {
    logger.info(`Requesting pairing code for ${onEvents.phoneNumber}...`);
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(onEvents.phoneNumber.replace(/[^0-9]/g, ''));
        if (onEvents?.onPairingCode) onEvents.onPairingCode(code);
      } catch (err) {
        logger.error('Failed to request pairing code:', err);
      }
    }, 5000); // 5s delay to ensure socket is ready
  }

  // --- HISTORICAL SYNC ---
  sock.ev.on('messaging-history.sync', async ({ chats, contacts, messages, isLatest }) => {
    logger.info(`📥 History Sync: ${chats.length} chats, ${contacts.length} contacts, ${messages.length} messages`);
    
    // 1. Sync Contacts
    if (contacts.length > 0) {
      const contactData = contacts.map(c => ({
        account_id: accountId,
        external_id: c.id,
        display_name: c.name || c.verifiedName || c.notify || c.id.split('@')[0],
        avatar_url: null,
        metadata: { source: 'whatsapp' }
      }));
      await supabase.from('contacts').upsert(contactData, { onConflict: 'account_id, external_id' });
    }

    // 2. Sync Conversations (Chats)
    if (chats.length > 0) {
      for (const chat of chats) {
        let avatarUrl = null;
        try {
          avatarUrl = await sock.profilePictureUrl(chat.id, 'image').catch(() => null);
        } catch (e) {}

        const { data: contact } = await supabase.from('contacts').upsert({
          account_id: accountId,
          external_id: chat.id,
          display_name: chat.name || chat.id.split('@')[0],
          avatar_url: avatarUrl
        }, { onConflict: 'account_id, external_id' }).select().single();

        if (contact) {
          await supabase.from('conversations').upsert({
            account_id: accountId,
            contact_id: contact.id,
            external_id: chat.id,
            platform: 'whatsapp',
            title: chat.name || chat.id.split('@')[0],
            updated_at: new Date()
          }, { onConflict: 'account_id, external_id' });
        }
      }
    }

    // 3. Sync recent messages
    if (messages.length > 0) {
      logger.info(`📜 Processing ${messages.length} historical messages...`);
      for (const m of messages.slice(-100)) { 
        await handleMessageUpsert(m.message || m, true);
      }
    }
  });

  sock.ev.on('chats.upsert', async (newChats) => {
    for (const chat of newChats) {
      const { data: contact } = await supabase.from('contacts').upsert({
        account_id: accountId,
        external_id: chat.id,
        display_name: chat.name || chat.id.split('@')[0]
      }, { onConflict: 'account_id, external_id' }).select().single();

      if (contact) {
        await supabase.from('conversations').upsert({
          account_id: accountId,
          contact_id: contact.id,
          external_id: chat.id,
          platform: 'whatsapp',
          title: chat.name || chat.id.split('@')[0],
          updated_at: new Date()
        }, { onConflict: 'account_id, external_id' });
      }
    }
  });

  const handleMessageUpsert = async (msg, isHistory = false) => {
    try {
      const message = msg.message || msg;
      const key = msg.key || message.key;
      const remoteJid = key?.remoteJid;
      if (!remoteJid) return;

      const content = message.conversation || message.extendedTextMessage?.text || (message.imageMessage ? '[Image]' : message.videoMessage ? '[Vidéo]' : '[Média]');
      
      const { data: contact } = await supabase.from('contacts').upsert({
        account_id: accountId,
        external_id: remoteJid,
        display_name: msg.pushName || remoteJid.split('@')[0]
      }, { onConflict: 'account_id, external_id' }).select().single();

      if (!contact) return;

      const { data: conv, error: convErr } = await supabase.from('conversations').upsert({
        account_id: accountId,
        contact_id: contact.id,
        external_id: remoteJid,
        platform: 'whatsapp',
        last_message_preview: content?.slice(0, 100),
        updated_at: new Date()
      }, { onConflict: 'account_id, external_id' }).select().single();

      if (convErr || !conv) return;

      // Upsert Message
      await supabase.from('messages').upsert({
        conversation_id: conv.id,
        account_id: accountId,
        remote_id: key.id,
        sender_id: key.fromMe ? 'me' : remoteJid,
        content: content || '',
        is_from_me: !!key.fromMe,
        timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000),
        media_type: message.imageMessage ? 'image' : message.videoMessage ? 'video' : null,
        metadata: { ...message, pushName: msg.pushName }
      }, { onConflict: 'remote_id' });

      if (!isHistory && onMessage && !key.fromMe) {
        onMessage('whatsapp', msg.pushName || remoteJid, content, accountId, remoteJid);
      }
    } catch (err) {
      logger.error(`Sync error: ${err.message}`);
    }
  };

  sock.ev.on('messages.upsert', async (m) => {
    for (const msg of m.messages) {
      await handleMessageUpsert(msg);
    }
  });

  sock.ev.on('call.upsert', async (calls) => {
    for (const call of calls) {
      if (call.status === 'offer') {
        const from = call.from.split('@')[0];
        onMessage('whatsapp', from, `📞 Appel ${call.isVideo ? 'Vidéo' : 'Audio'} entrant...`, accountId, call.from);
      }
    }
  });

  return sock;
}
