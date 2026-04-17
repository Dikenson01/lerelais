# LeRelais — Unified Messaging Hub (SaaS)

## Vision produit

LeRelais est un **hub de messagerie unifié multi-utilisateur**, comme Beeper ou Franz.  
Chaque personne crée son propre compte LeRelais, connecte toutes ses applications de messagerie, et reçoit/envoie tout depuis une seule interface.

---

## Ce que c'est

**Pour l'utilisateur final :**
- Je crée un compte sur lerelais.app
- Je connecte mon WhatsApp perso + mon WhatsApp business + mon Instagram + mon Signal
- Tous mes messages de toutes ces plateformes arrivent dans une seule boîte de réception
- Je réponds, j'envoie des photos/audios/vidéos directement depuis LeRelais
- Si un ami crée aussi un compte LeRelais, ses données sont totalement séparées des miennes

**Ce n'est PAS :**
- Un outil mono-utilisateur
- Un outil où les données de différents utilisateurs se mélangent
- Une appli limitée au texte (les médias doivent fonctionner)

---

## Architecture cible

### Couche utilisateurs (multi-tenant)
```
users (table)
  id UUID PK
  email TEXT UNIQUE
  password_hash TEXT
  created_at TIMESTAMPTZ

accounts (table existante)
  id UUID PK
  user_id UUID FK → users.id   ← CLEF DE L'ISOLATION
  platform TEXT ('whatsapp', 'instagram', 'signal', 'snapchat', 'telegram')
  status TEXT
  username TEXT
  ...

contacts, conversations, messages, media
  → tous filtrés via account_id → user_id
  → un utilisateur ne voit JAMAIS les données d'un autre
```

### Plateformes supportées (par priorité)
| Plateforme | Statut | Lib/API | Envoi texte | Envoi médias |
|---|---|---|---|---|
| WhatsApp | ✅ En prod | @whiskeysockets/baileys | ✅ | 🔧 À finir |
| Instagram DM | 🔧 Partiel | instagram-private-api | ✅ | 🔧 |
| Signal | 🎯 Priorité 2 | signal-cli / @signalapp | 🎯 | 🎯 |
| Telegram | 🎯 Priorité 3 | gramjs / telegraf | 🎯 | 🎯 |
| Snapchat | 🎯 Priorité 4 | snapchat-unofficial-api | 🎯 | 🎯 |

### Envoi de médias (priorité immédiate)
- Photos : upload → stockage Supabase Storage → envoi via API plateforme
- Audios : enregistrement navigateur (MediaRecorder API) → upload → envoi
- Vidéos : upload → compression si nécessaire → envoi
- Documents : upload → envoi
- Supabase Storage bucket : "Le Relais Media" (déjà créé, public)

---

## Stack technique actuelle

```
Backend : Node.js 22 + Express
  src/index.js          — API REST + routing + auth
  src/connectors/
    whatsapp.js         — Baileys (WhatsApp Web API)
    instagram.js        — Instagram connector
  src/config/supabase.js

Frontend : React 18 + Vite
  web/src/App.jsx       — Interface unifiée
  web/src/App.css

Base de données : Supabase (PostgreSQL)
  → Schema complet dans RELAIS_SCHEMA.sql

Déploiement : Railway (auto-deploy depuis GitHub main)
  → Variables Railway : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    TELEGRAM_BOT_TOKEN, ACCESS_PASSWORD, WHATSAPP_ACCOUNT_ID (temporaire)

Storage médias : Supabase Storage
  → Bucket : "Le Relais Media" (public)
  → Path : {account_id}/{message_id}.{ext}
```

---

## Ce qui est fait

- [x] Connexion WhatsApp par QR code (Baileys)
- [x] Synchronisation historique complet (messaging-history.set)
- [x] Sync contacts avec photos de profil
- [x] Réception messages texte temps réel
- [x] Envoi messages texte
- [x] Téléchargement médias reçus → Supabase Storage
- [x] Affichage images/vidéos/audio dans l'interface
- [x] Interface unifiée responsive (mobile + desktop)
- [x] Inbox triée par dernier message
- [x] Répertoire contacts avec numéros formatés
- [x] Filtrage conversations archivées

## Ce qui reste à faire (par priorité)

### P0 — Multi-utilisateur (FONDATION)
- [ ] Table `users` avec email + mot de passe hashé (bcrypt)
- [ ] `accounts.user_id` FK → users
- [ ] Toutes les queries filtrées par `user_id` (pas juste `account_id`)
- [ ] Inscription / Connexion dans le frontend
- [ ] JWT par utilisateur (remplace le token global actuel)
- [ ] Page "Mes comptes connectés" par utilisateur

### P1 — Envoi de médias
- [ ] Upload photo depuis le chat (input file + compression)
- [ ] Enregistrement audio dans le navigateur (bouton micro)
- [ ] Envoi via sock.sendMessage({ image: buffer }) pour WhatsApp
- [ ] Preview avant envoi

### P2 — Nouvelles plateformes
- [ ] Signal (signal-cli REST API ou @signalapp/signal-client)
- [ ] Telegram (gramjs — MTProto, pas Telegraf)
- [ ] Page "Connecter une plateforme" avec OAuth/QR par plateforme

### P3 — UX
- [ ] Notifications push (Service Worker)
- [ ] Recherche dans les messages
- [ ] Conversations épinglées
- [ ] Statut en ligne des contacts

---

## Schéma migration multi-utilisateur

```sql
-- 1. Table utilisateurs
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  telegram_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Lier les comptes aux utilisateurs
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts(user_id);

-- 3. Row Level Security (optionnel mais recommandé)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
-- Policy : un utilisateur voit uniquement ses conversations
CREATE POLICY user_isolation ON conversations
  USING (account_id IN (
    SELECT id FROM accounts WHERE user_id = current_setting('app.current_user_id')::UUID
  ));
```

---

## Variables d'environnement Railway

```env
# Supabase
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

# Auth
ACCESS_PASSWORD=...         # Mot de passe admin temporaire (avant multi-user)
WHATSAPP_ACCOUNT_ID=...     # Temporaire : verrouille sur 1 compte

# Telegram
TELEGRAM_BOT_TOKEN=...
ADMIN_ID=...

# App
PORT=8080
NODE_ENV=production
WEBAPP_URL=https://lerelais.up.railway.app
```

---

## Fichiers clés à connaître

| Fichier | Rôle |
|---|---|
| `src/index.js` | Serveur Express, toutes les routes API |
| `src/connectors/whatsapp.js` | Moteur WhatsApp (Baileys), sync, médias |
| `src/connectors/instagram.js` | Connecteur Instagram |
| `web/src/App.jsx` | Interface React complète |
| `RELAIS_SCHEMA.sql` | Schéma PostgreSQL complet |
| `.env` | Variables locales (gitignored) |

---

## Conventions de code

- **Backend** : ESModules (`import/export`), async/await, pas de callbacks
- **Supabase** : toujours `maybeSingle()` pour les queries qui peuvent ne rien retourner
- **Médias** : stocker dans Supabase Storage, sauvegarder `media_url` dans `messages`
- **Colonne date** : `last_message_at` (PAS `updated_at`) dans `conversations`
- **Contacts** : ne jamais écraser `avatar_url` avec `null` dans un upsert
- **Logs** : utiliser `logger.info/warn/error` (winston), jamais `console.log`
