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
      <div className="modal-overlay" onClick={() => setSelectedContact(null)}>
        <div className="profile-modal" onClick={e => e.stopPropagation()}>
          <button className="close-btn" onClick={() => setSelectedContact(null)}><Plus style={{ transform: 'rotate(45deg)' }} /></button>
          <div className="profile-hero">
            <div className="avatar-large">
              {selectedContact.avatar_url ? <img src={selectedContact.avatar_url} alt="" /> : (selectedContact.display_name?.[0] || '?')}
            </div>
            <h2>{selectedContact.display_name || 'Sans Nom'}</h2>
            <div className="id-tag">@{selectedContact.external_id?.split('@')[0]}</div>
          </div>
          <div className="profile-actions">
            <button className="primary-btn" onClick={() => {
              if (existing) setActiveConv(existing);
              setView('all');
              setSelectedContact(null);
            }}><MessageSquare size={18} /> Message</button>
            <button className="secondary-btn" onClick={() => alert('Appel prochainement')}><Smartphone size={18} /> Appeler</button>
          </div>
        </div>
      </div>
    );
  };

  const filteredConvs = (conversations || []).filter(c => {
    const title = (c.title || c.contacts?.display_name || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    const matchesQuery = title.includes(query);
    if (view === 'all') return matchesQuery;
    return matchesQuery && c.platform === view;
  });

  const filteredContacts = (contacts || []).filter(c => (c.display_name || '').toLowerCase().includes(searchQuery.toLowerCase()));

  const ConnectModal = () => (
    <div className="modal-overlay" onClick={() => setShowConnect(false)}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={() => setShowConnect(false)}><Plus style={{ transform: 'rotate(45deg)' }} /></button>
        {connectStep === 'select' && (
          <div className="step-select">
            <h2>Nouveau Compte</h2>
            <p style={{ color: 'var(--text-dim)', marginBottom: '24px' }}>Choisissez votre plateforme</p>
            <div className="plat-grid">
              <button onClick={startWhatsAppConnect} className="btn-wa">
                <Smartphone size={24} /> WhatsApp
              </button>
              <button onClick={() => setConnectStep('ig_login')} className="btn-ig">
                <Instagram size={24} /> Instagram
              </button>
            </div>
          </div>
        )}
        {connectStep === 'whatsapp_qr' && (
          <div className="step-qr">
            <h2>Scanner le QR Code</h2>
            <div className="qr-box shadow-max" style={{ background: '#fff', padding: '15px', borderRadius: '20px', display: 'inline-block', marginTop: '20px' }}>
              {waQr ? <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(waQr)}`} alt="QR" style={{ display: 'block' }} /> : 'Génération...'}
            </div>
            <p style={{ marginTop: '20px', color: 'var(--text-dim)' }}>Ouvrez WhatsApp > Appareils connectés</p>
          </div>
        )}
        {connectStep === 'ig_login' && (
          <form className="step-ig" onSubmit={e => { e.preventDefault(); startInstagramConnect(); }}>
            <h2>Instagram</h2>
            <input placeholder="Utilisateur" value={igData.username} onChange={e => setIgData({...igData, username: e.target.value})} style={{ width: '100%', padding: '15px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', marginBottom: '10px' }} />
            <input type="password" placeholder="Mot de passe" value={igData.password} onChange={e => setIgData({...igData, password: e.target.value})} style={{ width: '100%', padding: '15px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: '#fff', marginBottom: '20px' }} />
            <button type="submit" className="primary-btn" style={{ width: '100%' }}>Se connecter</button>
          </form>
        )}
      </div>
    </div>
  );

  return (
    <div className={`app-container ${isMobile ? 'is-mobile' : ''}`}>
      {/* Sidebar Navigation */}
      <nav className="nav-rail glass">
        <div className="nav-top">
          <button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}><LayoutGrid size={24} /></button>
          <button className={view === 'contacts' ? 'active' : ''} onClick={() => setView('contacts')}><Users size={24} /></button>
          <div className="nav-sep" />
          <button className={view === 'whatsapp' ? 'active wa' : ''} onClick={() => setView('whatsapp')}><Smartphone size={24} /></button>
          <button className={view === 'instagram' ? 'active ig' : ''} onClick={() => setView('instagram')}><Instagram size={24} /></button>
        </div>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')}><Settings size={24} /></button>
      </nav>

      {/* Main Content Areas */}
      {view === 'settings' ? (
        <main className="main-pane scrollable">
          <div className="pane-header">
            <h1>Paramètres</h1>
            <button className="icon-btn" onClick={preloadData}><RefreshCw size={18} /></button>
          </div>
          <div className="settings-list">
            <section className="settings-group">
              <h3>Comptes Connectés</h3>
              {accounts.map(acc => (
                <div key={acc.id} className="acc-card glass">
                  <div className="acc-info">
                    <span className={`plat-tag ${acc.platform}`}>{acc.platform}</span>
                    <strong>{acc.account_name || 'Chargement...'}</strong>
                    <div className={`status ${acc.status}`}>{acc.status}</div>
                  </div>
                  <button onClick={() => disconnectAccount(acc.id)} className="logout-btn"><LogOut size={16} /></button>
                </div>
              ))}
              <button className="add-acc-btn" onClick={() => { setShowConnect(true); setConnectStep('select'); }}><Plus size={18} /> Connecter</button>
            </section>
            <section className="settings-group">
              <button className="sync-all-btn" onClick={() => axios.post(`${API_BASE}/sync/all`).then(() => alert('Synchro lancée'))}>Forcer la Synchronisation</button>
            </section>
          </div>
        </main>
      ) : (
        <>
          <aside className={`list-pane ${activeConv && isMobile ? 'hide' : ''}`}>
            <div className="pane-header">
              <h1>{view === 'contacts' ? 'Contacts' : 'Hub'}</h1>
              <div className="search-wrap">
                <Search size={16} /><input placeholder="Rechercher..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
              </div>
            </div>
            <div className="item-list scrollable">
              {view === 'contacts' ? (
                filteredContacts.map(c => (
                  <div key={c.id} className="item-card" onClick={() => setSelectedContact(c)}>
                    <div className="ia-avatar">{c.avatar_url ? <img src={c.avatar_url} alt="" /> : (c.display_name?.[0] || '?')}</div>
                    <div className="ia-info"><strong>{c.display_name}</strong><span>{c.external_id?.split('@')[0]}</span></div>
                  </div>
                ))
              ) : (
                filteredConvs.map(c => (
                  <div key={c.id} className={`item-card ${activeConv?.id === c.id ? 'active' : ''}`} onClick={() => setActiveConv(c)}>
                    <div className="ia-avatar">
                      {c.contacts?.avatar_url ? <img src={c.contacts.avatar_url} alt="" /> : (c.title?.[0] || '?')}
                      <div className={`ia-badge ${c.platform}`}>{c.platform === 'whatsapp' ? <Smartphone size={8} /> : <Instagram size={8} />}</div>
                    </div>
                    <div className="ia-info"><strong>{c.title || c.contacts?.display_name}</strong><p>{c.last_message_preview}</p></div>
                  </div>
                ))
              )}
            </div>
          </aside>

          <main className={`chat-pane ${!activeConv && isMobile ? 'hide' : ''}`}>
            {activeConv ? (
              <div className="chat-box">
                <header className="chat-head">
                  {isMobile && <button onClick={() => setActiveConv(null)} className="back-btn"><Plus style={{ transform: 'rotate(45deg)' }} /></button>}
                  <div className="head-avatar">{activeConv.contacts?.avatar_url ? <img src={activeConv.contacts.avatar_url} alt="" /> : (activeConv.title?.[0] || '?')}</div>
                  <div className="head-info"><h3>{activeConv.title || activeConv.contacts?.display_name}</h3><div className="online"><span />En ligne</div></div>
                </header>
                <div className="msg-list scrollable">
                  {messages.map(m => (
                    <div key={m.id} className={`msg-wrap ${m.is_from_me ? 'is-me' : 'is-them'}`}>
                      <div className="msg-bubble">{m.content}</div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
                <div className="msg-input-wrap">
                  <form onSubmit={e => { e.preventDefault(); sendMessage(); }}>
                    <input placeholder="Répondre..." value={messageInput} onChange={e => setMessageInput(e.target.value)} />
                    <button type="submit" disabled={!messageInput.trim()}><Send size={20} /></button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="chat-empty">
                <div className="empty-icon glass" style={{ width: '80px', height: '80px', borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.03)', marginBottom: '20px' }}><MessageSquare size={40} /></div>
                <h3>Votre Centre Relais</h3>
                <p>Vos messages WhatsApp et Instagram centralisés en un seul endroit.</p>
                {accounts.length === 0 && (
                  <button className="main-add-btn" onClick={() => { setShowConnect(true); setConnectStep('select'); }}>
                    Connecter un compte
                  </button>
                )}
              </div>
            )}
          </main>
        </>
      )}

      {showConnect && <ConnectModal />}
      {selectedContact && <ProfileModal />}
    </div>
  );
}

export default App;
