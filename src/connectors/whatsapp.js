import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion,
  Browsers
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

  sock.ev.on('messages.upsert', async (m) => {
    // ... (rest of the message syncing logic remains the same)
    if (m.type === 'notify') {
      for (const msg of m.messages) {
        try {
          const remoteJid = msg.key.remoteJid;
          const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.buttonsResponseMessage?.selectedDisplayText || (msg.message?.imageMessage ? '[Image]' : '[Media]');
          
          if (!remoteJid) continue;

          // 1. Ensure contact exists
          const { data: contact, error: contactError } = await supabase
            .from('contacts')
            .upsert({
              account_id: accountId,
              external_id: remoteJid,
              display_name: msg.pushName || remoteJid.split('@')[0],
              username: remoteJid.split('@')[0],
              last_message_at: new Date(),
              metadata: { source: 'whatsapp' }
            }, { onConflict: 'account_id, external_id' })
            .select()
            .single();

          if (contactError) {
            logger.error(`❌ Contact Upsert Error: ${JSON.stringify(contactError, null, 2)}`);
            throw contactError;
          }

          // 2. Ensure conversation exists
          const { data: conv, error: convError } = await supabase
            .from('conversations')
            .upsert({
              account_id: accountId,
              contact_id: contact.id,
              external_conversation_id: remoteJid,
              platform: 'whatsapp',
              last_message_preview: content?.slice(0, 100),
              updated_at: new Date(),
              metadata: { source: 'whatsapp' }
            }, { onConflict: 'account_id, external_conversation_id' })
            .select()
            .single();

          if (convError) {
            logger.error(`❌ Conversation Upsert Error: ${JSON.stringify(convError, null, 2)}`);
            throw convError;
          }

          // 3. Save message
          const { error: msgError } = await supabase
            .from('messages')
            .insert({
              conversation_id: conv.id,
              sender_id: msg.key.fromMe ? 'me' : remoteJid,
              content: content || '',
              content_type: msg.message?.imageMessage ? 'image' : 'text',
              is_from_me: !!msg.key.fromMe,
              timestamp: new Date(msg.messageTimestamp * 1000),
              status: 'saved',
              metadata: { message_id: msg.key.id }
            });

          if (msgError) {
            logger.error(`❌ Message Insert Error: ${JSON.stringify(msgError, null, 2)}`);
            throw msgError;
          }

          logger.info(`Synced message from ${remoteJid} to Supabase`);

          // Relay to Telegram if callback provided
          if (onMessage && !msg.key.fromMe) {
            onMessage('whatsapp', contact.display_name || remoteJid, content, accountId, remoteJid);
          }
        } catch (err) {
          logger.error(`Failed to sync message: ${err.message || 'Unknown error'}`);
        }
      }
    }
  });

  return sock;
}
