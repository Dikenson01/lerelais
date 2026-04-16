/**
 * SIGNAL CONNECTOR
 * Utilise signal-cli-rest-api comme service sidecar Railway
 * Repo : https://github.com/bbernhard/signal-cli-rest-api
 *
 * ── DÉPLOIEMENT SUR RAILWAY ──
 * 1. Créer un nouveau service Railway avec l'image :
 *    bbernhard/signal-cli-rest-api:latest
 * 2. Ajouter la variable d'environnement : MODE=native
 * 3. Copier l'URL interne Railway dans SIGNAL_API_URL de ton service Node.js
 *    Ex: SIGNAL_API_URL=http://signal-api.railway.internal:8080
 *
 * ── FLOW QR LINK (RECOMMANDÉ — si Signal déjà installé) ──
 * 1. startSignalLink()       → retourne un QR code PNG (base64)
 * 2. L'utilisateur scanne depuis l'appli Signal sur son téléphone
 * 3. checkSignalLinkStatus() → retourne { step: 'connected' } quand lié
 *
 * ── FLOW INSCRIPTION SMS (nouveau numéro) ──
 * 1. registerSignal(phone)   → envoie un SMS
 * 2. verifySignalCode(code)  → vérifie le code
 */

import logger from '../utils/logger.js';
import supabase from '../config/supabase.js';

const SIGNAL_API = process.env.SIGNAL_API_URL || null;
if (!SIGNAL_API) logger.warn('[SIGNAL] SIGNAL_API_URL is NOT set in environment variables!');

// In-memory: accountId → { phone, pollInterval }
const signalSessions = new Map();

const apiAvailable = async () => {
  if (!SIGNAL_API) return false;
  try {
    const res = await fetch(`${SIGNAL_API}/v1/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
};

// ─────────────────────────────────────────────
//  QR LINK (compte Signal existant)
// ─────────────────────────────────────────────

export const startSignalLink = async (accountId) => {
  if (!await apiAvailable()) {
    throw new Error(
      `signal-cli-rest-api non disponible à ${SIGNAL_API}. Vérifiez SIGNAL_API_URL dans Railway.`
    );
  }

  // signal-cli-rest-api retourne le QR comme image PNG
  const res = await fetch(
    `${SIGNAL_API}/v1/qrcodelink?device_name=LeRelaisHub`,
    { signal: AbortSignal.timeout(10000) }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`QR link failed: ${body}`);
  }

  // Convert response to base64 data URL (PNG or SVG)
  const contentType = res.headers.get('content-type') || 'image/png';
  const arrayBuf = await res.arrayBuffer();
  const b64 = Buffer.from(arrayBuf).toString('base64');
  const dataUrl = `data:${contentType};base64,${b64}`;

  await supabase.from('accounts').update({ status: 'pairing' }).eq('id', accountId);
  signalSessions.set(accountId, { linking: true, accountId });

  logger.info(`[SIGNAL] QR link started for account ${accountId}`);
  return { step: 'qr', qr: dataUrl };
};

export const checkSignalLinkStatus = async (accountId) => {
  if (!SIGNAL_API) throw new Error('SIGNAL_API_URL non configuré');

  try {
    const res = await fetch(`${SIGNAL_API}/v1/accounts`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return { step: 'pending' };

    const accounts = await res.json();
    if (accounts?.length > 0) {
      const phone = accounts[0].number;

      await supabase.from('accounts').update({
        status: 'connected',
        username: phone,
        account_name: phone,
        metadata: { signal_phone: phone }
      }).eq('id', accountId);

      _startPolling(accountId, phone);
      signalSessions.set(accountId, { phone });

      logger.info(`[SIGNAL] Linked as ${phone} for account ${accountId}`);
      return { step: 'connected', phone };
    }
  } catch (e) {
    logger.warn('[SIGNAL-STATUS]', e.message);
  }

  return { step: 'pending' };
};

// ─────────────────────────────────────────────
//  INSCRIPTION SMS (nouveau numéro)
// ─────────────────────────────────────────────

export const registerSignal = async (accountId, phoneNumber) => {
  if (!await apiAvailable()) {
    throw new Error(`signal-cli-rest-api non disponible à ${SIGNAL_API}. Vérifiez SIGNAL_API_URL.`);
  }

  // Normalise le numéro (ajoute +33 si numéro français sans indicatif)
  let phone = phoneNumber.replace(/\s/g, '');
  if (phone.startsWith('0') && phone.length === 10) phone = '+33' + phone.slice(1);
  if (!phone.startsWith('+')) phone = '+' + phone;

  const res = await fetch(`${SIGNAL_API}/v1/register/${encodeURIComponent(phone)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ use_voice: false }),
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    const body = await res.text();
    // 400 peut signifier "déjà enregistré" — continue quand même
    if (res.status !== 400) throw new Error(`Erreur Signal: ${body}`);
  }

  await supabase.from('accounts').update({
    status: 'pairing',
    username: phone,
    metadata: { signal_phone: phone }
  }).eq('id', accountId);

  signalSessions.set(accountId, { phone });
  logger.info(`[SIGNAL] SMS code sent to ${phone}`);
  return { step: 'code' };
};

export const verifySignalCode = async (accountId, code) => {
  const session = signalSessions.get(accountId);
  if (!session?.phone) throw new Error('Session introuvable, recommencez');

  const { phone } = session;

  const res = await fetch(
    `${SIGNAL_API}/v1/register/${encodeURIComponent(phone)}/verifySmsCode/${code.trim()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000)
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Code invalide: ${body}`);
  }

  await supabase.from('accounts').update({ status: 'connected' }).eq('id', accountId);
  _startPolling(accountId, phone);

  logger.info(`[SIGNAL] Connected as ${phone}`);
  return { step: 'connected' };
};

// ─────────────────────────────────────────────
//  ENVOI DE MESSAGES
// ─────────────────────────────────────────────

export const sendSignalMessage = async (accountId, recipient, text) => {
  if (!SIGNAL_API) throw new Error('SIGNAL_API_URL non configuré');

  const { data: acc } = await supabase.from('accounts')
    .select('username, metadata').eq('id', accountId).maybeSingle();
  const phone = acc?.metadata?.signal_phone || acc?.username;
  if (!phone) throw new Error('Aucun numéro Signal configuré pour ce compte');

  const res = await fetch(`${SIGNAL_API}/v2/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: text,
      number: phone,
      recipients: [recipient]
    }),
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Envoi Signal échoué: ${body}`);
  }

  return { success: true };
};

// ─────────────────────────────────────────────
//  POLLING DES MESSAGES ENTRANTS
// ─────────────────────────────────────────────

function _startPolling(accountId, phone) {
  const poll = async () => {
    try {
      const res = await fetch(
        `${SIGNAL_API}/v1/receive/${encodeURIComponent(phone)}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return;

      const envelopes = await res.json();
      if (!Array.isArray(envelopes) || !envelopes.length) return;

      for (const env of envelopes) {
        const msg = env.envelope;
        if (!msg?.dataMessage) continue;

        const sender = msg.source || msg.sourceUuid;
        const text = msg.dataMessage.message;
        const ts = new Date(msg.timestamp || Date.now());

        if (!sender || !text) continue;

        // Upsert contact
        const { data: contact } = await supabase.from('contacts').upsert({
          account_id: accountId,
          external_id: sender,
          display_name: msg.sourceName || sender,
          phone_number: sender.startsWith('+') ? sender : null,
          platform: 'signal'
        }, { onConflict: 'account_id, external_id', ignoreDuplicates: false }).select('id').single();

        // Upsert conversation
        const { data: conv } = await supabase.from('conversations').upsert({
          account_id: accountId,
          external_id: sender,
          platform: 'signal',
          title: msg.sourceName || sender,
          contact_id: contact?.id,
          is_group: false,
          last_message_preview: text.slice(0, 120),
          last_message_at: ts
        }, { onConflict: 'account_id, external_id' }).select('id').single();

        if (!conv) continue;

        // Insert message (ignore if duplicate)
        await supabase.from('messages').upsert({
          conversation_id: conv.id,
          account_id: accountId,
          remote_id: `signal_${msg.timestamp}_${sender}`,
          sender_id: sender,
          content: text,
          is_from_me: false,
          timestamp: ts,
          metadata: { platform: 'signal', signal_sender: sender }
        }, { onConflict: 'remote_id', ignoreDuplicates: true });
      }
    } catch (e) {
      logger.warn('[SIGNAL-POLL]', e.message);
    }
  };

  const interval = setInterval(poll, 10000);
  poll(); // run immediately

  const existing = signalSessions.get(accountId);
  if (existing) signalSessions.set(accountId, { ...existing, pollInterval: interval });
}

// ─────────────────────────────────────────────
//  RESTAURATION AU DÉMARRAGE DU SERVEUR
// ─────────────────────────────────────────────

export const restoreSignalConnector = async (accountId) => {
  if (!await apiAvailable()) {
    logger.warn('[SIGNAL-RESTORE] signal-cli-rest-api non disponible');
    return null;
  }

  const { data: acc } = await supabase.from('accounts')
    .select('username, metadata').eq('id', accountId).maybeSingle();
  const phone = acc?.metadata?.signal_phone || acc?.username;
  if (!phone) return null;

  signalSessions.set(accountId, { phone });
  _startPolling(accountId, phone);

  logger.info(`[SIGNAL] Restored session for ${phone} (account ${accountId})`);
  return {
    sendMessage: async (recipient, text) => sendSignalMessage(accountId, recipient, text),
    disconnect: () => {
      const s = signalSessions.get(accountId);
      if (s?.pollInterval) clearInterval(s.pollInterval);
      signalSessions.delete(accountId);
    }
  };
};
