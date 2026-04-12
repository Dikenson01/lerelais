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
      logger.info(`WhatsApp connection opened for account ${accountId}`);
      await supabase.from('accounts').update({ status: 'connected' }).eq('id', accountId);
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
        avatar_url: null, // Profiles pics need a separate fetch
        metadata: { source: 'whatsapp' }
      }));
      await supabase.from('contacts').upsert(contactData, { onConflict: 'account_id, external_id' });
    }

    // 2. Sync Conversations (Chats)
    if (chats.length > 0) {
      // First, we need to make sure all contacts exist to satisfy FK constraints
      const chatData = chats.map(c => ({
        account_id: accountId,
        external_conversation_id: c.id,
        platform: 'whatsapp',
        last_message_preview: '', // Will be updated by messages
      
      // We do this carefully because contacts might not be in the contacts array but in chats
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
            external_conversation_id: chat.id,
            platform: 'whatsapp',
            updated_at: new Date()
          }, { onConflict: 'account_id, external_conversation_id' });
        }
      }
    }

    // 3. Sync recent messages
    if (messages.length > 0) {
      logger.info(`📜 Processing ${messages.length} historical messages...`);
      // We only take the last few to avoid overloading
      const recentMessages = messages.slice(-50); 
      for (const m of recentMessages) {
        await handleMessageUpsert(m.message, true); // Simplified helper
      }
    }
  });

  sock.ev.on('chats.upsert', async (newChats) => {
    for (const chat of newChats) {
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
          external_conversation_id: chat.id,
          platform: 'whatsapp',
          updated_at: new Date()
        }, { onConflict: 'account_id, external_conversation_id' });
      }
    }
  });

  const handleMessageUpsert = async (msg, isHistory = false) => {
    try {
      const remoteJid = msg.key.remoteJid;
      if (!remoteJid) return;

      const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || (msg.message?.imageMessage ? '[Image]' : '[Media]');
      
      let avatarUrl = null;
      try {
        avatarUrl = await sock.profilePictureUrl(remoteJid, 'image').catch(() => null);
      } catch (e) {}

      const { data: contact } = await supabase.from('contacts').upsert({
        account_id: accountId,
        external_id: remoteJid,
        display_name: msg.pushName || remoteJid.split('@')[0],
        avatar_url: avatarUrl
      }, { onConflict: 'account_id, external_id' }).select().single();

      if (!contact) return;

      const { data: conv } = await supabase.from('conversations').upsert({
        account_id: accountId,
        contact_id: contact.id,
        external_conversation_id: remoteJid,
        platform: 'whatsapp',
        last_message_preview: content?.slice(0, 100),
        updated_at: new Date()
      }, { onConflict: 'account_id, external_conversation_id' }).select().single();

      if (!conv) return;

      await supabase.from('messages').upsert({
        conversation_id: conv.id,
        sender_id: msg.key.fromMe ? 'me' : remoteJid,
        content: content || '',
        is_from_me: !!msg.key.fromMe,
        timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000),
        metadata: { message_id: msg.key.id }
      }, { onConflict: 'conversation_id, metadata->>message_id' }); // Use unique message ID

      if (!isHistory && onMessage && !msg.key.fromMe) {
        onMessage('whatsapp', contact.display_name || remoteJid, content, accountId, remoteJid);
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
