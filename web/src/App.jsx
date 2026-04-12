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

const API_BASE = (window.Telegram?.WebApp && window.location.hostname !== 'localhost') 
  ? '/api' 
  : `http://${window.location.hostname}:3000/api`;

function App() {
  const [conversations, setConversations] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState('all'); // all, whatsapp, instagram, contacts
  const [tgUser, setTgUser] = useState(null);
  const [messageInput, setMessageInput] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showChat, setShowChat] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [connectStep, setConnectStep] = useState('select'); // select, whatsapp_qr, instagram_login
  const [waQr, setWaQr] = useState(null);
  const [waAccountId, setWaAccountId] = useState(null);
  const [igData, setIgData] = useState({ username: '', password: '' });
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
    const interval = setInterval(() => {
      fetchConversations();
      fetchContacts();
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
    } catch (err) {
      console.error('Failed to fetch conversations', err);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/contacts`);
      setContacts(res.data);
    } catch (err) {
      console.error('Failed to fetch contacts', err);
    }
  };

  const fetchMessages = async (id) => {
    try {
      const res = await axios.get(`${API_BASE}/messages/${id}`);
      setMessages(res.data);
    } catch (err) {
      console.error('Failed to fetch messages', err);
    }
  };

  const sendMessage = async () => {
    if (!messageInput.trim() || !activeConv) return;
    const content = messageInput;
    setMessageInput('');
    const tempId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: tempId, content, is_from_me: true, timestamp: new Date(), status: 'sending' }]);
    try {
      await axios.post(`${API_BASE}/messages`, { conversationId: activeConv.id, content });
    } catch (err) { console.error('Failed to send', err); }
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
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

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
        const res = await axios.get(`${API_BASE}/connect/whatsapp/qr/${waAccountId}`);
        if (res.data.qr) setWaQr(res.data.qr);
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
              <button onClick={startWhatsAppConnect} className="wa-btn">
                <Smartphone size={32} />
                <span>WhatsApp</span>
              </button>
              <button onClick={() => setConnectStep('instagram_login')} className="ig-btn">
                <Instagram size={32} />
                <span>Instagram</span>
              </button>
            </div>
          </div>
        )}

        {connectStep === 'whatsapp_qr' && (
          <div className="connect-wa">
            <h2>Scannez le Code QR</h2>
            <div className="qr-container">
              {waQr ? (
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(waQr)}`} alt="WA QR" />
              ) : (
                <div className="qr-placeholder">Génération...</div>
              )}
            </div>
            <p>Ouvrez WhatsApp {'>'} Appareils connectés {'>'} Connecter un appareil</p>
          </div>
        )}

        {connectStep === 'instagram_login' && (
          <form className="connect-ig" onSubmit={e => { e.preventDefault(); startInstagramConnect(); }}>
            <h2>Connexion Instagram</h2>
            <div className="ig-inputs">
              <input 
                placeholder="Nom d'utilisateur" 
                value={igData.username}
                onChange={e => setIgData({...igData, username: e.target.value})}
              />
              <input 
                type="password"
                placeholder="Mot de passe" 
                value={igData.password}
                onChange={e => setIgData({...igData, password: e.target.value})}
              />
            </div>
            <button type="submit" className="ig-submit">Se connecter</button>
          </form>
        )}
      </motion.div>
    </div>
  );

  const fetchConversations = async () => {
    try {
      const res = await axios.get(`${API_BASE}/conversations`);
      setConversations(res.data);
    } catch (err) {
      console.error('Failed to fetch conversations', err);
    }
  };

  const fetchContacts = async () => {
    try {
      const res = await axios.get(`${API_BASE}/contacts`);
      setContacts(res.data);
    } catch (err) {
      console.error('Failed to fetch contacts', err);
    }
  };
      console.error('Failed to fetch conversations', err);
    }
  };

  const fetchMessages = async (id) => {
    try {
      const res = await axios.get(`${API_BASE}/messages/${id}`);
      setMessages(res.data);
    } catch (err) {
      console.error('Failed to fetch messages', err);
    }
  };

  const sendMessage = async () => {
    if (!messageInput.trim() || !activeConv) return;
    
    const content = messageInput;
    setMessageInput('');
    
    const tempId = crypto.randomUUID();
    const optimisticMsg = {
      id: tempId,
      conversation_id: activeConv.id,
      content,
      is_from_me: true,
      timestamp: new Date().toISOString(),
      status: 'sending'
    };
    setMessages(prev => [...prev, optimisticMsg]);

    try {
      await axios.post(`${API_BASE}/messages`, {
        conversationId: activeConv.id,
        content
      });
    } catch (err) {
      console.error('Failed to send message', err);
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, status: 'error' } : m));
    }
  };

  const filteredConversations = conversations.filter(c => {
    const matchesSearch = (c.title || c.contacts?.display_name || '').toLowerCase().includes(searchQuery.toLowerCase());
    if (view === 'all') return matchesSearch;
    return matchesSearch && c.platform === view;
  });

  const filteredContacts = contacts.filter(c => 
    (c.display_name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const Navigation = () => (
    <nav className={`rail glass ${isMobile ? 'bottom-bar' : ''}`}>
      <div className="rail-top">
        {!isMobile && <div className="logo-icon">LR</div>}
        <div className="rail-items">
          <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>
            <LayoutGrid size={isMobile ? 24 : 20} />
          </button>
          <button className={view === 'contacts' ? 'active' : ''} onClick={() => setView('contacts')}>
            <Users size={isMobile ? 24 : 20} />
          </button>
          {!isMobile && <div className="separator" />}
          <button className={view === 'whatsapp' ? 'active whatsapp' : ''} onClick={() => setView('whatsapp')}>
            <Smartphone size={isMobile ? 24 : 20} />
          </button>
          <button className={view === 'instagram' ? 'active instagram' : ''} onClick={() => setView('instagram')}>
            <Instagram size={isMobile ? 24 : 20} />
          </button>
          {!isMobile && (
            <button className="add-btn" onClick={() => { setShowConnect(true); setConnectStep('select'); }}>
              <Plus size={20} />
            </button>
          )}
          {isMobile && (
            <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>
              <Settings size={24} />
            </button>
          )}
        </div>
      </div>
      {!isMobile && (
        <div className="rail-bottom">
          <button className="status-btn"><Activity size={20} /></button>
          <button className="settings-btn"><Settings size={20} /></button>
        </div>
      )}
    </nav>
  );

  return (
    <div className={`app-layout ${isMobile ? 'mobile' : ''}`}>
      <Navigation />

      <aside className={`thread-pane ${(isMobile && showChat) ? 'hidden' : ''}`}>
        <header className="pane-header">
          <div className="title-row">
            <h1>{view === 'contacts' ? 'Contacts' : 'Inbox'}</h1>
            <div className="badge">{view === 'contacts' ? filteredContacts.length : filteredConversations.length}</div>
          </div>
          <div className="search-box">
            <Search size={14} />
            <input 
              placeholder="Rechercher..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </header>

        <div className="conversation-list scrollbar">
          <AnimatePresence mode='popLayout'>
            {view === 'contacts' ? (
              filteredContacts.map(contact => (
                <motion.div 
                  layout
                  key={contact.id} 
                  className="conv-card"
                  onClick={() => {
                    // Find or create conversation for this contact
                    const existing = conversations.find(c => c.contact_id === contact.id);
                    if (existing) {
                      setActiveConv(existing);
                    } else {
                      // We could implement creating a new conversation here
                      console.log('New conversation needed for', contact);
                    }
                  }}
                >
                  <div className="avatar-stack">
                    <div className="main-avatar">
                      {contact.avatar_url ? <img src={contact.avatar_url} alt="" /> : contact.display_name?.[0]}
                    </div>
                  </div>
                  <div className="conv-info">
                    <div className="info-top">
                      <span className="name">{contact.display_name}</span>
                    </div>
                    <div className="info-bottom">
                      <p className="preview">{contact.username || 'No username'}</p>
                    </div>
                  </div>
                </motion.div>
              ))
            ) : (
              filteredConversations.map(conv => (
                <motion.div 
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  key={conv.id} 
                  className={`conv-card ${activeConv?.id === conv.id ? 'active' : ''}`}
                  onClick={() => setActiveConv(conv)}
                >
                  <div className="avatar-stack">
                    <div className="main-avatar">
                      {conv.contacts?.avatar_url ? (
                        <img src={conv.contacts.avatar_url} alt="" />
                      ) : (
                        conv.contacts?.display_name?.[0] || '?'
                      )}
                    </div>
                    <div className={`platform-pip ${conv.platform}`}>
                      {conv.platform === 'whatsapp' ? <Smartphone size={8} /> : <Instagram size={8} />}
                    </div>
                  </div>
                  <div className="conv-info">
                    <div className="info-top">
                      <span className="name">{conv.title || conv.contacts?.display_name || 'Contact inconnu'}</span>
                      <span className="time">{new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="info-bottom">
                      <p className="preview">{conv.last_message_preview || 'Aucun message'}</p>
                      {conv.unread_count > 0 && <span className="unread-dot">{conv.unread_count}</span>}
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </aside>

      {/* Chat Window Pane */}
      <main className={`chat-pane ${(isMobile && !showChat) ? 'hidden' : ''}`}>
        <AnimatePresence mode="wait">
          {activeConv ? (
            <motion.div 
              key={activeConv.id}
              initial={isMobile ? { x: '100%' } : { opacity: 0, x: 20 }}
              animate={{ x: 0, opacity: 1 }}
              exit={isMobile ? { x: '100%' } : { opacity: 0, x: -20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="chat-content"
            >
              <header className="chat-header glass">
                <div className="header-identity">
                  {isMobile && (
                    <button className="back-btn" onClick={() => setShowChat(false)}>
                      <Plus size={24} style={{ transform: 'rotate(45deg)' }} />
                    </button>
                  )}
                  <div className="header-avatar">
                    {activeConv.contacts?.avatar_url ? (
                      <img src={activeConv.contacts.avatar_url} alt="" />
                    ) : (
                      activeConv.contacts?.display_name?.[0]
                    )}
                  </div>
                  <div className="header-text">
                    <h2>{activeConv.title || activeConv.contacts?.display_name}</h2>
                    <div className="online-indicator">
                      <span className="dot" />
                      En ligne
                    </div>
                  </div>
                </div>
                <div className="header-actions">
                  {!isMobile && <button><Search size={18} /></button>}
                  <button><MoreVertical size={18} /></button>
                </div>
              </header>

              <div className="message-area scrollbar">
                {messages.map((msg, idx) => (
                  <div key={msg.id} className={`msg-row ${msg.is_from_me ? 'me' : 'them'}`}>
                    {!msg.is_from_me && <div className="bubble-author">{activeConv.contacts?.display_name}</div>}
                    <div className="bubble">
                      {msg.content}
                      <div className="bubble-footer">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {msg.is_from_me && (
                          msg.status === 'sending' ? '...' : 
                          msg.status === 'error' ? '❌' : 
                          <CheckCheck size={12} className="sent-icon" />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <footer className="input-strip">
                <form className="input-container glass" onSubmit={(e) => { e.preventDefault(); sendMessage(); }}>
                  <button type="button" className="attach-btn"><Paperclip size={20} /></button>
                  <input 
                    type="text" 
                    placeholder="Répondre..." 
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                  />
                  <button type="submit" className="send-action" disabled={!messageInput.trim()}>
                    <Send size={18} />
                  </button>
                </form>
              </footer>
            </motion.div>
          ) : (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="empty-state"
            >
              <div className="empty-illust"><MessageSquare size={48} /></div>
              {conversations.length === 0 ? (
                <>
                  <h3>Bienvenue sur LeRelais</h3>
                  <p>Aucun compte n'est encore connecté à votre instance Railway.</p>
                  <button className="connect-now" onClick={() => { setShowConnect(true); setConnectStep('select'); }}>
                    Connecter un compte
                  </button>
                </>
              ) : (
                <>
                  <h3>Prêt à discuter ?</h3>
                  <p>Sélectionnez une conversation dans la liste pour commencer à répondre.</p>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {showConnect && <ConnectModal />}
    </div>
  );
}

export default App;
