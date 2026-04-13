import makeWASocket, {
  DisconnectReason,
  initAuthCreds,
  fetchLatestBaileysVersion,
  Browsers,
  delay,
  jidNormalizedUser,
  BufferJSON,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import { proto } from '@whiskeysockets/baileys';
import logger from '../utils/logger.js';
import supabase from '../config/supabase.js';
import pino from 'pino';

/**
 * MOTEUR IMMORTAL v2 (Style "Tim") 
 * Incorpore : 
 * 1. Double sauvegarde (Backup)
 * 2. Système de Lock anti-collision (Code 440)
 * 3. Cache de SignalKeyStore (Performance)
 * 4. Identité Browser fixée
 */

const useSupabaseAuthState = async (accountId) => {
  const TABLE = 'account_sessions';
  
  // Adaptateur de Namespace par préfixe (Garantit compatibilité sans migration DB)
  const makeKey = (ns_group, filename) => `NS:${ns_group}:${filename}`;

  const writeData = async (data, filename, ns_group = 'active') => {
    try {
      const key = makeKey(ns_group, filename);
      // Utilisation d'un verrou local simple pour éviter les conflits de duplication
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
        // TENTATIVE DE RESTAURATION DEPUIS LE BACKUP
        if (ns_group === 'active') {
          const backup = await readData(filename, 'backup');
          if (backup) {
             logger.info(`[WA-RECOVERY] Restored ${filename} from backup!`);
             await writeData(backup, filename, 'active'); // Auto-réparation
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

  // --- LOCK SYSTEM (Anti-Conflit 440) ---
  const myInstanceId = `${process.env.RAILWAY_SERVICE_NAME || 'local'}-${process.pid}`;
  
  const checkLock = async () => {
    const lockData = await readData('lock_session', 'lock');
    if (!lockData) return null;
    return { ...lockData, updatedAt: new Date(lockData.ts).getTime() };
  };

  const claimLock = async () => {
    const current = await checkLock();
    // Si lock existant par un autre et frais (< 3 min), on échoue
    if (current && current.owner !== myInstanceId && (Date.now() - current.updatedAt) < 180000) {
      return false;
    }
    await writeData({ owner: myInstanceId, ts: new Date().toISOString() }, 'lock_session', 'lock');
    return true;
  };

  // Chargement initial
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
              
              // DOUBLE SAUVEGARDE (Backup) des clés critiques
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

export const createWhatsAppConnector = async (accountId, onEvent) => {
  let sock = null;
  let qrCode = null;
  let { state, saveCreds, clearSession, claimLock } = await useSupabaseAuthState(accountId);

  const startSocket = async () => {
    // 1. Tenter de prendre le verrou
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
      browser: Browsers.ubuntu('Chrome'), // Identité stable
      logger: pino({ level: 'silent' }),
      syncFullHistory: true, // Force la récupération de l'historique
      markOnlineOnConnect: true,
      retryRequestDelayMs: 5000,
    });

    // Heartbeat Lock (Renouveler le verrou chaque minute)
    const lockTimer = setInterval(async () => {
      if (sock && (await claimLock())) {
        // Lock renewed
      } else {
        logger.error('[WA-LOCK] Port du verrou perdu !');
      }
    }, 60000);

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      // Toujours faire un backup des creds lors de l'update
      const { state: newState } = await useSupabaseAuthState(accountId);
      const activeCreds = newState.creds;
      // Note: useSupabaseAuthState wrap already handles backups in set() but creds.json is manual here
      // Manual backup for top level creds
      const TABLE = 'account_sessions';
      const key = `NS:backup:creds.json`;
      await supabase.from(TABLE).delete().eq('account_id', accountId).eq('filename', key);
      await supabase.from(TABLE).insert({
        account_id: accountId,
        filename: key,
        data: JSON.stringify(activeCreds, BufferJSON.replacer)
      });
      logger.info(`[WA-DB] Backup creds updated for ${accountId}`);
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = qr;
        onEvent('qr', qr);
        onEvent('status', { status: 'pairing' });
      }

      if (connection === 'close') {
        clearInterval(lockTimer);
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        
        logger.warn(`[WA] Connection closed: ${statusCode}. Reconnect: ${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut) {
          logger.error('[WA] Logged out! Clearing session...');
          await clearSession();
          onEvent('status', { status: 'disconnected' });
        } else if (statusCode === 440 || statusCode === 405) {
          // Conflit ou session expirée
          logger.info('[WA-STABILITY] Conflict or Expired. Waiting 10s before retry...');
          setTimeout(startSocket, 10000);
        } else {
          startSocket();
        }
      }

      if (connection === 'open') {
        qrCode = null;
        onEvent('status', { status: 'connected' });
        logger.info('[WA] Connected successfully!');

        // --- MAINTENANCE DE POST-CONNEXION (Générique pour tous) ---
        setTimeout(async () => {
          // 1. Unifier les conversations (LID/PN Merge)
          const { data: convs } = await supabase.from('conversations').select('id, external_id, contact_id').eq('account_id', accountId);
          if (convs) {
            const contactMap = {};
            for (const conv of convs) {
              if (!conv.contact_id) {
                 const cid = await getContactId(conv.external_id);
                 if (cid) {
                   conv.contact_id = cid;
                   await supabase.from('conversations').update({ contact_id: cid }).eq('id', conv.id);
                 }
              }

              if (conv.contact_id) {
                if (!contactMap[conv.contact_id]) {
                  contactMap[conv.contact_id] = conv.id;
                } else {
                  // DOUBLON TROUVÉ ! On fusionne
                  const masterId = contactMap[conv.contact_id];
                  logger.info(`[WA-MERGE] Merging duplicate conversation ${conv.id} into ${masterId}`);
                  
                  // Déplacer les messages
                  await supabase.from('messages').update({ conversation_id: masterId }).eq('conversation_id', conv.id);
                  // Supprimer le doublon
                  await supabase.from('conversations').delete().eq('id', conv.id);
                }
              }
            }
          }

          // 2. Découverte des Groupes (Miroir Profond)
          try {
            const groups = await sock.groupFetchAllParticipating();
            for (const [jid, group] of Object.entries(groups)) {
              await getOrCreateUnifiedConversation(jid, group.subject, true);
            }
          } catch (e) {
            logger.error(`[WA-GROUP-FETCH-ERR] ${e.message}`);
          }

          // 3. Scan PDP pour tous les contacts sans photo
          const { data: contacts } = await supabase.from('contacts').select('id, external_id').is('avatar_url', null);
          if (contacts) {
            for (const contact of contacts) {
              try {
                const url = await sock.profilePictureUrl(contact.external_id, 'image').catch(() => null);
                if (url) await supabase.from('contacts').update({ avatar_url: url }).eq('id', contact.id);
                await delay(1000); // Éviter le bannissement
              } catch (e) {}
            }
          }
          logger.info('[WA-MAINTENANCE] Cleanup and Unification finished.');
        }, 60000); 
      }
    });

    sock.ev.on('chats.upsert', async (chats) => {
      for (const chat of chats) {
        const jid = jidNormalizedUser(chat.id);
        await supabase.from('conversations').upsert({
          account_id: accountId,
          external_id: jid,
          platform: 'whatsapp',
          title: chat.name || jid.split('@')[0],
          is_group: chat.id.endsWith('@g.us'),
          unread_count: chat.unreadCount || 0,
          metadata: { is_archived: chat.archived === true },
          updated_at: new Date()
        }, { onConflict: 'account_id, external_id' });
      }
    });

    sock.ev.on('chats.update', async (updates) => {
      try {
        for (const update of updates) {
          if (update.archived !== undefined) {
            const jid = jidNormalizedUser(update.id);
            await supabase.from('conversations').update({
              metadata: { is_archived: update.archived === true }
            }).eq('account_id', accountId).eq('external_id', jid);
          }
        }
      } catch (e) {
        logger.error(`[WA-SYNC-ERR] chats.update: ${e.message}`);
      }
    });

    // --- HELPERS POUR LA SYNCHRO ---
    const getContactId = async (jid) => {
      // 1. Recherche par JID exact (PN ou LID)
      let { data } = await supabase.from('contacts').select('id, avatar_url, phone_number').eq('account_id', accountId).eq('external_id', jid).maybeSingle();
      
      // 2. Si non trouvé et c'est un LID, tenter de trouver via le mapping interne
      if (!data && jid.endsWith('@lid')) {
        const lid = jid.split('@')[0];
        const { data: mapping } = await supabase.from('contacts')
          .select('id, avatar_url')
          .eq('account_id', accountId)
          .filter('metadata->lid', 'eq', jid)
          .maybeSingle();
        data = mapping;
      }

      if (data && !data.avatar_url) {
        // Tenter de récupérer l'avatar si manquant (Generic pour tous)
        try {
          const url = await sock.profilePictureUrl(jid, 'image').catch(() => null);
          if (url) await supabase.from('contacts').update({ avatar_url: url }).eq('id', data.id);
        } catch (e) {}
      }
      return data?.id;
    };

    // --- RESOLUTION UNIFIÉE (Miroir) ---
    const getOrCreateUnifiedConversation = async (jid, title, isGroup = false) => {
      const contact_id = await getContactId(jid);
      
      // 1. Tenter de trouver une conversation existante liée à ce contact
      if (contact_id) {
        const { data: existing } = await supabase.from('conversations')
          .select('id')
          .eq('account_id', accountId)
          .eq('contact_id', contact_id)
          .maybeSingle();
        
        if (existing) {
          // Mettre à jour le JID (pour utiliser le plus récent pour l'envoi)
          await supabase.from('conversations').update({ external_id: jid, title: title }).eq('id', existing.id);
          return existing.id;
        }
      }

      // 2. Sinon, upsert par external_id (Standard Baileys)
      const { data: conv, error } = await supabase.from('conversations').upsert({
        account_id: accountId,
        external_id: jid,
        contact_id: contact_id,
        platform: 'whatsapp',
        title: title || jid.split('@')[0],
        is_group: isGroup,
        last_message_at: new Date()
      }, { onConflict: 'account_id, external_id' }).select('id').single();

      if (error) logger.error(`[WA-DB-UNIFY-ERR] ${jid}: ${error.message}`);
      return conv?.id;
    };

    sock.ev.on('messaging-history.sync', async ({ chats, contacts: syncContacts, messages }) => {
      try {
        logger.info(`[WA] Mirror Sync Started: ${chats?.length || 0} chats, ${syncContacts?.length || 0} contacts`);

        // 0. Sync Contacts PROFOND
        if (syncContacts) {
          for (const contact of syncContacts) {
            const jid = jidNormalizedUser(contact.id);
            await supabase.from('contacts').upsert({
              account_id: accountId,
              external_id: jid,
              display_name: contact.name || contact.verifiedName || contact.notify || jid.split('@')[0],
              phone_number: jid.split('@')[0],
              metadata: { lid: contact.id.endsWith('@lid') ? jid : null }
            }, { onConflict: 'account_id, external_id' });
          }
        }

        // 1. Sync Chats (Incluant Groupes)
        if (chats) {
          for (const chat of chats) {
            const jid = jidNormalizedUser(chat.id);
            await getOrCreateUnifiedConversation(jid, chat.name, jid.endsWith('@g.us'));
          }
        }

        // 2. Sync Messages (Historique Complet)
        if (messages) {
          for (const msg of messages) {
            if (!msg.message) continue;
            const jid = jidNormalizedUser(msg.key.remoteJid);
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            
            const convId = await getOrCreateUnifiedConversation(jid, msg.pushName, jid.endsWith('@g.us'));
            
            if (convId) {
              await supabase.from('messages').upsert({
                conversation_id: convId,
                account_id: accountId,
                remote_id: msg.key.id,
                sender_id: jid,
                content: text,
                is_from_me: msg.key.fromMe,
                timestamp: new Date(msg.messageTimestamp * 1000)
              }, { onConflict: 'remote_id' });
              
              await supabase.from('conversations').update({ 
                last_message_at: new Date(msg.messageTimestamp * 1000),
                last_message_preview: text.substring(0, 100)
              }).eq('id', convId);
            }
          }
        }
        logger.info(`[WA] Mirror Sync Completed.`);
      } catch (e) {
        logger.error(`[WA-SYNC-ERR] mirror.sync: ${e.message}`);
      }
    });

    sock.ev.on('contacts.upsert', async (contacts) => {
      for (const contact of contacts) {
        const jid = jidNormalizedUser(contact.id);
        const lid = contact.id.endsWith('@lid') ? jid : null;
        
        await supabase.from('contacts').upsert({
          account_id: accountId,
          external_id: jid,
          display_name: contact.name || contact.notify || jid.split('@')[0],
          avatar_url: null,
          metadata: { lid: lid }
        }, { onConflict: 'account_id, external_id' });
      }
    });

    sock.ev.on('contacts.update', async (updates) => {
      for (const update of updates) {
        const jid = jidNormalizedUser(update.id);
        
        // 1. Mise à jour PDP
        if (update.imgUrl !== undefined) {
           await supabase.from('contacts').update({ avatar_url: update.imgUrl }).eq('account_id', accountId).eq('external_id', jid);
        }

        // 2. Mapping LID ↔ PN (Générique)
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

    sock.ev.on('groups.update', async (updates) => {
      for (const update of updates) {
        const jid = jidNormalizedUser(update.id);
        logger.info(`[WA-GROUP] Group info updated: ${jid}`);
        await getOrCreateUnifiedConversation(jid, update.subject, true);
        if (update.participants) {
          // Future: sync participants if needed
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = jidNormalizedUser(msg.key.remoteJid);
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        // Résolution MIROIR : On utilise l'ID unifié (fusion LID/PN)
        const convId = await getOrCreateUnifiedConversation(jid, msg.pushName || jid.split('@')[0], jid.endsWith('@g.us'));

        if (convId) {
          await supabase.from('messages').insert({
            conversation_id: convId,
            account_id: accountId,
            remote_id: msg.key.id,
            sender_id: jid,
            content: text,
            is_from_me: false,
            timestamp: new Date(msg.messageTimestamp * 1000)
          });
          
          onEvent('message', { jid, text, fromMe: false });
        }
      }
    });
  };

  await startSocket();

  return {
    sendMessage: async (jid, text) => {
      if (!sock) return { success: false, error: 'Not connected' };
      const result = await sock.sendMessage(jid, { text });
      return { success: true, messageId: result.key.id };
    },
    disconnect: async () => {
      if (sock) sock.end();
    }
  };
};
