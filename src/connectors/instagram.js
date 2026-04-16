/**
 * INSTAGRAM DM CONNECTOR
 * Using instagram-private-api (unofficial API)
 *
 * FLOW:
 * 1. connectToInstagram(username, password) → 'connected' | throws { type: 'challenge' } | { type: '2fa' }
 * 2. verifyInstagramChallenge(accountId, code) → 'connected'
 * 3. verifyInstagram2FA(accountId, code) → 'connected'
 *
 * Anti-ban:
 * - preLoginFlow / postLoginFlow to mimic a real app session
 * - Random delays between operations
 * - State serialization/deserialization for session reuse
 */

import { IgApiClient, IgCheckpointError, IgLoginTwoFactorRequiredError } from 'instagram-private-api';
import logger from '../utils/logger.js';
import supabase from '../config/supabase.js';

// In-memory: accountId → { ig, challengeState, twoFactorIdentifier, twoFactorUsername }
const igSessions = new Map();

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (base, max = 2000) => delay(base + Math.random() * max);

// ─────────────────────────────────────────────
//  STEP 1: Login
// ─────────────────────────────────────────────

export async function connectToInstagram(accountId, username, password, onMessage, onEvents) {
  const ig = new IgApiClient();
  ig.state.generateDevice(username);

  // Restore saved state if available (avoids triggering IG security on repeated logins)
  const { data: acc } = await supabase.from('accounts')
    .select('metadata').eq('id', accountId).maybeSingle();
  if (acc?.metadata?.ig_state) {
    try {
      await ig.state.deserialize(acc.metadata.ig_state);
      logger.info(`[IG] Restored saved session for ${username}`);
    } catch (e) {
      logger.warn('[IG] Could not restore session state:', e.message);
    }
  }

  try {
    logger.info(`[IG] Authenticating ${username}...`);

    // Simulate real mobile app behaviour (reduces challenge rate)
    await ig.simulate.preLoginFlow();
    await jitter(1000, 1500);

    const auth = await ig.account.login(username, password);

    await jitter(500, 1000);
    await ig.simulate.postLoginFlow();

    // Persist serialized session state to Supabase
    const igState = await ig.state.serialize();
    delete igState.constants; // strip constants to reduce size
    await supabase.from('accounts').update({
      status: 'connected',
      account_name: auth.full_name || username,
      username,
      metadata: { ...(acc?.metadata || {}), ig_state: igState }
    }).eq('id', accountId);

    logger.info(`[IG] Connected as ${auth.full_name || username}`);
    igSessions.set(accountId, { ig });

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
    // ── CHALLENGE (Instagram demande vérification email/SMS) ──
    if (err instanceof IgCheckpointError) {
      logger.info(`[IG] Challenge required for ${username}`);
      try {
        await ig.challenge.auto(true); // force code via email/SMS
      } catch (e) {
        logger.warn('[IG] challenge.auto failed:', e.message);
      }
      igSessions.set(accountId, { ig, username, password });
      await supabase.from('accounts').update({ status: 'challenge' }).eq('id', accountId);
      throw Object.assign(new Error('challenge_required'), { type: 'challenge' });
    }

    // ── 2FA ──
    if (err instanceof IgLoginTwoFactorRequiredError) {
      const info = err.response.body.two_factor_info;
      igSessions.set(accountId, {
        ig,
        twoFactorIdentifier: info.two_factor_identifier,
        twoFactorUsername: info.username
      });
      throw Object.assign(new Error('2fa_required'), { type: '2fa' });
    }

    logger.error('[IG] Login failed:', err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────
//  STEP 2a: Verify challenge code (email/SMS)
// ─────────────────────────────────────────────

export async function verifyInstagramChallenge(accountId, code) {
  const session = igSessions.get(accountId);
  if (!session?.ig) throw new Error('Session introuvable, recommencez la connexion');

  try {
    await session.ig.challenge.sendSecurityCode(code.trim());
    logger.info(`[IG] Challenge verified for account ${accountId}`);

    const auth = await session.ig.account.currentUser();

    // Persist session state after challenge
    const igState = await session.ig.state.serialize();
    delete igState.constants;
    await supabase.from('accounts').update({
      status: 'connected',
      account_name: auth.full_name || auth.username,
      metadata: { ig_state: igState }
    }).eq('id', accountId);

    _startPolling(accountId, session.ig, null);
    return { status: 'connected', displayName: auth.full_name || auth.username };
  } catch (err) {
    logger.error('[IG] Challenge verification failed:', err.message);
    throw new Error('Code incorrect ou expiré. Réessayez.');
  }
}

// ─────────────────────────────────────────────
//  STEP 2b: Verify 2FA code
// ─────────────────────────────────────────────

export async function verifyInstagram2FA(accountId, code) {
  const session = igSessions.get(accountId);
  if (!session?.ig) throw new Error('Session introuvable');

  try {
    await session.ig.account.twoFactorLogin({
      username: session.twoFactorUsername,
      verificationCode: code.trim(),
      twoFactorIdentifier: session.twoFactorIdentifier,
      verificationMethod: '1', // SMS
      trustThisDevice: '1'
    });

    const igState = await session.ig.state.serialize();
    delete igState.constants;
    await supabase.from('accounts').update({
      status: 'connected',
      metadata: { ig_state: igState }
    }).eq('id', accountId);

    _startPolling(accountId, session.ig, null);
    return { status: 'connected' };
  } catch (err) {
    logger.error('[IG] 2FA failed:', err.message);
    throw new Error('Code 2FA incorrect.');
  }
}

// ─────────────────────────────────────────────
//  POLLING DES DMs (toutes les 20s)
// ─────────────────────────────────────────────

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
        const content = lastMsg.text
          || (lastMsg.media_share ? '📷 Post partagé' : null)
          || (lastMsg.link ? '🔗 Lien' : null)
          || '[Média]';

        // Upsert contact
        let contactId = null;
        if (sender) {
          const { data: contact } = await supabase.from('contacts').upsert({
            account_id: accountId,
            external_id: `ig_${sender.pk}`,
            display_name: sender.full_name || sender.username || `@${sender.username}`,
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
  poll(); // run immediately

  const existing = igSessions.get(accountId);
  if (existing) igSessions.set(accountId, { ...existing, pollInterval: interval });
}

// ─────────────────────────────────────────────
//  RESTORE SESSION AT SERVER STARTUP
// ─────────────────────────────────────────────

export const restoreInstagramConnector = async (accountId) => {
  const { data: acc } = await supabase.from('accounts')
    .select('username, metadata').eq('id', accountId).maybeSingle();
  const igState = acc?.metadata?.ig_state;
  if (!igState) return null;

  try {
    const ig = new IgApiClient();
    ig.state.generateDevice(acc.username || 'user');
    await ig.state.deserialize(igState);

    // Quick auth check
    const me = await ig.account.currentUser().catch(() => null);
    if (!me) {
      logger.warn(`[IG-RESTORE] Session expired for account ${accountId}`);
      await supabase.from('accounts').update({ status: 'disconnected' }).eq('id', accountId);
      return null;
    }

    igSessions.set(accountId, { ig });
    _startPolling(accountId, ig, null);

    logger.info(`[IG] Restored session for ${me.username} (account ${accountId})`);
    return {
      sendMessage: async (threadId, content) => {
        const thread = ig.entity.directThread(threadId);
        await thread.broadcastText(typeof content === 'string' ? content : content.text);
        return { success: true };
      },
      disconnect: () => { igSessions.delete(accountId); }
    };
  } catch (e) {
    logger.error(`[IG-RESTORE] ${e.message}`);
    return null;
  }
};
