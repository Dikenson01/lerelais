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
  const authPath = path.join(__dirname, `../auth/wa-${accountId}`);
  if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });
  
  // 1. FULL RESTORE from DB
  try {
    const { data: account } = await supabase.from('accounts').select('credentials').eq('id', accountId).single();
    if (account?.credentials?.files) {
      logger.info(`🔍 Restoring session for ${accountId} (${Object.keys(account.credentials.files).length} files)...`);
      for (const [file, content] of Object.entries(account.credentials.files)) {
        fs.writeFileSync(path.join(authPath, file), content);
      }
      logger.info('✅ Session files restored');
    }
  } catch (e) {
    logger.error('Failed session restore:', e);
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

  // 2. FULL PERSIST to DB
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    // Scan all files in auth folder and save to DB
    const files = {};
    const authFiles = fs.readdirSync(authPath);
    for (const file of authFiles) {
      if (file.endsWith('.json')) {
        files[file] = fs.readFileSync(path.join(authPath, file), 'utf-8');
      }
    }
    await supabase.from('accounts').update({ credentials: { files } }).eq('id', accountId);
    logger.info(`💾 Full session (${authFiles.length} files) persisted to DB`);
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && onEvents?.onQR) onEvents.onQR(qr);

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) connectToWhatsApp(accountId, onMessage, onEvents);
    } else if (connection === 'open') {
      logger.info(`✅ WhatsApp OPEN for ${accountId}`);
      await supabase.from('accounts').update({ status: 'connected' }).eq('id', accountId);
      if (onEvents?.onConnected) onEvents.onConnected();
      
      // Intensive profile pic sync
      const { data: list } = await supabase.from('contacts').select('external_id').eq('account_id', accountId);
      if (list) {
        for (const c of list) {
          try {
            const url = await sock.profilePictureUrl(c.external_id, 'image');
            if (url) await supabase.from('contacts').update({ avatar_url: url }).eq('account_id', accountId).eq('external_id', c.external_id);
            await delay(500);
          } catch(e) {}
        }
      }
    }
  });

  // (Event listeners for messages/history/contacts remain same as previous turno but optimized)
  sock.ev.on('messaging-history.sync', async ({ chats, contacts, messages }) => {
    logger.info(`📥 History Sync: ${chats.length} chats, ${messages?.length || 0} messages`);
    
    // 1. Sync Chats & Conversations
    for (const chat of chats) {
      const { data: contact } = await supabase.from('contacts').upsert({
        account_id: accountId,
        external_id: chat.id,
        display_name: chat.name || chat.id.split('@')[0],
      }, { onConflict: 'account_id, external_id' }).select().single();

      if (contact) {
        await supabase.from('conversations').upsert({
          account_id: accountId,
          contact_id: contact.id,
          external_id: chat.id,
          platform: 'whatsapp',
          title: chat.name || chat.id.split('@')[0],
          last_message_preview: chat.lastMessageRecvTimestamp ? 'Historique synchronisé' : null,
          updated_at: new Date()
        }, { onConflict: 'account_id, external_id' });
      }
    }

    // 2. Sync History Messages
    if (messages && messages.length > 0) {
      for (const msg of messages) {
        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) continue;
        const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '[Média]';
        
        // Find existing conversation
        const { data: conv } = await supabase.from('conversations').select('id').eq('account_id', accountId).eq('external_id', remoteJid).single();
        if (conv) {
          await supabase.from('messages').upsert({
            conversation_id: conv.id,
            account_id: accountId,
            remote_id: msg.key.id,
            sender_id: msg.key.fromMe ? 'me' : remoteJid,
            content,
            is_from_me: !!msg.key.fromMe,
            timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000)
          }, { onConflict: 'remote_id' });
        }
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    for (const msg of m.messages) {
      const remoteJid = msg.key.remoteJid;
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
            remote_id: msg.key.id,
            sender_id: msg.key.fromMe ? 'me' : remoteJid,
            content,
            is_from_me: !!msg.key.fromMe,
            timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000)
          }, { onConflict: 'remote_id' });
        }
      }
      if (onMessage && !msg.key.fromMe) onMessage('whatsapp', msg.pushName || remoteJid, content, accountId, remoteJid);
    }
  });

  return sock;
}
