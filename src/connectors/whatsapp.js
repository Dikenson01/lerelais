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
  const authPath = path.join(__dirname, `../../auth/wa-${accountId}`);
  if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });

  // 1. RESTAURATION GRANULAIRE depuis account_sessions
  try {
    const { data: sessionFiles } = await supabase
      .from('account_sessions')
      .select('filename, data')
      .eq('account_id', accountId);
    if (sessionFiles && sessionFiles.length > 0) {
      logger.info(`📂 Restauration de ${sessionFiles.length} fichiers de session pour ${accountId}`);
      for (const file of sessionFiles) {
        const filePath = path.join(authPath, file.filename);
        if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, file.data);
      }
    }
  } catch (e) { logger.error('Session Restore Error:', e.message); }

  const { state, saveCreds } = await useMultiFileAuthState(authPath);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: logger.child({ module: 'baileys', accountId }),
    browser: Browsers.macOS('Desktop'),
    syncFullHistory: true,
    shouldSyncHistoryMessage: () => true,
    getMessage: async () => undefined,
    patchMessageBeforeSending: (message) => {
      const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
      if (requiresPatch) {
        message = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, ...message } } };
      }
      return message;
    }
  });

  // 2. PERSISTANCE — sauve les creds en DB pour restore
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
    } catch (e) { logger.error('Creds Save Error:', e.message); }
  });

  // ============================================
  // 3. SYNC CONTACTS — récupère TOUS les contacts
  // ============================================
  const syncContacts = async (contacts) => {
    if (!contacts || !contacts.length) return;
    logger.info(`👥 Syncing ${contacts.length} contacts...`);

    const BATCH_SIZE = 50;
    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      const batch = contacts.slice(i, i + BATCH_SIZE);
      const contactUpserts = [];
      const identityUpserts = [];

      for (const contact of batch) {
        const jid = jidNormalizedUser(contact.id || contact.jid);
        if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@lid')) continue;

        const phone = jid.split('@')[0];
        const name = contact.name || contact.verifiedName || contact.notify || phone;

        // Récupérer la photo de profil
        let avatarUrl = null;
        try {
          avatarUrl = await sock.profilePictureUrl(jid, 'image');
        } catch (_) { /* pas de photo */ }

        identityUpserts.push({ phone, full_name: name });
        contactUpserts.push({
          account_id: accountId,
          external_id: jid,
          display_name: name,
          avatar_url: avatarUrl,
          phone_number: phone,
          metadata: { source: 'whatsapp', platform: 'whatsapp' }
        });
      }

      try {
        if (identityUpserts.length) {
          await supabase.from('identities').upsert(identityUpserts, { onConflict: 'phone' });
        }
        if (contactUpserts.length) {
          await supabase.from('contacts').upsert(contactUpserts, { onConflict: 'account_id, external_id' });
        }
      } catch (e) { logger.error('Contact Sync Batch Error:', e.message); }
    }
    logger.info(`✅ Contacts sync terminé (${contacts.length})`);
  };

  sock.ev.on('contacts.set', ({ contacts }) => syncContacts(contacts));
  sock.ev.on('contacts.upsert', (contacts) => syncContacts(contacts));
  sock.ev.on('contacts.update', (updates) => {
    // Mettre à jour les noms/avatars des contacts existants
    const mapped = updates.map(u => ({ id: u.id, jid: u.id, name: u.name || u.notify, ...u }));
    syncContacts(mapped);
  });

  // ============================================
  // 4. SYNC CHATS — récupère TOUTES les conversations
  // ============================================
  const findContactId = async (jid) => {
    try {
      const { data } = await supabase
        .from('contacts')
        .select('id')
        .eq('account_id', accountId)
        .eq('external_id', jid)
        .single();
      return data?.id || null;
    } catch (_) { return null; }
  };

  const syncChats = async (chats) => {
    if (!chats || !chats.length) return;
    logger.info(`💬 Syncing ${chats.length} conversations...`);

    for (const chat of chats) {
      const jid = jidNormalizedUser(chat.id);
      if (!jid || jid === 'status@broadcast') continue;
      const isGroup = jid.endsWith('@g.us');

      let contactId = null;
      if (!isGroup) {
        contactId = await findContactId(jid);
        // Si pas de contact, on le crée à la volée
        if (!contactId) {
          const phone = jid.split('@')[0];
          try {
            const { data: newContact } = await supabase
              .from('contacts')
              .upsert({
                account_id: accountId,
                external_id: jid,
                display_name: chat.name || phone,
                phone_number: phone,
                metadata: { source: 'whatsapp', platform: 'whatsapp' }
              }, { onConflict: 'account_id, external_id' })
              .select('id')
              .single();
            if (newContact) contactId = newContact.id;
          } catch (_) {}
        }
      }

      try {
        await supabase.from('conversations').upsert({
          account_id: accountId,
          external_id: jid,
          platform: 'whatsapp',
          title: chat.name || (isGroup ? 'Groupe WhatsApp' : jid.split('@')[0]),
          is_group: isGroup,
          contact_id: contactId,
          last_message_preview: chat.conversationTimestamp ? 'Synchronisé' : null,
          unread_count: chat.unreadCount || 0,
          last_message_at: new Date()
        }, { onConflict: 'account_id, external_id' });
      } catch (e) { logger.error('Chat Upsert Error:', e.message); }
    }
    logger.info(`✅ Conversations sync terminé (${chats.length})`);
  };

  sock.ev.on('chats.set', ({ chats }) => syncChats(chats));
  sock.ev.on('chats.upsert', (chats) => syncChats(chats));
  sock.ev.on('chats.update', (updates) => syncChats(updates));

  // ============================================
  // 5. SYNC HISTORIQUE — capture l'historique complet
  // ============================================
  sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
    logger.info(`📜 History sync: ${chats?.length || 0} chats, ${contacts?.length || 0} contacts, ${messages?.length || 0} msgs, isLatest=${isLatest}`);
    if (contacts?.length) await syncContacts(contacts);
    if (chats?.length) await syncChats(chats);

    // Sauvegarder les messages de l'historique
    if (messages?.length) {
      for (const msg of messages) {
        try {
          const jid = jidNormalizedUser(msg.key?.remoteJid);
          if (!jid || jid === 'status@broadcast') continue;

          const content = msg.message?.conversation
            || msg.message?.extendedTextMessage?.text
            || (msg.message?.imageMessage ? '[Image]'
            : msg.message?.videoMessage ? '[Vidéo]'
            : msg.message?.audioMessage ? '[Audio]'
            : msg.message?.documentMessage ? '[Document]'
            : msg.message?.stickerMessage ? '[Sticker]'
            : '[Média]');

          // Trouver ou créer la conversation
          const { data: conv } = await supabase
            .from('conversations')
            .select('id')
            .eq('account_id', accountId)
            .eq('external_id', jid)
            .single();

          if (conv) {
            await supabase.from('messages').upsert({
              conversation_id: conv.id,
              account_id: accountId,
              remote_id: msg.key.id,
              sender_id: msg.key.fromMe ? 'me' : jid,
              content: content || '',
              is_from_me: !!msg.key.fromMe,
              timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000)
            }, { onConflict: 'remote_id' });
          }
        } catch (_) {}
      }
      logger.info(`✅ ${messages.length} messages historiques sauvegardés`);
    }
  });

  // ============================================
  // 6. CONNEXION & RECONNEXION
  // ============================================
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr && onEvents?.onQR) onEvents.onQR(qr);

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        logger.info('🔄 Reconnexion automatique dans 5s...');
        setTimeout(() => connectToWhatsApp(accountId, onMessage, onEvents), 5000);
      } else {
        logger.info('❌ Session WhatsApp déconnectée (logout)');
        await supabase.from('accounts').update({ status: 'disconnected' }).eq('id', accountId);
        if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
      }
    } else if (connection === 'open') {
      logger.info(`🚀 WhatsApp Connecté pour ${accountId}`);
      await supabase.from('accounts').update({ status: 'connected' }).eq('id', accountId);
      if (onEvents?.onConnected) onEvents.onConnected();
    }
  });

  // ============================================
  // 7. NOUVEAUX MESSAGES EN TEMPS RÉEL
  // ============================================
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = jidNormalizedUser(msg.key.remoteJid);
      if (!jid || jid === 'status@broadcast') continue;

      const content = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || (msg.message?.imageMessage ? '[Image]'
        : msg.message?.videoMessage ? '[Vidéo]'
        : msg.message?.audioMessage ? '[Audio]'
        : msg.message?.documentMessage ? '[Document]'
        : msg.message?.stickerMessage ? '[Sticker]'
        : '[Média]');

      try {
        const mediaTag = msg.message?.imageMessage ? 'image' 
                        : msg.message?.audioMessage ? 'audio' 
                        : msg.message?.videoMessage ? 'video' 
                        : msg.message?.documentMessage ? 'document' : null;

        // Trouver/créer le contact pour garantir l'avatar et le nom
        let contactId = null;
        if (!jid.endsWith('@g.us')) {
          const phone = jid.split('@')[0];
          try {
            const { data: ct } = await supabase.from('contacts').upsert({
              account_id: accountId,
              external_id: jid,
              display_name: msg.pushName || phone,
              phone_number: phone,
              metadata: { platform: 'whatsapp' }
            }, { onConflict: 'account_id, external_id' }).select('id').single();
            if (ct) contactId = ct.id;
          } catch (_) {}
        }

        // Upsert conversation avec contact_id
        const { data: conv } = await supabase.from('conversations').upsert({
          account_id: accountId,
          external_id: jid,
          platform: 'whatsapp',
          contact_id: contactId,
          title: msg.pushName || jid.split('@')[0],
          last_message_preview: content?.slice(0, 100),
          last_message_at: new Date()
        }, { onConflict: 'account_id, external_id' }).select('id').single();

        if (conv) {
          // Utiliser UPSERT pour les messages pour éviter les erreurs de doublons 409/500
          await supabase.from('messages').upsert({
            conversation_id: conv.id,
            account_id: accountId,
            remote_id: msg.key.id,
            sender_id: msg.key.fromMe ? 'me' : jid,
            content: content || '',
            is_from_me: !!msg.key.fromMe,
            media_type: mediaTag,
            timestamp: new Date((msg.messageTimestamp || Date.now() / 1000) * 1000)
          }, { onConflict: 'remote_id' });
        }
      } catch (e) { logger.error('Message Save Error:', e.message); }

      if (onMessage && !msg.key.fromMe) {
        onMessage('whatsapp', msg.pushName || jid, content, accountId, jid);
      }
    }
  });

  return sock;
}
