import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  MessageSquare, Users, Settings, Plus, Search, Send, X,
  RefreshCw, ArrowLeft, Loader2, Phone, Video, Image as ImageIcon,
  LogOut, Lock, Mail, User, Mic, MicOff, Paperclip, Play, Check, CheckCheck,
  Pin, Archive, Trash, MoreVertical, Smile
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import QRCode from 'react-qr-code';
import './App.css';
import logoHub from './assets/logo_hub.jpg';

const API = '/api';
const getToken   = () => localStorage.getItem('lr_token');
const setToken   = (t) => localStorage.setItem('lr_token', t);
const clearToken = () => localStorage.removeItem('lr_token');

axios.interceptors.request.use(cfg => {
  const t = getToken();
  if (t && cfg.url?.startsWith(API)) cfg.headers['Authorization'] = `Bearer ${t}`;
  return cfg;
});
axios.interceptors.response.use(r => r, err => {
  if (err.response?.status === 401) { 
    console.warn('Session expirée, redirection...');
    clearToken(); 
    if (!window.location.pathname.includes('/auth')) {
       // Only reload if we are not already on the login flow or if we need to clear state
       window.location.href = '/'; 
    }
  }
  return Promise.reject(err);
});

// ─── Auth Screen — Raycast Style ──────────────────────────────
const AuthScreen = ({ onAuth }) => {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPass] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const url = mode === 'login' ? `${API}/auth/login` : `${API}/auth/register`;
      const { data } = await axios.post(url, { username, password });
      setToken(data.token); onAuth(data.user);
    } catch (err) { setError(err.response?.data?.error || 'Erreur'); }
    finally { setLoading(false); }
  };

  return (
    <div className="lx-screen">
      <motion.div className="lx-card" initial={{opacity:0, y:20}} animate={{opacity:1, y:0}}>
        <img src={logoHub} alt="Logo" className="lx-logo-img" />
        <h1 style={{fontSize: '24px', marginBottom: '8px'}}>LeRelais Hub</h1>
        <p style={{color: '#6a6b6c', marginBottom: '24px', fontSize: '14px'}}>Elite Unified Messenger</p>
        
        <form onSubmit={submit} style={{width:'100%'}}>
          <input className="lx-input" placeholder="Identifiant" value={username} onChange={e=>setUsername(e.target.value)} required />
          <input className="lx-input" type="password" placeholder="Code secret" value={password} onChange={e=>setPass(e.target.value)} required />
          {error && <p style={{color:'var(--accent-red)', fontSize:'12px', marginBottom:'12px'}}>{error}</p>}
          <button type="submit" className="lx-btn" disabled={loading}>
            {loading ? <Loader2 className="spinner" size={18}/> : 'Entrer dans le Hub'}
          </button>
        </form>
        
        <button onClick={()=>setMode(mode==='login'?'register':'login')} style={{marginTop:'20px', color:'var(--text-dim)', fontSize:'12px'}}>
          {mode==='login' ? "Pas de compte ? S'enregistrer" : "Déjà un compte ? Se connecter"}
        </button>
      </motion.div>
    </div>
  );
};

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [view, setView] = useState('inbox');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pairingQR, setPairingQR] = useState(null);
  const [pairingStatus, setPairingStatus] = useState(null);
  const [pairingId, setPairingId] = useState(null);
  // Telegram pairing state
  const [tgPhone, setTgPhone] = useState('');
  const [tgCode, setTgCode] = useState('');
  const [tg2FA, setTg2FA] = useState('');
  const [tgStep, setTgStep] = useState(null); // null | 'phone' | 'code' | '2fa' | 'connected'
  const [tgAccountId, setTgAccountId] = useState(null);
  const [tgError, setTgError] = useState('');
  // Telegram QR state
  const [tgQR, setTgQR] = useState(null);
  // Instagram pairing state
  const [igUsername, setIgUsername] = useState('');
  const [igPassword, setIgPassword] = useState('');
  const [igStep, setIgStep] = useState(null); // null | 'login' | 'connecting' | 'challenge' | '2fa' | 'connected'
  const [igError, setIgError] = useState('');
  const [igAccountId, setIgAccountId] = useState(null);
  const [igChallengeCode, setIgChallengeCode] = useState('');
  const [ig2FACode, setIg2FACode] = useState('');
  // Signal pairing state
  const [signalStep, setSignalStep] = useState(null); // null | 'menu' | 'qr' | 'sms_phone' | 'sms_code' | 'connecting' | 'connected'
  const [signalAccountId, setSignalAccountId] = useState(null);
  const [signalQR, setSignalQR] = useState(null);
  const [signalPhone, setSignalPhone] = useState('');
  const [signalCode, setSignalCode] = useState('');
  const [signalError, setSignalError] = useState('');
  const [activeNetwork, setActiveNetwork] = useState(null); // 'whatsapp' | 'telegram' | 'instagram' | 'signal'
  
  // UI Grouping & Filtering (V48)
  const [filter, setFilter] = useState({ type: 'all', network: null, accountId: null });

  const messagesEndRef = useRef(null);
  const messagesAreaRef = useRef(null);
  const fileInputRef = useRef(null);
  const isAtBottomRef = useRef(true); // Track if user is scrolled to bottom
  const [callingContact, setCallingContact] = useState(null);
  const [selectedContactDetail, setSelectedContactDetail] = useState(null);

  // ── Auth Init ───────────────────────────────────────────────
  useEffect(() => {
    const t = getToken();
    if (!t) { setAuthReady(true); return; }
    axios.get(`${API}/auth/me`).then(r => { setUser(r.data); setAuthReady(true); }).catch((err) => { 
      if (err.response?.status === 404 || err.response?.status === 401) { 
        clearToken(); setUser(null);
      }
      setAuthReady(true); 
    });
  }, []);

  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  // ── Data Polling ───────────────────────────────────────────
  const preloadData = useCallback(async () => {
    try {
      const [c, ct, ac] = await Promise.all([
        axios.get(`${API}/conversations`),
        axios.get(`${API}/contacts`),
        axios.get(`${API}/accounts`).catch(() => ({ data: [] }))
      ]);
      setConversations(c.data || []);
      setContacts(ct.data || []);
      setAccounts(ac.data || []);
    } catch (e) {} finally { setLoading(false); }
  }, []);

  useEffect(() => { if (user) { preloadData(); const id = setInterval(preloadData, 5000); return () => clearInterval(id); } }, [user, preloadData]);

  // ── Message Polling ────────────────────────────────────────
  const [loadedConvId, setLoadedConvId] = useState(null);

  const fetchMessages = useCallback(async (cid) => {
    try {
      const r = await axios.get(`${API}/messages/${cid}`);
      setMessages(r.data);
      setLoadedConvId(cid); // Tracker la conv dont les messages viennent d'arriver
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (!selectedConv) return;
    setMessages([]); // Vider les anciens messages immédiatement (évite flash + mauvais scroll)
    fetchMessages(selectedConv.id);
    const id = setInterval(() => fetchMessages(selectedConv.id), 3000);
    return () => clearInterval(id);
  }, [selectedConv, fetchMessages]);

  // Scroll intelligent : descend uniquement si conv vient de charger ou si on était déjà en bas
  const prevLoadedConvIdRef = useRef(null);
  useEffect(() => {
    if (!messages.length) return; // Pas encore de messages — rien à faire
    const isFirstLoad = loadedConvId !== prevLoadedConvIdRef.current;
    prevLoadedConvIdRef.current = loadedConvId;

    if (isFirstLoad) {
      // Première arrivée des messages → scroll immédiat vers le bas (dernier message)
      isAtBottomRef.current = true;
      requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'instant' }));
    } else if (isAtBottomRef.current) {
      // Même conv, nouveau message, utilisateur était en bas → scroll doux
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loadedConvId]);

  // ── Actions ────────────────────────────────────────────────
  const sendText = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConv) return;
    const txt = newMessage; setNewMessage('');
    try {
      await axios.post(`${API}/messages`, { conversationId: selectedConv.id, content: txt });
      fetchMessages(selectedConv.id);
      preloadData(); // Refresh sidebar preview
    } catch (err) { alert('Erreur envoi'); setNewMessage(txt); }
  };

  const sendMedia = async (file) => {
    if (!file || !selectedConv) return;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('conversationId', selectedConv.id);
    try {
      await axios.post(`${API}/messages/media`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      fetchMessages(selectedConv.id);
      preloadData();
    } catch (err) { alert('Erreur envoi média: ' + (err.response?.data?.error || err.message)); }
  };

  const startWAPairing = async () => {
    setActiveNetwork('whatsapp');
    setPairingStatus('waiting_qr');
    try {
      const r = await axios.post(`${API}/connect/whatsapp`);
      setPairingId(r.data.accountId);
    } catch (e) { setPairingStatus(null); }
  };

  // ── Telegram auth ─────────────────────────────────────────
  const startTelegramPairing = async (e) => {
    e?.preventDefault();
    setTgError('');
    if (!tgPhone.trim()) return;
    try {
      setTgStep('connecting');
      const r = await axios.post(`${API}/connect/telegram/start`, { phone: tgPhone });
      setTgAccountId(r.data.accountId);
      setTgStep('code');
    } catch (err) {
      setTgError(err.response?.data?.error || 'Erreur connexion Telegram');
      setTgStep('phone');
    }
  };

  const verifyTelegramCode = async (e) => {
    e?.preventDefault();
    setTgError('');
    if (!tgCode.trim()) return;
    try {
      setTgStep('connecting');
      const r = await axios.post(`${API}/connect/telegram/verify`, {
        accountId: tgAccountId, code: tgCode, password2fa: tg2FA || null
      });
      if (r.data.step === '2fa') { setTgStep('2fa'); return; }
      if (r.data.step === 'connected') {
        setTgStep('connected');
        preloadData();
        setTimeout(() => { setShowAddModal(false); resetPairingState(); }, 2500);
      }
    } catch (err) {
      setTgError(err.response?.data?.error || 'Code incorrect');
      setTgStep(tg2FA ? '2fa' : 'code');
    }
  };

  // ── Telegram QR flow ─────────────────────────────────────
  const startTelegramQRFlow = async () => {
    setTgError('');
    setTgStep('connecting');
    try {
      const r = await axios.post(`${API}/connect/telegram/qr/start`);
      setTgAccountId(r.data.accountId);
      setTgQR(r.data.qr);
      setTgStep('qr');
      // Poll for status
      const pollId = setInterval(async () => {
        try {
          const s = await axios.get(`${API}/connect/telegram/qr/status/${r.data.accountId}`);
          if (s.data.qr) setTgQR(s.data.qr);
          if (s.data.status === 'connected') {
            clearInterval(pollId);
            setTgStep('connected');
            preloadData();
            setTimeout(() => { setShowAddModal(false); resetPairingState(); }, 2500);
          }
        } catch (e) {}
      }, 2000);
    } catch (err) {
      setTgError(err.response?.data?.error || 'Erreur QR');
      setTgStep('phone');
    }
  };

  // ── Instagram auth ────────────────────────────────────────
  const connectInstagram = async (e) => {
    e?.preventDefault();
    setIgError('');
    if (!igUsername.trim() || !igPassword.trim()) return;
    try {
      setIgStep('connecting');
      const r = await axios.post(`${API}/connect/instagram`, { username: igUsername, password: igPassword });
      setIgAccountId(r.data.accountId);
      if (r.data.status === 'challenge') { setIgStep('challenge'); return; }
      if (r.data.status === '2fa') { setIgStep('2fa'); return; }
      setIgStep('connected');
      preloadData();
      setTimeout(() => { setShowAddModal(false); resetPairingState(); }, 2500);
    } catch (err) {
      setIgError(err.response?.data?.error || 'Identifiants incorrects');
      setIgStep('login');
    }
  };

  const verifyIgChallenge = async (e) => {
    e?.preventDefault();
    setIgError('');
    try {
      setIgStep('connecting');
      await axios.post(`${API}/connect/instagram/challenge`, { accountId: igAccountId, code: igChallengeCode });
      setIgStep('connected');
      preloadData();
      setTimeout(() => { setShowAddModal(false); resetPairingState(); }, 2500);
    } catch (err) {
      setIgError(err.response?.data?.error || 'Code incorrect');
      setIgStep('challenge');
    }
  };

  const verifyIg2FA = async (e) => {
    e?.preventDefault();
    setIgError('');
    try {
      setIgStep('connecting');
      await axios.post(`${API}/connect/instagram/2fa`, { accountId: igAccountId, code: ig2FACode });
      setIgStep('connected');
      preloadData();
      setTimeout(() => { setShowAddModal(false); resetPairingState(); }, 2500);
    } catch (err) {
      setIgError(err.response?.data?.error || 'Code 2FA incorrect');
      setIgStep('2fa');
    }
  };

  // ── Signal auth ───────────────────────────────────────────
  const startSignalLinkFlow = async () => {
    setSignalError('');
    setSignalStep('connecting');
    try {
      const r = await axios.post(`${API}/connect/signal/link/start`);
      setSignalAccountId(r.data.accountId);
      setSignalQR(r.data.qr);
      setSignalStep('qr');
      // Poll for link completion
      const pollId = setInterval(async () => {
        try {
          const s = await axios.get(`${API}/connect/signal/link/status/${r.data.accountId}`);
          if (s.data.step === 'connected') {
            clearInterval(pollId);
            setSignalStep('connected');
            preloadData();
            setTimeout(() => { setShowAddModal(false); resetPairingState(); }, 2500);
          }
        } catch (e) {}
      }, 3000);
    } catch (err) {
      setSignalError(err.response?.data?.error || 'signal-cli non disponible');
      setSignalStep('menu');
    }
  };

  const startSignalSMS = async (e) => {
    e?.preventDefault();
    setSignalError('');
    try {
      setSignalStep('connecting');
      const r = await axios.post(`${API}/connect/signal/register`, { phone: signalPhone });
      setSignalAccountId(r.data.accountId);
      setSignalStep('sms_code');
    } catch (err) {
      setSignalError(err.response?.data?.error || 'Erreur Signal');
      setSignalStep('sms_phone');
    }
  };

  const verifySignalSMSCode = async (e) => {
    e?.preventDefault();
    setSignalError('');
    try {
      setSignalStep('connecting');
      await axios.post(`${API}/connect/signal/verify`, { accountId: signalAccountId, code: signalCode });
      setSignalStep('connected');
      preloadData();
      setTimeout(() => { setShowAddModal(false); resetPairingState(); }, 2500);
    } catch (err) {
      setSignalError(err.response?.data?.error || 'Code incorrect');
      setSignalStep('sms_code');
    }
  };

  const resetPairingState = () => {
    setPairingStatus(null); setPairingQR(null); setPairingId(null);
    setTgPhone(''); setTgCode(''); setTg2FA(''); setTgStep(null); setTgAccountId(null); setTgError(''); setTgQR(null);
    setIgUsername(''); setIgPassword(''); setIgStep(null); setIgError(''); setIgAccountId(null); setIgChallengeCode(''); setIg2FACode('');
    setSignalStep(null); setSignalAccountId(null); setSignalQR(null); setSignalPhone(''); setSignalCode(''); setSignalError('');
    setActiveNetwork(null);
  };

  useEffect(() => {
    if (!pairingId || pairingStatus !== 'waiting_qr') return;
    const id = setInterval(async () => {
      try {
        const r = await axios.get(`${API}/connect/whatsapp/status/${pairingId}`);
        if (r.data.qr) setPairingQR(r.data.qr);
        if (r.data.status === 'connected') { setPairingStatus('connected'); preloadData(); setTimeout(()=>setShowAddModal(false), 2000); }
      } catch (e) {}
    }, 2000);
    return () => clearInterval(id);
  }, [pairingId, pairingStatus, preloadData]);

  // ── UI Logic ───────────────────────────────────────────────
  const sortedConvs = useMemo(() => {
    return [...conversations].sort((a, b) => {
      const aPin = a.metadata?.is_pinned ? 1 : 0;
      const bPin = b.metadata?.is_pinned ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;
      const aTs = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
      const bTs = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
      return bTs - aTs;
    }).filter(c => {
      if (view === 'archive') return c.metadata?.is_archived;
      if (view === 'inbox') return !c.metadata?.is_archived;
      return true;
    }).filter(c => {
      // Grouping Filters (V48)
      if (filter.type === 'network') return c.platform === filter.network;
      if (filter.type === 'account') return c.account_id === filter.accountId;
      return true; // type: 'all'
    }).filter(c => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return c.title?.toLowerCase().includes(q) || c.external_id?.includes(q);
    });
  }, [conversations, view, searchQuery, filter]);

  const getAvatar = (conv) => {
    if (!conv) return null;
    const c = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
    const url = c?.photo_url || c?.avatar_url || conv.metadata?.photo_url || conv.metadata?.avatar_url;
    return url || null;
  };

  const formatName = (str) => {
    if (!str) return 'Inconnu';
    // Si c'est un JID entier (@lid, @s.whatsapp.net etc.), extraire juste le numéro
    const base = str.includes('@') ? str.split('@')[0] : str;
    const clean = base.replace(/[+\s-]/g, '');

    // ID technique WA @lid (15+ chiffres — pas un numéro de téléphone standard)
    // Pour ces IDs, on ne peut pas les afficher joliment — on retourne le numéro brut tel quel
    // (WA enverra le vrai nom via contacts.update quand disponible)
    if (str.includes('@lid') && /^\d{12,}$/.test(clean)) return base;

    // Numéro de téléphone standard (10-13 chiffres)
    if (/^\d{10,13}$/.test(clean)) {
       if (clean.startsWith('33') && clean.length === 11) {
         return `+33 ${clean.slice(2,3)} ${clean.slice(3,5)} ${clean.slice(5,7)} ${clean.slice(7,9)} ${clean.slice(9,11)}`;
       }
       return `+${clean}`;
    }

    return base;
  };

  // Returns the best human-readable name for a contact object (not a conversation)
  const getContactName = (contact) => {
    const dn = contact?.display_name;
    if (dn) {
      // Skip raw JIDs stored as display_name (these are legacy bad data)
      if (dn.includes('@s.whatsapp.net') || dn.includes('@lid')) {
        return contact?.phone_number ? formatName(contact.phone_number) : 'Contact WhatsApp';
      }
      const clean = dn.replace(/[+\s-]/g, '');
      // Pure numeric ID (12+ digits) = @lid ID stored as name → don't show it
      if (/^\d{10,}$/.test(clean)) {
        return contact?.phone_number ? formatName(contact.phone_number) : 'Contact WhatsApp';
      }
      // It's a real name or formatted phone number
      return formatName(dn);
    }
    // Fallback: phone_number or external_id
    if (contact?.phone_number) return formatName(contact.phone_number);
    // external_id fallback — mask numeric @lid IDs
    const ext = contact?.external_id?.split('@')[0];
    if (ext) {
      const cleanExt = ext.replace(/[-\s]/g, '');
      if (/^\d{10,}$/.test(cleanExt)) return 'Contact WhatsApp';
      return formatName(ext);
    }
    return 'Inconnu';
  };

  const getDisplayName = (conv) => {
    const c = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
    if (c?.display_name) {
       const dn = c.display_name;
       // Skip raw JIDs (legacy bad data)
       if (dn.includes('@s.whatsapp.net') || dn.includes('@lid')) {
         // fall through to title/external_id check below
       } else {
         const cleanDn = dn.replace(/[+\s-]/g, '');
         // If display_name is a 12+ digit pure number (stored as ID fallback), skip it
         if (/^\d{10,}$/.test(cleanDn)) {
           // use phone_number if available, otherwise fall through
           if (c.phone_number) return formatName(c.phone_number);
         } else if (dn && dn !== 'null') {
           return dn; // Real name ✓
         }
       }
    }
    // Fallback: conv title — but NEVER show a raw numeric @lid ID to the user
    const fallback = conv.title || conv.external_id?.split('@')[0];
    if (!fallback) return 'Contact WhatsApp';
    // If fallback is a pure numeric string (possibly with dashes) → it's a raw @lid ID
    const cleanFallback = fallback.replace(/[-\s]/g, '');
    if (/^\d{10,}$/.test(cleanFallback)) return 'Contact WhatsApp';
    return formatName(fallback);
  };

  const toggleArchive = async (conv) => {
    try {
      const isArchived = !!conv.metadata?.is_archived;
      await axios.post(`${API}/conversations/${conv.id}/archive`, { archived: !isArchived });
      preloadData();
    } catch (e) { alert('Erreur archive'); }
  };

  // Resolve sender ID to display name using contacts list
  const resolveContactName = useCallback((senderId, participantId = null) => {
    const idToSearch = participantId || senderId;
    if (!idToSearch) return 'Inconnu';

    let contact = contacts.find(c => c.external_id === idToSearch);
    if (!contact) {
      const pureId = idToSearch.split('@')[0];
      // Chercher par numéro brut (ex: résoudre @lid vers @s.whatsapp.net)
      contact = contacts.find(c => {
        const cPure = c.external_id?.split('@')[0];
        return cPure === pureId;
      });
    }

    if (contact?.display_name) {
       const dn = contact.display_name;
       const isLid = dn.includes('@lid') || dn.includes('@s.whatsapp.net');
       const isRawNum = /^\d{14,}$/.test(dn.replace(/[+\s-]/g, ''));
       if (!isLid && !isRawNum) return dn; // Vrai nom
    }

    return formatName(idToSearch);
  }, [contacts]);

  const startCall = (conv) => {
    const c = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
    const phone = c?.phone_number || conv.external_id?.split('@')[0];
    if (!phone || conv.external_id?.endsWith('@lid')) {
      // @lid contacts: can't resolve phone number — show info only
      setCallingContact({ name: getDisplayName(conv), phone: null, avatar: getAvatar(conv) });
      return;
    }
    setCallingContact({ name: getDisplayName(conv), phone, avatar: getAvatar(conv) });
  };

  if (!authReady) return <div className="lx-screen"><Loader2 className="spinner" size={40}/></div>;
  if (!user) return <AuthScreen onAuth={setUser} />;
  if (loading) return <div className="lx-screen"><div style={{textAlign:'center'}}><RefreshCw className="spinner" size={40}/><p style={{marginTop:'20px'}}>Chargement du Hub Elite...</p></div></div>;

  return (
    <div className="app-container">
      {/* SIDEBAR RAIL */}
      {!isMobile && (
        <nav className="nav-rail">
          <div className="brand-icon"><img src={logoHub} alt="" style={{width:'100%', borderRadius:'12px'}}/></div>
          
          <div className="nav-group-label" style={{fontSize:10, color:'var(--text-dim)', marginBottom:12, textAlign:'center'}}>GLOBAL</div>
          <button className={`nav-item ${(view==='inbox' && filter.type==='all')?'active':''}`} onClick={()=>{setView('inbox'); setFilter({type:'all'})}} title="Toutes les boites"><MessageSquare size={22}/></button>
          <button className={`nav-item ${view==='archive'?'active':''}`} onClick={()=>setView('archive')} title="Archives"><Archive size={22}/></button>
          
          <div className="nav-group-label" style={{fontSize:10, color:'var(--text-dim)', marginTop:20, marginBottom:12, textAlign:'center'}}>RÉSEAUX</div>
          <button className={`nav-item ${(filter.network==='whatsapp')?'active':''}`} onClick={()=>{setView('inbox'); setFilter({type:'network', network:'whatsapp'})}} title="WhatsApp"><div className="platform-dot whatsapp" style={{position:'relative', left:0, bottom:0, width:14, height:14}}/></button>
          <button className={`nav-item ${(filter.network==='telegram')?'active':''}`} onClick={()=>{setView('inbox'); setFilter({type:'network', network:'telegram'})}} title="Telegram"><div className="platform-dot telegram" style={{position:'relative', left:0, bottom:0, width:14, height:14}}/></button>
          <button className={`nav-item ${(filter.network==='instagram')?'active':''}`} onClick={()=>{setView('inbox'); setFilter({type:'network', network:'instagram'})}} title="Instagram"><div className="platform-dot instagram" style={{position:'relative', left:0, bottom:0, width:14, height:14, background:'linear-gradient(45deg,#f09433,#bc1888)'}}/></button>
          <button className={`nav-item ${(filter.network==='signal')?'active':''}`} onClick={()=>{setView('inbox'); setFilter({type:'network', network:'signal'})}} title="Signal"><div className="platform-dot signal" style={{position:'relative', left:0, bottom:0, width:14, height:14, background:'#3a76f0'}}/></button>

          <div style={{marginTop:'auto'}}>
             <button className={`nav-item ${view==='contacts'?'active':''}`} onClick={()=>setView('contacts')} title="Contacts"><Users size={22}/></button>
             <button className={`nav-item ${view==='settings'?'active':''}`} onClick={()=>setView('settings')} title="Comptes"><Settings size={22}/></button>
             <button className="nav-item" onClick={()=>setShowAddModal(true)} title="Ajouter"><Plus size={22}/></button>
             <button className="nav-item" onClick={()=>{clearToken();setUser(null)}} title="Quitter"><LogOut size={20}/></button>
          </div>
        </nav>
      )}

      {/* LIST PANE */}
      <div className={`list-pane ${selectedConv && isMobile ? 'hidden' : ''}`}>
        <header className="pane-header">
           <h1>{
             filter.type === 'network' ? (filter.network === 'whatsapp' ? 'WhatsApp' : filter.network === 'telegram' ? 'Telegram' : filter.network === 'instagram' ? 'Instagram' : 'Signal') 
             : filter.type === 'account' ? (accounts.find(a=>a.id===filter.accountId)?.account_name || 'Compte')
             : view === 'archive' ? 'Archives' 
             : view === 'contacts' ? 'Contacts' 
             : view === 'settings' ? 'Paramètres' 
             : 'Messages'
           } <span className="badge">
             {view === 'contacts' ? contacts.length : view === 'settings' ? accounts.length : sortedConvs.length}
           </span></h1>
           <div className="search-box"><Search size={16} color="var(--text-dim)"/><input placeholder="Rechercher..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/></div>
        </header>

        {(filter.type === 'network' || filter.type === 'account') && (
          <div className="account-selector">
            <button className={`acc-tab ${filter.type==='network'?'active':''}`} onClick={()=>setFilter({type:'network', network: filter.network})}>Tout {filter.network}</button>
            {accounts.filter(a => a.platform === filter.network).map(acc => (
              <button key={acc.id} className={`acc-tab ${filter.accountId===acc.id?'active':''}`} onClick={()=>setFilter({type:'account', network: acc.platform, accountId: acc.id})}>
                {acc.account_name || acc.username || (acc.platform === 'whatsapp' ? 'Numéro WA' : 'Compte')}
              </button>
            ))}
          </div>
        )}

        <div className="scroll-area">
           {view === 'contacts' ? (
             contacts.filter(c => {
               if (!searchQuery) return true;
               const q = searchQuery.toLowerCase();
               const name = getContactName(c).toLowerCase();
               const phone = (c.phone_number || c.external_id || '').toLowerCase();
               return name.includes(q) || phone.includes(q);
             }).map(contact => {
               const displayName = getContactName(contact);
               const isUnknown = displayName === 'Contact WhatsApp' || displayName === 'Inconnu';
               return (
                <div key={contact.id} className="conv-card" onClick={() => setSelectedContactDetail(contact)}>
                  <div className="avatar-wrap">
                    {contact.avatar_url
                      ? <img src={contact.avatar_url} alt="" onError={e => { e.target.style.display='none'; e.target.nextElementSibling?.style && (e.target.nextElementSibling.style.display='flex'); }}/>
                      : null}
                    <div className="avatar-placeholder" style={contact.avatar_url ? {display:'none'} : {}}/>
                  </div>
                  <div className="conv-content">
                    <strong style={isUnknown ? {color:'var(--text-dim)', fontStyle:'italic', fontWeight:400} : {}}>{displayName}</strong>
                    <p>{contact.phone_number ? formatName(contact.phone_number) : (isUnknown ? contact.external_id?.split('@')[0] : '')}</p>
                  </div>
               </div>
               );
             })
           ) : view === 'settings' ? (
             <div style={{padding:'0 16px'}}>
               <p style={{color:'var(--text-dim)', fontSize:'12px', marginBottom:'12px', marginTop:'12px'}}>Comptes connectés</p>
               {accounts.length === 0 && (
                 <p style={{color:'var(--text-dim)', fontSize:'13px', marginBottom:'16px', textAlign:'center', padding:'20px 0'}}>Aucun compte connecté</p>
               )}
               {accounts.map(acc => {
                 const isConnected = acc.status === 'connected';
                 const statusColor = isConnected ? 'var(--accent-green)' : acc.status === 'pairing' || acc.status === 'challenge' ? 'var(--accent-gold)' : 'var(--accent-red)';
                 const statusLabel = isConnected ? '● Connecté' : acc.status === 'pairing' ? '◌ Connexion...' : acc.status === 'challenge' ? '◌ Vérification...' : '○ Déconnecté';

                 // Icône et couleur par plateforme
                 const platformIcon = acc.platform === 'telegram' ? (
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                 ) : acc.platform === 'instagram' ? (
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                 ) : (
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.824L.057 23.882l6.233-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-1.961 0-3.79-.527-5.364-1.446l-.384-.228-3.984 1.045 1.063-3.878-.25-.398A9.796 9.796 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/></svg>
                 );
                 const platformBg = acc.platform === 'telegram' ? '#229ED9'
                   : acc.platform === 'instagram' ? 'linear-gradient(45deg,#f09433,#dc2743,#bc1888)'
                   : '#25D366';
                 const platformName = acc.platform === 'telegram' ? 'Telegram'
                   : acc.platform === 'instagram' ? 'Instagram'
                   : 'WhatsApp';

                 return (
                 <div key={acc.id} className="acc-row" style={{background:'var(--surface-200)', marginBottom:'12px', border:'1px solid var(--border-muted)', borderRadius:16, display:'flex', alignItems:'center', padding:'12px 16px', gap:12}}>
                    <div style={{width:40,height:40,borderRadius:'50%',background:platformBg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      {platformIcon}
                    </div>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontWeight:500, fontSize:15, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{acc.account_name || acc.username || platformName}</div>
                      <div style={{color: statusColor, fontSize:'12px'}}>{statusLabel}</div>
                    </div>
                    <button
                      onClick={async () => {
                        // Bypass confirm() which is blocked on some browsers/subagents
                        try {
                          console.log(`[DELETE] Force Requesting for ${acc.id}`);
                          await axios.delete(`${API}/accounts/${acc.id}`);
                          preloadData();
                        } catch (err) { 
                          console.error(`[DELETE] Error for ${acc.id}`, err);
                          alert('Échec suppression.'); 
                        }
                      }}
                      className="delete-acc-btn"
                      style={{
                        marginLeft:'auto', 
                        padding: '8px 12px', 
                        cursor: 'pointer', 
                        background: 'rgba(239, 68, 68, 0.1)', 
                        border: '1px solid #ef4444', 
                        borderRadius: 10,
                        color: '#ef4444',
                        display:'flex',
                        alignItems:'center',
                        justifyContent:'center'
                      }}
                    >
                      <Trash size={20}/>
                    </button>
                 </div>
                 );
               })}
               <button className="lx-btn" style={{marginTop:'12px', marginBottom:'8px'}} onClick={()=>setShowAddModal(true)}>
                 + Connecter un compte
               </button>
               <button className="lx-btn" style={{background:'var(--accent-red)', color:'white', marginBottom:'80px'}} onClick={()=>{clearToken();setUser(null)}}>
                 Déconnexion du Hub
               </button>
             </div>
           ) : (
             sortedConvs.map(conv => (
               <div key={conv.id} className={`conv-card ${selectedConv?.id===conv.id?'active':''}`} onClick={()=>setSelectedConv(conv)}>
                  <div className="avatar-wrap">
                    {/* FIX: mutual exclusive — show photo OR placeholder, never both */}
                    {getAvatar(conv)
                      ? <img src={getAvatar(conv)} alt="" onError={(e) => { e.target.style.display='none'; e.target.nextElementSibling?.style && (e.target.nextElementSibling.style.display='flex'); }}/>
                      : null}
                    <div className="avatar-placeholder" style={getAvatar(conv) ? {display:'none'} : {}}/>
                    <div className="platform-dot whatsapp"/>
                  </div>
                  <div className="conv-content">
                    <div className="conv-top">
                      <strong>{getDisplayName(conv)} {conv.metadata?.is_pinned && <Pin size={10} style={{marginLeft:4, color:'var(--accent-gold)'}}/>}</strong>
                      <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
                        <span className="time">{conv.last_message_at ? new Date(conv.last_message_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</span>
                        <button className="archive-btn" onClick={(e) => { e.stopPropagation(); toggleArchive(conv); }}>
                          <Archive size={14} color={conv.metadata?.is_archived ? 'var(--accent-gold)' : 'var(--text-dim)'}/>
                        </button>
                      </div>
                    </div>
                    <p>{conv.last_message_preview || 'Aucun message'}</p>
                  </div>
               </div>
             ))
           )}
        </div>

        {/* BOTTOM NAV (Mobile only) */}
        {isMobile && (
          <nav className="nav-bottom">
            <button className={`nav-item ${view==='inbox'?'active':''}`} onClick={()=>setView('inbox')}><MessageSquare size={20}/></button>
            <button className={`nav-item ${view==='archive'?'active':''}`} onClick={()=>setView('archive')}><Archive size={20}/></button>
            <button className={`nav-item ${view==='contacts'?'active':''}`} onClick={()=>setView('contacts')}><Users size={20}/></button>
            <button className={`nav-item ${view==='settings'?'active':''}`} onClick={()=>setView('settings')}><Settings size={20}/></button>
          </nav>
        )}
      </div>


      {/* CHAT PANE */}

      <main className={`chat-pane ${!selectedConv && isMobile ? 'hidden' : ''}`}>
        {selectedConv ? (
          <div className="chat-content" style={{display:'flex', flexDirection:'column', height:'100%'}}>
            <header className="chat-header">
              <div className="header-left">
                {isMobile && <button className="back-btn" onClick={()=>setSelectedConv(null)}><ArrowLeft/></button>}
                <div className="avatar-wrap">
                  {getAvatar(selectedConv)
                    ? <img src={getAvatar(selectedConv)} alt="" onError={(e) => { e.target.style.display='none'; e.target.nextElementSibling?.style && (e.target.nextElementSibling.style.display='flex'); }}/>
                    : null}
                  <div className="avatar-placeholder" style={getAvatar(selectedConv) ? {display:'none'} : {}}/>
                </div>
                <div className="header-info">
                  <h2>{getDisplayName(selectedConv)}</h2>
                  <span className="status">WhatsApp • {selectedConv.is_group && selectedConv.group_metadata?.participants ? `${selectedConv.group_metadata.participants.length} participants` : 'En ligne'}</span>
                </div>
              </div>
              <div className="header-actions">
                <button className="h-action" onClick={() => startCall(selectedConv)} title="Appel"><Phone size={20}/></button>
                <button className="h-action" onClick={() => preloadData()} title="Rafraîchir"><RefreshCw size={20}/></button>
                <button className="h-action"><MoreVertical size={20}/></button>
              </div>
            </header>

            <div
              className="messages-area"
              ref={messagesAreaRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                // Consider "at bottom" if within 80px of the bottom
                isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              }}
            >
              {messages.map(msg => {
                const hasText = msg.content && !msg.content.startsWith('[');
                const hasMedia = !!msg.media_url;
                const isMediaOnly = hasMedia && !hasText && !msg.metadata?.quoted;
                const side = msg.is_from_me ? 'me' : 'them';
                return (
                <div key={msg.id} className={`msg-bubble ${side}${isMediaOnly ? ' media-only' : ''}`}>
                  {/* Sender name for group chats */}
                  {selectedConv?.is_group && !msg.is_from_me && (
                    <div className="msg-sender">{msg.metadata?.pushName || resolveContactName(msg.sender_id, msg.metadata?.participant)}</div>
                  )}
                  {/* Quoted message */}
                  {msg.metadata?.quoted && (
                    <div className="quoted-box">
                      <strong>{msg.metadata.quoted.sender?.split('@')[0]}</strong>
                      <p>{msg.metadata.quoted.content}</p>
                    </div>
                  )}
                  {/* Media rendering — correct player per type */}
                  {hasMedia ? (() => {
                    const t = msg.media_type;
                    if (t === 'audio') {
                      return <audio controls className="msg-audio" src={msg.media_url} preload="metadata"/>;
                    }
                    if (t === 'video') {
                      return (
                        <video controls className="msg-video" src={msg.media_url} preload="metadata"
                          onClick={e => e.stopPropagation()}/>
                      );
                    }
                    if (t === 'sticker') {
                      return <img src={msg.media_url} alt="sticker" style={{maxWidth:120, maxHeight:120, borderRadius:8, background:'none'}}
                        onError={e => e.target.style.display='none'}/>;
                    }
                    // image / document / fallback
                    return (
                      <img src={msg.media_url} alt={t || 'media'} className="msg-media"
                        onError={e => e.target.style.display='none'}
                        onClick={() => window.open(msg.media_url, '_blank')}/>
                    );
                  })() : null}
                  {/* Text content */}
                  {hasText ? <span>{msg.content}</span> : null}
                  {/* Placeholder when media_url not yet available */}
                  {!hasMedia && msg.media_type ? (
                    <span style={{opacity:0.65, fontStyle:'italic'}}>
                      {{'image':'📷 Photo', 'video':'🎬 Vidéo', 'audio':'🎵 Message vocal', 'document':'📄 Document', 'sticker':'🎭 Sticker'}[msg.media_type] || '📎 Média'}
                    </span>
                  ) : null}
                  {/* Caption under media */}
                  {(hasMedia && hasText) ? <span className="media-caption">{msg.content}</span> : null}
                  {/* Reactions */}
                  {msg.metadata?.reactions && (
                    <div style={{display:'flex', gap:2, marginTop:4}}>
                      {Object.values(msg.metadata.reactions).map((emoji, i) => (
                        <span key={i} style={{fontSize:12, background:'rgba(255,255,255,0.1)', padding:'2px 4px', borderRadius:8}}>{emoji}</span>
                      ))}
                    </div>
                  )}
                  <div className="msg-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                    {msg.is_from_me && <span style={{marginLeft:4}}>{msg.status==='read'?'✓✓':msg.status==='delivered'?'✓✓':'✓'}</span>}
                  </div>
                </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            <footer className="chat-footer">
              <form className="input-group" onSubmit={sendText}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx"
                  style={{display:'none'}}
                  onChange={(e) => { if (e.target.files[0]) { sendMedia(e.target.files[0]); e.target.value=''; } }}
                />
                <button type="button" className="media-btn" onClick={() => fileInputRef.current?.click()}><Paperclip size={20}/></button>
                <input placeholder="Écrire un message..." value={newMessage} onChange={e=>setNewMessage(e.target.value)} />
                <button type="button" className="media-btn"><Smile size={20}/></button>
                <button type="submit" className="send-btn"><Send size={18}/></button>
              </form>
            </footer>
          </div>
        ) : (
          <div style={{flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-dim)', flexDirection:'column'}}>
            <MessageSquare size={64} style={{marginBottom:20, opacity:0.2}}/>
            <h3>LeRelais Hub Elite</h3>
            <p>Sélectionnez une discussion pour commencer</p>
          </div>
        )}
      </main>

      {/* ADD ACCOUNT MODAL */}
      {showAddModal && (
        <div className="modal-overlay" onClick={()=>{setShowAddModal(false); resetPairingState();}}>
          <div className="elite-modal" onClick={e=>e.stopPropagation()} style={{maxHeight:'90vh', overflowY:'auto'}}>

            {/* ── WhatsApp QR ── */}
            {activeNetwork === 'whatsapp' && pairingStatus === 'waiting_qr' ? (
              <div style={{textAlign:'center'}}>
                <button onClick={resetPairingState} style={{position:'absolute', top:16, right:16, color:'var(--text-dim)', padding:8}}><X size={18}/></button>
                <h2 style={{marginBottom:10}}>Scanner le QR Code</h2>
                <p style={{color:'var(--text-dim)', marginBottom:20, fontSize:13}}>WhatsApp → Appareils connectés → Lier un appareil</p>
                <div style={{background:'white', padding:20, borderRadius:20, display:'inline-block'}}>
                  {pairingQR ? <QRCode value={pairingQR} size={200}/> : <Loader2 className="spinner" size={40}/>}
                </div>
                {pairingStatus === 'connected' && <p style={{marginTop:20, color:'var(--accent-green)'}}>✅ Connecté !</p>}
                <p style={{marginTop:12, color:'var(--text-dim)', fontSize:12}}>Le QR expire dans 60s</p>
              </div>

            /* ── Telegram phone ── */
            ) : activeNetwork === 'telegram' && (tgStep === 'phone' || tgStep === 'qr') ? (
              <div>
                <button onClick={resetPairingState} style={{float:'right', color:'var(--text-dim)', padding:4}}><X size={18}/></button>
                <h2 style={{marginBottom:6}}>Connecter Telegram</h2>
                
                {tgStep === 'qr' ? (
                  <div style={{textAlign:'center', marginTop:10}}>
                    <p style={{fontSize:13, color:'var(--text-dim)', marginBottom:16}}>Scanner avec Telegram {'>'} Appareils {'>'} Connecter</p>
                    {tgQR ? (
                      <div style={{background:'white', padding:10, borderRadius:12, display:'inline-block'}}>
                        <QRCode value={tgQR} size={200} />
                      </div>
                    ) : <Loader2 className="spinner" size={30} style={{margin:'20px auto'}}/>}
                    <button onClick={() => setTgStep('phone')} style={{display:'block', width:'100%', marginTop:20, color:'var(--text-dim)', fontSize:12, textDecoration:'underline'}}>Retour au SMS</button>
                  </div>
                ) : (
                  <>
                    <p style={{color:'var(--text-dim)', fontSize:13, marginBottom:20}}>Entrez votre numéro de téléphone Telegram</p>
                    <form onSubmit={startTelegramPairing}>
                      <input className="lx-input" placeholder="+33 6 12 34 56 78" value={tgPhone} onChange={e=>setTgPhone(e.target.value)} required/>
                      {tgError && <p style={{color:'var(--accent-red)', fontSize:12, marginBottom:8}}>{tgError}</p>}
                      <button type="submit" className="lx-btn" style={{background:'#229ED9', color:'white'}}>Envoyer le code SMS</button>
                    </form>
                    <button onClick={startTelegramQRFlow} style={{display:'block', width:'100%', marginTop:16, color:'var(--text-dim)', fontSize:12, textDecoration:'underline'}}>Se connecter via QR Code</button>
                  </>
                )}
              </div>

            ) : activeNetwork === 'telegram' && tgStep === 'connecting' ? (
              <div style={{textAlign:'center', padding:'30px 0'}}>
                <Loader2 className="spinner" size={36} style={{color:'#229ED9'}}/>
                <p style={{marginTop:16, color:'var(--text-dim)'}}>Connexion à Telegram...</p>
              </div>

            ) : activeNetwork === 'telegram' && (tgStep === 'code' || tgStep === '2fa') ? (
              <div>
                <button onClick={resetPairingState} style={{float:'right', color:'var(--text-dim)', padding:4}}><X size={18}/></button>
                <h2 style={{marginBottom:6}}>{tgStep === '2fa' ? 'Mot de passe 2FA' : 'Code de vérification'}</h2>
                <p style={{color:'var(--text-dim)', fontSize:13, marginBottom:20}}>
                  {tgStep === '2fa' ? 'Votre compte Telegram a la vérification en 2 étapes activée.' : `Code envoyé au ${tgPhone}`}
                </p>
                <form onSubmit={verifyTelegramCode}>
                  {tgStep === 'code' && <input className="lx-input" placeholder="Code à 5 chiffres" value={tgCode} onChange={e=>setTgCode(e.target.value)} maxLength={8} required/>}
                  {tgStep === '2fa' && <input className="lx-input" type="password" placeholder="Mot de passe 2FA" value={tg2FA} onChange={e=>setTg2FA(e.target.value)} required/>}
                  {tgError && <p style={{color:'var(--accent-red)', fontSize:12, marginBottom:8}}>{tgError}</p>}
                  <button type="submit" className="lx-btn" style={{background:'#229ED9', color:'white'}}>Confirmer</button>
                </form>
              </div>

            ) : activeNetwork === 'telegram' && tgStep === 'connected' ? (
              <div style={{textAlign:'center', padding:'20px 0'}}>
                <p style={{fontSize:40}}>✅</p>
                <h2 style={{marginTop:12}}>Telegram connecté !</h2>
                <p style={{color:'var(--text-dim)', marginTop:8}}>Vos messages Telegram apparaîtront dans le Hub.</p>
              </div>

            /* ── Instagram login ── */
            ) : activeNetwork === 'instagram' && igStep === 'login' ? (
              <div>
                <button onClick={resetPairingState} style={{float:'right', color:'var(--text-dim)', padding:4}}><X size={18}/></button>
                <h2 style={{marginBottom:6}}>Connecter Instagram</h2>
                <p style={{color:'var(--text-dim)', fontSize:13, marginBottom:4}}>Identifiants de votre compte Instagram</p>
                <p style={{color:'#f09433', fontSize:11, marginBottom:16}}>⚠️ Utilisez un compte secondaire — Instagram peut détecter les connexions automatiques.</p>
                <form onSubmit={connectInstagram}>
                  <input className="lx-input" placeholder="Nom d'utilisateur Instagram" value={igUsername} onChange={e=>setIgUsername(e.target.value)} required/>
                  <input className="lx-input" type="password" placeholder="Mot de passe" value={igPassword} onChange={e=>setIgPassword(e.target.value)} required/>
                  {igError && <p style={{color:'var(--accent-red)', fontSize:12, marginBottom:8}}>{igError}</p>}
                  <button type="submit" className="lx-btn" style={{background:'linear-gradient(45deg,#f09433,#dc2743,#bc1888)', color:'white'}}>Se connecter</button>
                </form>
              </div>

            ) : activeNetwork === 'instagram' && igStep === 'connecting' ? (
              <div style={{textAlign:'center', padding:'30px 0'}}>
                <Loader2 className="spinner" size={36} style={{color:'#dc2743'}}/>
                <p style={{marginTop:16, color:'var(--text-dim)'}}>Connexion à Instagram...</p>
              </div>

            /* ── Instagram challenge (code email/SMS) ── */
            ) : activeNetwork === 'instagram' && igStep === 'challenge' ? (
              <div>
                <button onClick={resetPairingState} style={{float:'right', color:'var(--text-dim)', padding:4}}><X size={18}/></button>
                <h2 style={{marginBottom:6}}>Vérification Instagram</h2>
                <p style={{color:'var(--text-dim)', fontSize:13, marginBottom:4}}>Instagram a envoyé un code de sécurité à votre adresse e-mail ou téléphone.</p>
                <p style={{color:'#f09433', fontSize:11, marginBottom:16}}>Vérifiez votre e-mail ou SMS lié à votre compte Instagram.</p>
                <form onSubmit={verifyIgChallenge}>
                  <input className="lx-input" placeholder="Code de vérification (6 chiffres)" value={igChallengeCode} onChange={e=>setIgChallengeCode(e.target.value)} maxLength={8} required/>
                  {igError && <p style={{color:'var(--accent-red)', fontSize:12, marginBottom:8}}>{igError}</p>}
                  <button type="submit" className="lx-btn" style={{background:'linear-gradient(45deg,#f09433,#dc2743,#bc1888)', color:'white'}}>Valider le code</button>
                </form>
              </div>

            /* ── Instagram 2FA ── */
            ) : activeNetwork === 'instagram' && igStep === '2fa' ? (
              <div>
                <button onClick={resetPairingState} style={{float:'right', color:'var(--text-dim)', padding:4}}><X size={18}/></button>
                <h2 style={{marginBottom:6}}>Double authentification</h2>
                <p style={{color:'var(--text-dim)', fontSize:13, marginBottom:16}}>Entrez le code de votre application d'authentification.</p>
                <form onSubmit={verifyIg2FA}>
                  <input className="lx-input" placeholder="Code 2FA (6 chiffres)" value={ig2FACode} onChange={e=>setIg2FACode(e.target.value)} maxLength={8} required/>
                  {igError && <p style={{color:'var(--accent-red)', fontSize:12, marginBottom:8}}>{igError}</p>}
                  <button type="submit" className="lx-btn" style={{background:'linear-gradient(45deg,#f09433,#dc2743,#bc1888)', color:'white'}}>Confirmer</button>
                </form>
              </div>

            ) : activeNetwork === 'instagram' && igStep === 'connected' ? (
              <div style={{textAlign:'center', padding:'20px 0'}}>
                <p style={{fontSize:40}}>✅</p>
                <h2 style={{marginTop:12}}>Instagram connecté !</h2>
                <p style={{color:'var(--text-dim)', marginTop:8}}>Vos DMs Instagram apparaîtront dans le Hub.</p>
              </div>

            /* ── Signal : menu choix ── */
            ) : activeNetwork === 'signal' && (signalStep === 'menu' || !signalStep) ? (
              <div>
                <button onClick={resetPairingState} style={{float:'right', color:'var(--text-dim)', padding:4}}><X size={18}/></button>
                <h2 style={{marginBottom:6}}>Connecter Signal</h2>
                <p style={{color:'var(--text-dim)', fontSize:13, marginBottom:20}}>Choisissez votre méthode de connexion</p>
                {signalError && <p style={{color:'var(--accent-red)', fontSize:12, marginBottom:12}}>{signalError}</p>}
                <div className="conv-card" style={{background:'var(--surface-200)', marginBottom:10, cursor:'pointer'}} onClick={startSignalLinkFlow}>
                  <div style={{fontSize:28, marginRight:12}}>📱</div>
                  <div className="conv-content">
                    <strong>Lier mon compte Signal</strong>
                    <small style={{color:'var(--text-dim)'}}>Scannez un QR depuis votre appli Signal (recommandé)</small>
                  </div>
                </div>
                <div className="conv-card" style={{background:'var(--surface-200)', cursor:'pointer'}} onClick={()=>setSignalStep('sms_phone')}>
                  <div style={{fontSize:28, marginRight:12}}>✉️</div>
                  <div className="conv-content">
                    <strong>Nouveau numéro Signal</strong>
                    <small style={{color:'var(--text-dim)'}}>Inscrire un numéro dédié via SMS</small>
                  </div>
                </div>
                <p style={{color:'var(--text-dim)', fontSize:11, marginTop:16, lineHeight:'1.5'}}>
                  ⚙️ Requiert le service <strong>signal-cli-rest-api</strong> déployé sur Railway.<br/>
                  Configurez <code>SIGNAL_API_URL</code> dans vos variables Railway.
                </p>
              </div>

            /* ── Signal : QR link ── */
            ) : activeNetwork === 'signal' && signalStep === 'qr' ? (
              <div style={{textAlign:'center'}}>
                <button onClick={resetPairingState} style={{position:'absolute', top:16, right:16, color:'var(--text-dim)', padding:8}}><X size={18}/></button>
                <h2 style={{marginBottom:6}}>Scanner le QR Signal</h2>
                <p style={{color:'var(--text-dim)', fontSize:13, marginBottom:16}}>Signal → Paramètres → Appareils liés → Lier un appareil</p>
                <div style={{background:'white', padding:16, borderRadius:16, display:'inline-block'}}>
                  {signalQR ? <img src={signalQR} alt="Signal QR" style={{width:200, height:200}}/> : <Loader2 className="spinner" size={40}/>}
                </div>
                <p style={{marginTop:12, color:'var(--text-dim)', fontSize:12}}>En attente du scan…</p>
              </div>

            /* ── Signal : SMS phone ── */
            ) : activeNetwork === 'signal' && signalStep === 'sms_phone' ? (
              <div>
                <button onClick={() => setSignalStep('menu')} style={{float:'right', color:'var(--text-dim)', padding:4}}><X size={18}/></button>
                <h2 style={{marginBottom:6}}>Numéro Signal</h2>
                <p style={{color:'var(--text-dim)', fontSize:13, marginBottom:16}}>Entrez le numéro à inscrire sur Signal (numéro dédié)</p>
                <form onSubmit={startSignalSMS}>
                  <input className="lx-input" placeholder="+33 6 12 34 56 78" value={signalPhone} onChange={e=>setSignalPhone(e.target.value)} required/>
                  {signalError && <p style={{color:'var(--accent-red)', fontSize:12, marginBottom:8}}>{signalError}</p>}
                  <button type="submit" className="lx-btn" style={{background:'#3A76F0', color:'white'}}>Envoyer le SMS</button>
                </form>
              </div>

            /* ── Signal : SMS code ── */
            ) : activeNetwork === 'signal' && signalStep === 'sms_code' ? (
              <div>
                <button onClick={() => setSignalStep('sms_phone')} style={{float:'right', color:'var(--text-dim)', padding:4}}><X size={18}/></button>
                <h2 style={{marginBottom:6}}>Code de vérification Signal</h2>
                <p style={{color:'var(--text-dim)', fontSize:13, marginBottom:16}}>Code reçu par SMS au {signalPhone}</p>
                <form onSubmit={verifySignalSMSCode}>
                  <input className="lx-input" placeholder="000-000" value={signalCode} onChange={e=>setSignalCode(e.target.value)} required/>
                  {signalError && <p style={{color:'var(--accent-red)', fontSize:12, marginBottom:8}}>{signalError}</p>}
                  <button type="submit" className="lx-btn" style={{background:'#3A76F0', color:'white'}}>Confirmer</button>
                </form>
              </div>

            ) : activeNetwork === 'signal' && signalStep === 'connecting' ? (
              <div style={{textAlign:'center', padding:'30px 0'}}>
                <Loader2 className="spinner" size={36} style={{color:'#3A76F0'}}/>
                <p style={{marginTop:16, color:'var(--text-dim)'}}>Connexion à Signal...</p>
              </div>

            ) : activeNetwork === 'signal' && signalStep === 'connected' ? (
              <div style={{textAlign:'center', padding:'20px 0'}}>
                <p style={{fontSize:40}}>✅</p>
                <h2 style={{marginTop:12}}>Signal connecté !</h2>
                <p style={{color:'var(--text-dim)', marginTop:8}}>Vos messages Signal apparaîtront dans le Hub.</p>
              </div>

            /* ── Liste des réseaux ── */
            ) : (
              <div>
                <h2 style={{marginBottom:6}}>Connecter un compte</h2>
                <p style={{color:'var(--text-dim)', fontSize:13, marginBottom:20}}>Choisissez le réseau à connecter</p>

                {/* WhatsApp */}
                <div className="conv-card" style={{background:'var(--surface-200)', border:'1px solid var(--border-muted)', marginBottom:10, cursor:'pointer'}} onClick={startWAPairing}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'#25D366',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.824L.057 23.882l6.233-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-1.961 0-3.79-.527-5.364-1.446l-.384-.228-3.984 1.045 1.063-3.878-.25-.398A9.796 9.796 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/></svg>
                  </div>
                  <div className="conv-content"><strong>WhatsApp</strong><small style={{color:'var(--text-dim)'}}>Scan QR · miroir de votre compte</small></div>
                </div>

                {/* Telegram */}
                <div className="conv-card" style={{background:'var(--surface-200)', border:'1px solid var(--border-muted)', marginBottom:10, cursor:'pointer'}} onClick={()=>{setActiveNetwork('telegram'); setTgStep('phone');}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'#229ED9',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                  </div>
                  <div className="conv-content"><strong>Telegram</strong><small style={{color:'var(--accent-green)', fontSize:11}}>✓ Disponible · numéro de téléphone</small></div>
                </div>

                {/* Instagram */}
                <div className="conv-card" style={{background:'var(--surface-200)', border:'1px solid var(--border-muted)', marginBottom:10, cursor:'pointer'}} onClick={()=>{setActiveNetwork('instagram'); setIgStep('login');}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                  </div>
                  <div className="conv-content"><strong>Instagram</strong><small style={{color:'var(--accent-green)', fontSize:11}}>✓ Disponible · identifiants</small></div>
                </div>

                {/* Signal */}
                <div className="conv-card" style={{background:'var(--surface-200)', border:'1px solid var(--border-muted)', marginBottom:10, cursor:'pointer'}} onClick={()=>{setActiveNetwork('signal'); setSignalStep('menu');}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'#3A76F0',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.374 0 0 5.373 0 12c0 2.023.52 3.925 1.433 5.582L.054 23.88l6.405-1.673A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm.174 18.784c-1.032 0-2.03-.18-2.96-.51l-3.04.836.85-2.97a6.781 6.781 0 01-1.178-3.838c0-3.774 3.084-6.836 6.886-6.836 3.8 0 6.884 3.062 6.884 6.836 0 3.773-3.084 6.836-6.886 6.836l.444-.354z"/></svg>
                  </div>
                  <div className="conv-content">
                    <strong>Signal</strong>
                    <small style={{color:'var(--accent-green)', fontSize:11}}>✓ Disponible · nécessite signal-cli sur Railway</small>
                  </div>
                </div>

                {/* Snapchat */}
                <div className="conv-card" style={{background:'var(--surface-100)', border:'1px dashed var(--border-muted)', opacity:0.45, cursor:'not-allowed'}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'#FFFC00',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#000"><path d="M12.017 0C8.3 0 7.86.015 7.86.015 4.93.15 2.875 1.01 1.715 2.17.557 3.326-.002 4.866 0 8.006c0 .44.013 1.94.013 3.994C.013 16.11.013 16.543 0 16.994c.002 3.14.559 4.68 1.715 5.836C2.874 23.986 4.93 24.848 7.86 24.984c0 0 .44.016 4.157.016 3.716 0 4.14-.016 4.14-.016 2.928-.136 4.985-.998 6.143-2.154C23.454 21.672 24 20.13 24 16.994c0-.45-.013-1.94-.013-3.994C23.987 8 23.987 7.57 24 7.006 24 3.866 23.443 2.326 22.285 1.17 21.127.016 19.072-.847 16.142-.984 16.142-.984 15.72-1 12.017 0zm-.001 2.16c3.648 0 4.08.014 4.08.014 2.475.113 3.813.805 4.577 1.57.766.764 1.46 2.1 1.573 4.576.013.45.013 1.925.013 3.964v.003c0 2.04 0 3.516-.013 3.965-.113 2.476-.807 3.81-1.573 4.576-.764.764-2.102 1.457-4.577 1.57-.4.014-4.08.014-4.08.014s-3.698 0-4.095-.013c-2.476-.112-3.814-.806-4.578-1.57C3.36 20.094 2.667 18.76 2.554 16.283c-.013-.45-.013-1.925-.013-3.965v-.003c0-2.04 0-3.515.013-3.964.113-2.476.807-3.812 1.57-4.576.766-.766 2.103-1.458 4.579-1.571.395-.013 4.08-.013 4.08-.013s.234-.03.233-.03z"/></svg>
                  </div>
                  <div className="conv-content">
                    <strong>Snapchat</strong>
                    <small style={{color:'var(--text-dim)', fontSize:11}}>Pas d'API officielle — non supporté</small>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MOBILE NAV */}
      {isMobile && !selectedConv && (
        <nav className="mobile-nav">
          <button className={`nav-item ${view==='inbox'?'active':''}`} onClick={()=>setView('inbox')}><MessageSquare size={24}/></button>
          <button className={`nav-item ${view==='contacts'?'active':''}`} onClick={()=>setView('contacts')}><Users size={24}/></button>
          <button className="send-btn" style={{borderRadius:'50%', marginTop:-30, width:56, height:56}} onClick={()=>setShowAddModal(true)}><Plus size={28}/></button>
          <button className={`nav-item ${view==='archive'?'active':''}`} onClick={()=>setView('archive')}><Archive size={24}/></button>
          <button className={`nav-item ${view==='settings'?'active':''}`} onClick={()=>setView('settings')}><Settings size={24}/></button>
        </nav>
      )}

      {/* CONTACT DETAIL MODAL */}
      <AnimatePresence>
        {selectedContactDetail && (
          <motion.div
            className="modal-overlay"
            initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            style={{zIndex:2000, background:'rgba(0,0,0,0.85)', backdropFilter:'blur(20px)'}}
            onClick={() => setSelectedContactDetail(null)}
          >
            <motion.div
              className="calling-card"
              initial={{scale:0.9, y:20}} animate={{scale:1, y:0}} exit={{scale:0.9, y:20}}
              onClick={e => e.stopPropagation()}
            >
              <div className="avatar-wrap" style={{width:100, height:100, margin:'0 auto'}}>
                {selectedContactDetail.avatar_url ? <img src={selectedContactDetail.avatar_url} alt="" style={{borderRadius:32}}/> : <div className="avatar-placeholder" style={{borderRadius:32}}/>}
              </div>
              <h2 style={{marginTop:24, fontSize:26}}>{getContactName(selectedContactDetail)}</h2>
              <p style={{color:'var(--text-dim)', marginTop:8, fontSize:15}}>
                {selectedContactDetail.phone_number ? formatName(selectedContactDetail.phone_number) : selectedContactDetail.external_id?.split('@')[0]}
              </p>

              <div style={{display:'flex', flexDirection:'column', gap:12, width:'100%', maxWidth:280, marginTop:40}}>
                 <button
                   className="lx-btn"
                   style={{background:'var(--accent-gold)', color:'white', border:'none'}}
                   onClick={() => {
                     const existing = conversations.find(cv => cv.contact_id === selectedContactDetail.id);
                     if (existing) { setSelectedConv(existing); }
                     setView('inbox');
                     setSelectedContactDetail(null);
                   }}
                 >
                   <MessageSquare size={18} style={{marginRight:8}}/>
                   Envoyer un message
                 </button>

                 <button
                   className="lx-btn"
                   style={{background:'white', color:'black', fontWeight:600}}
                   onClick={() => {
                     const fakeConv = { contacts: [selectedContactDetail], external_id: selectedContactDetail.external_id, title: getContactName(selectedContactDetail) };
                     startCall(fakeConv);
                     setSelectedContactDetail(null);
                   }}
                 >
                   <Phone size={18} style={{marginRight:8}}/>
                   Appeler le contact
                 </button>
              </div>

              <button
                onClick={() => setSelectedContactDetail(null)}
                style={{color:'var(--text-dim)', fontSize:13, marginTop:32, background:'none', border:'none', cursor:'pointer'}}
              >
                Annuler
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CALLING MODAL */}
      <AnimatePresence>
        {callingContact && (
          <motion.div
            className="modal-overlay"
            initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            style={{zIndex:2000, background:'rgba(0,0,0,0.85)', backdropFilter:'blur(20px)'}}
            onClick={() => setCallingContact(null)}
          >
            <motion.div
              className="calling-card"
              initial={{scale:0.9, y:20}} animate={{scale:1, y:0}} exit={{scale:0.9, y:20}}
              onClick={e => e.stopPropagation()}
            >
              {/* Avatar */}
              <div className="pulse-container">
                <div className="pulse-ring"/>
                <div className="pulse-ring" style={{animationDelay:'0.8s'}}/>
                <div className="pulse-avatar">
                  {callingContact.avatar ? <img src={callingContact.avatar} alt=""/> : <User size={48}/>}
                </div>
              </div>

              <h2 style={{marginTop:28, fontSize:26}}>{callingContact.name}</h2>

              {callingContact.phone ? (
                <>
                  <p style={{color:'var(--text-dim)', marginTop:6, fontSize:14}}>
                    +{callingContact.phone.replace(/^\+/, '')}
                  </p>
                  <p style={{color:'var(--text-secondary)', fontSize:12, marginTop:6, marginBottom:28, maxWidth:280, lineHeight:1.5}}>
                    Choisissez le protocole d'appel depuis le Relais :
                  </p>

                  {/* WhatsApp call — VoIP, uses WiFi/4G data */}
                  <a
                    href={`https://wa.me/${callingContact.phone.replace(/^\+/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{display:'flex', alignItems:'center', gap:14, background:'#25D366', color:'white', padding:'14px 28px', borderRadius:16, marginBottom:12, textDecoration:'none', fontWeight:600, fontSize:15, width:'100%', maxWidth:280}}
                  >
                    {/* WhatsApp icon */}
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.824L.057 23.882l6.233-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-1.961 0-3.79-.527-5.364-1.446l-.384-.228-3.984 1.045 1.063-3.878-.25-.398A9.796 9.796 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/></svg>
                    <div style={{textAlign:'left'}}>
                      <div>Appel WhatsApp</div>
                      <div style={{fontSize:11, fontWeight:400, opacity:0.85}}>WiFi / 4G — données mobiles</div>
                    </div>
                  </a>

                  {/* Classic phone call */}
                  <a
                    href={`tel:+${callingContact.phone.replace(/^\+/, '')}`}
                    style={{display:'flex', alignItems:'center', gap:14, background:'var(--surface-200)', color:'white', padding:'14px 28px', borderRadius:16, marginBottom:32, textDecoration:'none', fontWeight:600, fontSize:15, width:'100%', maxWidth:280, border:'1px solid var(--border-active)'}}
                  >
                    <Phone size={22} color="var(--accent-gold)"/>
                    <div style={{textAlign:'left'}}>
                      <div>Appel téléphonique</div>
                      <div style={{fontSize:11, fontWeight:400, opacity:0.6}}>Réseau GSM classique</div>
                    </div>
                  </a>
                </>
              ) : (
                /* No phone available — @lid contact */
                <div style={{margin:'20px 0 32px', color:'var(--text-secondary)', fontSize:13, maxWidth:260, lineHeight:1.6, textAlign:'center'}}>
                  <p>Numéro de téléphone indisponible pour ce contact.</p>
                  <p style={{marginTop:8, fontSize:12, color:'var(--text-dim)'}}>WhatsApp masque le numéro de certains contacts via son système LID. L'appel sera disponible dès que le numéro est résolu.</p>
                </div>
              )}

              {/* Close / Annuler */}
              <button
                onClick={() => setCallingContact(null)}
                style={{color:'var(--text-dim)', fontSize:13, marginTop:4, background:'none', border:'none', cursor:'pointer'}}
              >
                Annuler
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
