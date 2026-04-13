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
  Loader2,
  Phone,
  Video,
  Image as ImageIcon
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
  const [previewImage, setPreviewImage] = useState(null);
  
  // Pairing State
  const [pairingStatus, setPairingStatus] = useState(null);
  const [pairingQR, setPairingQR] = useState(null);
  const [pairingId, setPairingId] = useState(null);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    preloadData();
    const refreshInterval = setInterval(() => preloadData(), 5000);
    return () => { window.removeEventListener('resize', handleResize); clearInterval(refreshInterval); };
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

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

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
    const text = newMessage.trim();
    if (!text || !selectedConv) return;
    setNewMessage(''); // Instant reset for UX
    try {
      await axios.post(`${API_BASE}/messages`, {
        conversationId: selectedConv.id,
        content: text,
        accountId: selectedConv.account_id
      });
      fetchMessages(selectedConv.id);
    } catch (err) {
      console.error('Send failed:', err);
      if (err.response?.status === 503) {
        alert('Session déconnectée. Veuillez scanner à nouveau le QR Code.');
        setShowAddModal(true);
        startWhatsAppPairing();
      } else {
        alert(err.response?.data?.error || 'Erreur lors de l\'envoi. Vérifiez que votre compte WhatsApp est bien connecté.');
      }
      setNewMessage(text); // Restore on failure
    }
  };

  const openContactConversation = async (contact) => {
    try {
      const { data: conv } = await axios.post(`${API_BASE}/conversations/ensure`, { contact_id: contact.id });
      // Recharger les conversations pour être sûr d'avoir la dernière version
      await preloadData();
      setSelectedConv(conv);
      setView('inbox');
    } catch (err) {
      console.error('Failed to ensure conversation:', err);
      alert('Impossible d\'ouvrir la conversation.');
    }
  };

  const formatPhone = (phone) => {
    if (!phone) return '';
    // Si c'est un identifiant LID technique (commence par 9 et est très long)
    if (phone.length > 13 && (phone.startsWith('9') || phone.startsWith('1'))) {
      return 'WhatsApp'; // Masquer l'ID technique
    }
    if (phone.startsWith('33') && phone.length >= 11) {
      return `+${phone.slice(0, 2)} ${phone.slice(2, 3)} ${phone.slice(3, 5)} ${phone.slice(5, 7)} ${phone.slice(7, 9)} ${phone.slice(9, 11)}`;
    }
    return `+${phone}`;
  };

  const startWhatsAppPairing = async () => {
    setPairingStatus('initiating');
    try {
      const res = await axios.post(`${API_BASE}/connect/whatsapp`);
      setPairingId(res.data.accountId);
      setPairingStatus('waiting_qr');
    } catch (err) {
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
        setTimeout(() => { setPairingStatus(null); setShowAddModal(false); }, 2000);
      } else if (res.data.status === 'waiting_lock') {
        setPairingStatus('waiting_lock');
      }
    } catch (e) {}
  };

  // 0. AUTO-QR: Récupérer le QR même pour un compte déjà existant
  useEffect(() => {
    const fetchUniversalQR = async () => {
      const waAcc = accounts.find(a => a.platform === 'whatsapp');
      if (waAcc && !pairingId) {
        try {
          const res = await axios.get(`${API_BASE}/connect/whatsapp/status/${waAcc.id}`);
          if (res.data.qr && !pairingQR) {
             setPairingQR(res.data.qr);
             setPairingStatus('waiting_qr');
             setPairingId(waAcc.id);
          }
        } catch (e) {}
      }
    };
    if (view === 'inbox' || view === 'settings') fetchUniversalQR();
  }, [accounts, view]);

  // 7. ARCHIVES: Filtrage des conversations archivées
  const filteredConvs = conversations.filter(c => {
    const matchesSearch = c.title?.toLowerCase().includes(searchQuery.toLowerCase()) || c.external_id?.includes(searchQuery);
    const isArchived = c.metadata?.is_archived === true;
    return matchesSearch && !isArchived;
  });

  const filteredContacts = contacts.filter(c =>
    c.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone_number?.includes(searchQuery)
  );

  const getDisplayName = (conv) => {
    const contact = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
    return contact?.display_name || conv.title || conv.external_id?.split('@')[0] || 'Inconnu';
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <RefreshCw className="spinner" size={40} />
          <h1>LeRelais</h1>
          <p>Initialisation...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {!isMobile && (
        <nav className="nav-rail">
          <div className="brand-icon"><MessageSquare size={24} color="#fff" /></div>
          <div className={`nav-item ${view === 'inbox' ? 'active' : ''}`} onClick={() => setView('inbox')}><MessageSquare size={20} /></div>
          <div className={`nav-item ${view === 'contacts' ? 'active' : ''}`} onClick={() => setView('contacts')}><Users size={20} /></div>
          <div className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}><Settings size={20} /></div>
          <button className="nav-add-btn" onClick={() => setShowAddModal(true)}><Plus size={24} /></button>
        </nav>
      )}

      <div className={`list-pane ${(selectedConv || (isMobile && view !== 'inbox' && view !== 'contacts' && view !== 'settings')) ? 'hidden' : ''}`}>
        <header className="pane-header">
          <h1>
            {view === 'inbox' ? 'Messages' : view === 'contacts' ? 'Répertoire' : 'Paramètres'}
            <span className="badge">{view === 'inbox' ? filteredConvs.length : view === 'contacts' ? filteredContacts.length : ''}</span>
          </h1>
          <div className="search-box">
            <Search size={16} />
            <input type="text" placeholder="Rechercher..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>
        </header>

        <div className="scroll-area">
          {view === 'inbox' && filteredConvs.map(conv => (
            <motion.div key={conv.id} className={`conv-card ${selectedConv?.id === conv.id ? 'active' : ''}`} onClick={() => setSelectedConv(conv)}>
              <div className="avatar-wrap">
                {(() => {
                  const contact = Array.isArray(conv.contacts) ? conv.contacts[0] : conv.contacts;
                  if (contact?.avatar_url) return <img src={contact.avatar_url} alt="" />;
                  if (conv.is_group) return <div className="avatar-placeholder group"><Users size={20} /></div>;
                  return <span>{getDisplayName(conv).charAt(0)}</span>;
                })()}
                <div className={`platform-dot ${conv.platform}`}></div>
              </div>
              <div className="conv-content">
                <div className="conv-top">
                  <strong>{getDisplayName(conv)}</strong>
                  <span className="time">{conv.last_message_at ? new Date(conv.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                </div>
                <p>{conv.last_message_preview || 'Aucun message'}</p>
              </div>
            </motion.div>
          ))}

          {view === 'contacts' && filteredContacts.map(contact => (
            <div key={contact.id} className="conv-card" onClick={() => openContactConversation(contact)}>
              <div className="avatar-wrap">
                {contact.avatar_url ? <img src={contact.avatar_url} alt="" /> : <span>{contact.display_name?.charAt(0)}</span>}
              </div>
              <div className="conv-content">
                <strong>{contact.display_name}</strong>
                <p><Phone size={11} /> {formatPhone(contact.phone_number || contact.external_id?.split('@')[0])}</p>
              </div>
            </div>
          ))}

          {view === 'settings' && accounts.map(acc => (
            <div key={acc.id} className="account-card">
              <div className={`platform-dot ${acc.platform}`} style={{ position: 'relative', border: 'none' }}></div>
              <div className="acc-info">
                <strong>{acc.account_name || acc.platform}</strong>
                <span className={`status-pill ${acc.status}`}>{acc.status}</span>
              </div>
              <button className="disconnect-btn" onClick={async () => { await axios.delete(`${API_BASE}/accounts/${acc.id}`); preloadData(); }}>Déconnecter</button>
            </div>
          ))}
        </div>
      </div>

      <main className={`chat-pane ${!selectedConv && isMobile ? 'hidden' : ''}`}>
        <AnimatePresence mode="wait">
          {selectedConv ? (
            <motion.div key={selectedConv.id} className="chat-content" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
              <header className="chat-header">
                {isMobile && <button onClick={() => setSelectedConv(null)} className="back-btn"><ArrowLeft size={20} /></button>}
                {/* 6. PHOTO CLIQUABLE */}
                <div className="avatar-wrap small clickable" onClick={() => {
                  const contact = Array.isArray(selectedConv.contacts) ? selectedConv.contacts[0] : selectedConv.contacts;
                  if (contact?.avatar_url) setPreviewImage(contact.avatar_url);
                }}>
                  {(() => {
                    const contact = Array.isArray(selectedConv.contacts) ? selectedConv.contacts[0] : selectedConv.contacts;
                    return contact?.avatar_url ? <img src={contact.avatar_url} alt="" /> : <span>{getDisplayName(selectedConv).charAt(0)}</span>;
                  })()}
                </div>
                <div className="header-info">
                  <h2>{getDisplayName(selectedConv)}</h2>
                  <span className="status">{selectedConv.external_id?.split('@')[0]}</span>
                </div>
                {/* 4. APPEL DEPUIS LA CONVERSATION */}
                <div className="chat-actions">
                  <a href={`tel:${selectedConv.external_id?.split('@')[0]}`} className="action-btn"><Phone size={20} /></a>
                  <button className="action-btn"><Video size={20} /></button>
                </div>
              </header>

              <div className="messages-area">
                {messages.map(msg => (
                  <div key={msg.id} className={`msg-bubble ${msg.is_from_me ? 'me' : 'them'}`}>
                    {/* 2. AFFICHAGE DES MÉDIAS */}
                    {msg.media_type === 'image' && <div className="media-placeholder"><ImageIcon size={24} /> <span>Image reçue</span></div>}
                    {msg.media_type === 'audio' && <div className="media-placeholder"><RefreshCw size={18} /> <span>Audio reçu</span></div>}
                    {msg.content}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <footer className="chat-footer">
                <form className="input-group" onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}>
                  <input type="text" placeholder="Écrire un message..." value={newMessage} onChange={(e) => setNewMessage(e.target.value)} autoFocus />
                  <button type="submit" className="send-btn" disabled={!newMessage.trim()}><Send size={18} /></button>
                </form>
              </footer>
            </motion.div>
          ) : !isMobile && <div className="placeholder-view"><h2>LeRelais Hub</h2><p>Sélectionnez une conversation.</p></div>}
        </AnimatePresence>
      </main>

      {/* Preview Modal */}
      {previewImage && (
        <div className="modal-overlay" onClick={() => setPreviewImage(null)}>
          <img src={previewImage} className="full-preview" alt="" />
        </div>
      )}

      {isMobile && (
        <nav className="mobile-nav">
          <div className={`mob-item ${view === 'inbox' ? 'active' : ''}`} onClick={() => setView('inbox')}><MessageSquare size={22} /></div>
          <div className={`mob-item ${view === 'contacts' ? 'active' : ''}`} onClick={() => setView('contacts')}><Users size={22} /></div>
          <div className="mob-add-wrap"><button className="mob-add-btn" onClick={() => setShowAddModal(true)}><Plus size={28} /></button></div>
          <div className={`mob-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}><Settings size={22} /></div>
          <div className="mob-item" onClick={() => preloadData()}><RefreshCw size={22} /></div>
        </nav>
      )}

      {showAddModal && (
        <div className="modal-overlay" onClick={() => !pairingStatus && setShowAddModal(false)}>
          <motion.div className="elite-modal" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={e => e.stopPropagation()}>
            {!pairingStatus && <button className="modal-close" onClick={() => setShowAddModal(false)}><X size={20} /></button>}
            {pairingStatus ? (
              <div className="pairing-view">
                <h2>
                  {pairingStatus === 'connected' ? '✅ Connecté !' : 
                   pairingStatus === 'waiting_lock' ? '🛡️ Sécurisation...' :
                   'Scannez le code'}
                </h2>
                <p>
                  {pairingStatus === 'waiting_lock' ? 
                   'Une autre instance est en cours d\'initialisation. Veuillez patienter.' : 
                   'WhatsApp > Appareils connectés'}
                </p>
                <div className="qr-container">
                  {pairingStatus === 'waiting_lock' ? (
                    <div className="waiting-box">
                      <RefreshCw className="spinner" size={40} />
                    </div>
                  ) : (
                    pairingQR ? <div className="qr-box"><QRCode value={pairingQR} size={220} /></div> : <Loader2 className="spinner" size={40} />
                  )}
                </div>
                {pairingStatus !== 'connected' && <button className="cancel-pairing" onClick={() => { setPairingStatus(null); setPairingId(null); setPairingQR(null); }}>Annuler</button>}
              </div>
            ) : (
              <div className="platform-list">
                <div className="platform-item" onClick={startWhatsAppPairing}><div className="platform-dot whatsapp"></div><strong>WhatsApp</strong></div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </div>
  );
}

export default App;
