import makeWASocket, {
  DisconnectReason,
  initAuthCreds,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  jidNormalizedUser,
  BufferJSON,
  makeCacheableSignalKeyStore,
  downloadMediaMessage
} from '@whiskeysockets/baileys';
import { proto } from '@whiskeysockets/baileys';
import logger from '../utils/logger.js';
import supabase from '../config/supabase.js';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * MOTEUR IMMORTAL v3 - FULL SYNC EDITION
 * 1. Double sauvegarde (Backup)
 * 2. Système de Lock anti-collision (Code 440)
 * 3. Cache de SignalKeyStore (Performance)
 * 4. Identité Browser fixée
 * 5. Téléchargement de médias (images, vidéos, audio, docs)
 * 6. Photos de profil automatiques
 * 7. Historique complet (messages envoyés + reçus)
 */

const MEDIA_BUCKET = 'Le Relais Media';

const useSupabaseAuthState = async (accountId) => {
  const TABLE = 'account_sessions';

  const makeKey = (ns_group, filename) => `NS:${ns_group}:${filename}`;

  const writeData = async (data, filename, ns_group = 'active') => {
    try {
      const key = makeKey(ns_group, filename);
      if (global.wa_db_locks?.[key]) return;
      if (!global.wa_db_locks) global.wa_db_locks = {};
      global.wa_db_locks[key] = true;

      try {
        await supabase.from(TABLE).delete().eq('account_id', accountId).eq('filename', key);
        await supabase.from(TABLE).insert({
          account_id: accountId,
          filename: key,
          data: JSON.stringify(data, BufferJSON.replacer)
        });
        if (filename === 'creds.json') logger.info(`[WA-DB] Persisted creds for ${accountId} (${ns_group})`);
      } finally {
        delete global.wa_db_locks[key];
      }
    } catch (e) {
      logger.error(`[WA-DB] Write exception (${ns_group}:${filename}):`, e.message);
    }
  };

  const readData = async (filename, ns_group = 'active') => {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select('data')
        .eq('account_id', accountId)
        .eq('filename', makeKey(ns_group, filename))
        .maybeSingle();

      if (error || !data) {
        if (ns_group === 'active') {
          const backup = await readData(filename, 'backup');
          if (backup) {
             logger.info(`[WA-RECOVERY] Restored ${filename} from backup!`);
             await writeData(backup, filename, 'active');
             return backup;
          }
        }
        return null;
      }
      return JSON.parse(data.data, BufferJSON.reviver);
    } catch (e) {
      return null;
    }
  };

  const removeData = async (filename, ns_group = 'active') => {
    await supabase.from(TABLE).delete().eq('account_id', accountId).eq('filename', makeKey(ns_group, filename));
  };

  const clearSession = async () => {
    await supabase.from(TABLE).delete().eq('account_id', accountId).like('filename', 'NS:active:%');
  };

  const myInstanceId = `${process.env.RAILWAY_SERVICE_NAME || 'local'}-${process.pid}`;

  const checkLock = async () => {
    const lockData = await readData('lock_session', 'lock');
    if (!lockData) return null;
    return { ...lockData, updatedAt: new Date(lockData.ts).getTime() };
  };

  const claimLock = async () => {
    const current = await checkLock();
    if (current && current.owner !== myInstanceId && (Date.now() - current.updatedAt) < 180000) {
      return false;
    }
    await writeData({ owner: myInstanceId, ts: new Date().toISOString() }, 'lock_session', 'lock');
    return true;
  };

  const creds = await readData('creds.json') || initAuthCreds();

  return {
    state: {
      creds,
      keys: makeCacheableSignalKeyStore({
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async id => {
            const filename = `${type}-${id}.json`;
            let val = await readData(filename);
            if (type === 'app-state-sync-key' && val) {
              val = proto.Message.AppStateSyncKeyData.fromObject(val);
            }
            if (val) data[id] = val;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const filename = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, filename) : removeData(filename));
              if (value && ['creds.json', 'app-state-sync-key'].some(k => filename.includes(k))) {
                tasks.push(writeData(value, filename, 'backup'));
              }
            }
          }
          await Promise.all(tasks);
        }
      }, pino({ level: 'silent' })),
    },
    saveCreds: () => writeData(creds, 'creds.json'),
    clearSession,
    claimLock
  };
};

// --- UTILITAIRES MÉDIAS ---
const getMediaInfo = (message) => {
  if (message.imageMessage) return { type: 'image', ext: 'jpg', mime: message.imageMessage.mimetype || 'image/jpeg' };
  if (message.videoMessage) return { type: 'video', ext: 'mp4', mime: message.videoMessage.mimetype || 'video/mp4' };
  if (message.audioMessage) return { type: 'audio', ext: 'ogg', mime: message.audioMessage.mimetype || 'audio/ogg' };
  if (message.documentMessage) return { type: 'document', ext: 'bin', mime: message.documentMessage.mimetype || 'application/octet-stream' };
  if (message.stickerMessage) return { type: 'image', ext: 'webp', mime: 'image/webp' };
  return null;
};

const extractContent = (message) => {
  if (!message) return '';
  return message.conversation
    || message.extendedTextMessage?.text
    || message.imageMessage?.caption
    || (message.imageMessage ? '📷 Photo' : null)
    || message.videoMessage?.caption
    || (message.videoMessage ? '🎬 Vidéo' : null)
    || message.audioMessage?.caption
    || (message.audioMessage ? '🎵 Audio' : null)
    || message.documentMessage?.fileName
    || (message.documentMessage ? '📄 Document' : null)
    || (message.stickerMessage ? '🎭 Sticker' : null)
    || (message.buttonsResponseMessage?.selectedButtonId ? `🔘 Bouton: ${message.buttonsResponseMessage.selectedDisplayText}` : null)
    || (message.listResponseMessage?.title ? `📋 Liste: ${message.listResponseMessage.title}` : null)
    || '';
};

const getQuotedInfo = (message) => {
  const quoted = message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return null;
  return {
    remote_id: message.extendedTextMessage.contextInfo.stanzaId,
    sender: message.extendedTextMessage.contextInfo.participant,
    content: extractContent(quoted)
  };
};

export const createWhatsAppConnector = async (accountId, onEvent, pairingPhone = null) => {
  let sock = null;
  let qrCode = null;
  let { state, saveCreds, clearSession, claimLock } = await useSupabaseAuthState(accountId);

  // --- RÉSOLVEUR DE PASSEPORT (défini en dehors de startSocket pour être accessible)
  let _sock = null; // Référence au socket actuel

  const getContactId = async (jid, pushName = null) => {
    let { data } = await supabase.from('contacts').select('id, avatar_url, display_name').eq('account_id', accountId).eq('external_id', jid).maybeSingle();

    if (!data && jid.endsWith('@lid')) {
      const { data: mapping } = await supabase.from('contacts')
        .select('id, avatar_url, display_name')
        .eq('account_id', accountId)
        .filter('metadata->lid', 'eq', jid)
        .maybeSingle();
      data = mapping;
    }

    if (!data && pushName) {
      const { data: byName } = await supabase.from('contacts')
        .select('id, avatar_url, display_name')
        .eq('account_id', accountId)
        .eq('display_name', pushName)
        .maybeSingle();
      data = byName;
      if (data) {
        await supabase.from('contacts').update({ metadata: { lid: jid } }).eq('id', data.id);
      }
    }

    // Récupérer la photo de profil si manquante — stockage permanent
    if (data && !data.avatar_url && _sock && !jid.endsWith('@lid')) {
      try {
        const cdnUrl = await _sock.profilePictureUrl(jid, 'image').catch(() => null);
        if (cdnUrl) {
          const permanentUrl = await downloadAndStoreAvatar(data.id, cdnUrl);
          if (permanentUrl) {
            await supabase.from('contacts').update({ avatar_url: permanentUrl }).eq('id', data.id);
            data.avatar_url = permanentUrl;
          }
        }
      } catch (e) {}
    }
    return data?.id;
  };

  const getOrCreateUnifiedConversation = async (jid, title, isGroup = false) => {
    let contact_id = await getContactId(jid, isGroup ? null : title);

    if (contact_id) {
      const { data: existingConvs } = await supabase.from('conversations')
        .select('id, external_id')
        .eq('account_id', accountId)
        .eq('contact_id', contact_id)
        .order('last_message_at', { ascending: false });

      if (existingConvs && existingConvs.length > 0) {
        const master = existingConvs[0];
        if (master.external_id !== jid) {
          await supabase.from('conversations').update({ external_id: jid, title: title || master.title }).eq('id', master.id);
        }
        return master.id;
      }
    }

    const { data: byJid } = await supabase.from('conversations').select('id').eq('account_id', accountId).eq('external_id', jid).maybeSingle();
    if (byJid) return byJid.id;

    const { data: conv } = await supabase.from('conversations').upsert({
      account_id: accountId,
      external_id: jid,
      contact_id: contact_id,
      platform: 'whatsapp',
      title: title || jid.split('@')[0],
      is_group: isGroup,
      last_message_at: new Date()
    }, { onConflict: 'account_id, external_id' }).select('id').single();

    return conv?.id;
  };

  // --- TÉLÉCHARGEMENT PERMANENT DE PHOTO DE PROFIL ---
  const downloadAndStoreAvatar = async (contactId, cdnUrl) => {
    try {
      const res = await fetch(cdnUrl);
      if (!res.ok) return null;
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (!buffer || buffer.length === 0) return null;

      const fileName = `avatars/${contactId}.jpg`;
      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });

      if (error) {
        logger.error(`[WA-AVATAR] Storage upload failed: ${error.message}`);
        return null;
      }

      const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(fileName);
      logger.info(`[WA-AVATAR] Stored avatar for contact ${contactId}`);
      return urlData.publicUrl;
    } catch (e) {
      logger.error(`[WA-AVATAR] Download failed: ${e.message}`);
      return null;
    }
  };

  // --- TÉLÉCHARGEMENT DE MÉDIAS ---
  const downloadAndStoreMedia = async (msg) => {
    if (!msg.message) return null;
    const mediaInfo = getMediaInfo(msg.message);
    if (!mediaInfo) return null;

    try {
      const buffer = await downloadMediaMessage(
        msg,
        'buffer',
        {},
        { logger: pino({ level: 'silent' }), reuploadRequest: _sock?.updateMediaMessage }
      );

      if (!buffer || buffer.length === 0) return null;

      const fileName = `${accountId}/${msg.key.id}.${mediaInfo.ext}`;
      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(fileName, buffer, { contentType: mediaInfo.mime, upsert: true });

      if (error) {
        logger.error(`[WA-MEDIA] Storage upload failed: ${error.message}`);
        return null;
      }

      const { data: urlData } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(fileName);
      logger.info(`[WA-MEDIA] Stored: ${fileName}`);
      return urlData.publicUrl;
    } catch (e) {
      logger.error(`[WA-MEDIA] Download failed for ${msg.key.id}: ${e.message}`);
      return null;
    }
  };

  const upsertContact = async (jid, name, lidValue = null) => {
    const phone = (!jid.endsWith('@lid') && !jid.endsWith('@g.us')) ? jid.split('@')[0] : null;

    // Upsert sans avatar_url pour ne pas écraser les photos existantes
    const { data: contact } = await supabase.from('contacts').upsert({
      account_id: accountId,
      external_id: jid,
      display_name: name || jid.split('@')[0],
      phone_number: phone,
      metadata: { lid: lidValue }
    }, { onConflict: 'account_id, external_id', ignoreDuplicates: false })
    .select('id, avatar_url').single();

    // Fetch photo de profil si absente — stockage permanent dans Supabase Storage
    if (contact && !contact.avatar_url && _sock && !jid.endsWith('@lid') && !jid.endsWith('@g.us')) {
      setTimeout(async () => {
        try {
          const cdnUrl = await _sock.profilePictureUrl(jid, 'image').catch(() => null);
          if (cdnUrl) {
            const permanentUrl = await downloadAndStoreAvatar(contact.id, cdnUrl);
            if (permanentUrl) {
              await supabase.from('contacts').update({ avatar_url: permanentUrl }).eq('id', contact.id);
            }
          }
        } catch (e) {}
      }, 500);
    }

    return contact;
  };

  const startSocket = async () => {
    const hasLock = await claimLock();
    if (!hasLock) {
      logger.warn(`[WA-LOCK] Session locked by another instance. Retrying in 30s...`);
      onEvent('status', { status: 'waiting_lock', message: 'En attente de connexion sécurisée...' });
      setTimeout(startSocket, 30000);
      return;
    }

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      logger: pino({ level: 'silent' }),
      syncFullHistory: true,
      markOnlineOnConnect: true,
      retryRequestDelayMs: 5000,
    });

    _sock = sock; // Mettre à jour la référence globale

    const lockTimer = setInterval(async () => {
      if (sock && (await claimLock())) {
        // Lock renewed
      } else {
        logger.error('[WA-LOCK] Port du verrou perdu !');
      }
    }, 60000);

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      const TABLE = 'account_sessions';
      const key = `NS:backup:creds.json`;
      await supabase.from(TABLE).delete().eq('account_id', accountId).eq('filename', key);
      await supabase.from(TABLE).insert({
        account_id: accountId,
        filename: key,
        data: JSON.stringify(state.creds, BufferJSON.replacer)
      });
    });

    sock.ev.on('call', async (calls) => {
      for (const call of calls) {
        if (call.status === 'offer') {
          const jid = jidNormalizedUser(call.from);
          const text = `☎️ Appel WhatsApp entrant de ${jid.split('@')[0]}`;
          const convId = await getOrCreateUnifiedConversation(jid, jid.split('@')[0], false);
          if (convId) {
            await supabase.from('messages').insert({
              conversation_id: convId,
              account_id: accountId,
              remote_id: `call-${call.id}`,
              sender_id: jid,
              content: text,
              is_from_me: false,
              metadata: { is_call: true, call_id: call.id }
            });
            onEvent('message', { jid, text, fromMe: false });
          }
        }
      }
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = qr;
        onEvent('qr', qr);
        onEvent('status', { status: 'pairing' });
        
        // --- SAUVEGARDE IMAGE QR POUR /whatsapp-qr ---
        try {
          const qrcode = await import('qrcode');
          const publicPath = path.join(__dirname, '../../web/dist/whatsapp_qr.png');
          if (!fs.existsSync(path.dirname(publicPath))) fs.mkdirSync(path.dirname(publicPath), { recursive: true });
          await qrcode.default.toFile(publicPath, qr);
        } catch (e) {
          logger.error('[WA-QR] Image Save Error:', e.message);
        }
      }

      // --- LOGIQUE PAIRING CODE ---
      if (pairingPhone && !sock?.authState.creds.registered && qr) {
        if (!sock._pairingRequested) {
          sock._pairingRequested = true;
          logger.info(`📡 [WA] Demande de Pairing Code pour ${pairingPhone} dans 10s...`);
          setTimeout(async () => {
             try {
               const code = await sock.requestPairingCode(pairingPhone.replace(/\D/g, ''));
               logger.info(`✅ [WA] Pairing Code Reçu : ${code}`);
               onEvent('pairing_code', code);
             } catch (err) {
               logger.error('[WA-PAIRING] Error:', err.message);
             }
          }, 10000);
        }
      }

      if (connection === 'close') {
        clearInterval(lockTimer);
        _sock = null;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn(`[WA] Connection closed: ${statusCode}. Reconnect: ${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut) {
          logger.error('[WA] Logged out! Clearing session...');
          await clearSession();
          onEvent('status', { status: 'disconnected' });
        } else if (statusCode === 440 || statusCode === 405) {
          logger.info('[WA-STABILITY] Conflict. Waiting 10s before retry...');
          setTimeout(startSocket, 10000);
        } else {
          startSocket();
        }
      }

      if (connection === 'open') {
        qrCode = null;
        onEvent('status', { status: 'connected' });
        logger.info('[WA] Connected successfully!');

        setTimeout(async () => {
          // 1. Lier les conversations orphelines à leurs contacts
          const { data: convs } = await supabase.from('conversations').select('id, title, external_id, contact_id').eq('account_id', accountId);
          if (convs) {
            const masterMap = {};
            for (const conv of convs) {
              if (!conv.contact_id) {
                const cid = await getContactId(conv.external_id, conv.title);
                if (cid) {
                  conv.contact_id = cid;
                  await supabase.from('conversations').update({ contact_id: cid }).eq('id', conv.id);
                }
              }

              if (conv.contact_id) {
                if (!masterMap[conv.contact_id]) {
                  masterMap[conv.contact_id] = conv.id;
                } else {
                  const masterId = masterMap[conv.contact_id];
                  logger.info(`[WA-PASSPORT] Merging ${conv.id} into master thread ${masterId}`);
                  await supabase.from('messages').update({ conversation_id: masterId }).eq('conversation_id', conv.id);
                  await supabase.from('conversations').delete().eq('id', conv.id);
                }
              }
            }
          }

          // 2. Découverte des Groupes + Stockage des Participants
          try {
            const groups = await sock.groupFetchAllParticipating();
            for (const [jid, group] of Object.entries(groups)) {
              const convId = await getOrCreateUnifiedConversation(jid, group.subject, true);
              if (convId && group.participants) {
                await supabase.from('conversations').update({
                  group_metadata: {
                    participants: group.participants.map(p => ({
                      id: p.id, admin: p.admin || null
                    })),
                    description: group.desc || '',
                    owner: group.owner || null,
                    size: group.size || group.participants.length
                  }
                }).eq('id', convId);

                // SYNC PARTICIPANTS AS CONTACTS
                for (const p of group.participants) {
                  const jid = jidNormalizedUser(p.id);
                  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) {
                    const phone = jid.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : null;
                    await supabase.from('contacts').upsert({
                      account_id: accountId,
                      external_id: jid,
                      display_name: phone || jid,
                      phone_number: phone,
                      metadata: { lid: jid.endsWith('@lid') ? jid : null }
                    }, { onConflict: 'account_id, external_id', ignoreDuplicates: true });
                  }
                }
              }
            }
            logger.info(`[WA-GROUPS] Synced ${Object.keys(groups).length} groups with participants`);
          } catch (e) {
            logger.error(`[WA-GROUP-FETCH-ERR] ${e.message}`);
          }

          // 3. Scan photos de profil (par lot, progressif, avec retry)
          const scanAvatars = async () => {
            const { data: contacts } = await supabase.from('contacts').select('id, external_id')
              .is('avatar_url', null)
              .eq('account_id', accountId)
              .not('external_id', 'like', '%@lid')
              .not('external_id', 'like', '%@g.us');

            if (contacts && contacts.length > 0) {
              logger.info(`[WA-PDP] Fetching ${contacts.length} profile photos...`);
              let fetched = 0;
              for (const contact of contacts) {
                try {
                  const cdnUrl = await sock.profilePictureUrl(contact.external_id, 'image').catch(() => null);
                  if (cdnUrl) {
                    const permanentUrl = await downloadAndStoreAvatar(contact.id, cdnUrl);
                    if (permanentUrl) {
                      await supabase.from('contacts').update({ avatar_url: permanentUrl }).eq('id', contact.id);
                      fetched++;
                    }
                  }
                  await delay(1500); // Rate-limit protection
                } catch (e) {}
              }
              logger.info(`[WA-PDP] Fetched ${fetched}/${contacts.length} avatars.`);
              
              // Retry remaining avatars in 5 minutes
              const remaining = contacts.length - fetched;
              if (remaining > 0 && _sock) {
                logger.info(`[WA-PDP] Scheduling retry for ${remaining} missing avatars in 5min...`);
                setTimeout(scanAvatars, 300000);
              }
            }
          };
          await scanAvatars();

          // 4. Scan noms de groupes et participants (Identity Recovery V9)
          const scanGroupsNames = async () => {
             const { data: grps } = await supabase.from('conversations').select('external_id').eq('is_group', true);
             if (grps) {
               logger.info(`[WA-IDENTITY] Explicitly fetching metadata for ${grps.length} groups...`);
               for (const g of grps) {
                 try {
                   const meta = await sock.groupMetadata(g.external_id);
                   if (meta && meta.participants) {
                     for (const p of meta.participants) {
                       const pj = jidNormalizedUser(p.id);
                       // Si on a un nom (notify/pushname/name), on l'enregistre
                       const pName = p.name || p.notify || p.verifiedName;
                       if (pName) {
                         await supabase.from('contacts').upsert({
                           account_id: accountId,
                           external_id: pj,
                           display_name: pName,
                           phone_number: pj.endsWith('@s.whatsapp.net') ? pj.split('@')[0] : null
                         }, { onConflict: 'account_id, external_id' });
                       }
                     }
                   }
                   await delay(2000); // Respecter les limites WA
                 } catch (e) {
                    logger.warn(`[WA-IDENTITY] Failed meta for ${g.external_id}: ${e.message}`);
                 }
               }
             }
          };
          await scanGroupsNames();

          logger.info('[WA-MAINTENANCE] Post-connection maintenance finished.');
          
          // Lancement de la synchronisation de l'historique en cascade
          startHistoryCascadeWorker();
        }, 30000); // Démarrer 30s après connexion
      }
    });

    sock.ev.on('chats.upsert', async (chats) => {
      const icons = { image: '📷 Photo', video: '🎬 Vidéo', audio: '🎵 Audio', document: '📄 Document', sticker: '🎭 Sticker' };
      for (const chat of chats) {
        const jid = jidNormalizedUser(chat.id);
        const isGroup = jid.endsWith('@g.us');
        const lastMsgAt = chat.conversationTimestamp
          ? new Date(Number(chat.conversationTimestamp) * 1000)
          : new Date();

        // Tenter d'extraire la preview depuis le dernier message du chat
        let preview = null;
        const lastMsgObj = chat.messages?.array?.[0]?.message || chat.messages?.get?.(0)?.message;
        if (lastMsgObj) {
          const lastContent = extractContent(lastMsgObj);
          const lastMedia = getMediaInfo(lastMsgObj);
          preview = lastContent || (lastMedia ? icons[lastMedia.type] || '📎 Média' : null);
        }

        const upsertData = {
          account_id: accountId,
          external_id: jid,
          platform: 'whatsapp',
          title: chat.name || jid.split('@')[0],
          is_group: isGroup,
          unread_count: chat.unreadCount || 0,
          metadata: {
            is_archived: chat.archived === true,
            is_pinned: (chat.pin && chat.pin > 0) || false,
            is_muted: chat.mute !== undefined && chat.mute !== null
          },
          last_message_at: lastMsgAt
        };
        if (preview) upsertData.last_message_preview = preview;

        await supabase.from('conversations').upsert(upsertData, { onConflict: 'account_id, external_id' });
      }
    });

    sock.ev.on('chats.update', async (updates) => {
      try {
        for (const update of updates) {
          const jid = jidNormalizedUser(update.id);
          const metaUpdate = {};
          if (update.archived !== undefined) metaUpdate.is_archived = update.archived === true;
          if (update.pin !== undefined) metaUpdate.is_pinned = (update.pin && update.pin > 0) || false;
          if (update.mute !== undefined) metaUpdate.is_muted = update.mute !== null;

          if (Object.keys(metaUpdate).length > 0) {
            // Fetch existing metadata to merge
            const { data: conv } = await supabase.from('conversations').select('metadata').eq('account_id', accountId).eq('external_id', jid).maybeSingle();
            if (conv) {
              const isArchived = chat.archived === true || chat.archive === true || chat.readOnly === true || (chat.metadata?.is_archived === true);
              const newMeta = { ...(conv.metadata || {}), ...metaUpdate, is_archived: isArchived };
              await supabase.from('conversations').update({ metadata: newMeta }).eq('account_id', accountId).eq('external_id', jid);
            }
          }
        }
      } catch (e) {
        logger.error(`[WA-SYNC-ERR] chats.update: ${e.message}`);
      }
    });

    // --- SYNC HISTORIQUE COMPLET (AUDIT FIX v2) ---
    sock.ev.on('messaging-history.set', async ({ chats, contacts: syncContacts, messages, isLatest }) => {
      try {
        logger.info(`[WA] Full Sync: ${chats?.length || 0} chats, ${syncContacts?.length || 0} contacts, ${messages?.length || 0} messages`);

        // 1. Sync Contacts — avec résolution des noms
        if (syncContacts) {
          for (const contact of syncContacts) {
            const jid = jidNormalizedUser(contact.id);
            const isLid = jid.endsWith('@lid');
            const isGroup = jid.endsWith('@g.us');
            const phone = (!isLid && !isGroup) ? jid.split('@')[0] : null;
            const name = contact.name || contact.verifiedName || contact.notify || jid.split('@')[0];

            await supabase.from('contacts').upsert({
              account_id: accountId,
              external_id: jid,
              display_name: name,
              phone_number: phone,
              metadata: { lid: isLid ? jid : null }
            }, { onConflict: 'account_id, external_id', ignoreDuplicates: false });
          }
        }

        // 2. Sync Chats — avec le vrai timestamp du dernier message
        const jidToConvId = {};
        if (chats) {
          for (const chat of chats) {
            const jid = jidNormalizedUser(chat.id);
            const isGroup = jid.endsWith('@g.us');
            const lastMsgAt = chat.conversationTimestamp
              ? new Date(Number(chat.conversationTimestamp) * 1000)
              : null;

            const convId = await getOrCreateUnifiedConversation(jid, chat.name, isGroup);
            if (convId) {
              jidToConvId[jid] = convId;
              // Mettre à jour timestamp + état archivé
              const { data: existing } = await supabase.from('conversations').select('metadata').eq('id', convId).maybeSingle();
              const isArchived = chat.archived === true || chat.archive === true || chat.readOnly === true;
              await supabase.from('conversations')
                .update({ 
                  metadata: { ...(existing?.metadata || {}), is_archived: isArchived },
                  last_message_at: lastMsgAt || new Date()
                })
                .eq('id', convId);
            }
          }
        }

        // 3. Sync Messages Historiques — AVEC téléchargement des médias
        if (messages && messages.length > 0) {
          const latestByJid = {};
          const mediaQueue = []; // File d'attente pour téléchargement en arrière-plan
          
          for (const msg of messages) {
            if (!msg.message) continue;
            const jid = jidNormalizedUser(msg.key.remoteJid);
            const ts = (msg.messageTimestamp?.low || msg.messageTimestamp || 0) * 1000;
            
            // Garder trace du message le plus récent pour la preview
            if (!latestByJid[jid] || ts > latestByJid[jid].ts) {
              latestByJid[jid] = { msg, ts };
            }

            const mediaInfo = getMediaInfo(msg.message);
            const convId = jidToConvId[jid] || await getOrCreateUnifiedConversation(jid, msg.pushName, jid.endsWith('@g.us'));

            // FIX 2: Résoudre les noms via pushName si le contact est un numéro brut
            if (msg.pushName && !msg.key.fromMe) {
              const senderId = msg.key.participant || jid;
              const { data: existingContact } = await supabase.from('contacts')
                .select('id, display_name').eq('account_id', accountId).eq('external_id', senderId).maybeSingle();
              
              if (existingContact) {
                const currentName = existingContact.display_name;
                // Si le nom actuel est un ID technique ou un numéro brut, le mettre à jour avec le pushName
                const isTechnical = !currentName || currentName.includes('@') || /^\d+$/.test(currentName.replace(/[+\s-]/g, ''));
                if (isTechnical && msg.pushName !== currentName) {
                  await supabase.from('contacts').update({ display_name: msg.pushName }).eq('id', existingContact.id);
                }
              } else {
                // Créer le contact s'il manque (sauvegarde opportuniste)
                await supabase.from('contacts').upsert({
                   account_id: accountId,
                   external_id: senderId,
                   display_name: msg.pushName
                }, { onConflict: 'account_id, external_id' });
              }
            }

            if (convId) {
              const content = extractContent(msg.message);
              const isGroupMsg = jid.endsWith('@g.us');
              const finalSenderId = msg.key.fromMe ? accountId : (isGroupMsg ? (msg.key.participant || jid) : jid);

              // FIX 1 & 3: Ne plus ignorer les doublons pour pouvoir patcher les previews
              const { data: inserted } = await supabase.from('messages').upsert({
                conversation_id: convId,
                account_id: accountId,
                remote_id: msg.key.id,
                sender_id: finalSenderId,
                content: content || (mediaInfo ? `[${mediaInfo.type}]` : ''),
                media_type: mediaInfo?.type || null,
                is_from_me: msg.key.fromMe || false,
                timestamp: new Date(ts || Date.now()),
                metadata: {
                  has_media: !!mediaInfo,
                  participant: isGroupMsg ? (msg.key.participant || null) : null,
                  pushName: msg.pushName || null
                }
              }, { onConflict: 'remote_id' }).select('id').maybeSingle();

              // FIX 1: Si c'est un média, ajouter à la file de téléchargement
              if (mediaInfo && inserted?.id) {
                mediaQueue.push({ msg, remoteId: msg.key.id });
              }
            }
          }

          // 4. Mettre à jour les PREVIEWS des conversations
          for (const [jid, data] of Object.entries(latestByJid)) {
            const convId = jidToConvId[jid];
            if (convId) {
              const mediaInfo = getMediaInfo(data.msg.message);
              const content = extractContent(data.msg.message);
              const preview = content || (mediaInfo ? `📷 ${mediaInfo.type.charAt(0).toUpperCase() + mediaInfo.type.slice(1)}` : '');
              const realTs = new Date(data.ts || Date.now());
              
              // FIX 3 & 6: Toujours écrire la preview et utiliser le vrai timestamp
              await supabase.from('conversations').update({
                last_message_preview: preview,
                last_message_at: realTs
              }).eq('id', convId);
            }
          }
          logger.info(`[WA-SYNC] Previews and messages synced for ${Object.keys(latestByJid).length} chats`);

          // 5. Téléchargement des médias en arrière-plan (non bloquant)
          if (mediaQueue.length > 0) {
            logger.info(`[WA-MEDIA-QUEUE] Starting background download of ${mediaQueue.length} media files...`);
            (async () => {
              let downloaded = 0;
              for (const item of mediaQueue) {
                try {
                  const mediaUrl = await downloadAndStoreMedia(item.msg);
                  if (mediaUrl) {
                    await supabase.from('messages').update({ media_url: mediaUrl }).eq('remote_id', item.remoteId);
                    downloaded++;
                  }
                  await delay(500); // Throttle pour ne pas surcharger
                } catch (e) {
                  logger.error(`[WA-MEDIA-QUEUE] Failed for ${item.remoteId}: ${e.message}`);
                }
              }
              logger.info(`[WA-MEDIA-QUEUE] Downloaded ${downloaded}/${mediaQueue.length} media files.`);
            })();
          }
        }
      } catch (e) {
        logger.error(`[WA-SYNC-ERR] messaging-history.set: ${e.message}`, e);
      }
    });

    // --- CONTACTS ---
    sock.ev.on('messages.reaction', async (reactions) => {
      for (const reaction of reactions) {
        const remote_id = reaction.key.id;
        const emoji = reaction.reaction.text;
        const sender = reaction.reaction.senderJid;

        const { data: msg } = await supabase.from('messages').select('metadata').eq('remote_id', remote_id).maybeSingle();
        if (msg) {
          const newReactions = { ...(msg.metadata?.reactions || {}) };
          if (emoji) {
            newReactions[sender] = emoji;
          } else {
            delete newReactions[sender];
          }
          await supabase.from('messages').update({ metadata: { ...msg.metadata, reactions: newReactions } }).eq('remote_id', remote_id);
        }
      }
    });

    sock.ev.on('contacts.upsert', async (contacts) => {
      for (const contact of contacts) {
        const jid = jidNormalizedUser(contact.id);
        const lid = contact.id.endsWith('@lid') ? jid : null;
        const name = contact.name || contact.notify || jid.split('@')[0];

        await upsertContact(jid, name, lid);

        if (lid) {
          const { data: existing } = await supabase.from('contacts').select('id').eq('account_id', accountId).eq('display_name', name).neq('external_id', jid).maybeSingle();
          if (existing) {
            await supabase.from('contacts').update({ metadata: { lid: jid } }).eq('id', existing.id);
          }
        }
      }
    });

    sock.ev.on('contacts.update', async (updates) => {
      for (const update of updates) {
        const jid = jidNormalizedUser(update.id);

        // Mise à jour photo de profil — stockage permanent
        if (update.imgUrl !== undefined) {
          let avatarUrl = null;
          if (update.imgUrl) {
            // Get contact id first
            const { data: c } = await supabase.from('contacts').select('id').eq('account_id', accountId).eq('external_id', jid).maybeSingle();
            if (c) {
              avatarUrl = await downloadAndStoreAvatar(c.id, update.imgUrl);
            }
          }
          await supabase.from('contacts').update({ avatar_url: avatarUrl })
            .eq('account_id', accountId).eq('external_id', jid);
        }

        // Mise à jour nom
        if (update.name || update.notify) {
          await supabase.from('contacts').update({
            display_name: update.name || update.notify
          }).eq('account_id', accountId).eq('external_id', jid);
        }

        // Mapping LID ↔ PN
        if (update.lid || update.phoneNumber) {
          await supabase.from('contacts').upsert({
            account_id: accountId,
            external_id: jid,
            display_name: update.name || update.notify || jid.split('@')[0],
            metadata: { lid: update.lid || null, pn: update.phoneNumber || null }
          }, { onConflict: 'account_id, external_id' });
        }
      }
    });

    // --- NOUVEAUX MESSAGES (temps réel) ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message) continue;

        const jid = jidNormalizedUser(msg.key.remoteJid);
        const isGroup = jid.endsWith('@g.us');
        const isFromMe = msg.key.fromMe || false;

        const content = msg.message.conversation
          || msg.message.extendedTextMessage?.text
          || msg.message.imageMessage?.caption
          || msg.message.videoMessage?.caption
          || msg.message.documentMessage?.fileName
          || '';

        const mediaInfo = getMediaInfo(msg.message);
        const convId = await getOrCreateUnifiedConversation(jid, msg.pushName || jid.split('@')[0], isGroup);

        if (!convId) continue;

        // Télécharger le média si présent
        let mediaUrl = null;
        if (mediaInfo) {
          mediaUrl = await downloadAndStoreMedia(msg);
        }

        // Insérer le message (envoyé OU reçu)
        const quoted = getQuotedInfo(msg.message);
        const { data: insertedMsg } = await supabase.from('messages').upsert({
          conversation_id: convId,
          account_id: accountId,
          remote_id: msg.key.id,
          sender_id: isFromMe ? accountId : (isGroup ? msg.key.participant : jid),
          content: content || (mediaInfo ? `[${mediaInfo.type}]` : ''),
          media_type: mediaInfo?.type || null,
          media_url: mediaUrl,
          is_from_me: isFromMe,
          timestamp: new Date((msg.messageTimestamp?.low || msg.messageTimestamp || Date.now() / 1000) * 1000),
          metadata: { 
            participant: msg.key.participant || null,
            quoted: quoted
          }
        }, { onConflict: 'remote_id' }).select('id').single();

        // Mettre à jour la preview de la conversation
        const preview = content || (mediaInfo ? `📷 ${mediaInfo.type.charAt(0).toUpperCase() + mediaInfo.type.slice(1)}` : '');
        await supabase.from('conversations').update({
          last_message_preview: preview,
          last_message_at: new Date()
        }).eq('id', convId);

        if (!isFromMe) {
          onEvent('message', { jid, text: preview, fromMe: false });
        }
      }
    });

    sock.ev.on('groups.update', async (updates) => {
      for (const update of updates) {
        const jid = jidNormalizedUser(update.id);
        await getOrCreateUnifiedConversation(jid, update.subject, true);
      }
    });

    // Messages mis à jour (statut lu/livré)
    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        if (update.update?.status !== undefined) {
          const statusMap = { 1: 'sent', 2: 'delivered', 3: 'read', 4: 'played' };
          const status = statusMap[update.update.status];
          if (status) {
            await supabase.from('messages').update({ status })
              .eq('remote_id', update.key.id);
          }
        }
      }
    });
    // --- WORKER DE SYNC EN CASCADE (HISTORIQUE ANCIEN) ---
    const processHistoryBatch = async (jid) => {
      if (!sock) return;
      try {
        // 1. Trouver le message le plus ancien dans notre DB pour cette conv
        const { data: oldestDbMsg } = await supabase.from('messages')
          .select('timestamp, remote_id')
          .eq('account_id', accountId)
          .eq('sender_id', jid.endsWith('@g.us') ? undefined : jid) // Filter by conv jid generally
          .order('timestamp', { ascending: true })
          .limit(1)
          .maybeSingle();

        // Plus robuste : récupérer la conversation pour avoir le curseur stocké
        const { data: conv } = await supabase.from('conversations')
          .select('id, metadata')
          .eq('account_id', accountId)
          .eq('external_id', jid)
          .single();

        if (conv?.metadata?.history_sync_complete) return;

        const cursorMsgId = conv.metadata?.oldest_msg_id || oldestDbMsg?.remote_id;
        const limit = 100;

        logger.info(`[WA-CASCADE-SYNC] Fetching history for ${jid} (cursor: ${cursorMsgId || 'START'})`);
        
        // fetchMessageHistory est l'API Baileys pour remonter le temps
        // NOTE: Baileys peut rejeter si le cursor n'est pas formaté correctement
        const messages = await sock.fetchMessageHistory(jid, limit, cursorMsgId ? { id: cursorMsgId, fromMe: false } : undefined)
          .catch(e => {
            logger.warn(`[WA-CASCADE-SYNC] Failed with cursor ${cursorMsgId}, retrying without cursor...`);
            return sock.fetchMessageHistory(jid, limit);
          });

        if (!messages || messages.length === 0) {
          logger.info(`[WA-CASCADE-SYNC] ${jid} finalized. No more history.`);
          await supabase.from('conversations').update({
            metadata: { ...conv.metadata, history_sync_complete: true }
          }).eq('id', conv.id);
          return;
        }

        // Insérer les messages récupérés
        for (const msg of messages) {
          if (!msg.message) continue;
          const ts = (msg.messageTimestamp?.low || msg.messageTimestamp || 0) * 1000;
          const mediaInfo = getMediaInfo(msg.message);
          const isGroupMsg = jid.endsWith('@g.us');
          const finalSenderId = msg.key.fromMe ? accountId : (isGroupMsg ? (msg.key.participant || jid) : jid);

          await supabase.from('messages').upsert({
            conversation_id: conv.id,
            account_id: accountId,
            remote_id: msg.key.id,
            sender_id: finalSenderId,
            content: extractContent(msg.message) || (mediaInfo ? `[${mediaInfo.type}]` : ''),
            media_type: mediaInfo?.type || null,
            is_from_me: msg.key.fromMe || false,
            timestamp: new Date(ts || Date.now()),
            metadata: {
              has_media: !!mediaInfo,
              participant: isGroupMsg ? (msg.key.participant || null) : null,
              pushName: msg.pushName || null,
              is_history: true
            }
          }, { onConflict: 'remote_id' });
        }

        // Mettre à jour le curseur (le plus ancien de ce batch)
        const newOldest = messages[messages.length - 1]; // Baileys retourne généralement du plus récent au plus ancien
        await supabase.from('conversations').update({
          metadata: { ...conv.metadata, oldest_msg_id: newOldest.key.id }
        }).eq('id', conv.id);

        logger.info(`[WA-CASCADE-SYNC] ${jid}: inserted ${messages.length} messages.`);
      } catch (e) {
        logger.error(`[WA-CASCADE-SYNC-ERR] ${jid}: ${e.message}`);
      }
    };

    const startHistoryCascadeWorker = async () => {
      if (!sock) return;
      logger.info('[WA-CASCADE-SYNC] Starting background history worker...');
      
      while (sock) {
        try {
          // Trouver les conversations qui ont besoin de sync
          // Utilisation de NOT logic plus permissive pour attraper Metadata NULL ou flag manquant
          const { data: convs } = await supabase.from('conversations')
            .select('external_id, metadata')
            .eq('account_id', accountId)
            .or('metadata->history_sync_complete.is.null,metadata->history_sync_complete.eq.false')
            .order('last_message_at', { ascending: false })
            .limit(10);

          if (!convs || convs.length === 0) {
            logger.info('[WA-CASCADE-SYNC] All histories complete.');
            break;
          }

          for (const conv of convs) {
            await processHistoryBatch(conv.external_id);
            await delay(1500); // Respecter le délai de sécurité demandé
          }
        } catch (e) {
          logger.error(`[WA-CASCADE-SYNC-LOOP] ${e.message}`);
          await delay(5000);
        }
      }
    };

    // startHistoryCascadeWorker(); // Retiré d'ici pour être mis dans le hook de maintenance
  };

  await startSocket();

  return {
    sendMessage: async (jid, text) => {
      if (!sock) return { success: false, error: 'Not connected' };
      try {
        const result = await sock.sendMessage(jid, { text });
        return { success: true, messageId: result.key.id };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    sendMedia: async (jid, mediaPayload) => {
      if (!sock) return { success: false, error: 'Not connected' };
      try {
        const result = await sock.sendMessage(jid, mediaPayload);
        return { success: true, messageId: result.key.id };
      } catch (e) {
        logger.error(`[WA-SEND-MEDIA] ${e.message}`);
        return { success: false, error: e.message };
      }
    },
    disconnect: async () => {
      if (sock) sock.end();
    }
  };
};
