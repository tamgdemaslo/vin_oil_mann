CREATE TABLE IF NOT EXISTS notification_templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  body TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  branch_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  event_type TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  channel TEXT NOT NULL,
  template_id TEXT NOT NULL,
  timing_type TEXT NOT NULL DEFAULT 'immediate',
  offset_minutes INTEGER,
  conditions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  branch_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  client_id TEXT,
  appointment_id TEXT,
  diagnostic_report_id TEXT,
  template_id TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  idempotency_key TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  messenger_message_id TEXT,
  messenger_outbox_id TEXT,
  conversation_id TEXT,
  branch_id TEXT,
  initiated_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  notification_job_id TEXT,
  event_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  client_id TEXT,
  appointment_id TEXT,
  diagnostic_report_id TEXT,
  template_id TEXT,
  status TEXT NOT NULL,
  rendered_message TEXT,
  error_message TEXT,
  provider_message_id TEXT,
  initiated_by_id TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_notification_preferences (
  client_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT 'default',
  telegram_enabled BOOLEAN NOT NULL DEFAULT true,
  consent_status TEXT NOT NULL DEFAULT 'unknown',
  consent_source TEXT,
  consent_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_jobs_org_idempotency_uidx
  ON notification_jobs(organization_id, idempotency_key);
CREATE INDEX IF NOT EXISTS notification_templates_org_event_idx
  ON notification_templates(organization_id, event_type, channel, is_active);
CREATE INDEX IF NOT EXISTS notification_templates_org_branch_idx
  ON notification_templates(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS notification_rules_org_event_idx
  ON notification_rules(organization_id, event_type, enabled);
CREATE INDEX IF NOT EXISTS notification_rules_org_branch_idx
  ON notification_rules(organization_id, branch_id);
CREATE INDEX IF NOT EXISTS notification_rules_template_idx
  ON notification_rules(template_id);
CREATE INDEX IF NOT EXISTS notification_jobs_org_status_idx
  ON notification_jobs(organization_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS notification_jobs_org_event_idx
  ON notification_jobs(organization_id, event_type);
CREATE INDEX IF NOT EXISTS notification_jobs_client_idx
  ON notification_jobs(client_id);
CREATE INDEX IF NOT EXISTS notification_jobs_appointment_idx
  ON notification_jobs(appointment_id);
CREATE INDEX IF NOT EXISTS notification_jobs_diagnostic_idx
  ON notification_jobs(diagnostic_report_id);
CREATE INDEX IF NOT EXISTS notification_logs_org_created_idx
  ON notification_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_logs_org_event_idx
  ON notification_logs(organization_id, event_type);
CREATE INDEX IF NOT EXISTS notification_logs_org_status_idx
  ON notification_logs(organization_id, status);
CREATE INDEX IF NOT EXISTS notification_logs_client_idx
  ON notification_logs(client_id);
CREATE INDEX IF NOT EXISTS notification_logs_appointment_idx
  ON notification_logs(appointment_id);
CREATE INDEX IF NOT EXISTS notification_logs_diagnostic_idx
  ON notification_logs(diagnostic_report_id);
CREATE INDEX IF NOT EXISTS client_notification_preferences_org_idx
  ON client_notification_preferences(organization_id, telegram_enabled, consent_status);

ALTER TABLE IF EXISTS messenger_messages
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

UPDATE messenger_messages
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;
