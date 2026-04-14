-- ============================================================
-- LeRelais — Migration Multi-Utilisateur v1
-- À exécuter dans : Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Table des utilisateurs LeRelais
CREATE TABLE IF NOT EXISTS relais_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'free',           -- 'free', 'pro', 'business'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- 2. Lier les comptes de messagerie aux utilisateurs
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES relais_users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts(user_id);

-- 3. Lier les contacts aux utilisateurs (direct, pas juste via account)
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES relais_users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS contacts_user_id_idx ON contacts(user_id);

-- 4. Lier les conversations aux utilisateurs
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES relais_users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS conversations_user_id_idx ON conversations(user_id);

-- 5. last_message_preview sur conversations (si absent)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_message_preview TEXT;

-- 6. Colonnes médias sur messages (si absentes)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(50);

-- 7. Vérification
SELECT 'relais_users' as table_name, count(*) FROM relais_users
UNION ALL
SELECT 'accounts', count(*) FROM accounts
UNION ALL
SELECT 'conversations', count(*) FROM conversations
UNION ALL
SELECT 'contacts', count(*) FROM contacts;
