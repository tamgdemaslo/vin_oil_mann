CREATE TABLE IF NOT EXISTS messenger_accounts (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  mode TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  username TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'disconnected',
  last_sync_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS messenger_accounts_channel_mode_phone_uidx
  ON messenger_accounts(channel, mode, phone)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS messenger_accounts_channel_mode_idx
  ON messenger_accounts(channel, mode);

CREATE INDEX IF NOT EXISTS messenger_accounts_status_idx
  ON messenger_accounts(status);

CREATE TABLE IF NOT EXISTS telegram_user_sessions (
  id TEXT PRIMARY KEY,
  messenger_account_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  api_id_encrypted JSONB,
  api_hash_encrypted JSONB,
  session_encrypted JSONB,
  phone_code_hash_encrypted JSONB,
  status TEXT NOT NULL DEFAULT 'disconnected',
  last_authorized_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT telegram_user_sessions_account_fk
    FOREIGN KEY (messenger_account_id) REFERENCES messenger_accounts(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS telegram_user_sessions_account_uidx
  ON telegram_user_sessions(messenger_account_id);

CREATE INDEX IF NOT EXISTS telegram_user_sessions_status_idx
  ON telegram_user_sessions(status);

ALTER TABLE messenger_conversations
  ADD COLUMN IF NOT EXISTS messenger_account_id TEXT,
  ADD COLUMN IF NOT EXISTS external_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS external_user_id TEXT,
  ADD COLUMN IF NOT EXISTS participant_username TEXT;

ALTER TABLE messenger_outbox
  ADD COLUMN IF NOT EXISTS messenger_account_id TEXT;

CREATE INDEX IF NOT EXISTS messenger_conversations_account_idx
  ON messenger_conversations(messenger_account_id);

CREATE INDEX IF NOT EXISTS messenger_conversations_external_chat_idx
  ON messenger_conversations(channel, external_chat_id);

CREATE INDEX IF NOT EXISTS messenger_outbox_account_idx
  ON messenger_outbox(messenger_account_id);
