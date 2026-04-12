-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Accounts table
create table if not exists accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid, -- Link to auth.users if needed
  platform text not null, -- 'whatsapp', 'instagram', 'snapchat', 'signal'
  account_name text,
  session_data jsonb, -- Encrypted session/tokens
  status text default 'disconnected',
  last_sync_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- 2. Contacts table
create table if not exists contacts (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references accounts(id) on delete cascade,
  external_id text not null,
  full_name text,
  display_name text,
  avatar_url text,
  phone_number text,
  username text,
  metadata jsonb,
  last_message_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- 3. Conversations table
create table if not exists conversations (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references accounts(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  external_conversation_id text not null,
  is_group boolean default false,
  title text,
  last_message_preview text,
  unread_count integer default 0,
  platform text not null,
  metadata jsonb,
  updated_at timestamp with time zone default now()
);

-- 4. Messages table
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid references conversations(id) on delete cascade,
  sender_id text,
  content text, -- Encrypted
  content_type text default 'text', -- 'text', 'image', 'video', 'audio', 'document'
  media_url text,
  timestamp timestamp with time zone default now(),
  is_from_me boolean default false,
  status text default 'pending',
  metadata jsonb
);

-- 5. Sync Logs table
create table if not exists sync_logs (
  id uuid primary key default uuid_generate_v4(),
  account_id uuid references accounts(id) on delete cascade,
  sync_type text, -- 'initial', 'incremental'
  status text,
  details text,
  created_at timestamp with time zone default now()
);

-- Indexes for performance
create index if not exists idx_messages_conversation on messages(conversation_id);
create index if not exists idx_contacts_account on contacts(account_id);
create index if not exists idx_conversations_account on conversations(account_id);
create index if not exists idx_accounts_platform on accounts(platform);
