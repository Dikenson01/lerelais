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
      const payload = {
        account_id: accountId,
        filename: makeKey(ns_group, filename),
        data: JSON.stringify(data, BufferJSON.replacer),
        updated_at: new Date().toISOString()
      };
      await supabase.from(TABLE).upsert(payload, { onConflict: 'account_id, filename' });
    } catch (e) {
      logger.error(`[WA-DB] Write error (${ns_group}:${filename}):`, e.message);
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
      await supabase.from(TABLE).upsert({
        account_id: accountId,
        filename: `NS:backup:creds.json`,
        data: JSON.stringify(activeCreds, BufferJSON.replacer),
        updated_at: new Date().toISOString()
      }, { onConflict: 'account_id, filename' });
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

    sock.ev.on('messaging-history.sync', async ({ chats, contacts, messages, isLatest }) => {
      try {
        logger.info(`[WA] History Sync Started: ${chats?.length || 0} chats, ${messages?.length || 0} messages...`);
        
        // 1. Sync Chats
        if (chats) {
          for (const chat of chats) {
            const jid = jidNormalizedUser(chat.id);
            const { error } = await supabase.from('conversations').upsert({
              account_id: accountId,
              external_id: jid,
              platform: 'whatsapp',
              title: chat.name || jid.split('@')[0],
              is_group: chat.id.endsWith('@g.us'),
              metadata: { is_archived: chat.archived === true },
              updated_at: new Date()
            }, { onConflict: 'account_id, external_id' });
            
            if (error) logger.error(`[WA-DB-SYNC-ERR] Chat ${jid}: ${error.message}`);
            else logger.info(`[WA-DB-SYNC] Synced chat: ${jid}`);
          }
        }

        // 2. Sync Messages
        if (messages) {
          for (const msg of messages) {
            if (!msg.message) continue;
            const jid = jidNormalizedUser(msg.key.remoteJid);
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            
            const { data: conv, error: convErr } = await supabase.from('conversations').select('id').eq('account_id', accountId).eq('external_id', jid).maybeSingle();
            
            if (convErr) logger.error(`[WA-DB-SYNC-ERR] FindConv ${jid}: ${convErr.message}`);
            
            if (conv) {
              const { error: msgErr } = await supabase.from('messages').upsert({
                conversation_id: conv.id,
                account_id: accountId,
                remote_id: msg.key.id,
                sender_id: jid,
                content: text,
                is_from_me: msg.key.fromMe,
                timestamp: new Date(msg.messageTimestamp * 1000)
              }, { onConflict: 'remote_id' });
              
              if (msgErr) logger.error(`[WA-DB-SYNC-ERR] Msg ${msg.key.id}: ${msgErr.message}`);
            }
          }
        }
        logger.info(`[WA] History Sync Completed successfully.`);
      } catch (e) {
        logger.error(`[WA-SYNC-ERR] messaging-history.sync: ${e.message}`);
      }
    });

    sock.ev.on('contacts.upsert', async (contacts) => {
      for (const contact of contacts) {
        const jid = jidNormalizedUser(contact.id);
        await supabase.from('contacts').upsert({
          account_id: accountId,
          external_id: jid,
          display_name: contact.name || contact.notify || jid.split('@')[0],
          avatar_url: null,
          metadata: { lid: contact.id.endsWith('@lid') ? contact.id : null }
        }, { onConflict: 'account_id, external_id' });
      }
    });

    sock.ev.on('contacts.update', async (updates) => {
      for (const update of updates) {
        if (update.imgUrl !== undefined) {
           const jid = jidNormalizedUser(update.id);
           await supabase.from('contacts').update({ avatar_url: update.imgUrl }).eq('account_id', accountId).eq('external_id', jid);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const jid = jidNormalizedUser(msg.key.remoteJid);
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        
        // Sync conversation
        const { data: conv } = await supabase.from('conversations').upsert({
          account_id: accountId,
          external_id: jid,
          platform: 'whatsapp',
          title: msg.pushName || jid.split('@')[0],
          last_message_preview: text.substring(0, 100),
          updated_at: new Date()
        }, { onConflict: 'account_id, external_id' }).select().single();

        if (conv) {
          await supabase.from('messages').insert({
            conversation_id: conv.id,
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
