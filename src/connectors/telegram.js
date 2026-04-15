/**
 * TELEGRAM MTProto USER CLIENT
 * Using gramjs — real user account sync (not just bot)
 * Same architecture as WhatsApp connector
 */

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import logger from '../utils/logger.js';
import supabase from '../config/supabase.js';

// Telegram API credentials (from https://my.telegram.org)
// These are stored in Railway env vars: TELEGRAM_API_ID, TELEGRAM_API_HASH
const getApiCredentials = () => ({
  apiId: parseInt(process.env.TELEGRAM_API_ID || '0'),
  apiHash: process.env.TELEGRAM_API_HASH || ''
});

// In-memory map: accountId → { client, step, phone, phoneCodeHash }
const tgSessions = new Map();

/**
 * Step 1: Start Telegram auth — send code to phone
 * Returns: { step: 'code' } — frontend must prompt user for the code
 */
export const startTelegramAuth = async (accountId, phoneNumber) => {
  const { apiId, apiHash } = getApiCredentials();
  if (!apiId || !apiHash) {
    throw new Error('TELEGRAM_API_ID / TELEGRAM_API_HASH manquants dans les variables Railway');
  }

  // Restore existing session if any
  const { data: acc } = await supabase.from('accounts')
    .select('metadata').eq('id', accountId).maybeSingle();
  const savedSession = acc?.metadata?.tg_session || '';

  const client = new TelegramClient(new StringSession(savedSession), apiId, apiHash, {
    connectionRetries: 5,
    baseLogger: { log: () => {}, warn: () => {}, error: (msg) => logger.warn(`[TG] ${msg}`) }
  });

  await client.connect();

  // Send code
  const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, phoneNumber.replace(/\D/g, ''));

  tgSessions.set(accountId, { client, phone: phoneNumber.replace(/\D/g, ''), phoneCodeHash, step: 'code' });
  logger.info(`[TG] Code sent to ${phoneNumber} for account ${accountId}`);

  // Save pairing state
  await supabase.from('accounts').update({
    status: 'pairing',
    metadata: { ...(acc?.metadata || {}), tg_phone: phoneNumber, tg_step: 'code' }
  }).eq('id', accountId);

  return { step: 'code' };
};

/**
 * Step 2: Verify code (+ optional 2FA password)
 * Returns: { step: 'connected' } or { step: '2fa' } if 2FA required
 */
export const verifyTelegramCode = async (accountId, code, password2fa = null) => {
  const session = tgSessions.get(accountId);
  if (!session) throw new Error('Session introuvable, recommencez');

  const { client, phone, phoneCodeHash } = session;

  try {
    await client.signIn({ apiId: getApiCredentials().apiId, apiHash: getApiCredentials().apiHash },
      { phoneNumber: phone, phoneCodeHash, phoneCode: code });
  } catch (err) {
    if (err.message?.includes('SESSION_PASSWORD_NEEDED') || err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      if (!password2fa) {
        tgSessions.set(accountId, { ...session, step: '2fa' });
        return { step: '2fa' };
      }
      // Apply 2FA
      await client.signInWithPassword({ apiId: getApiCredentials().apiId, apiHash: getApiCredentials().apiHash },
        { password: password2fa });
    } else {
      throw err;
    }
  }

  // Connected! Save session string
  const sessionStr = client.session.save();
  const me = await client.getMe();
  const displayName = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.username || phone;

  await supabase.from('accounts').update({
    status: 'connected',
    username: me.username || phone,
    account_name: displayName,
    metadata: { tg_session: sessionStr, tg_phone: phone, tg_user_id: me.id?.toString(), tg_step: 'connected' }
  }).eq('id', accountId);

  logger.info(`[TG] Connected as ${displayName} (account ${accountId})`);

  // Start message listener in background
  await attachTelegramListeners(accountId, client);
  tgSessions.set(accountId, { ...session, client, step: 'connected', sessionStr });

  return { step: 'connected', displayName };
};

/**
 * Attach real-time message listeners and start background sync
 */
const attachTelegramListeners = async (accountId, client) => {
  // Sync existing dialogs (conversations)
  try {
    logger.info(`[TG] Syncing dialogs for account ${accountId}...`);
    const dialogs = await client.getDialogs({ limit: 100 });

    for (const dialog of dialogs) {
      if (!dialog.isUser && !dialog.isGroup && !dialog.isChannel) continue;

      const externalId = dialog.id?.toString();
      const title = dialog.title || dialog.name || externalId;
      const isGroup = dialog.isGroup || dialog.isChannel;

      // Upsert contact
      let contactId = null;
      if (!isGroup) {
        const { data: contact } = await supabase.from('contacts').upsert({
          account_id: accountId,
          external_id: externalId,
          display_name: title,
          platform: 'telegram',
          phone_number: dialog.entity?.phone || null,
          avatar_url: null
        }, { onConflict: 'account_id, external_id', ignoreDuplicates: false }).select('id').single();
        contactId = contact?.id;
      }

      // Upsert conversation
      await supabase.from('conversations').upsert({
        account_id: accountId,
        external_id: externalId,
        platform: 'telegram',
        title,
        is_group: isGroup,
        contact_id: contactId,
        last_message_at: dialog.message?.date ? new Date(dialog.message.date * 1000) : new Date(),
        last_message_preview: dialog.message?.text?.slice(0, 120) || ''
      }, { onConflict: 'account_id, external_id' });
    }
    logger.info(`[TG] Synced ${dialogs.length} dialogs`);
  } catch (e) {
    logger.error(`[TG-SYNC] ${e.message}`);
  }

  // Listen for new messages in real time
  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg) return;

      const chatId = msg.chatId?.toString() || msg.peerId?.toString();
      if (!chatId) return;

      const text = msg.text || msg.message || '';
      const isFromMe = msg.out || false;

      // Resolve conversation
      const { data: conv } = await supabase.from('conversations')
        .select('id').eq('account_id', accountId).eq('external_id', chatId).maybeSingle();

      let convId = conv?.id;
      if (!convId) {
        // Create new conversation on first message
        try {
          const entity = await client.getEntity(msg.chatId || msg.peerId);
          const title = entity.firstName
            ? [entity.firstName, entity.lastName].filter(Boolean).join(' ')
            : (entity.title || chatId);
          const isGroup = !!(entity.megagroup || entity.gigagroup || entity.broadcast || entity.migratedTo);

          const { data: newConv } = await supabase.from('conversations').upsert({
            account_id: accountId,
            external_id: chatId,
            platform: 'telegram',
            title,
            is_group: isGroup,
            last_message_at: new Date(),
            last_message_preview: text.slice(0, 120)
          }, { onConflict: 'account_id, external_id' }).select('id').single();
          convId = newConv?.id;
        } catch (e) { return; }
      }

      if (!convId) return;

      // Insert message
      await supabase.from('messages').upsert({
        conversation_id: convId,
        account_id: accountId,
        remote_id: msg.id?.toString(),
        sender_id: isFromMe ? accountId : chatId,
        content: text || (msg.media ? '[Média]' : ''),
        is_from_me: isFromMe,
        timestamp: new Date((msg.date || Date.now() / 1000) * 1000),
        metadata: { tg_msg_id: msg.id, pushName: null }
      }, { onConflict: 'remote_id' });

      // Update preview
      await supabase.from('conversations').update({
        last_message_preview: text.slice(0, 120),
        last_message_at: new Date((msg.date || Date.now() / 1000) * 1000)
      }).eq('id', convId);
    } catch (e) {
      logger.error(`[TG-MSG] ${e.message}`);
    }
  }, new NewMessage({}));

  logger.info(`[TG] Real-time listener attached for ${accountId}`);
};

/**
 * Restore Telegram session on server startup
 */
export const restoreTelegramConnector = async (accountId) => {
  const { apiId, apiHash } = getApiCredentials();
  if (!apiId || !apiHash) return null;

  const { data: acc } = await supabase.from('accounts')
    .select('metadata').eq('id', accountId).maybeSingle();
  const savedSession = acc?.metadata?.tg_session;
  if (!savedSession) return null;

  try {
    const client = new TelegramClient(new StringSession(savedSession), apiId, apiHash, {
      connectionRetries: 5,
      baseLogger: { log: () => {}, warn: () => {}, error: (msg) => logger.warn(`[TG] ${msg}`) }
    });

    await client.connect();
    if (!await client.isUserAuthorized()) {
      logger.warn(`[TG] Session expired for ${accountId}`);
      await supabase.from('accounts').update({ status: 'disconnected' }).eq('id', accountId);
      return null;
    }

    const me = await client.getMe();
    logger.info(`[TG] Restored session for ${me.username || accountId}`);

    await attachTelegramListeners(accountId, client);
    tgSessions.set(accountId, { client, step: 'connected' });

    return {
      sendMessage: async (chatId, text) => {
        try {
          await client.sendMessage(chatId, { message: text });
          return { success: true };
        } catch (e) {
          return { success: false, error: e.message };
        }
      },
      disconnect: async () => { await client.disconnect(); }
    };
  } catch (e) {
    logger.error(`[TG-RESTORE] ${e.message}`);
    return null;
  }
};

/**
 * Send a message via an existing Telegram session
 */
export const sendTelegramMessage = async (accountId, chatId, text) => {
  const session = tgSessions.get(accountId);
  if (!session?.client) throw new Error('Session Telegram non active');
  await session.client.sendMessage(chatId, { message: text });
  return { success: true };
};
