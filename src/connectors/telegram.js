/**
 * TELEGRAM MTProto USER CLIENT
 * Using gramjs (telegram npm package) — real user account, not just bot
 *
 * FIXES:
 * - Removed baseLogger (caused "this._log.info is not a function" crash)
 * - Removed useWSS (caused random disconnections on Railway — use TCP instead)
 * - Added autoReconnect + retryDelay for Railway's 15-min connection timeout
 */

import { TelegramClient, Api } from 'telegram';
import { computeCheck } from 'telegram/Password.js';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import logger from '../utils/logger.js';
import supabase from '../config/supabase.js';

const getApiCredentials = () => ({
  apiId: parseInt(process.env.TELEGRAM_API_ID || '0'),
  apiHash: process.env.TELEGRAM_API_HASH || ''
});

// Recommended options for Railway (TCP, auto-reconnect, no WSS)
const CLIENT_OPTIONS = {
  connectionRetries: 10,
  retryDelay: 2000,
  autoReconnect: true,
  // NO useWSS — TCP works better on Railway
  // NO baseLogger — causes crash with "this._log.info is not a function"
};

// In-memory: accountId → { client, step, phone, phoneCodeHash }
const tgSessions = new Map();

// ─────────────────────────────────────────────
//  STEP 1: Send SMS code
// ─────────────────────────────────────────────

export const startTelegramAuth = async (accountId, phoneNumber) => {
  const { apiId, apiHash } = getApiCredentials();
  if (!apiId || !apiHash) {
    throw new Error('TELEGRAM_API_ID / TELEGRAM_API_HASH manquants dans les variables Railway');
  }

  // Normalize French numbers: 07... → +337...
  let cleanPhone = phoneNumber.replace(/\D/g, '');
  if (cleanPhone.startsWith('0') && cleanPhone.length === 10) {
    cleanPhone = '33' + cleanPhone.slice(1);
  }

  const { data: acc } = await supabase.from('accounts')
    .select('metadata').eq('id', accountId).maybeSingle();
  const savedSession = acc?.metadata?.tg_session || '';

  const client = new TelegramClient(
    new StringSession(savedSession),
    apiId, apiHash,
    CLIENT_OPTIONS
  );

  await client.connect();

  const { phoneCodeHash } = await client.sendCode({ apiId, apiHash }, cleanPhone);

  tgSessions.set(accountId, { client, phone: cleanPhone, phoneCodeHash, step: 'code' });

  await supabase.from('accounts').update({
    status: 'pairing',
    metadata: { ...(acc?.metadata || {}), tg_phone: cleanPhone, tg_step: 'code' }
  }).eq('id', accountId);

  logger.info(`[TG] Code sent to +${cleanPhone} for account ${accountId}`);
  return { step: 'code' };
};

// ─────────────────────────────────────────────
//  QR CODE LOGIN (alternative)
// ─────────────────────────────────────────────

export const startTelegramQR = async (accountId) => {
  const { apiId, apiHash } = getApiCredentials();
  if (!apiId || !apiHash) throw new Error('TELEGRAM_API_ID / TELEGRAM_API_HASH manquants');

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, CLIENT_OPTIONS);
  await client.connect();

  let currentQR = null;

  // Fire and forget — resolves when user scans QR
  const qrPromise = client.signInUserWithQrCode({ apiId, apiHash }, {
    qrCode: async (qr) => {
      const b64 = qr.token.toString('base64url');
      currentQR = `tg://login?token=${b64}`;
      logger.info(`[TG-QR] New QR token generated for ${accountId}`);
    },
    onError: (err) => logger.warn('[TG-QR-ERR]', err.message)
  }).catch(() => {});

  tgSessions.set(accountId, { client, qrPromise, getQR: () => currentQR, step: 'qr' });

  // Wait up to 5s for first QR
  for (let i = 0; i < 10; i++) {
    if (currentQR) break;
    await new Promise(r => setTimeout(r, 500));
  }

  return { qr: currentQR };
};

export const checkTelegramQRStatus = async (accountId) => {
  const session = tgSessions.get(accountId);
  if (!session) return { status: 'unknown' };

  const { client, getQR } = session;

  try {
    if (await client.isUserAuthorized()) {
      const sessionStr = client.session.save();
      const me = await client.getMe();
      const displayName = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.username;

      await supabase.from('accounts').update({
        status: 'connected',
        username: me.username || me.id?.toString(),
        account_name: displayName,
        metadata: { tg_session: sessionStr, tg_user_id: me.id?.toString(), tg_step: 'connected' }
      }).eq('id', accountId);

      await attachTelegramListeners(accountId, client);
      return { status: 'connected', displayName };
    }
  } catch (e) {
    logger.warn('[TG-QR-STATUS]', e.message);
  }

  return { status: 'pairing', qr: getQR ? getQR() : null };
};

// ─────────────────────────────────────────────
//  STEP 2: Verify SMS code (+ optional 2FA)
// ─────────────────────────────────────────────

export const verifyTelegramCode = async (accountId, code, password2fa = null) => {
  const session = tgSessions.get(accountId);
  if (!session) throw new Error('Session introuvable, recommencez');

  const { client, phone, phoneCodeHash } = session;
  const { apiId, apiHash } = getApiCredentials();

  // Reconnect if needed (Railway can drop connections)
  if (!client.connected) {
    logger.info(`[TG-VERIFY] Reconnecting client for +${phone}...`);
    await client.connect();
  }

  try {
    if (!password2fa) {
      await client.invoke(new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code.trim()
      }));
    } else {
      // 2FA Flow — Manual SRP to avoid PHONE_CODE_INVALID
      logger.info(`[TG-VERIFY] Checking 2FA with SRP for +${phone}...`);
      const passwordSrpResult = await client.invoke(new Api.account.GetPassword());
      const srpCheck = await computeCheck(passwordSrpResult, password2fa);
      await client.invoke(new Api.auth.CheckPassword({
        password: srpCheck
      }));
    }
  } catch (err) {
    const msg = err.message || err.errorMessage || '';
    if (msg.includes('SESSION_PASSWORD_NEEDED')) {
      tgSessions.set(accountId, { ...session, step: '2fa' });
      return { step: '2fa' };
    } else if (msg.includes('PHONE_CODE_INVALID')) {
      throw new Error('Code incorrect ou expiré. Recommencez.');
    } else if (msg.includes('PASSWORD_HASH_INVALID')) {
      throw new Error('Mot de passe 2FA incorrect.');
    } else {
      throw err;
    }
  }

  const sessionStr = client.session.save();
  const me = await client.getMe();
  const displayName = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.username || phone;

  await supabase.from('accounts').update({
    status: 'connected',
    username: me.username || phone,
    account_name: displayName,
    metadata: {
      tg_session: sessionStr,
      tg_phone: phone,
      tg_user_id: me.id?.toString(),
      tg_step: 'connected'
    }
  }).eq('id', accountId);

  logger.info(`[TG] Connected as ${displayName} (account ${accountId})`);
  await attachTelegramListeners(accountId, client);
  tgSessions.set(accountId, { ...session, client, step: 'connected' });

  return { step: 'connected', displayName };
};

// ─────────────────────────────────────────────
//  MESSAGE LISTENERS + DIALOG SYNC
// ─────────────────────────────────────────────

const attachTelegramListeners = async (accountId, client) => {
  // 1. Sync existing dialogs
  try {
    logger.info(`[TG] Syncing dialogs for account ${accountId}...`);
    const dialogs = await client.getDialogs({ limit: 100 });

    for (const dialog of dialogs) {
      if (!dialog.isUser && !dialog.isGroup && !dialog.isChannel) continue;

      const externalId = dialog.id?.toString();
      if (!externalId) continue;
      const title = dialog.title || dialog.name || externalId;
      const isGroup = dialog.isGroup || dialog.isChannel;

      let contactId = null;
      if (!isGroup) {
        const { data: contact } = await supabase.from('contacts').upsert({
          account_id: accountId,
          external_id: externalId,
          display_name: title,
          platform: 'telegram',
          phone_number: dialog.entity?.phone ? `+${dialog.entity.phone}` : null,
        }, { onConflict: 'account_id, external_id', ignoreDuplicates: false }).select('id').single();
        contactId = contact?.id;
      }

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

  // 2. Real-time listener for new messages
  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg) return;

      const chatId = msg.chatId?.toString() || msg.peerId?.toString();
      if (!chatId) return;

      const text = msg.text || msg.message || '';
      const isFromMe = msg.out || false;
      const msgDate = new Date((msg.date || Date.now() / 1000) * 1000);

      // Find or create conversation
      let { data: conv } = await supabase.from('conversations')
        .select('id').eq('account_id', accountId).eq('external_id', chatId).maybeSingle();

      if (!conv) {
        try {
          const entity = await client.getEntity(msg.chatId || msg.peerId);
          const entityTitle = entity.firstName
            ? [entity.firstName, entity.lastName].filter(Boolean).join(' ')
            : (entity.title || chatId);
          const isGroup = !!(entity.megagroup || entity.gigagroup || entity.broadcast);

          // Upsert contact if 1:1
          let contactId = null;
          if (!isGroup) {
            const { data: contact } = await supabase.from('contacts').upsert({
              account_id: accountId,
              external_id: chatId,
              display_name: entityTitle,
              platform: 'telegram',
              phone_number: entity.phone ? `+${entity.phone}` : null,
            }, { onConflict: 'account_id, external_id', ignoreDuplicates: false }).select('id').single();
            contactId = contact?.id;
          }

          const { data: newConv } = await supabase.from('conversations').upsert({
            account_id: accountId,
            external_id: chatId,
            platform: 'telegram',
            title: entityTitle,
            is_group: isGroup,
            contact_id: contactId,
            last_message_at: msgDate,
            last_message_preview: text.slice(0, 120)
          }, { onConflict: 'account_id, external_id' }).select('id').single();
          conv = newConv;
        } catch (e) {
          logger.warn(`[TG-CONV-CREATE] ${e.message}`);
          return;
        }
      }

      if (!conv) return;

      // Insert message
      await supabase.from('messages').upsert({
        conversation_id: conv.id,
        account_id: accountId,
        remote_id: msg.id?.toString(),
        sender_id: isFromMe ? accountId : chatId,
        content: text || (msg.media ? '[Média]' : ''),
        is_from_me: isFromMe,
        timestamp: msgDate,
        metadata: { tg_msg_id: msg.id }
      }, { onConflict: 'remote_id' });

      // Update conversation preview
      await supabase.from('conversations').update({
        last_message_preview: text.slice(0, 120),
        last_message_at: msgDate
      }).eq('id', conv.id);

    } catch (e) {
      logger.error(`[TG-MSG] ${e.message}`);
    }
  }, new NewMessage({}));

  logger.info(`[TG] Real-time listener attached for ${accountId}`);
};

// ─────────────────────────────────────────────
//  SEND MESSAGE
// ─────────────────────────────────────────────

export const sendTelegramMessage = async (accountId, chatId, text) => {
  const session = tgSessions.get(accountId);
  if (!session?.client) throw new Error('Session Telegram non active');

  if (!session.client.connected) {
    await session.client.connect();
  }

  // chatId can be a numeric string — convert properly
  const peer = isNaN(chatId) ? chatId : parseInt(chatId);
  await session.client.sendMessage(peer, { message: text });
  return { success: true };
};

// ─────────────────────────────────────────────
//  RESTORE SESSION AT SERVER STARTUP
// ─────────────────────────────────────────────

export const restoreTelegramConnector = async (accountId) => {
  const { apiId, apiHash } = getApiCredentials();
  if (!apiId || !apiHash) return null;

  const { data: acc } = await supabase.from('accounts')
    .select('metadata').eq('id', accountId).maybeSingle();
  const savedSession = acc?.metadata?.tg_session;
  if (!savedSession) return null;

  try {
    const client = new TelegramClient(
      new StringSession(savedSession),
      apiId, apiHash,
      CLIENT_OPTIONS
    );

    await client.connect();

    if (!await client.isUserAuthorized()) {
      logger.warn(`[TG] Session expired for account ${accountId}`);
      await supabase.from('accounts').update({ status: 'disconnected' }).eq('id', accountId);
      return null;
    }

    const me = await client.getMe();
    logger.info(`[TG] Restored session for ${me.username || me.id} (account ${accountId})`);

    await attachTelegramListeners(accountId, client);
    tgSessions.set(accountId, { client, step: 'connected' });

    return {
      sendMessage: async (chatId, text) => sendTelegramMessage(accountId, chatId, text),
      disconnect: async () => {
        try { await client.disconnect(); } catch(e){}
        tgSessions.delete(accountId);
      }
    };
  } catch (e) {
    logger.error(`[TG-RESTORE] ${e.message}`);
    return null;
  }
};
