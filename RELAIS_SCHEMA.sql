-- ==========================================
-- LERELAIS HUB - PROFESSIONAL UNIFIED SCHEMA (v2.0)
-- ==========================================

-- 1. ACCOUNTS (Master Accounts for Connectors)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(50) NOT NULL, -- 'whatsapp', 'instagram', 'telegram', 'facebook'
    account_name VARCHAR(255),
    external_id VARCHAR(255) UNIQUE, -- Phone (WA) or Username (IG)
    status VARCHAR(50) DEFAULT 'disconnected', -- 'connected', 'disconnected', 'pairing'
    credentials JSONB DEFAULT '{}', -- Auth sesssion tokens
    settings JSONB DEFAULT '{ "notifications": true, "auto_reply": false }',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CONTACT IDENTITIES (Unique person logic)
CREATE TABLE IF NOT EXISTS identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255),
    phone VARCHAR(50) UNIQUE, -- Unified key for cross-platform linking
    email VARCHAR(255),
    tags TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CONTACTS (Platform-specific contacts)
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    identity_id UUID REFERENCES identities(id) ON DELETE SET NULL, -- Link to merged identity
    external_id VARCHAR(255) NOT NULL, -- JID (WA) or PK (IG)
    display_name VARCHAR(255),
    avatar_url TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, external_id)
);

-- 4. CONVERSATIONS (One-to-one or Groups)
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL, -- NULL for groups
    external_id VARCHAR(255) NOT NULL, -- JID (WA) or ThreadID
    platform VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    is_group BOOLEAN DEFAULT FALSE,
    unread_count INTEGER DEFAULT 0,
    last_message_preview TEXT,
    group_metadata JSONB DEFAULT '{}', -- Store members, admins, description
    metadata JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, external_id)
);

-- 5. LABELS (For categorization)
CREATE TABLE IF NOT EXISTS labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    color VARCHAR(20) DEFAULT '#7289da'
);

CREATE TABLE IF NOT EXISTS conversation_labels (
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    label_id UUID REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, label_id)
);

-- 6. MESSAGES (Universal message storage)
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    remote_id VARCHAR(255) UNIQUE, -- Original message ID
    sender_id VARCHAR(255), -- External ID of sender
    content TEXT,
    is_from_me BOOLEAN DEFAULT FALSE,
    media_url TEXT,
    media_type VARCHAR(50), -- 'image', 'video', 'document', 'audio'
    status VARCHAR(50) DEFAULT 'sent', -- 'sent', 'delivered', 'read'
    metadata JSONB DEFAULT '{}',
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 7. MEDIA ASSETS (For tracking files)
CREATE TABLE IF NOT EXISTS media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID REFERENCES messages(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    file_name VARCHAR(255),
    mime_type VARCHAR(100),
    size_bytes BIGINT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. BROADCASTS (Bulk Messaging)
CREATE TABLE IF NOT EXISTS broadcasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255),
    platform VARCHAR(50),
    content TEXT,
    media_url TEXT,
    status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sending', 'completed', 'failed'
    target_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    scheduled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS broadcast_logs (
    id BIGSERIAL PRIMARY KEY,
    broadcast_id UUID REFERENCES broadcasts(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    status VARCHAR(50),
    error_message TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. SYSTEM LOGS (Audit trail)
CREATE TABLE IF NOT EXISTS system_logs (
    id BIGSERIAL PRIMARY KEY,
    level VARCHAR(20), -- 'info', 'warn', 'error'
    module VARCHAR(50), -- 'wa', 'ig', 'bot', 'api'
    message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. ACCOUNT SESSIONS & BOT STATE (Redundancy & Multi-instance locking)
CREATE TABLE IF NOT EXISTS account_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE CASCADE,
    namespace VARCHAR(100) DEFAULT 'wa_session', -- 'wa_session', 'wa_backup', 'wa_lock'
    filename TEXT NOT NULL,
    data TEXT NOT NULL, -- JSON content of the session file
    metadata JSONB DEFAULT '{}', -- For lock owner and timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(account_id, namespace, filename)
);

-- Index for lock lookup and session recovery
CREATE INDEX IF NOT EXISTS idx_sessions_ns ON account_sessions(account_id, namespace);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_account ON conversations(account_id);
CREATE INDEX IF NOT EXISTS idx_contacts_account ON contacts(account_id);
CREATE INDEX IF NOT EXISTS idx_contacts_identity ON contacts(identity_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON identities(phone);
