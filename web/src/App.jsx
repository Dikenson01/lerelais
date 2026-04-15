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

  const messagesEndRef = useRef(null);
  const messagesAreaRef = useRef(null);
  const fileInputRef = useRef(null);
  const isAtBottomRef = useRef(true); // Track if user is scrolled to bottom
  const [callingContact, setCallingContact] = useState(null);

  // ── Auth Init ───────────────────────────────────────────────
  useEffect(() => {
    const t = getToken();
    if (!t) { setAuthReady(true); return; }
    axios.get(`${API}/auth/me`).then(r => { setUser(r.data); setAuthReady(true); }).catch((err) => { 
      if (err.response?.status !== 401) { /* log error */ }
      clearToken(); setAuthReady(true); 
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
    setPairingStatus('waiting_qr');
    try {
      const r = await axios.post(`${API}/connect/whatsapp`);
      setPairingId(r.data.accountId);
    } catch (e) { setPairingStatus(null); }
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
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return c.title?.toLowerCase().includes(q) || c.external_id?.includes(q);
    });
  }, [conversations, view, searchQuery]);

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
      if (dn.includes('@s.whatsapp.net')) return formatName(contact?.phone_number || dn);
      // For @lid raw IDs, show the number but the backend will resolve the real name soon
      const clean = dn.replace(/[+\s-@lid]/g, '');
      if (/^\d{12,}$/.test(clean) && !dn.includes('@')) {
        // Pure numeric ID without @lid — legacy data, show as-is (will be fixed by cleanup job)
        return contact?.phone_number ? formatName(contact.phone_number) : dn;
      }
      // It's a real name or formatted phone number
      return formatName(dn);
    }
    // Fallback: phone_number or external_id
    if (contact?.phone_number) return formatName(contact.phone_number);
    if (contact?.external_id) return formatName(contact.external_id);
    return 'Inconnu';
  };

  const getDisplayName = (conv) => {
    const c = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
    if (c?.display_name) {
       const dn = c.display_name;
       // Skip raw JIDs (legacy bad data)
       if (dn.includes('@s.whatsapp.net') || dn.includes('@lid')) {
         return conv.title ? formatName(conv.title) : formatName(conv.external_id);
       }
       const cleanDn = dn.replace(/[+\s-]/g, '');
       // If display_name is a 12+ digit pure number (stored as ID fallback) — use title instead
       if (/^\d{12,}$/.test(cleanDn) && c.phone_number) return formatName(c.phone_number);
       if (dn && dn !== 'null') return dn; // Real name
    }
    // Fallback: conv title (can be a name or a phone number)
    return conv.title ? formatName(conv.title) : formatName(conv.external_id);
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
    if (phone) {
      // Redirect to WhatsApp calling if possible, or just wa.me
      window.open(`https://wa.me/${phone}`, '_blank');
      setCallingContact({ name: getDisplayName(conv), phone, avatar: getAvatar(conv) });
    }
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
          <button className={`nav-item ${view==='inbox'?'active':''}`} onClick={()=>setView('inbox')} title="Messages"><MessageSquare size={22}/></button>
          <button className={`nav-item ${view==='archive'?'active':''}`} onClick={()=>setView('archive')} title="Archives"><Archive size={22}/></button>
          <button className={`nav-item ${view==='contacts'?'active':''}`} onClick={()=>setView('contacts')} title="Contacts"><Users size={22}/></button>
          <button className={`nav-item ${view==='settings'?'active':''}`} onClick={()=>setView('settings')} title="Paramètres"><Settings size={22}/></button>
          <div style={{marginTop:'auto'}}>
             <button className="nav-item" onClick={()=>setShowAddModal(true)} title="Ajouter un compte"><Plus size={22}/></button>
             <button className="nav-item" onClick={()=>{clearToken();setUser(null)}} title="Sortir"><LogOut size={20}/></button>
          </div>
        </nav>
      )}

      {/* LIST PANE */}
      <div className={`list-pane ${selectedConv && isMobile ? 'hidden' : ''}`}>
        <header className="pane-header">
           <h1>{view==='archive'?'Archives':view==='contacts'?'Contacts':view==='settings'?'Paramètres':'Messages'} <span className="badge">
             {view==='contacts' ? contacts.length : view==='settings' ? accounts.length : sortedConvs.length}
           </span></h1>
           <div className="search-box"><Search size={16} color="var(--text-dim)"/><input placeholder="Rechercher..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/></div>
        </header>

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
               <div key={contact.id} className="conv-card" onClick={() => {
                 const existing = conversations.find(cv => cv.contact_id === contact.id);
                 if (existing) { setSelectedConv(existing); setView('inbox'); }
                 else { setView('inbox'); }
               }}>
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
             <div style={{padding:'0 24px'}}>
               <p style={{color:'var(--text-dim)', fontSize:'12px', marginBottom:'12px'}}>Comptes connectés</p>
               {accounts.length === 0 && (
                 <p style={{color:'var(--text-dim)', fontSize:'13px', marginBottom:'16px', textAlign:'center', padding:'20px 0'}}>Aucun compte connecté</p>
               )}
               {accounts.map(acc => {
                 const isConnected = acc.status === 'connected';
                 const statusColor = isConnected ? 'var(--accent-green)' : acc.status === 'pairing' ? 'var(--accent-gold)' : 'var(--accent-red)';
                 const statusLabel = isConnected ? '● Connecté' : acc.status === 'pairing' ? '◌ En cours...' : '○ Déconnecté';
                 return (
                 <div key={acc.id} className="conv-card" style={{background:'var(--surface-200)', marginBottom:'10px', border:'1px solid var(--border-muted)'}}>
                    <div style={{width:36,height:36,borderRadius:'50%',background:'#25D366',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.824L.057 23.882l6.233-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-1.961 0-3.79-.527-5.364-1.446l-.384-.228-3.984 1.045 1.063-3.878-.25-.398A9.796 9.796 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/></svg>
                    </div>
                    <div className="conv-content">
                      <strong>{acc.account_name || 'Mon WhatsApp'}</strong>
                      <p style={{color: statusColor, fontSize:'12px'}}>{statusLabel}</p>
                    </div>
                 </div>
                 );
               })}
               <button className="lx-btn" style={{marginTop:'12px', marginBottom:'8px'}} onClick={()=>setShowAddModal(true)}>
                 + Connecter un compte
               </button>
               <button className="lx-btn" style={{background:'var(--accent-red)', color:'white'}} onClick={()=>{clearToken();setUser(null)}}>
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
              {messages.map(msg => (
                <div key={msg.id} className={`msg-bubble ${msg.is_from_me?'me':'them'}`}>
                  {/* Sender name for group chats */}
                  {selectedConv?.is_group && !msg.is_from_me && (
                    <div className="msg-sender">{msg.metadata?.pushName || resolveContactName(msg.sender_id, msg.metadata?.participant)}</div>
                  )}
                  {msg.metadata?.quoted && (
                    <div className="quoted-box">
                      <strong>{msg.metadata.quoted.sender?.split('@')[0]}</strong>
                      <p>{msg.metadata.quoted.content}</p>
                    </div>
                  )}
                  {msg.media_url ? (
                    <img 
                      src={msg.media_url} 
                      alt={msg.media_type || 'media'}
                      className="msg-media"
                      onError={(e) => { e.target.style.display = 'none'; }}
                      onClick={() => window.open(msg.media_url, '_blank')}
                    />
                  ) : null}
                  {msg.content && !msg.content.startsWith('[') ? <span>{msg.content}</span> : null}
                  {!msg.media_url && msg.media_type ? (
                    <span style={{opacity:0.65, fontStyle:'italic'}}>
                      {{'image':'📷 Photo', 'video':'🎬 Vidéo', 'audio':'🎵 Audio', 'document':'📄 Document', 'sticker':'🎭 Sticker'}[msg.media_type] || '📎 Média'}
                    </span>
                  ) : null}
                  {(msg.media_url && msg.content && !msg.content.startsWith('[')) ? <span className="media-caption">{msg.content}</span> : null}
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
              ))}
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
        <div className="modal-overlay" onClick={()=>{setShowAddModal(false);setPairingStatus(null);setPairingQR(null);}}>
          <div className="elite-modal" onClick={e=>e.stopPropagation()}>
            {pairingStatus === 'waiting_qr' ? (
              <div style={{textAlign:'center'}}>
                <h2 style={{marginBottom:10}}>Scanner le QR Code</h2>
                <p style={{color:'var(--text-dim)', marginBottom:20}}>WhatsApp {'>'} Appareils connectés {'>'} Lier un appareil</p>
                <div style={{background:'white', padding:20, borderRadius:20, display:'inline-block'}}>
                  {pairingQR ? <QRCode value={pairingQR} size={200}/> : <Loader2 className="spinner" size={40}/>}
                </div>
                {pairingStatus === 'connected' && <p style={{marginTop:20, color:'var(--accent-green)'}}>✅ Connecté !</p>}
                <p style={{marginTop:12, color:'var(--text-dim)', fontSize:12}}>Le QR code expire dans 60s — rafraîchissez si besoin</p>
              </div>
            ) : (
              <div>
                <h2 style={{marginBottom:6}}>Connecter un compte</h2>
                <p style={{color:'var(--text-dim)', fontSize:13, marginBottom:20}}>Choisissez le réseau à connecter</p>

                {/* WhatsApp — compte principal ou supplémentaire */}
                <div className="conv-card" style={{background:'var(--surface-200)', border:'1px solid var(--border-muted)', marginBottom:10}} onClick={startWAPairing}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'#25D366',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.103 1.523 5.824L.057 23.882l6.233-1.635A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-1.961 0-3.79-.527-5.364-1.446l-.384-.228-3.984 1.045 1.063-3.878-.25-.398A9.796 9.796 0 012.182 12C2.182 6.57 6.57 2.182 12 2.182S21.818 6.57 21.818 12 17.43 21.818 12 21.818z"/></svg>
                  </div>
                  <div className="conv-content">
                    <strong>WhatsApp</strong>
                    <small style={{color:'var(--text-dim)'}}>Synchronisation miroir · scan QR</small>
                  </div>
                </div>

                {/* Instagram — à venir */}
                <div className="conv-card" style={{background:'var(--surface-100)', border:'1px dashed var(--border-muted)', marginBottom:10, opacity:0.5, cursor:'not-allowed'}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                  </div>
                  <div className="conv-content">
                    <strong>Instagram</strong>
                    <small style={{color:'var(--text-dim)'}}>Bientôt disponible</small>
                  </div>
                </div>

                {/* Telegram — à venir */}
                <div className="conv-card" style={{background:'var(--surface-100)', border:'1px dashed var(--border-muted)', opacity:0.5, cursor:'not-allowed'}}>
                  <div style={{width:36,height:36,borderRadius:'50%',background:'#229ED9',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                  </div>
                  <div className="conv-content">
                    <strong>Telegram</strong>
                    <small style={{color:'var(--text-dim)'}}>Bientôt disponible</small>
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

      {/* CALLING MODAL */}
      <AnimatePresence>
        {callingContact && (
          <motion.div 
            className="modal-overlay" 
            initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            style={{zIndex:2000, background:'rgba(0,0,0,0.85)', backdropFilter:'blur(20px)'}}
          >
            <motion.div 
              className="calling-card"
              initial={{scale:0.9, y:20}} animate={{scale:1, y:0}} exit={{scale:0.9, y:20}}
            >
              <div className="pulse-container">
                <div className="pulse-ring"/>
                <div className="pulse-ring" style={{animationDelay:'1s'}}/>
                <div className="pulse-avatar">
                   {callingContact.avatar ? <img src={callingContact.avatar} alt=""/> : <User size={48}/>}
                </div>
              </div>
              <h2 style={{marginTop:30, fontSize:28}}>{callingContact.name}</h2>
              <p style={{color:'var(--accent-green)', fontWeight:600, letterSpacing:1.5, marginTop:10}}>APPEL EN COURS...</p>
              <p style={{marginTop:40, color:'var(--text-dim)'}}>+{callingContact.phone}</p>
              
              <button className="hangup-btn" onClick={() => setCallingContact(null)}>
                <X size={32}/>
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
