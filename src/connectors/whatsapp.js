import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  jidNormalizedUser
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
  
  // 1. RESTAURATION GRANULAIRE (Scale 20K)
  // On restaure fichier par fichier depuis la nouvelle table account_sessions
  try {
    const { data: sessionFiles } = await supabase.from('account_sessions').select('filename, data').eq('account_id', accountId);
    if (sessionFiles && sessionFiles.length > 0) {
      logger.info(`📂 Restauration de ${sessionFiles.length} fichiers de session pour ${accountId}`);
      for (const file of sessionFiles) {
        const filePath = path.join(authPath, file.filename);
        if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, file.data);
      }
    }
  } catch (e) { logger.error('Session Restore Error:', e); }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();
  
  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: logger.child({ module: 'baileys', accountId }),
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: true, // Crucial pour 20K users
    shouldSyncHistoryMessage: () => true,
    patchMessageBeforeSending: (message) => {
      const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
      if (requiresPatch) {
        message = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, ...message } } };
      }
      return message;
    }
  });

  // 2. PERSISTANCE HAUTE PERFORMANCE
  // On sauve chaque fichier JSON individuellement en base
  sock.ev.on('creds.update', async () => {
    await saveCreds();
    try {
      const files = fs.readdirSync(authPath).filter(f => f.endsWith('.json'));
      const upserts = files.map(f => ({
        account_id: accountId,
        filename: f,
        data: fs.readFileSync(path.join(authPath, f), 'utf-8')
      }));
      await supabase.from('account_sessions').upsert(upserts, { onConflict: 'account_id, filename' });
    } catch (e) { logger.error('Creds Save Error:', e); }
  });

  // 3. SYNCHRONISATION MASSIVE DES CONTACTS (Bulk Upsert)
  const syncContacts = async (contacts) => {
    if (!contacts.length) return;
    logger.info(`👥 Syncing ${contacts.length} contacts en masse...`);

    const contactUpserts = [];
    const identityUpserts = [];

    for (const contact of contacts) {
      const jid = jidNormalizedUser(contact.id || contact.jid);
      if (!jid || jid.endsWith('@g.us')) continue; // Groupes à part

      const phone = jid.split('@')[0];
      const name = contact.name || contact.verifiedName || contact.notify || phone;

      // Tenter de récupérer la photo de profil
      let avatarUrl = contact.imgUrl || null;
      if (!avatarUrl) {
        try {
          avatarUrl = await sock.profilePictureUrl(jid, 'image');
        } catch (_) { /* pas de photo de profil */ }
      }

      identityUpserts.push({ phone, full_name: name });
      contactUpserts.push({
        account_id: accountId,
        external_id: jid,
        display_name: name,
        avatar_url: avatarUrl,
        metadata: { source: 'whatsapp', platform: 'whatsapp' }
      });
    }

    try {
      if (identityUpserts.length) await supabase.from('identities').upsert(identityUpserts, { onConflict: 'phone' });
      if (contactUpserts.length) await supabase.from('contacts').upsert(contactUpserts, { onConflict: 'account_id, external_id' });
    } catch (e) { logger.error('Contact Sync Error:', e); }
  };

  sock.ev.on('contacts.set', ({ contacts }) => syncContacts(contacts));
  sock.ev.on('contacts.upsert', (contacts) => syncContacts(contacts));

  // 4. SYNCHRONISATION DES CHATS ET GROUPES
  const syncChats = async (chats) => {
    if (!chats.length) return;
    logger.info(`💬 Syncing ${chats.length} conversations et groupes...`);

    for (const chat of chats) {
      const jid = jidNormalizedUser(chat.id);
      const isGroup = jid.endsWith('@g.us');

      // Chercher le contact_id correspondant pour les conversations 1-to-1
      let contactId = null;
      if (!isGroup) {
        try {
          const { data: contact } = await supabase
            .from('contacts')
            .select('id')
            .eq('account_id', accountId)
            .eq('external_id', jid)
            .single();
          if (contact) contactId = contact.id;
        } catch (_) {}
      }

      try {
        await supabase.from('conversations').upsert({
          account_id: accountId,
          external_id: jid,
          platform: 'whatsapp',
          title: chat.name || (isGroup ? 'Groupe WhatsApp' : jid.split('@')[0]),
          is_group: isGroup,
          contact_id: contactId,
          last_message_preview: chat.lastMessageRecvTimestamp ? 'Synchronisé' : null,
          unread_count: chat.unreadCount || 0,
          last_message_at: new Date()
        }, { onConflict: 'account_id, external_id' });
      } catch (e) { logger.error('Chat Upsert Error:', e); }
    }
  };

  sock.ev.on('chats.set', ({ chats }) => syncChats(chats));
  sock.ev.on('chats.upsert', (chats) => syncChats(chats));

  // 5. GESTION DES MESSAGES ET RECONNEXION
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && onEvents?.onQR) onEvents.onQR(qr);

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        logger.info('🔄 Tentative de reconnexion auto...');
        setTimeout(() => connectToWhatsApp(accountId, onMessage, onEvents), 5000);
      } else {
        await supabase.from('accounts').update({ status: 'disconnected' }).eq('id', accountId);
        if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
      }
    } else if (connection === 'open') {
      logger.info(`🚀 WhatsApp Connecté pour ${accountId}`);
      await supabase.from('accounts').update({ status: 'connected' }).eq('id', accountId);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = jidNormalizedUser(msg.key.remoteJid);
      if (!jid || jid === 'status@broadcast') continue;

      const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || (msg.message?.imageMessage ? '[Image]' : '[Média]');
      
      try {
        // Chercher le contact_id pour cette conversation
        let contactId = null;
        if (!jid.endsWith('@g.us')) {
          try {
            const { data: contact } = await supabase
              .from('contacts')
              .select('id')
              .eq('account_id', accountId)
              .eq('external_id', jid)
              .single();
            if (contact) contactId = contact.id;
          } catch (_) {}
        }

        const { data: conv } = await supabase.from('conversations').upsert({
          account_id: accountId,
          external_id: jid,
          platform: 'whatsapp',
          contact_id: contactId,
          last_message_preview: content?.slice(0, 100),
          last_message_at: new Date()
        }, { onConflict: 'account_id, external_id' }).select('id').single();

        if (conv) {
          await supabase.from('messages').insert({
            conversation_id: conv.id,
            account_id: accountId,
            remote_id: msg.key.id,
            sender_id: msg.key.fromMe ? 'me' : jid,
            content,
            is_from_me: !!msg.key.fromMe,
            timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000)
          });
        }
      } catch (e) { logger.error('Message Save Error:', e); }
      
      if (onMessage && !msg.key.fromMe) onMessage('whatsapp', msg.pushName || jid, content, accountId, jid);
    }
  });

  return sock;
}
