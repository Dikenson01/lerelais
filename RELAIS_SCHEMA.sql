-- 1. Table des comptes connectés
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  platform TEXT NOT NULL,
  status TEXT DEFAULT 'pairing',
  username TEXT,
  credentials JSONB,
  last_sync TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Table des contacts synchronisés
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  last_message_at TIMESTAMP WITH TIME ZONE
);

-- 3. Table des conversations
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE NOT NULL,
  platform TEXT NOT NULL,
  title TEXT,
  last_message TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Table des messages
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  metadata JSONB
);
