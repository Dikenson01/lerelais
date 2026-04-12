import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MessageSquare, 
  Users, 
  Search, 
  Settings, 
  Send, 
  Paperclip,
  MoreVertical,
  Instagram,
  Smartphone,
  CheckCheck,
  LayoutGrid,
  Hash,
  Activity,
  Plus,
  User
} from 'lucide-react';
import './App.css';

const API_BASE = window.location.hostname === 'localhost' 
  ? `http://localhost:3000/api` 
  : '/api';

function App() {
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState('all');
  const [tgUser, setTgUser] = useState(null);
  const [messageInput, setMessageInput] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showChat, setShowChat] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [connectStep, setConnectStep] = useState('select');
  const [waQr, setWaQr] = useState(null);
  const [waAccountId, setWaAccountId] = useState(null);
  const [igData, setIgData] = useState({ username: '', password: '' });
  const [accounts, setAccounts] = useState([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    if (window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
      setTgUser(tg.initDataUnsafe?.user);
      tg.setHeaderColor('#0F1011');
      tg.setBackgroundColor('#08090A');
    }
    fetchConversations();
    fetchContacts();
    fetchAccountsList();
    const interval = setInterval(() => {
      fetchConversations();
      fetchContacts();
      fetchAccountsList();
    }, 5000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const fetchConversations = async () => {
    try {
      const res = await axios.get(`${API_BASE}/conversations`);
      setConversations(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchContacts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/contacts`);
      setContacts(res.data);
    } catch (err) { console.error(err); }
  };

  const fetchAccountsList = async () => {
    try {
      const res = await axios.get(`${API_BASE}/accounts`);
      setAccounts(res.data);
    } catch (err) { console.error(err); }
  };

  const disconnectAccount = async (id) => {
    if (!confirm('Déconnecter ce compte ?')) return;
    try {
      await axios.delete(`${API_BASE}/accounts/${id}`);
      fetchAccountsList();
    } catch (err) { alert('Erreur déconnexion'); }
  };

  const fetchMessages = async (id) => {
    try {
      const res = await axios.get(`${API_BASE}/messages/${id}`);
      setMessages(res.data);
    } catch (err) { console.error(err); }
  };

  const sendMessage = async () => {
    if (!messageInput.trim() || !activeConv) return;
    const content = messageInput;
    setMessageInput('');
    const tempId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: tempId, content, is_from_me: true, timestamp: new Date(), status: 'sending' }]);
    try {
      await axios.post(`${API_BASE}/messages`, { conversationId: activeConv.id, content });
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    if (activeConv) {
      fetchMessages(activeConv.id);
      if (isMobile) setShowChat(true);
      const interval = setInterval(() => fetchMessages(activeConv.id), 3000);
      return () => clearInterval(interval);
    } else {
      setShowChat(false);
    }
  }, [activeConv, isMobile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startWhatsAppConnect = async () => {
    setConnectStep('whatsapp_qr');
    try {
      const res = await axios.post(`${API_BASE}/connect/whatsapp`);
      setWaAccountId(res.data.accountId);
    } catch (err) { alert('Erreur WhatsApp'); }
  };

  useEffect(() => {
    let interval;
    if (waAccountId && connectStep === 'whatsapp_qr') {
      interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API_BASE}/connect/whatsapp/status/${waAccountId}`);
          if (res.data.status === 'connected') {
            setShowConnect(false);
            setConnectStep('select');
            setWaAccountId(null);
            setWaQr(null);
            fetchAccountsList();
            clearInterval(interval);
          } else {
            setWaQr(res.data.qr);
          }
        } catch (e) { console.error('Poll error', e); }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [waAccountId, connectStep]);

  const startInstagramConnect = async () => {
    setConnectStep('instagram_loading');
    try {
      await axios.post(`${API_BASE}/connect/instagram`, igData);
      setShowConnect(false);
      setConnectStep('select');
    } catch (err) { alert('Erreur Instagram'); setConnectStep('instagram_login'); }
  };

  const ConnectModal = () => (
    <div className="modal-overlay glass" onClick={() => setShowConnect(false)}>
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="connect-modal" 
        onClick={e => e.stopPropagation()}
      >
        <button className="close-modal" onClick={() => setShowConnect(false)}><Plus size={24} style={{ transform: 'rotate(45deg)' }} /></button>
        {connectStep === 'select' && (
          <div className="connect-select">
            <h2>Connecter un compte</h2>
            <div className="platform-grid">
              <button onClick={startWhatsAppConnect} className="wa-btn"><Smartphone size={32} /><span>WhatsApp</span></button>
              <button onClick={() => setConnectStep('instagram_login')} className="ig-btn"><Instagram size={32} /><span>Instagram</span></button>
            </div>
          </div>
        )}
        {connectStep === 'whatsapp_qr' && (
          <div className="connect-wa">
            <h2>Scannez le QR Code</h2>
            <div className="qr-container">
              {waQr ? <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(waQr)}`} alt="QR" /> : <div className="qr-placeholder">Génération...</div>}
            </div>
          </div>
        )}
        {connectStep === 'instagram_login' && (
          <form className="connect-ig" onSubmit={e => { e.preventDefault(); startInstagramConnect(); }}>
            <h2>Instagram</h2>
            <div className="ig-inputs">
              <input placeholder="Username" value={igData.username} onChange={e => setIgData({...igData, username: e.target.value})} />
              <input type="password" placeholder="Password" value={igData.password} onChange={e => setIgData({...igData, password: e.target.value})} />
            </div>
            <button type="submit" className="ig-submit">Se connecter</button>
          </form>
        )}
      </motion.div>
    </div>
  );

  const filteredConversations = conversations.filter(c => {
    const matchesSearch = (c.title || c.contacts?.display_name || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (view === 'all') return matchesSearch;
    return matchesSearch && c.platform === view;
  });

  const filteredContacts = contacts.filter(c => (c.display_name || '').toLowerCase().includes(searchQuery.toLowerCase()));

  const Navigation = () => (
    <nav className={`rail glass ${isMobile ? 'bottom-bar' : ''}`}>
      <div className="rail-top">
        {!isMobile && <div className="logo-icon">LR</div>}
        <div className="rail-items">
          <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}><LayoutGrid size={isMobile ? 24 : 20} /></button>
          <button className={view === 'contacts' ? 'active' : ''} onClick={() => setView('contacts')}><Users size={isMobile ? 24 : 20} /></button>
          {!isMobile && <div className="separator" />}
          <button className={view === 'whatsapp' ? 'active whatsapp' : ''} onClick={() => setView('whatsapp')}><Smartphone size={isMobile ? 24 : 20} /></button>
          <button className={view === 'instagram' ? 'active instagram' : ''} onClick={() => setView('instagram')}><Instagram size={isMobile ? 24 : 20} /></button>
          {!isMobile && <button className="add-btn" onClick={() => { setShowConnect(true); setConnectStep('select'); }}><Plus size={20} /></button>}
          {isMobile && <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><Settings size={24} /></button>}
        </div>
      </div>
      {!isMobile && (
        <div className="rail-bottom">
          <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><Settings size={20} /></button>
        </div>
      )}
    </nav>
  );

  return (
    <div className={`app-layout ${isMobile ? 'mobile' : ''}`}>
      <Navigation />
      
      {view === 'settings' ? (
        <main className="settings-pane scrollbar">
          <header className="pane-header"><h1>Paramètres</h1></header>
          <div className="settings-content">
            <section className="settings-section">
              <h2>Comptes</h2>
              <div className="account-list">
                {accounts.map(acc => (
                  <div key={acc.id} className="account-card glass">
                    <div className="account-info">
                      <span className="platform">{acc.platform}</span>
                      <strong>{acc.username || acc.platform}</strong>
                    </div>
                    <button className="disconnect-btn" onClick={() => disconnectAccount(acc.id)}>Déconnecter</button>
                  </div>
                ))}
              </div>
              <button className="add-account-btn" onClick={() => { setShowConnect(true); setConnectStep('select'); }}>Ajouter un compte</button>
            </section>
          </div>
        </main>
      ) : (
        <>
          <aside className={`thread-pane ${(isMobile && showChat) ? 'hidden' : ''}`}>
            <header className="pane-header">
              <div className="title-row">
                <h1>{view === 'contacts' ? 'Contacts' : 'Inbox'}</h1>
                <div className="badge">{view === 'contacts' ? filteredContacts.length : filteredConversations.length}</div>
              </div>
              <div className="search-box">
                <Search size={14} /><input placeholder="Rechercher..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
            </header>
            <div className="conversation-list scrollbar">
              {view === 'contacts' ? (
                filteredContacts.map(contact => (
                  <div key={contact.id} className="conv-card" onClick={() => {
                    const existing = conversations.find(c => c.contact_id === contact.id);
                    if (existing) setActiveConv(existing);
                  }}>
                    <div className="main-avatar">{contact.avatar_url ? <img src={contact.avatar_url} alt="" /> : contact.display_name?.[0]}</div>
                    <div className="conv-info"><span className="name">{contact.display_name}</span></div>
                  </div>
                ))
              ) : (
                filteredConversations.map(conv => (
                  <div key={conv.id} className={`conv-card ${activeConv?.id === conv.id ? 'active' : ''}`} onClick={() => setActiveConv(conv)}>
                    <div className="avatar-stack">
                      <div className="main-avatar">{conv.contacts?.avatar_url ? <img src={conv.contacts.avatar_url} alt="" /> : (conv.contacts?.display_name?.[0] || '?')}</div>
                    </div>
                    <div className="conv-info"><span className="name">{conv.title || conv.contacts?.display_name}</span><p className="preview">{conv.last_message_preview}</p></div>
                  </div>
                ))
              )}
            </div>
          </aside>
          <main className={`chat-pane ${(isMobile && !showChat) ? 'hidden' : ''}`}>
            {activeConv ? (
              <div className="chat-content">
                <header className="chat-header glass">
                  <div className="header-identity">
                    {isMobile && <button className="back-btn" onClick={() => setShowChat(false)}><Plus size={24} style={{ transform: 'rotate(45deg)' }} /></button>}
                    <div className="header-avatar">{activeConv.contacts?.avatar_url ? <img src={activeConv.contacts.avatar_url} alt="" /> : activeConv.contacts?.display_name?.[0]}</div>
                    <div className="header-text"><h2>{activeConv.title || activeConv.contacts?.display_name}</h2><div className="online-indicator"><span className="dot" />En ligne</div></div>
                  </div>
                </header>
                <div className="message-area scrollbar">
                  {messages.map(msg => (
                    <div key={msg.id} className={`msg-row ${msg.is_from_me ? 'me' : 'them'}`}>
                      <div className="bubble">{msg.content}</div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
                <footer className="input-strip">
                  <form className="input-container glass" onSubmit={e => { e.preventDefault(); sendMessage(); }}>
                    <input placeholder="Répondre..." value={messageInput} onChange={e => setMessageInput(e.target.value)} />
                    <button type="submit" disabled={!messageInput.trim()}><Send size={18} /></button>
                  </form>
                </footer>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-illust"><MessageSquare size={48} /></div>
                {conversations.length === 0 ? (
                  <><h3>Bienvenue</h3><p>Aucun compte connecté.</p><button className="connect-now" onClick={() => { setShowConnect(true); setConnectStep('select'); }}>Connecter un compte</button></>
                ) : (
                  <><h3>Prêt à discuter ?</h3><p>Sélectionnez une conversation.</p></>
                )}
              </div>
            )}
          </main>
        </>
      )}
      {showConnect && <ConnectModal />}
    </div>
  );
}

export default App;
