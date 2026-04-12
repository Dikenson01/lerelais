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
  Plus
} from 'lucide-react';
import './App.css';

const API_BASE = (window.Telegram?.WebApp && window.location.hostname !== 'localhost') 
  ? '/api' 
  : `http://${window.location.hostname}:3000/api`;

function App() {
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState('all');
  const [tgUser, setTgUser] = useState(null);
  const [messageInput, setMessageInput] = useState('');
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showChat, setShowChat] = useState(false);
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
    const interval = setInterval(fetchConversations, 5000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

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

  const fetchConversations = async () => {
    try {
      const res = await axios.get(`${API_BASE}/conversations`);
      setConversations(res.data);
    } catch (err) {
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

  const Navigation = () => (
    <nav className={`rail glass ${isMobile ? 'bottom-bar' : ''}`}>
      <div className="rail-top">
        {!isMobile && <div className="logo-icon">LR</div>}
        <div className="rail-items">
          <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>
            <LayoutGrid size={isMobile ? 24 : 20} />
            {!isMobile && <span className="tooltip">Toutes</span>}
          </button>
          {!isMobile && <div className="separator" />}
          <button className={view === 'whatsapp' ? 'active whatsapp' : ''} onClick={() => setView('whatsapp')}>
            <Smartphone size={isMobile ? 24 : 20} />
          </button>
          <button className={view === 'instagram' ? 'active instagram' : ''} onClick={() => setView('instagram')}>
            <Instagram size={isMobile ? 24 : 20} />
          </button>
          {isMobile && (
            <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}>
              <Settings size={24} />
            </button>
          )}
          {!isMobile && (
            <button className="add-btn">
              <Plus size={20} />
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
      {/* Sidebar Rail (or Bottom bar) */}
      <Navigation />

      {/* Thread List Pane */}
      <aside className={`thread-pane ${(isMobile && showChat) ? 'hidden' : ''}`}>
        <header className="pane-header">
          <div className="title-row">
            <h1>Inbox</h1>
            <div className="badge">{filteredConversations.length}</div>
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
            {filteredConversations.map(conv => (
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
                    {conv.contacts?.display_name?.[0] || '?'}
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
            ))}
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
                  <div className="header-avatar">{activeConv.contacts?.display_name?.[0]}</div>
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
          ) : !isMobile && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="empty-state"
            >
              <div className="empty-illust"><MessageSquare size={48} /></div>
              <h3>Sélectionnez une conversation</h3>
              <p>Tous vos messages WhatsApp et Instagram sont centralisés ici.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;
