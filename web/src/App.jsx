import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare, Users, Settings, Plus, Search, Send, X,
  RefreshCw, ArrowLeft, Loader2, Phone, Video, Image as ImageIcon,
  LogOut, Lock, Mail, User, Mic, MicOff, Paperclip, Play, Check, CheckCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import QRCode from 'react-qr-code';
import './App.css';
import logoHub from './assets/logo_hub.jpg';
import bg1 from './assets/bgs/bg1.png';
import bg2 from './assets/bgs/bg2.png';
import bg3 from './assets/bgs/bg3.png';

const BGS = [bg1, bg2, bg3];
const API = '/api';

// ─── Auth helpers ───────────────────────────────────────────
const getToken   = () => localStorage.getItem('lr_token');
const setToken   = (t) => localStorage.setItem('lr_token', t);
const clearToken = () => localStorage.removeItem('lr_token');

axios.interceptors.request.use(cfg => {
  const t = getToken();
  if (t && cfg.url?.startsWith(API)) cfg.headers['Authorization'] = `Bearer ${t}`;
  return cfg;
});
axios.interceptors.response.use(r => r, err => {
  if (err.response?.status === 401) { clearToken(); window.location.reload(); }
  return Promise.reject(err);
});

// ─── Auth Screen — Premium Luxury Edition ─────────────────────
function AuthScreen({ onAuth }) {
  const cardRef   = useRef(null);
  const rafRef    = useRef(null);
  const [tilt,  setTilt]  = useState({ x: 0, y: 0 });
  const [light, setLight] = useState({ x: 50, y: 50, show: false });
  const [mounted, setMounted] = useState(false);

  const [mode,     setMode]     = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPass]     = useState('');
  const [name,     setName]     = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [bg] = useState(() => BGS[Math.floor(Math.random() * BGS.length)]);

  useEffect(() => { setTimeout(() => setMounted(true), 60); }, []);

  const trackCard = (clientX, clientY) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x  = clientX - rect.left;
    const y  = clientY - rect.top;
    const cx = rect.width  / 2;
    const cy = rect.height / 2;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setTilt({ x: ((y - cy) / cy) * -9, y: ((x - cx) / cx) * 9 });
      setLight({ x: (x / rect.width) * 100, y: (y / rect.height) * 100, show: true });
    });
  };

  const onMove  = e => trackCard(e.clientX, e.clientY);
  const onTouch = e => { if (e.touches[0]) trackCard(e.touches[0].clientX, e.touches[0].clientY); };
  const onLeave = () => { setTilt({ x: 0, y: 0 }); setLight(l => ({ ...l, show: false })); };

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const url  = mode === 'login' ? `${API}/auth/login` : `${API}/auth/register`;
      const body = mode === 'login' ? { username, password } : { username, password, displayName: name };
      const { data } = await axios.post(url, body);
      setToken(data.token);
      onAuth(data.user);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de connexion');
    } finally { setLoading(false); }
  };

  const cardStyle = {
    transform: `perspective(1100px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) scale(${light.show ? 1.018 : 1})`,
    transition: light.show
      ? 'transform 0.08s linear'
      : 'transform 0.7s cubic-bezier(0.23, 1, 0.32, 1)',
    opacity: mounted ? 1 : 0,
    translate: mounted ? '0 0' : '0 28px',
  };

  return (
    <div className="lx-screen" style={{ backgroundImage: `url(${bg})` }}>
      {/* Atmospheric overlay */}
      <div className="lx-atmo" />
      {/* Grain */}
      <div className="lx-grain" />

      <div
        ref={cardRef}
        className="lx-card"
        style={cardStyle}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onTouchMove={onTouch}
        onTouchEnd={onLeave}
      >
        {/* Moving light refraction */}
        <div className="lx-light" style={{
          background: `radial-gradient(ellipse 220px 180px at ${light.x}% ${light.y}%, rgba(210,178,120,0.13) 0%, transparent 70%)`,
          opacity: light.show ? 1 : 0,
          transition: 'opacity 0.3s',
        }} />

        {/* Gold border shimmer — top edge */}
        <div className="lx-edge" />

        {/* Logo */}
        <div className="lx-logo-wrap">
          <img src={logoHub} alt="Le Relais" className="lx-logo-img" />
          <div className="lx-logo-ring" />
        </div>

        {/* Brand */}
        <div className="lx-brand">
          <h1 className="lx-name">Le Relais</h1>
          <p className="lx-tagline">Toutes vos messageries — un seul endroit</p>
        </div>

        {/* Ornamental divider */}
        <div className="lx-divider">
          <span /><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,0 10,5 5,10 0,5" fill="currentColor"/></svg><span />
        </div>

        {/* Mode tabs */}
        <div className="lx-tabs">
          <button className={mode === 'login' ? 'lx-tab active' : 'lx-tab'} onClick={() => { setMode('login'); setError(''); }}>
            Connexion
          </button>
          <button className={mode === 'register' ? 'lx-tab active' : 'lx-tab'} onClick={() => { setMode('register'); setError(''); }}>
            Inscription
          </button>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="lx-form">
          {mode === 'register' && (
            <div className="lx-field">
              <label className="lx-label">Prénom</label>
              <input className="lx-input" placeholder="Votre prénom" value={name} onChange={e => setName(e.target.value)} />
            </div>
          )}
          <div className="lx-field">
            <label className="lx-label">Identifiant</label>
            <input className="lx-input" type="text" placeholder="Votre identifiant" value={username} onChange={e => setUsername(e.target.value)} required autoComplete="username" />
          </div>
          <div className="lx-field">
            <label className="lx-label">Mot de passe</label>
            <input className="lx-input" type="password" placeholder="••••••••" value={password} onChange={e => setPass(e.target.value)} required autoComplete="current-password" />
          </div>

          {error && <p className="lx-error">{error}</p>}

          <button type="submit" className="lx-btn" disabled={loading}>
            <span className="lx-btn-shimmer" />
            <span className="lx-btn-label">
              {loading
                ? <Loader2 size={18} className="spinner" />
                : mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
            </span>
          </button>
        </form>

        {/* Platforms */}
        <p className="lx-platforms">
          WhatsApp&nbsp;&nbsp;·&nbsp;&nbsp;Instagram&nbsp;&nbsp;·&nbsp;&nbsp;Telegram&nbsp;&nbsp;·&nbsp;&nbsp;Signal
        </p>
      </div>
    </div>
  );
}

// ─── Audio Recorder Hook ──────────────────────────────────────
function useAudioRecorder(onStop) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds]     = useState(0);
  const mediaRef = useRef(null);
  const timerRef = useRef(null);
  const chunksRef = useRef([]);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/ogg; codecs=opus' });
        onStop(blob);
        setSeconds(0);
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch (e) { alert('Microphone non accessible'); }
  };

  const stop = () => {
    clearInterval(timerRef.current);
    mediaRef.current?.stop();
    setRecording(false);
  };

  const cancel = () => {
    clearInterval(timerRef.current);
    if (mediaRef.current) {
      mediaRef.current.onstop = null;
      mediaRef.current.stop();
    }
    setRecording(false);
    setSeconds(0);
  };

  return { recording, seconds, start, stop, cancel };
}

// ─── Main App ─────────────────────────────────────────────────
export default function App() {
  const [user, setUser]           = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [view, setView]                   = useState('inbox');
  const [isMobile, setIsMobile]           = useState(window.innerWidth <= 768);
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts]           = useState([]);
  const [accounts, setAccounts]           = useState([]);
  const [selectedConv, setSelectedConv]   = useState(null);
  const [messages, setMessages]           = useState([]);
  const [newMessage, setNewMessage]       = useState('');
  const [searchQuery, setSearchQuery]     = useState('');
  const [loading, setLoading]             = useState(true);
  const [showAddModal, setShowAddModal]   = useState(false);
  const [previewImage, setPreviewImage]   = useState(null);
  const [sending, setSending]             = useState(false);

  // Pairing
  const [pairingStatus, setPairingStatus] = useState(null);
  const [pairingQR, setPairingQR]         = useState(null);
  const [pairingId, setPairingId]         = useState(null);

  const messagesEndRef = useRef(null);
  const fileInputRef   = useRef(null);

  // Audio recorder
  const recorder = useAudioRecorder(async (blob) => {
    await sendMediaBlob(blob, 'audio.ogg', 'audio/ogg');
  });

  // ── Check auth — avec retry pour les démarrages lents ──────────
  useEffect(() => {
    if (!getToken()) { setAuthReady(true); return; }

    const tryAuth = async (attempt = 1) => {
      try {
        const r = await axios.get(`${API}/auth/me`);
        setUser(r.data);
        setAuthReady(true);
      } catch (err) {
        // Si le serveur démarre encore (502/503/504), on réessaie jusqu'à 5 fois
        if (attempt < 5 && (!err.response || [502, 503, 504].includes(err.response.status))) {
          setTimeout(() => tryAuth(attempt + 1), 2000 * attempt);
        } else if (err.response?.status === 401) {
          // Token invalide (JWT_SECRET changé) → on efface proprement
          clearToken();
          setAuthReady(true);
        } else {
          setAuthReady(true);
        }
      }
    };

    tryAuth();
  }, []);

  // ── Resize ───────────────────────────────────────────────────
  useEffect(() => {
    const fn = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);

  // ── Polling data ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    preloadData();
    const id = setInterval(preloadData, 5000);
    return () => clearInterval(id);
  }, [user]);

  // ── Messages ─────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedConv) return;
    fetchMessages(selectedConv.id);
    const id = setInterval(() => fetchMessages(selectedConv.id), 3000);
    return () => clearInterval(id);
  }, [selectedConv]);

  // ── Pairing polling ───────────────────────────────────────────
  useEffect(() => {
    if (!pairingId || pairingStatus !== 'waiting_qr') return;
    const id = setInterval(checkPairingStatus, 2000);
    return () => clearInterval(id);
  }, [pairingId, pairingStatus]);

  // ── Auto scroll messages ───────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Auto-QR for existing WA account ───────────────────────────
  useEffect(() => {
    const waAcc = accounts.find(a => a.platform === 'whatsapp');
    if (waAcc && !pairingId) {
      axios.get(`${API}/connect/whatsapp/status/${waAcc.id}`).then(r => {
        if (r.data.qr && !pairingQR) {
          setPairingQR(r.data.qr); setPairingStatus('waiting_qr'); setPairingId(waAcc.id);
        }
      }).catch(() => {});
    }
  }, [accounts]);

  // ── Data loaders ─────────────────────────────────────────────
  const preloadData = async () => {
    try {
      const [c, ct, ac] = await Promise.all([
        axios.get(`${API}/conversations`),
        axios.get(`${API}/contacts`),
        axios.get(`${API}/accounts`)
      ]);
      // Ne mettre à jour que si on a des données réelles (évite de vider l'UI sur erreur transitoire)
      if (Array.isArray(c.data))  setConversations(c.data);
      if (Array.isArray(ct.data)) setContacts(ct.data);
      if (Array.isArray(ac.data)) setAccounts(ac.data);
    } catch (e) {
      // Ne pas vider les données si c'est une erreur réseau passagère
      if (e.response?.status !== 401) console.warn('[preload] Erreur transitoire, données conservées');
    } finally { setLoading(false); }
  };

  const fetchMessages = async (cid) => {
    try { const r = await axios.get(`${API}/messages/${cid}`); setMessages(r.data); } catch (e) {}
  };

  // ── Send text ─────────────────────────────────────────────────
  const sendText = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedConv || sending) return;
    const txt = newMessage; setNewMessage(''); setSending(true);
    try {
      await axios.post(`${API}/messages`, { conversationId: selectedConv.id, content: txt });
      fetchMessages(selectedConv.id);
    } catch (err) {
      setNewMessage(txt);
      if (err.response?.status === 503) alert('WhatsApp déconnecté. Scannez le QR code.');
    } finally { setSending(false); }
  };

  // ── Send media ────────────────────────────────────────────────
  const sendMediaBlob = async (blob, filename, mimetype) => {
    if (!selectedConv) return;
    setSending(true);
    try {
      const form = new FormData();
      form.append('file', blob, filename);
      form.append('conversationId', selectedConv.id);
      await axios.post(`${API}/messages/media`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
      fetchMessages(selectedConv.id);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur envoi média');
    } finally { setSending(false); }
  };

  const onFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    sendMediaBlob(file, file.name, file.type);
    e.target.value = '';
  };

  // ── Open contact conv ─────────────────────────────────────────
  const openContactConversation = async (contact) => {
    try {
      const { data: conv } = await axios.post(`${API}/conversations/ensure`, { contact_id: contact.id });
      await preloadData();
      setSelectedConv(conv); setView('inbox');
    } catch (e) { alert('Impossible d\'ouvrir la conversation.'); }
  };

  // ── Pairing ───────────────────────────────────────────────────
  const startWAPairing = async () => {
    setPairingStatus('initiating');
    try {
      const r = await axios.post(`${API}/connect/whatsapp`);
      setPairingId(r.data.accountId); setPairingStatus('waiting_qr');
    } catch (e) { setPairingStatus(null); }
  };

  const checkPairingStatus = async () => {
    if (!pairingId) return;
    try {
      const r = await axios.get(`${API}/connect/whatsapp/status/${pairingId}`);
      if (r.data.qr) setPairingQR(r.data.qr);
      if (r.data.status === 'connected') {
        setPairingStatus('connected'); setPairingId(null); setPairingQR(null);
        preloadData();
        setTimeout(() => { setPairingStatus(null); setShowAddModal(false); }, 2000);
      }
    } catch (e) {}
  };

  // ── Helpers ───────────────────────────────────────────────────
  const formatPhone = (phone) => {
    if (!phone) return '';
    if (phone.length > 13) return 'WhatsApp';
    if (phone.startsWith('33') && phone.length >= 11)
      return `+${phone.slice(0,2)} ${phone.slice(2,3)} ${phone.slice(3,5)} ${phone.slice(5,7)} ${phone.slice(7,9)} ${phone.slice(9,11)}`;
    return `+${phone}`;
  };

  const getDisplayName = (conv) => {
    const c = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
    return c?.display_name || conv.title || conv.external_id?.split('@')[0] || '…';
  };

  const getAvatar = (conv) => {
    const c = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
    return c?.avatar_url || null;
  };

  const filteredConvs = conversations.filter(c =>
    !c.metadata?.is_archived &&
    (c.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
     c.external_id?.includes(searchQuery))
  );
  const filteredContacts = contacts.filter(c =>
    c.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone_number?.includes(searchQuery)
  );

  const formatTime = (ts) => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const fmtSec = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  // ── Auth gate ─────────────────────────────────────────────────
  if (!authReady) return <div className="loading-screen"><Loader2 className="spinner" size={40} /></div>;
  if (!user) return <AuthScreen onAuth={(u) => { setUser(u); }} />;

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-content">
        <RefreshCw className="spinner" size={40} />
        <h1>LeRelais</h1><p>Chargement…</p>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="app-container">

      {/* NAV RAIL desktop */}
      {!isMobile && (
        <nav className="nav-rail">
          <div className="brand-icon" style={{ padding: '4px' }}>
            <img src={logoHub} alt="" style={{ width: '100%', height: '100%', borderRadius: '8px', objectFit: 'cover' }} />
          </div>
          <div className={`nav-item ${view==='inbox'?'active':''}`} onClick={()=>setView('inbox')}><MessageSquare size={20}/></div>
          <div className={`nav-item ${view==='contacts'?'active':''}`} onClick={()=>setView('contacts')}><Users size={20}/></div>
          <div className={`nav-item ${view==='settings'?'active':''}`} onClick={()=>setView('settings')}><Settings size={20}/></div>
          <button className="nav-add-btn" onClick={()=>setShowAddModal(true)}><Plus size={22}/></button>
          <div style={{marginTop:'auto',marginBottom:'12px'}} className="nav-item" onClick={async()=>{ await axios.post(`${API}/auth/logout`).catch(()=>{}); clearToken(); setUser(null); }} title="Déconnexion"><LogOut size={18}/></div>
        </nav>
      )}

      {/* LIST PANE */}
      <div className={`list-pane ${(selectedConv||(isMobile&&!['inbox','contacts','settings'].includes(view)))?'hidden':''}`}>
        <header className="pane-header">
          <h1>
            {view==='inbox'?'Messages':view==='contacts'?'Répertoire':'Paramètres'}
            <span className="badge">{view==='inbox'?filteredConvs.length:view==='contacts'?filteredContacts.length:''}</span>
          </h1>
          <div className="search-box"><Search size={15}/><input placeholder="Rechercher…" value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/></div>
        </header>

        <div className="scroll-area">
          {/* INBOX */}
          {view==='inbox' && filteredConvs.map(conv=>(
            <motion.div key={conv.id} className={`conv-card ${selectedConv?.id===conv.id?'active':''}`} onClick={()=>setSelectedConv(conv)}>
              <div className="avatar-wrap">
                {getAvatar(conv)?<img src={getAvatar(conv)} alt=""/>:conv.is_group?<div className="avatar-placeholder group"><Users size={18}/></div>:<span>{getDisplayName(conv).charAt(0)}</span>}
                <div className={`platform-dot ${conv.platform}`}/>
              </div>
              <div className="conv-content">
                <div className="conv-top">
                  <strong>{getDisplayName(conv)}</strong>
                  <span className="time">{formatTime(conv.last_message_at)}</span>
                </div>
                <p>{conv.last_message_preview||'Aucun message'}</p>
              </div>
            </motion.div>
          ))}

          {/* CONTACTS */}
          {view==='contacts' && filteredContacts.map(c=>(
            <div key={c.id} className="conv-card" onClick={()=>openContactConversation(c)}>
              <div className="avatar-wrap">
                {c.avatar_url?<img src={c.avatar_url} alt=""/>:<span>{c.display_name?.charAt(0)||'?'}</span>}
              </div>
              <div className="conv-content">
                <strong>{c.display_name}</strong>
                <p><Phone size={11}/> {formatPhone(c.phone_number||c.external_id?.split('@')[0])}</p>
              </div>
            </div>
          ))}

          {/* SETTINGS */}
          {view==='settings' && (
            <div className="settings-view">
              <div className="user-card">
                <div className="avatar-wrap"><span>{user.displayName?.charAt(0)||user.username?.charAt(0)}</span></div>
                <div><strong>{user.displayName}</strong><br/><small>{user.username}</small></div>
              </div>
              <div style={{height:'1px',background:'var(--border)',margin:'12px 0'}}/>
              <p style={{padding:'0 16px',color:'var(--dim-gray)',fontSize:'12px',textTransform:'uppercase',letterSpacing:'1px'}}>Comptes connectés</p>
              {accounts.map(acc=>(
                <div key={acc.id} className="account-card">
                  <div className={`platform-dot ${acc.platform}`} style={{position:'relative',border:'none'}}/>
                  <div className="acc-info"><strong>{acc.account_name}</strong><span className={`status-pill ${acc.status}`}>{acc.status}</span></div>
                  <button className="disconnect-btn" onClick={async()=>{ await axios.delete(`${API}/accounts/${acc.id}`); preloadData(); }}>Déconnecter</button>
                </div>
              ))}
              <div style={{padding:'16px'}}>
                <button className="auth-btn" style={{width:'100%',opacity:0.7}} onClick={async()=>{ await axios.post(`${API}/auth/logout`).catch(()=>{}); clearToken(); setUser(null); }}>
                  <LogOut size={16}/> Se déconnecter
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CHAT PANE */}
      <main className={`chat-pane ${!selectedConv&&isMobile?'hidden':''}`}>
        <AnimatePresence mode="wait">
          {selectedConv ? (
            <motion.div key={selectedConv.id} className="chat-content" initial={{opacity:0,x:20}} animate={{opacity:1,x:0}}>
              {/* Header */}
              <header className="chat-header">
                {isMobile && <button onClick={()=>setSelectedConv(null)} className="back-btn"><ArrowLeft size={20}/></button>}
                <div className="avatar-wrap small clickable" onClick={()=>{ const u=getAvatar(selectedConv); if(u) setPreviewImage(u); }}>
                  {getAvatar(selectedConv)?<img src={getAvatar(selectedConv)} alt=""/>:<span>{getDisplayName(selectedConv).charAt(0)}</span>}
                </div>
                <div className="header-info">
                  <h2>{getDisplayName(selectedConv)}</h2>
                  <span className="status">{formatPhone(selectedConv.external_id?.split('@')[0])}</span>
                </div>
                <div className="chat-actions">
                  <a href={`tel:${selectedConv.external_id?.split('@')[0]}`} className="action-btn"><Phone size={19}/></a>
                </div>
              </header>

              {/* Messages */}
              <div className="messages-area">
                {messages.length === 0 && (
                  <div style={{textAlign:'center',padding:'40px',color:'var(--dim-gray)'}}>Aucun message. Dites bonjour 👋</div>
                )}
                {messages.map(msg => (
                  <div key={msg.id} className={`msg-bubble ${msg.is_from_me?'me':'them'}`}>
                    {msg.media_url ? (
                      <div className="message-media">
                        {msg.media_type==='image' && <img src={msg.media_url} alt="photo" onClick={()=>setPreviewImage(msg.media_url)} style={{maxWidth:'220px',borderRadius:'10px',cursor:'pointer',display:'block'}}/>}
                        {msg.media_type==='video' && <video src={msg.media_url} controls style={{maxWidth:'220px',borderRadius:'10px'}}/>}
                        {msg.media_type==='audio' && <audio src={msg.media_url} controls style={{width:'200px'}}/>}
                        {msg.media_type==='document' && <a href={msg.media_url} target="_blank" rel="noreferrer" className="file-link">📄 {msg.content||'Fichier'}</a>}
                      </div>
                    ) : msg.media_type ? (
                      <div className="media-placeholder">
                        {msg.media_type==='image'?'📷':msg.media_type==='audio'?'🎵':msg.media_type==='video'?'🎬':'📄'}
                        <span> {msg.content||msg.media_type}</span>
                      </div>
                    ) : null}
                    {msg.content && !msg.media_url && msg.media_type !== 'audio' && <span>{msg.content}</span>}
                    <div className="msg-time">
                      {formatTime(msg.timestamp)}
                      {msg.is_from_me && <span style={{marginLeft:'4px'}}>{msg.status==='read'?'✓✓':msg.status==='delivered'?'✓✓':'✓'}</span>}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef}/>
              </div>

              {/* Footer — saisie + médias */}
              <footer className="chat-footer">
                <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx" style={{display:'none'}} onChange={onFileSelect}/>

                {recorder.recording ? (
                  <div className="recording-bar">
                    <button onClick={recorder.cancel} className="rec-btn cancel"><X size={18}/></button>
                    <div className="rec-pulse"/>
                    <span className="rec-time">{fmtSec(recorder.seconds)}</span>
                    <button onClick={recorder.stop} className="rec-btn send"><Send size={18}/></button>
                  </div>
                ) : (
                  <form className="input-group" onSubmit={sendText}>
                    <button type="button" className="media-btn" onClick={()=>fileInputRef.current?.click()} title="Joindre un fichier">
                      <Paperclip size={18}/>
                    </button>
                    <input
                      type="text"
                      placeholder="Écrire un message…"
                      value={newMessage}
                      onChange={e=>setNewMessage(e.target.value)}
                      autoFocus
                    />
                    {newMessage.trim() ? (
                      <button type="submit" className="send-btn" disabled={sending}>
                        {sending?<Loader2 className="spinner" size={16}/>:<Send size={16}/>}
                      </button>
                    ) : (
                      <button type="button" className="send-btn" onMouseDown={e=>{e.preventDefault();recorder.start();}} title="Maintenir pour enregistrer">
                        <Mic size={16}/>
                      </button>
                    )}
                  </form>
                )}
              </footer>
            </motion.div>
          ) : !isMobile && (
            <div className="placeholder-view">
              <MessageSquare size={48} color="var(--dim-gray)"/>
              <h2>LeRelais Hub</h2>
              <p>Sélectionnez une conversation pour commencer</p>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Preview image */}
      {previewImage && (
        <div className="modal-overlay" onClick={()=>setPreviewImage(null)}>
          <img src={previewImage} className="full-preview" alt=""/>
        </div>
      )}

      {/* Mobile nav */}
      {isMobile && !selectedConv && (
        <nav className="mobile-nav">
          <div className={`mob-item ${view==='inbox'?'active':''}`} onClick={()=>setView('inbox')}><MessageSquare size={22}/></div>
          <div className={`mob-item ${view==='contacts'?'active':''}`} onClick={()=>setView('contacts')}><Users size={22}/></div>
          <div className="mob-add-wrap"><button className="mob-add-btn" onClick={()=>setShowAddModal(true)}><Plus size={26}/></button></div>
          <div className={`mob-item ${view==='settings'?'active':''}`} onClick={()=>setView('settings')}><Settings size={22}/></div>
          <div className="mob-item" onClick={preloadData}><RefreshCw size={22}/></div>
        </nav>
      )}

      {/* Modal connexion plateforme */}
      {showAddModal && (
        <div className="modal-overlay" onClick={()=>!pairingStatus&&setShowAddModal(false)}>
          <motion.div className="elite-modal" initial={{scale:.9,opacity:0}} animate={{scale:1,opacity:1}} onClick={e=>e.stopPropagation()}>
            {!pairingStatus && <button className="modal-close" onClick={()=>setShowAddModal(false)}><X size={18}/></button>}

            {pairingStatus ? (
              <div className="pairing-view">
                <h2>{pairingStatus==='connected'?'✅ Connecté !':pairingStatus==='waiting_lock'?'🛡️ Sécurisation…':'Scanner le QR Code'}</h2>
                <p>{pairingStatus==='waiting_lock'?'Initialisation en cours…':'WhatsApp → Appareils connectés'}</p>
                <div className="qr-container">
                  {pairingQR?<div className="qr-box"><QRCode value={pairingQR} size={210}/></div>:<Loader2 className="spinner" size={36}/>}
                </div>
                {pairingStatus!=='connected'&&<button className="cancel-pairing" onClick={()=>{setPairingStatus(null);setPairingId(null);setPairingQR(null);}}>Annuler</button>}
              </div>
            ) : (
              <div className="platform-list">
                <h3 style={{margin:'0 0 16px',color:'var(--white)'}}>Connecter une messagerie</h3>
                <div className="platform-item" onClick={startWAPairing}>
                  <div className="platform-dot whatsapp"/>
                  <div><strong>WhatsApp</strong><br/><small style={{color:'var(--dim-gray)'}}>Via QR code</small></div>
                </div>
                <div className="platform-item coming-soon">
                  <div className="platform-dot instagram"/>
                  <div><strong>Instagram</strong><br/><small style={{color:'var(--dim-gray)'}}>Bientôt disponible</small></div>
                </div>
                <div className="platform-item coming-soon">
                  <div className="platform-dot" style={{background:'#3a76f0'}}/>
                  <div><strong>Telegram</strong><br/><small style={{color:'var(--dim-gray)'}}>Bientôt disponible</small></div>
                </div>
                <div className="platform-item coming-soon">
                  <div className="platform-dot" style={{background:'#3b7dd8'}}/>
                  <div><strong>Signal</strong><br/><small style={{color:'var(--dim-gray)'}}>Bientôt disponible</small></div>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}
