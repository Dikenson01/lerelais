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
  if (err.response?.status === 401) { clearToken(); window.location.reload(); }
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
  const fileInputRef = useRef(null);

  // ── Auth Init ───────────────────────────────────────────────
  useEffect(() => {
    const t = getToken();
    if (!t) { setAuthReady(true); return; }
    axios.get(`${API}/auth/me`).then(r => { setUser(r.data); setAuthReady(true); }).catch(() => { clearToken(); setAuthReady(true); });
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
        axios.get(`${API}/accounts`)
      ]);
      setConversations(c.data);
      setContacts(ct.data);
      setAccounts(ac.data);
    } catch (e) {} finally { setLoading(false); }
  }, []);

  useEffect(() => { if (user) { preloadData(); const id = setInterval(preloadData, 5000); return () => clearInterval(id); } }, [user, preloadData]);

  // ── Message Polling ────────────────────────────────────────
  const fetchMessages = useCallback(async (cid) => {
    try { const r = await axios.get(`${API}/messages/${cid}`); setMessages(r.data); } catch (e) {}
  }, []);

  useEffect(() => {
    if (!selectedConv) return;
    fetchMessages(selectedConv.id);
    const id = setInterval(() => fetchMessages(selectedConv.id), 3000);
    return () => clearInterval(id);
  }, [selectedConv, fetchMessages]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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
      return new Date(b.last_message_at) - new Date(a.last_message_at);
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

  const getDisplayName = (conv) => {
    const c = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
    return c?.display_name || conv.title || conv.external_id?.split('@')[0] || 'Inconnu';
  };

  // Resolve sender ID to display name using contacts list
  const resolveContactName = useCallback((senderId) => {
    if (!senderId) return 'Inconnu';
    const contact = contacts.find(c => c.external_id === senderId);
    if (contact?.display_name) return contact.display_name;
    // Fallback: extract phone number from JID
    const phone = senderId.split('@')[0];
    if (phone && phone.length > 5) return `+${phone}`;
    return senderId;
  }, [contacts]);

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
           <h1>{view==='archive'?'Archives':view==='contacts'?'Contacts':'Messages'} <span className="badge">{sortedConvs.length}</span></h1>
           <div className="search-box"><Search size={16} color="var(--text-dim)"/><input placeholder="Rechercher..." value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}/></div>
        </header>

        <div className="scroll-area">
           {sortedConvs.map(conv => (
             <div key={conv.id} className={`conv-card ${selectedConv?.id===conv.id?'active':''}`} onClick={()=>setSelectedConv(conv)}>
                <div className="avatar-wrap">
                  {getAvatar(conv) ? (
                    <img 
                      src={getAvatar(conv)} 
                      alt="" 
                      onError={(e) => e.target.style.display = 'none'} 
                    />
                  ) : null}
                  <div className="avatar-placeholder"/>
                  <div className="platform-dot whatsapp"/>
                </div>
                <div className="conv-content">
                  <div className="conv-top">
                    <strong>{getDisplayName(conv)} {conv.metadata?.is_pinned && <Pin size={10} style={{marginLeft:4, color:'var(--accent-gold)'}}/>}</strong>
                    <span className="time">{conv.last_message_at ? new Date(conv.last_message_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : ''}</span>
                  </div>
                  <p>{conv.last_message_preview || 'Aucun message'}</p>
                </div>
             </div>
           ))}
        </div>
      </div>

      {/* CHAT PANE */}
      <main className={`chat-pane ${!selectedConv && isMobile ? 'hidden' : ''}`}>
        {selectedConv ? (
          <div className="chat-content" style={{display:'flex', flexDirection:'column', height:'100%'}}>
            <header className="chat-header">
              {isMobile && <button onClick={()=>setSelectedConv(null)}><ArrowLeft/></button>}
              <div className="avatar-wrap" style={{width:40, height:40}}>
                {getAvatar(selectedConv) ? (
                  <img src={getAvatar(selectedConv)} alt="" onError={(e) => e.target.style.display = 'none'} />
                ) : null}
                <div className="avatar-placeholder" />
              </div>
              <div className="header-info">
                <h2>{getDisplayName(selectedConv)}</h2>
                <span className="status">WhatsApp • {selectedConv.is_group && selectedConv.group_metadata?.participants ? `${selectedConv.group_metadata.participants.length} participants` : 'En ligne'}</span>
              </div>
              <div style={{marginLeft:'auto', display:'flex', gap:'12px'}}>
                <button className="nav-item" style={{width:36, height:36}}><Phone size={18}/></button>
                <button className="nav-item" style={{width:36, height:36}}><MoreVertical size={18}/></button>
              </div>
            </header>

            <div className="messages-area">
              {messages.map(msg => (
                <div key={msg.id} className={`msg-bubble ${msg.is_from_me?'me':'them'}`}>
                  {/* Sender name for group chats */}
                  {selectedConv?.is_group && !msg.is_from_me && (
                    <div className="msg-sender">{msg.metadata?.pushName || resolveContactName(msg.sender_id)}</div>
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
        <div className="modal-overlay" onClick={()=>setShowAddModal(false)}>
          <div className="elite-modal" onClick={e=>e.stopPropagation()}>
            {pairingStatus === 'waiting_qr' ? (
              <div style={{textAlign:'center'}}>
                <h2 style={{marginBottom:10}}>Scanner le QR Code</h2>
                <p style={{color:'var(--text-dim)', marginBottom:20}}>WhatsApp > Appareils connectés</p>
                <div style={{background:'white', padding:20, borderRadius:20, display:'inline-block'}}>
                  {pairingQR ? <QRCode value={pairingQR} size={200}/> : <Loader2 className="spinner" size={40}/>}
                </div>
                {pairingStatus === 'connected' && <p style={{marginTop:20, color:'var(--accent-green)'}}>✅ Connecté !</p>}
              </div>
            ) : (
              <div>
                <h2 style={{marginBottom:20}}>Connecter un compte</h2>
                <div className="conv-card" style={{background:'var(--surface-200)', border:'1px solid var(--border-muted)'}} onClick={startWAPairing}>
                   <div className="platform-dot whatsapp" style={{position:'static'}}/>
                   <div className="conv-content"><strong>WhatsApp</strong><br/><small>Synchronisation miroir</small></div>
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
    </div>
  );
}
