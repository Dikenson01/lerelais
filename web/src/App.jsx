import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  Users, 
  Settings, 
  Plus, 
  Search, 
  Send, 
  X, 
  RefreshCw,
  ArrowLeft,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import QRCode from 'react-qr-code';
import './App.css';

const API_BASE = '/api';

function App() {
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
  
  // Pairing State
  const [pairingStatus, setPairingStatus] = useState(null); // 'initiating', 'waiting_qr', 'connected'
  const [pairingQR, setPairingQR] = useState(null);
  const [pairingId, setPairingId] = useState(null);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    preloadData();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (selectedConv) {
      fetchMessages(selectedConv.id);
      const interval = setInterval(() => fetchMessages(selectedConv.id), 3000);
      return () => clearInterval(interval);
    }
  }, [selectedConv]);

  useEffect(() => {
    let interval;
    if (pairingId && pairingStatus === 'waiting_qr') {
      interval = setInterval(checkPairingStatus, 2000);
    }
    return () => clearInterval(interval);
  }, [pairingId, pairingStatus]);

  const preloadData = async () => {
    try {
      const [convs, conts, accs] = await Promise.all([
        axios.get(`${API_BASE}/conversations`),
        axios.get(`${API_BASE}/contacts`),
        axios.get(`${API_BASE}/accounts`)
      ]);
      setConversations(convs.data);
      setContacts(conts.data);
      setAccounts(accs.data);
    } catch (err) {
      console.error('Preload failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = async (convId) => {
    try {
      const res = await axios.get(`${API_BASE}/messages/${convId}`);
      setMessages(res.data);
    } catch (err) {
      console.error('Fetch messages failed:', err);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !selectedConv) return;
    try {
      await axios.post(`${API_BASE}/messages`, {
        conversationId: selectedConv.id,
        content: newMessage,
        accountId: selectedConv.account_id
      });
      setNewMessage('');
      fetchMessages(selectedConv.id);
    } catch (err) {
      console.error('Send failed:', err);
    }
  };

  // Pairing Logic
  const startWhatsAppPairing = async () => {
    setPairingStatus('initiating');
    try {
      const res = await axios.post(`${API_BASE}/connect/whatsapp`);
      setPairingId(res.data.accountId);
      setPairingStatus('waiting_qr');
    } catch (err) {
      console.error('Pairing fail:', err);
      setPairingStatus(null);
    }
  };

  const checkPairingStatus = async () => {
    if (!pairingId) return;
    try {
      const res = await axios.get(`${API_BASE}/connect/whatsapp/status/${pairingId}`);
      if (res.data.qr) setPairingQR(res.data.qr);
      if (res.data.status === 'connected') {
        setPairingStatus('connected');
        setPairingId(null);
        setPairingQR(null);
        preloadData();
        setTimeout(() => {
          setPairingStatus(null);
          setShowAddModal(false);
        }, 2000);
      }
    } catch (e) {}
  };

  const filteredConvs = conversations.filter(c => 
    c.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredContacts = contacts.filter(c => 
    c.display_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <RefreshCw className="spinner" size={40} />
          <h1>LeRelais</h1>
          <p>Initialisation de votre espace premium...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Sidebar - Desktop */}
      {!isMobile && (
        <nav className="nav-rail">
          <div className="brand-icon">
            <MessageSquare size={24} color="#fff" />
          </div>
          
          <div className={`nav-item ${view === 'inbox' ? 'active' : ''}`} onClick={() => setView('inbox')}>
            <MessageSquare size={20} />
          </div>
          <div className={`nav-item ${view === 'contacts' ? 'active' : ''}`} onClick={() => setView('contacts')}>
            <Users size={20} />
          </div>
          <div className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            <Settings size={20} />
          </div>

          <button className="nav-add-btn" onClick={() => setShowAddModal(true)}>
            <Plus size={24} />
          </button>
        </nav>
      )}

      {/* List Area */}
      <div className={`list-pane ${(selectedConv || (isMobile && view !== 'inbox' && view !== 'contacts' && view !== 'settings')) ? 'hidden' : ''}`}>
        <header className="pane-header">
          <h1>
            {view === 'inbox' ? 'Messages' : view === 'contacts' ? 'Répertoire' : 'Paramètres'}
            <span className="badge">{view === 'inbox' ? conversations.length : view === 'contacts' ? contacts.length : ''}</span>
          </h1>
          
          {(view === 'inbox' || view === 'contacts') && (
            <div className="search-box">
              <Search size={16} />
              <input 
                type="text" 
                placeholder="Rechercher partout..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}
        </header>

        <div className="scroll-area">
          {view === 'inbox' && (
            <>
              {filteredConvs.length === 0 ? (
                <div className="placeholder-view">
                  <MessageSquare size={48} className="hero-logo" />
                  <h3>Boite vide</h3>
                  <p>Connectez un compte pour voir vos messages.</p>
                </div>
              ) : (
                filteredConvs.map(conv => (
                  <motion.div 
                    key={conv.id} 
                    className={`conv-card ${selectedConv?.id === conv.id ? 'active' : ''}`}
                    onClick={() => setSelectedConv(conv)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="avatar-wrap">
                      {conv.contact?.avatar_url ? (
                        <img src={conv.contact.avatar_url} alt="" />
                      ) : (
                        <span>{conv.title?.charAt(0) || '?'}</span>
                      )}
                      <div className={`platform-dot ${conv.platform}`}></div>
                    </div>
                    <div className="conv-content">
                      <div className="conv-top">
                        <strong>{conv.title || 'Inconnu'}</strong>
                        <span className="time">{new Date(conv.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <p>{conv.last_message_preview || 'Aucun message'}</p>
                    </div>
                  </motion.div>
                ))
              )}
            </>
          )}

          {view === 'contacts' && (
            <div className="contact-list">
              {filteredContacts.map(contact => (
                <div key={contact.id} className="conv-card" onClick={() => {}}>
                  <div className="avatar-wrap">
                    {contact.avatar_url ? <img src={contact.avatar_url} alt="" /> : <span>{contact.display_name?.charAt(0)}</span>}
                  </div>
                  <div className="conv-content">
                    <strong>{contact.display_name}</strong>
                    <p>{contact.external_id?.split('@')[0]}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === 'settings' && (
            <div className="settings-view">
              <h3>Comptes Connectés</h3>
              {accounts.map(acc => (
                <div key={acc.id} className="account-card">
                  <div className={`platform-dot ${acc.platform}`} style={{ position: 'relative', border: 'none' }}></div>
                  <div className="acc-info">
                    <strong>{acc.account_name || acc.platform}</strong>
                    <span className={`status-pill ${acc.status}`}>{acc.status}</span>
                  </div>
                  <button className="disconnect-btn" onClick={async () => {
                    await axios.delete(`${API_BASE}/accounts/${acc.id}`);
                    preloadData();
                  }}>Déconnecter</button>
                </div>
              ))}
              {accounts.length === 0 && <p className="dim-text">Aucun compte lié.</p>}
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <main className={`chat-pane ${!selectedConv && isMobile ? 'hidden' : ''}`}>
        <AnimatePresence mode="wait">
          {selectedConv ? (
            <motion.div 
              key={selectedConv.id}
              className="chat-content"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <header className="chat-header">
                {isMobile && (
                  <button onClick={() => setSelectedConv(null)} className="back-btn">
                    <ArrowLeft size={20} />
                  </button>
                )}
                <div className="avatar-wrap small">
                   {selectedConv.contact?.avatar_url ? <img src={selectedConv.contact.avatar_url} alt="" /> : <span>{selectedConv.title?.charAt(0)}</span>}
                </div>
                <div className="header-info">
                  <h2>{selectedConv.title}</h2>
                  <span className="status">En ligne</span>
                </div>
              </header>

              <div className="messages-area">
                {messages.map(msg => (
                  <div key={msg.id} className={`msg-bubble ${msg.is_from_me ? 'me' : 'them'}`}>
                    {msg.content}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <footer className="chat-footer">
                <form className="input-group" onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}>
                  <input 
                    type="text" 
                    placeholder="Écrire un message..." 
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                  />
                  <button type="submit" className="send-btn">
                    <Send size={18} />
                  </button>
                </form>
              </footer>
            </motion.div>
          ) : (
            !isMobile && (
              <div className="placeholder-view">
                <div className="brand-icon large">
                  <MessageSquare size={48} color="#fff" />
                </div>
                <h2>LeRelais Hub</h2>
                <p>Sélectionnez une conversation pour commencer à répondre.</p>
              </div>
            )
          )}
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Nav */}
      {isMobile && (
        <nav className="mobile-nav">
          <div className={`mob-item ${view === 'inbox' ? 'active' : ''}`} onClick={() => { setView('inbox'); setSelectedConv(null); }}>
            <MessageSquare size={22} />
          </div>
          <div className={`mob-item ${view === 'contacts' ? 'active' : ''}`} onClick={() => { setView('contacts'); setSelectedConv(null); }}>
            <Users size={22} />
          </div>
          <div className="mob-add-wrap">
             <button className="mob-add-btn" onClick={() => setShowAddModal(true)}>
               <Plus size={28} />
             </button>
          </div>
          <div className={`mob-item ${view === 'settings' ? 'active' : ''}`} onClick={() => { setView('settings'); setSelectedConv(null); }}>
            <Settings size={22} />
          </div>
          <div className="mob-item" onClick={() => preloadData()}>
            <RefreshCw size={22} />
          </div>
        </nav>
      )}

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => { if (!pairingStatus) setShowAddModal(false); }}>
          <motion.div 
            className="elite-modal"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={e => e.stopPropagation()}
          >
            {!pairingStatus && <button className="modal-close" onClick={() => setShowAddModal(false)}><X size={20} /></button>}
            
            {pairingStatus ? (
              <div className="pairing-view">
                <h2>{pairingStatus === 'connected' ? '✅ Connecté !' : 'Scannez le code'}</h2>
                <p>Ouvrez WhatsApp, puis Appareils connectés, et enfin Connecter un appareil.</p>
                
                <div className="qr-container">
                  {pairingQR ? (
                    <div className="qr-box">
                      <QRCode value={pairingQR} size={220} />
                    </div>
                  ) : (
                    <div className="qr-loading">
                      <Loader2 className="spinner" size={40} />
                      <p>Génération du QR Code...</p>
                    </div>
                  )}
                </div>
                {pairingStatus !== 'connected' && (
                  <button className="cancel-pairing" onClick={() => { setPairingStatus(null); setPairingId(null); setPairingQR(null); }}>Annuler</button>
                )}
              </div>
            ) : (
              <>
                <h2>Ajouter un compte</h2>
                <p>Choisissez une plateforme pour synchroniser vos messages.</p>
                <div className="platform-list">
                  <div className="platform-item" onClick={startWhatsAppPairing}>
                    <div className="platform-dot whatsapp" style={{ position: 'relative', border: 'none' }}></div>
                    <strong>WhatsApp</strong>
                  </div>
                  <div className="platform-item" onClick={() => alert('Instagram arrive bientôt !')}>
                    <div className="platform-dot instagram" style={{ position: 'relative', border: 'none' }}></div>
                    <strong>Instagram</strong>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}

export default App;
