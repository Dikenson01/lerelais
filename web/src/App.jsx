import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageSquare, 
  Users, 
  Search, 
  Settings, 
  Send, 
  Instagram,
  Smartphone,
  LayoutGrid,
  Plus,
  Activity,
  ChevronLeft,
  X,
  Loader2
} from 'lucide-react';
import './App.css';

const API_BASE = window.location.hostname === 'localhost' 
  ? `http://localhost:3000/api` 
  : '/api';

function App() {
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState('all'); // all, contacts, whatsapp, instagram, settings
  const [messageInput, setMessageInput] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [connectStep, setConnectStep] = useState('select');
  const [waQr, setWaQr] = useState(null);
  const [waAccountId, setWaAccountId] = useState(null);
  const [igData, setIgData] = useState({ username: '', password: '' });
  const [selectedContact, setSelectedContact] = useState(null);
  const messagesEndRef = useRef(null);

  // Responsive handle
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Sync Timer & Platform Setup
  useEffect(() => {
    if (window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
    }
    preloadData().finally(() => setLoading(false));
    const interval = setInterval(preloadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const preloadData = async () => {
    try {
      const [convs, conts, accs] = await Promise.all([
        axios.get(`${API_BASE}/conversations`),
        axios.get(`${API_BASE}/contacts`),
        axios.get(`${API_BASE}/accounts`)
      ]);
      setConversations(convs.data || []);
      setContacts(conts.data || []);
      setAccounts(accs.data || []);
    } catch (err) { 
      console.error('Sync error:', err);
    }
  };

  useEffect(() => {
    if (activeConv) {
      fetchMessages(activeConv.id);
      const interval = setInterval(() => fetchMessages(activeConv.id), 3000);
      return () => clearInterval(interval);
    }
  }, [activeConv]);

  const fetchMessages = async (id) => {
    try {
      const res = await axios.get(`${API_BASE}/messages/${id}`);
      setMessages(res.data || []);
    } catch (err) { console.error(err); }
  };

  const sendMessage = async () => {
    if (!messageInput.trim() || !activeConv) return;
    const content = messageInput;
    setMessageInput('');
    try {
      await axios.post(`${API_BASE}/messages`, { conversationId: activeConv.id, content });
      fetchMessages(activeConv.id);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startWhatsAppConnect = async () => {
    setConnectStep('whatsapp_qr');
    try {
      const res = await axios.post(`${API_BASE}/connect/whatsapp`);
      setWaAccountId(res.data.accountId);
    } catch (err) { alert('Erreur WA'); }
  };

  useEffect(() => {
    let interval;
    if (waAccountId && connectStep === 'whatsapp_qr') {
      interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API_BASE}/connect/whatsapp/status/${waAccountId}`);
          if (res.data.status === 'connected') {
            setShowConnect(false);
            preloadData();
            clearInterval(interval);
          } else {
            setWaQr(res.data.qr);
          }
        } catch (e) {}
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [waAccountId, connectStep]);

  const disconnectAccount = async (id) => {
    if (!confirm('Déconnecter ?')) return;
    await axios.delete(`${API_BASE}/accounts/${id}`);
    preloadData();
  };

  const filteredConvs = (conversations || []).filter(c => {
    const title = (c.title || c.contacts?.display_name || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return title.includes(query) && (view === 'all' || c.platform === view);
  });

  const filteredContacts = (contacts || []).filter(c =>
    (c.display_name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="loading-screen">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="loading-content"
        >
          <Loader2 className="spinner" size={40} />
          <h1>LeRelais Hub</h1>
          <p>Initialisation de votre interface unifiée...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar / Navigation Rail */}
      <nav className="nav-rail">
        <div className="nav-top">
          <div className="brand-icon"><Activity size={24} /></div>
          <div className={`nav-item ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}><LayoutGrid size={22} /></div>
          <div className={`nav-item ${view === 'whatsapp' ? 'active' : ''}`} onClick={() => setView('whatsapp')}><Smartphone size={22} /></div>
          <div className={`nav-item ${view === 'instagram' ? 'active' : ''}`} onClick={() => setView('instagram')}><Instagram size={22} /></div>
          <div className={`nav-item ${view === 'contacts' ? 'active' : ''}`} onClick={() => setView('contacts')}><Users size={22} /></div>
          <div className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}><Settings size={22} /></div>
        </div>
        <button className="nav-add-btn" onClick={() => { setShowConnect(true); setConnectStep('select'); }}>
          <Plus size={24} />
        </button>
      </nav>

      {/* List Area */}
      <div className={`list-pane ${activeConv && isMobile ? 'hidden' : ''}`}>
        <header className="pane-header">
          <h1>
            {view === 'contacts' ? 'Carnet' : (view === 'settings' ? 'Profil' : 'Messages')}
            <span className="badge">{view === 'contacts' ? contacts.length : filteredConvs.length}</span>
          </h1>
          <div className="search-box">
            <Search size={16} />
            <input 
              placeholder="Rechercher partout..." 
              value={searchQuery} 
              onChange={e => setSearchQuery(e.target.value)} 
            />
          </div>
        </header>

        <div className="scroll-area">
          <AnimatePresence mode="popLayout">
            {view === 'contacts' ? (
              filteredContacts.map((c, i) => (
                <motion.div 
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  key={c.id} 
                  className="conv-card" 
                  onClick={() => setSelectedContact(c)}
                >
                  <div className="avatar-wrap">
                    {c.avatar_url ? <img src={c.avatar_url} alt="" /> : (c.display_name?.[0] || '?')}
                  </div>
                  <div className="conv-content">
                    <strong>{c.display_name}</strong>
                    <p>{c.external_id?.split('@')[0]}</p>
                  </div>
                </motion.div>
              ))
            ) : view === 'settings' ? (
              <div className="settings-view">
                <section>
                  <h3>Comptes connectés</h3>
                  {accounts.map(acc => (
                    <div key={acc.id} className="account-card">
                      <div className="avatar-wrap small">
                        {acc.platform === 'whatsapp' ? <Smartphone size={18} /> : <Instagram size={18} />}
                      </div>
                      <div className="acc-info">
                        <strong>{acc.account_name || acc.platform}</strong>
                        <span className={`status-pill ${acc.status}`}>{acc.status}</span>
                      </div>
                      <button className="disconnect-btn" onClick={() => disconnectAccount(acc.id)}>Détacher</button>
                    </div>
                  ))}
                  {accounts.length === 0 && <p className="empty-text">Aucun compte actif.</p>}
                </section>
                <button className="btn-secondary w-full" onClick={() => axios.post(`${API_BASE}/sync/all`)}>
                  Synchroniser Tout
                </button>
              </div>
            ) : (
              filteredConvs.map((c, i) => (
                <motion.div 
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  key={c.id} 
                  className={`conv-card ${activeConv?.id === c.id ? 'active' : ''}`}
                  onClick={() => setActiveConv(c)}
                >
                  <div className="avatar-wrap">
                    {c.contacts?.avatar_url ? <img src={c.contacts.avatar_url} alt="" /> : (c.title?.[0] || '?')}
                    <div className={`platform-dot ${c.platform}`} />
                  </div>
                  <div className="conv-content">
                    <div className="conv-top">
                      <strong>{c.title || c.contacts?.display_name || 'Inconnu'}</strong>
                      <span className="time">{new Date(c.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p>{c.last_message_preview || 'Aucun message récent'}</p>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>

          {filteredConvs.length === 0 && view !== 'contacts' && view !== 'settings' && (
            <div className="empty-state">
              <MessageSquare size={32} />
              <h3>Boite vide</h3>
              <p>Connectez un compte pour voir vos messages.</p>
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <main className={`chat-pane ${!activeConv && isMobile ? 'hidden' : ''}`}>
        {activeConv ? (
          <div className="chat-content">
            <header className="chat-header">
              {isMobile && <button className="back-btn" onClick={() => setActiveConv(null)}><ChevronLeft /></button>}
              <div className="header-info">
                <h2>{activeConv.title || activeConv.contacts?.display_name}</h2>
                <span className="status">Actif en ce moment</span>
              </div>
            </header>
            
            <div className="messages-area">
              <AnimatePresence initial={false}>
                {messages.map((m) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    key={m.id} 
                    className={`msg-bubble ${m.is_from_me ? 'me' : 'them'}`}
                  >
                    {m.content}
                  </motion.div>
                ))}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            <footer className="chat-footer">
              <form className="input-group" onSubmit={e => { e.preventDefault(); sendMessage(); }}>
                <input 
                  placeholder="Écrire un message..." 
                  value={messageInput} 
                  onChange={e => setMessageInput(e.target.value)} 
                />
                <button type="submit" className="send-btn" disabled={!messageInput.trim()}>
                  <Send size={18} />
                </button>
              </form>
            </footer>
          </div>
        ) : (
          <div className="placeholder-view">
            <div className="hero-logo"><LayoutGrid size={64} /></div>
            <h2>Sélectionnez une discussion</h2>
            <p>Tous vos canaux WhatsApp et Instagram réunis ici.</p>
          </div>
        )}
      </main>

      {/* Modals */}
      <AnimatePresence>
        {showConnect && (
          <div className="modal-overlay" onClick={() => setShowConnect(false)}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="elite-modal" 
              onClick={e => e.stopPropagation()}
            >
              <button className="modal-close" onClick={() => setShowConnect(false)}><X size={20} /></button>
              
              {connectStep === 'select' ? (
                <div className="step-content">
                  <h2>Nouveau Compte</h2>
                  <p>Choisissez la plateforme à unifier.</p>
                  <div className="platform-list">
                    <div className="platform-item wa" onClick={startWhatsAppConnect}>
                      <Smartphone /> <strong>WhatsApp Business</strong>
                    </div>
                    <div className="platform-item ig" onClick={() => setConnectStep('ig_login')}>
                      <Instagram /> <strong>Instagram Direct</strong>
                    </div>
                  </div>
                </div>
              ) : connectStep === 'whatsapp_qr' ? (
                <div className="step-content qr-view">
                  <h2>WhatsApp Pairing</h2>
                  <div className="qr-container">
                    {waQr ? (
                      <img src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(waQr)}`} alt="QR" />
                    ) : (
                      <Loader2 className="spinner" />
                    )}
                  </div>
                  <p>Ouvrez WhatsApp sur votre mobile et scannez le code.</p>
                </div>
              ) : null}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
