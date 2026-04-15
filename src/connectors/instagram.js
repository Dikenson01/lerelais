import { IgApiClient, IgCheckpointError, IgLoginTwoFactorRequiredError } from 'instagram-private-api';
import logger from '../utils/logger.js';
import supabase from '../config/supabase.js';

// In-memory: accountId → { ig, challengeState }
const igSessions = new Map();

/**
 * Step 1: Attempt login — may return 'connected', 'challenge_email', 'challenge_phone', or '2fa'
 */
export async function connectToInstagram(accountId, username, password, onMessage, onEvents) {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  try {
    logger.info(`[IG] Authenticating ${username}...`);

    // Simulate mobile app request headers
    await ig.simulate.preLoginFlow();
    const auth = await ig.account.login(username, password);
    await ig.simulate.postLoginFlow();

    logger.info(`[IG] Connected as ${username}`);
    igSessions.set(accountId, { ig });

    await supabase.from('accounts').update({
      status: 'connected',
      account_name: auth.full_name || username,
      username
    }).eq('id', accountId);

    if (onEvents?.onConnected) onEvents.onConnected();
    _startPolling(accountId, ig, onMessage);

    return {
      sendMessage: async (threadId, content) => {
        const thread = ig.entity.directThread(threadId);
        await thread.broadcastText(typeof content === 'string' ? content : content.text);
        return { success: true };
      },
      disconnect: () => { igSessions.delete(accountId); }
    };

  } catch (err) {
    // --- CHALLENGE (Instagram asks for email/SMS verification) ---
    if (err instanceof IgCheckpointError) {
      logger.info(`[IG] Challenge required for ${username}`);
      await ig.challenge.auto(true); // send code via email/SMS automatically
      igSessions.set(accountId, { ig, username, password });

      await supabase.from('accounts').update({ status: 'challenge' }).eq('id', accountId);
      throw Object.assign(new Error('challenge_required'), { type: 'challenge' });
    }

    // --- TWO FACTOR AUTH ---
    if (err instanceof IgLoginTwoFactorRequiredError) {
      const { username: twoFactorUsername, totp_two_factor_on, two_factor_identifier } = err.response.body.two_factor_info;
      igSessions.set(accountId, { ig, twoFactorIdentifier: two_factor_identifier, twoFactorUsername });
      throw Object.assign(new Error('2fa_required'), { type: '2fa' });
    }

    logger.error('[IG] Login failed:', err.message);
    if (err.response) {
      logger.error('[IG-DEBUG] Status:', err.response.statusCode);
      logger.error('[IG-DEBUG] Body:', JSON.stringify(err.response.body, null, 2));
    }
    throw err;
  }
}

/**
 * Step 2a: Verify Instagram challenge code (email/SMS)
 */
export async function verifyInstagramChallenge(accountId, code) {
  const session = igSessions.get(accountId);
  if (!session?.ig) throw new Error('Session introuvable, recommencez');

  try {
    await session.ig.challenge.sendSecurityCode(code);
    logger.info(`[IG] Challenge verified for account ${accountId}`);

    // Re-login after challenge
    const auth = await session.ig.account.currentUser();
    await supabase.from('accounts').update({ status: 'connected' }).eq('id', accountId);

    _startPolling(accountId, session.ig, null);
    return { status: 'connected', displayName: auth.full_name || auth.username };
  } catch (err) {
    logger.error('[IG] Challenge verification failed:', err.message);
    throw err;
  }
}

/**
 * Step 2b: Verify 2FA code
 */
export async function verifyInstagram2FA(accountId, code) {
  const session = igSessions.get(accountId);
  if (!session?.ig) throw new Error('Session introuvable');

  try {
    await session.ig.account.twoFactorLogin({
      username: session.twoFactorUsername,
      verificationCode: code,
      twoFactorIdentifier: session.twoFactorIdentifier,
      verificationMethod: '1', // SMS
      trustThisDevice: '1'
    });

    await supabase.from('accounts').update({ status: 'connected' }).eq('id', accountId);
    _startPolling(accountId, session.ig, null);
    return { status: 'connected' };
  } catch (err) {
    logger.error('[IG] 2FA failed:', err.message);
    throw err;
  }
}

/**
 * Poll Instagram DMs every 20s
 */
function _startPolling(accountId, ig, onMessage) {
  const poll = async () => {
    try {
      const inbox = ig.feed.directInbox();
      const threads = await inbox.items();

      for (const thread of threads) {
        const lastMsg = thread.items?.[0];
        if (!lastMsg) continue;

        const isFromMe = lastMsg.user_id?.toString() === ig.state.cookieUserId?.toString();
        const sender = isFromMe ? null : thread.users?.[0];
        const content = lastMsg.text || (lastMsg.media_share ? '📷 Post partagé' : lastMsg.link ? '🔗 Lien' : '[Média]');

        // Upsert contact
        let contactId = null;
        if (sender) {
          const { data: contact } = await supabase.from('contacts').upsert({
            account_id: accountId,
            external_id: `ig_${sender.pk}`,
            display_name: sender.full_name || sender.username,
            avatar_url: sender.profile_pic_url || null,
            platform: 'instagram',
            metadata: { ig_username: sender.username }
          }, { onConflict: 'account_id, external_id', ignoreDuplicates: false }).select('id').single();
          contactId = contact?.id;
        }

        // Upsert conversation
        const { data: conv } = await supabase.from('conversations').upsert({
          account_id: accountId,
          external_id: thread.thread_id,
          platform: 'instagram',
          title: thread.thread_title || sender?.full_name || sender?.username || 'Instagram DM',
          contact_id: contactId,
          is_group: thread.is_group || false,
          last_message_preview: content,
          last_message_at: new Date(parseInt(lastMsg.timestamp) / 1000)
        }, { onConflict: 'account_id, external_id' }).select('id').single();

        if (!conv) continue;

        // Insert message if new
        await supabase.from('messages').upsert({
          conversation_id: conv.id,
          account_id: accountId,
          remote_id: lastMsg.item_id,
          sender_id: isFromMe ? accountId : `ig_${lastMsg.user_id}`,
          content,
          is_from_me: isFromMe,
          timestamp: new Date(parseInt(lastMsg.timestamp) / 1000),
          metadata: { ig_item_type: lastMsg.item_type }
        }, { onConflict: 'remote_id', ignoreDuplicates: true });

        if (!isFromMe && onMessage) {
          onMessage('instagram', sender?.username || 'Instagram', content);
        }
      }
    } catch (e) {
      logger.warn('[IG-POLL]', e.message);
    }
  };

  const interval = setInterval(poll, 20000);
  poll(); // run immediately on connect

  const existing = igSessions.get(accountId);
  if (existing) igSessions.set(accountId, { ...existing, pollInterval: interval });
}
