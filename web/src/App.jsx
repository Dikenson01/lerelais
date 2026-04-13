import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
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
  User,
  LogOut,
  RefreshCw
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
  const [isMobile] = useState(window.innerWidth < 768);
  const [showChat, setShowChat] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [connectStep, setConnectStep] = useState('select');
  const [waQr, setWaQr] = useState(null);
  const [waAccountId, setWaAccountId] = useState(null);
  const [igData, setIgData] = useState({ username: '', password: '' });
  const [selectedContact, setSelectedContact] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (window.Telegram?.WebApp) {
      const tg = window.Telegram.WebApp;
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#111418');
      tg.setBackgroundColor('#0B0D0F');
    }
    preloadData();
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
    } catch (err) { console.error('Sync error', err); }
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
        const res = await axios.get(`${API_BASE}/connect/whatsapp/status/${waAccountId}`);
        if (res.data.status === 'connected') {
          setShowConnect(false);
          preloadData();
          clearInterval(interval);
        } else {
          setWaQr(res.data.qr);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [waAccountId, connectStep]);

  const disconnectAccount = async (id) => {
    if (!confirm('Déconnecter ?')) return;
    await axios.delete(`${API_BASE}/accounts/${id}`);
    preloadData();
  };

  const startInstagramConnect = async () => {
    setConnectStep('loading');
    try {
      await axios.post(`${API_BASE}/connect/instagram`, igData);
      setShowConnect(false);
      preloadData();
    } catch (e) { alert('Erreur IG'); setConnectStep('instagram_login'); }
  };

  // --- RENDERING COMPONENTS ---

  const ProfileModal = () => {
    if (!selectedContact) return null;
    const existing = conversations.find(c => c.contact_id === selectedContact.id);
    return (
      <div className="modal-backdrop" onClick={() => setSelectedContact(null)}>
        <div className="elite-modal" onClick={e => e.stopPropagation()}>
          <button className="close-btn" onClick={() => setSelectedContact(null)}><Plus style={{ transform: 'rotate(45deg)' }} /></button>
          <h2>{selectedContact.display_name || 'Sans Nom'}</h2>
          <p>@{selectedContact.external_id?.split('@')[0]}</p>
          <div className="platform-grid" style={{ marginTop: '20px' }}>
            <button className="btn-primary" style={{ flex: 1 }} onClick={() => {
              if (existing) setActiveConv(existing);
              setView('all');
              setSelectedContact(null);
            }}>Message</button>
          </div>
        </div>
      </div>
    );
  };

  const ConnectModal = () => (
    <div className="modal-backdrop" onClick={() => setShowConnect(false)}>
      <div className="elite-modal" onClick={e => e.stopPropagation()}>
        <button className="close-btn" style={{ position: 'absolute', top: '20px', right: '20px', background: 'transparent', border: 'none', color: 'var(--med-gray)', cursor: 'pointer' }} onClick={() => setShowConnect(false)}>
          <Plus style={{ transform: 'rotate(45deg)' }} />
        </button>
        {connectStep === 'select' ? (
          <>
            <h2>Ajouter un compte</h2>
            <p>Choisissez votre plateforme préférée.</p>
            <div className="platform-grid">
              <div className="platform-card wa" onClick={startWhatsAppConnect}>
                <div className="icon"><Smartphone size={24} /></div>
                <strong>WhatsApp</strong>
              </div>
              <div className="platform-card ig" onClick={() => setConnectStep('ig_login')}>
                <div className="icon"><Instagram size={24} /></div>
                <strong>Instagram</strong>
              </div>
            </div>
          </>
        ) : connectStep === 'whatsapp_qr' ? (
          <div style={{ textAlign: 'center' }}>
            <h2>Scanner le QR</h2>
            <div style={{ background: '#fff', padding: '16px', borderRadius: '16px', display: 'inline-block', marginTop: '16px' }}>
              {waQr ? <img src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(waQr)}`} alt="QR" /> : 'Chargement...'}
            </div>
            <p style={{ marginTop: '20px', color: 'var(--med-gray)' }}>Ouvrez WhatsApp &gt; Appareils connectés</p>
          </div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); startInstagramConnect(); }}>
            <h2>Instagram</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
              <input className="form-input" placeholder="Utilisateur" value={igData.username} onChange={e => setIgData({...igData, username: e.target.value})} />
              <input className="form-input" type="password" placeholder="Mot de passe" value={igData.password} onChange={e => setIgData({...igData, password: e.target.value})} />
              <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '12px' }}>Vérifier</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );

  const filteredConvs = (conversations || []).filter(c => {
    const title = (c.title || c.contacts?.display_name || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return title.includes(query) && (view === 'all' || c.platform === view);
  });

  const filteredContacts = (contacts || []).filter(c =>
    (c.display_name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="app-container">
      {/* Elite Navigation Rail */}
      <nav className="nav-rail">
        <div className="nav-top">
          <div className={`nav-item ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}><LayoutGrid size={24} /></div>
          <div className={`nav-item ${view === 'whatsapp' ? 'active' : ''}`} onClick={() => setView('whatsapp')}><Smartphone size={24} /></div>
          <div className="nav-spacer"></div>
          <div className={`nav-item ${view === 'instagram' ? 'active' : ''}`} onClick={() => setView('instagram')}><Instagram size={24} /></div>
          <div className={`nav-item ${view === 'contacts' ? 'active' : ''}`} onClick={() => setView('contacts')}><Users size={24} /></div>
          <div className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}><Settings size={24} /></div>
        </div>
        <div className="nav-add-btn" onClick={() => { setShowConnect(true); setConnectStep('select'); }}>
          <Plus size={24} />
        </div>
      </nav>

      {/* Main Content Area */}
      <div className={`list-pane ${activeConv && isMobile ? 'hidden' : ''}`}>
        <header className="pane-header">
          <h1>{view === 'contacts' ? 'Contacts' : (view === 'settings' ? 'Réglages' : 'Hub')}</h1>
          <div className="search-container">
            <Search size={16} />
            <input placeholder="Rechercher..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          </div>
        </header>

        <div className="scroll-area">
          {view === 'contacts' ? (
            filteredContacts.length > 0 ? (
              filteredContacts.map(c => (
                <div key={c.id} className="conv-card" onClick={() => setSelectedContact(c)}>
                  <div className="avatar-wrap">
                    {c.avatar_url ? <img src={c.avatar_url} alt="" /> : (c.display_name?.[0] || '?')}
                  </div>
                  <div className="conv-info">
                    <strong>{c.display_name}</strong>
                    <p>{c.external_id?.split('@')[0]}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Users size={32} />
                <h3>Aucun contact</h3>
              </div>
            )
          ) : view === 'settings' ? (
            <div style={{ padding: '20px' }}>
              <h3 style={{ fontSize: '12px', color: 'var(--dim-gray)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '16px' }}>Comptes</h3>
              {accounts.map(acc => (
                <div key={acc.id} className="conv-card" style={{ cursor: 'default', background: 'var(--bg-card)', marginBottom: '10px' }}>
                  <div className="avatar-wrap">
                    {acc.profile_pic_url ? <img src={acc.profile_pic_url} alt="" /> : (acc.platform === 'whatsapp' ? <Smartphone size={20} /> : <Instagram size={20} />)}
                  </div>
                  <div className="conv-info">
                    <strong>{acc.account_name || acc.username || acc.platform}</strong>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                      <div className="status-pill" style={{ opacity: 0.8 }}>{acc.status}</div>
                      <button onClick={() => disconnectAccount(acc.id)} style={{ background: 'transparent', border: 'none', color: 'var(--accent-ig)', fontSize: '11px', cursor: 'pointer' }}>Déconnecter</button>
                    </div>
                  </div>
                </div>
              ))}
              <button 
                onClick={() => axios.post(`${API_BASE}/sync/all`).then(() => alert('Synchro lancée'))}
                className="btn-secondary" 
                style={{ width: '100%', marginTop: '20px', fontSize: '13px' }}
              >
                Forcer la Synchronisation
              </button>
            </div>
          ) : filteredConvs.length > 0 ? (
            filteredConvs.map(c => (
              <div 
                key={c.id} 
                className={`conv-card ${activeConv?.id === c.id ? 'active' : ''}`}
                onClick={() => { setActiveConv(c); if (isMobile) setIsMobileView(true); }}
              >
                <div className="avatar-wrap">
                  {c.contacts?.avatar_url ? <img src={c.contacts.avatar_url} alt="" /> : (c.title?.[0] || '?')}
                  <div className={`platform-dot ${c.platform}`} />
                </div>
                <div className="conv-info">
                  <strong>{c.title || c.contacts?.display_name || 'Inconnu'}</strong>
                  <p>{c.last_message_preview || 'Aucun message'}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <MessageSquare size={32} />
              <h3>Aucun message</h3>
              <p>Ajoutez un compte avec le bouton + pour commencer.</p>
            </div>
          )}
        </div>
      </div>

      <main className={`chat-view ${!activeConv && isMobile ? 'hidden' : ''}`}>
        {activeConv ? (
          <>
            <header className="chat-header">
              {isMobile && <div className="nav-item" onClick={() => setActiveConv(null)}><Plus style={{ transform: 'rotate(45deg)' }} /></div>}
              <h2>{activeConv.title || activeConv.contacts?.display_name}</h2>
              <div className="status-pill">Direct</div>
            </header>
            
            <div className="messages">
              {messages.map(m => (
                <div key={m.id} className={`message ${m.is_from_me ? 'me' : 'them'}`}>
                  {m.content}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="chat-footer">
              <form className="input-box" onSubmit={e => { e.preventDefault(); sendMessage(); }}>
                <input placeholder="Écrire un message..." value={messageInput} onChange={e => setMessageInput(e.target.value)} />
                <button type="submit" className="send-btn" disabled={!messageInput.trim()}>Envoyer</button>
              </form>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <LayoutGrid size={48} style={{ opacity: 0.1 }} />
            <h3>Sélectionnez un échange</h3>
          </div>
        )}
      </main>

      {showConnect && <ConnectModal />}
      {selectedContact && <ProfileModal />}
    </div>
  );
}

export default App;
