import { prisma } from "@/lib/db";
import { getMessengerOrganizationId } from "./messenger-tenant";

let ensurePromise: Promise<void> | null = null;

export async function ensureMessengerIntegrationCoreSchema() {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const orgId = getMessengerOrganizationId();

      await prisma.$executeRaw`
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
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS integration_credentials (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          provider_id TEXT,
          messenger_account_id TEXT,
          channel TEXT NOT NULL,
          key TEXT NOT NULL,
          encrypted_value JSONB NOT NULL,
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by_id TEXT,
          rotated_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS integration_onboarding_sessions (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          channel TEXT NOT NULL,
          provider_key TEXT,
          messenger_account_id TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          current_step TEXT NOT NULL DEFAULT 'capability_audit',
          data_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          error_message TEXT,
          created_by_id TEXT,
          expires_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS webhook_subscriptions (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          provider_id TEXT,
          messenger_account_id TEXT,
          channel TEXT NOT NULL,
          url TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'disabled',
          secret_ref TEXT,
          external_subscription_id TEXT,
          last_event_at TIMESTAMPTZ,
          last_error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS messenger_attachments (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          message_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          external_attachment_id TEXT,
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
          error_code TEXT,
          error_message TEXT,
          caption TEXT,
          width INTEGER,
          height INTEGER,
          duration INTEGER,
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS messenger_delivery_events (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          message_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          external_event_id TEXT,
          event_type TEXT NOT NULL,
          status TEXT NOT NULL,
          raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS messenger_sync_cursors (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          messenger_account_id TEXT NOT NULL,
          channel TEXT NOT NULL,
          scope TEXT NOT NULL,
          cursor_value TEXT,
          cursor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          last_synced_at TIMESTAMPTZ,
          error_message TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS communication_consents (
          id TEXT PRIMARY KEY,
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
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS communication_identities (
          id TEXT PRIMARY KEY,
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
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS conversation_entity_links (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          conversation_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          relation_type TEXT NOT NULL DEFAULT 'RELATED',
          created_by_id TEXT,
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS integration_audit_logs (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          channel TEXT,
          messenger_account_id TEXT,
          actor_id TEXT,
          action TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'ok',
          message TEXT,
          metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;

      await prisma.$executeRaw`ALTER TABLE messenger_connections ADD COLUMN IF NOT EXISTS organization_id TEXT NOT NULL DEFAULT 'default'`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS organization_id TEXT NOT NULL DEFAULT 'default'`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS external_account_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS avatar_url TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS connected_by_user_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS last_outbound_at TIMESTAMPTZ`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS error_code TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_accounts ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await prisma.$executeRaw`ALTER TABLE telegram_user_sessions ADD COLUMN IF NOT EXISTS organization_id TEXT NOT NULL DEFAULT 'default'`;
      await prisma.$executeRaw`ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS organization_id TEXT NOT NULL DEFAULT 'default'`;
      await prisma.$executeRaw`ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS external_participant_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS avatar_storage_key TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS avatar_thumbnail_key TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS avatar_telegram_photo_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS avatar_status TEXT NOT NULL DEFAULT 'pending'`;
      await prisma.$executeRaw`ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ`;
      await prisma.$executeRaw`ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS avatar_error TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_conversations ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await prisma.$executeRaw`ALTER TABLE messenger_messages ADD COLUMN IF NOT EXISTS organization_id TEXT NOT NULL DEFAULT 'default'`;
      await prisma.$executeRaw`ALTER TABLE messenger_messages ADD COLUMN IF NOT EXISTS messenger_account_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_messages ADD COLUMN IF NOT EXISTS external_reply_to_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'`;
      await prisma.$executeRaw`ALTER TABLE messenger_messages ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ`;
      await prisma.$executeRaw`ALTER TABLE messenger_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`;
      await prisma.$executeRaw`ALTER TABLE messenger_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`;
      await prisma.$executeRaw`ALTER TABLE messenger_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
      await prisma.$executeRaw`ALTER TABLE messenger_messages ALTER COLUMN created_at SET DEFAULT now()`;
      await prisma.$executeRaw`ALTER TABLE messenger_messages ALTER COLUMN updated_at SET DEFAULT now()`;
      await prisma.$executeRaw`UPDATE messenger_messages SET updated_at = COALESCE(updated_at, created_at, now()) WHERE updated_at IS NULL`;
      await prisma.$executeRaw`ALTER TABLE messenger_outbox ADD COLUMN IF NOT EXISTS organization_id TEXT NOT NULL DEFAULT 'default'`;
      await prisma.$executeRaw`ALTER TABLE messenger_outbox ADD COLUMN IF NOT EXISTS idempotency_key TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_webhook_events ADD COLUMN IF NOT EXISTS organization_id TEXT NOT NULL DEFAULT 'default'`;
      await prisma.$executeRaw`ALTER TABLE messenger_templates ADD COLUMN IF NOT EXISTS organization_id TEXT NOT NULL DEFAULT 'default'`;
      await prisma.$executeRaw`ALTER TABLE messenger_link_tokens ADD COLUMN IF NOT EXISTS organization_id TEXT NOT NULL DEFAULT 'default'`;
      await prisma.$executeRaw`ALTER TABLE messenger_channel_settings ADD COLUMN IF NOT EXISTS organization_id TEXT NOT NULL DEFAULT 'default'`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS original_storage_key TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS thumbnail_storage_key TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS messenger_account_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS conversation_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS direction TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS external_file_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS external_document_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS external_message_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS external_peer_id TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS telegram_dc_id INTEGER`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS error_code TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS error_message TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS caption TEXT`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS width INTEGER`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS height INTEGER`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS duration INTEGER`;
      await prisma.$executeRaw`ALTER TABLE messenger_attachments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`;
      await prisma.$executeRaw`ALTER TABLE communication_identities ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb`;
      await prisma.$executeRaw`ALTER TABLE conversation_entity_links ADD COLUMN IF NOT EXISTS metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb`;

      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS messenger_media_jobs (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL DEFAULT 'default',
          messenger_account_id TEXT,
          attachment_id TEXT NOT NULL,
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
        )
      `;

      await prisma.$executeRaw`UPDATE messenger_connections SET organization_id = ${orgId} WHERE organization_id IS NULL OR organization_id = ''`;
      await prisma.$executeRaw`UPDATE messenger_accounts SET organization_id = ${orgId}, enabled = COALESCE(enabled, true) WHERE organization_id IS NULL OR organization_id = ''`;
      await prisma.$executeRaw`UPDATE telegram_user_sessions SET organization_id = ${orgId} WHERE organization_id IS NULL OR organization_id = ''`;
      await prisma.$executeRaw`
        UPDATE messenger_conversations mc
        SET organization_id = COALESCE(ma.organization_id, ${orgId})
        FROM messenger_accounts ma
        WHERE mc.messenger_account_id = ma.id
          AND (mc.organization_id IS NULL OR mc.organization_id = '' OR mc.organization_id = 'default')
      `;
      await prisma.$executeRaw`UPDATE messenger_conversations SET organization_id = ${orgId} WHERE organization_id IS NULL OR organization_id = ''`;
      await prisma.$executeRaw`
        UPDATE messenger_messages mm
        SET organization_id = mc.organization_id,
            messenger_account_id = COALESCE(mm.messenger_account_id, mc.messenger_account_id)
        FROM messenger_conversations mc
        WHERE mm.conversation_id = mc.id
          AND (mm.organization_id IS NULL OR mm.organization_id = '' OR mm.organization_id = 'default')
      `;
      await prisma.$executeRaw`UPDATE messenger_messages SET organization_id = ${orgId} WHERE organization_id IS NULL OR organization_id = ''`;
      await prisma.$executeRaw`
        UPDATE messenger_outbox mo
        SET organization_id = mc.organization_id
        FROM messenger_conversations mc
        WHERE mo.conversation_id = mc.id
          AND (mo.organization_id IS NULL OR mo.organization_id = '' OR mo.organization_id = 'default')
      `;
      await prisma.$executeRaw`
        UPDATE messenger_outbox mo
        SET organization_id = ma.organization_id
        FROM messenger_accounts ma
        WHERE mo.messenger_account_id = ma.id
          AND (mo.organization_id IS NULL OR mo.organization_id = '' OR mo.organization_id = 'default')
      `;
      await prisma.$executeRaw`UPDATE messenger_outbox SET organization_id = ${orgId} WHERE organization_id IS NULL OR organization_id = ''`;
      await prisma.$executeRaw`
        UPDATE messenger_messages
        SET text = '',
            message_type = CASE WHEN message_type = 'text' THEN 'file' ELSE message_type END,
            updated_at = now()
        WHERE text = '[Вложение Telegram]'
      `;
      await prisma.$executeRaw`
        UPDATE messenger_conversations
        SET last_message_text = 'Вложение',
            updated_at = now()
        WHERE last_message_text = '[Вложение Telegram]'
      `;

      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_connections_org_channel_idx ON messenger_connections(organization_id, channel)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_accounts_org_channel_idx ON messenger_accounts(organization_id, channel, mode, status)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS telegram_user_sessions_org_account_idx ON telegram_user_sessions(organization_id, messenger_account_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_conversations_org_account_idx ON messenger_conversations(organization_id, messenger_account_id, last_message_at DESC)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_conversations_org_channel_idx ON messenger_conversations(organization_id, channel, status)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_messages_org_conversation_idx ON messenger_messages(organization_id, conversation_id, created_at)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_messages_org_dedupe_idx ON messenger_messages(organization_id, channel, external_message_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_outbox_org_status_idx ON messenger_outbox(organization_id, status, next_attempt_at)`;
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS integration_providers_channel_provider_uidx ON integration_providers(channel, provider_key)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS integration_credentials_org_channel_idx ON integration_credentials(organization_id, channel, messenger_account_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS integration_onboarding_org_channel_idx ON integration_onboarding_sessions(organization_id, channel, status)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS webhook_subscriptions_org_channel_idx ON webhook_subscriptions(organization_id, channel, status)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_attachments_message_idx ON messenger_attachments(message_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_attachments_status_idx ON messenger_attachments(organization_id, channel, status)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_attachments_account_status_idx ON messenger_attachments(organization_id, messenger_account_id, status)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_attachments_external_message_idx ON messenger_attachments(organization_id, channel, external_message_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_media_jobs_status_idx ON messenger_media_jobs(organization_id, status, next_attempt_at, created_at)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_media_jobs_attachment_idx ON messenger_media_jobs(attachment_id, operation, status)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS messenger_delivery_events_message_idx ON messenger_delivery_events(message_id)`;
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS messenger_sync_cursors_account_scope_uidx ON messenger_sync_cursors(organization_id, messenger_account_id, scope)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS communication_consents_org_channel_idx ON communication_consents(organization_id, channel, subject_type, subject_id)`;
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS communication_identities_org_account_user_uidx ON communication_identities(organization_id, messenger_account_id, external_user_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS communication_identities_org_channel_entity_idx ON communication_identities(organization_id, channel, entity_type, status)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS communication_identities_org_client_idx ON communication_identities(organization_id, client_id)`;
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS conversation_entity_links_unique_uidx ON conversation_entity_links(organization_id, conversation_id, entity_type, entity_id, relation_type)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS conversation_entity_links_conversation_idx ON conversation_entity_links(organization_id, conversation_id, entity_type)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS conversation_entity_links_entity_idx ON conversation_entity_links(organization_id, entity_type, entity_id)`;
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS integration_audit_logs_org_created_idx ON integration_audit_logs(organization_id, created_at DESC)`;
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  await ensurePromise;
}
