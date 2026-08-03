-- Runtime DDL is forbidden. These tables were historically bootstrapped from
-- request handlers; make their creation explicit and repeatable instead.

CREATE TABLE IF NOT EXISTS integration_providers (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  adapter_status TEXT NOT NULL DEFAULT 'planned',
  capability_status TEXT NOT NULL DEFAULT 'requires_audit',
  capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  platform_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_providers_channel_provider_key_key
  ON integration_providers(channel, provider_key);

CREATE TABLE IF NOT EXISTS integration_credentials (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  business_group_id TEXT NOT NULL DEFAULT 'group-main' REFERENCES business_groups(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  provider_id TEXT REFERENCES integration_providers(id) ON DELETE SET NULL,
  messenger_account_id TEXT REFERENCES messenger_accounts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  key TEXT NOT NULL,
  encrypted_value JSONB NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  last_validated_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_by_id TEXT,
  rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_onboarding_sessions (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  channel TEXT NOT NULL,
  provider_key TEXT,
  messenger_account_id TEXT REFERENCES messenger_accounts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  current_step TEXT NOT NULL DEFAULT 'capability_audit',
  data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_by_id TEXT,
  expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  provider_id TEXT REFERENCES integration_providers(id) ON DELETE SET NULL,
  messenger_account_id TEXT REFERENCES messenger_accounts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled',
  secret_ref TEXT,
  external_subscription_id TEXT,
  last_event_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messenger_attachments (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  message_id TEXT NOT NULL REFERENCES messenger_messages(id) ON DELETE CASCADE,
  messenger_account_id TEXT,
  conversation_id TEXT,
  channel TEXT NOT NULL,
  direction TEXT,
  external_attachment_id TEXT,
  external_file_id TEXT,
  external_document_id TEXT,
  external_message_id TEXT,
  external_peer_id TEXT,
  telegram_dc_id INTEGER,
  type TEXT NOT NULL,
  url TEXT,
  name TEXT,
  size INTEGER,
  mime_type TEXT,
  preview_url TEXT,
  original_storage_key TEXT,
  thumbnail_storage_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  caption TEXT,
  width INTEGER,
  height INTEGER,
  duration INTEGER,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messenger_media_jobs (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  messenger_account_id TEXT,
  attachment_id TEXT NOT NULL REFERENCES messenger_attachments(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_attempt_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messenger_delivery_events (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  message_id TEXT NOT NULL REFERENCES messenger_messages(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  external_event_id TEXT,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messenger_sync_cursors (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  messenger_account_id TEXT NOT NULL REFERENCES messenger_accounts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  scope TEXT NOT NULL,
  cursor_value TEXT,
  cursor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS communication_consents (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  channel TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  external_user_id TEXT,
  external_chat_id TEXT,
  consent_status TEXT NOT NULL DEFAULT 'unknown',
  source TEXT,
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS communication_identities (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  channel TEXT NOT NULL,
  messenger_account_id TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  external_conversation_id TEXT,
  username TEXT,
  display_name TEXT,
  phone_normalized TEXT,
  entity_type TEXT NOT NULL DEFAULT 'OTHER',
  client_id TEXT,
  supplier_id TEXT,
  employee_id TEXT,
  status TEXT NOT NULL DEFAULT 'SUGGESTED',
  match_source TEXT NOT NULL DEFAULT 'MANUAL',
  linked_by_id TEXT,
  linked_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversation_entity_links (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  conversation_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'RELATED',
  created_by_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_audit_logs (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  channel TEXT,
  messenger_account_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  message TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_settings (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main' REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  organization_id TEXT NOT NULL DEFAULT 'default',
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Existing runtime-created tables are upgraded without data mutation.
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS branch_id TEXT NOT NULL DEFAULT 'branch-main';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_settings_branch_id_fkey') THEN
    ALTER TABLE notification_settings ADD CONSTRAINT notification_settings_branch_id_fkey
      FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS integration_credentials_branch_id_idx ON integration_credentials(branch_id);
CREATE INDEX IF NOT EXISTS integration_credentials_business_group_id_status_idx ON integration_credentials(business_group_id, status);
CREATE INDEX IF NOT EXISTS messenger_attachments_branch_id_idx ON messenger_attachments(branch_id);
CREATE INDEX IF NOT EXISTS messenger_media_jobs_branch_id_idx ON messenger_media_jobs(branch_id);
CREATE INDEX IF NOT EXISTS messenger_sync_cursors_branch_id_idx ON messenger_sync_cursors(branch_id);
CREATE INDEX IF NOT EXISTS communication_identities_branch_id_idx ON communication_identities(branch_id);
CREATE INDEX IF NOT EXISTS conversation_entity_links_branch_id_idx ON conversation_entity_links(branch_id);
CREATE INDEX IF NOT EXISTS integration_audit_logs_branch_id_idx ON integration_audit_logs(branch_id);
