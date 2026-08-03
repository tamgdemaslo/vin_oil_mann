-- Operational state for long-running client agent calculations.
ALTER TABLE ai_agent_settings
  ADD COLUMN IF NOT EXISTS timeout_rules_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ai_agent_runs
  ADD COLUMN IF NOT EXISTS trigger_message_id TEXT,
  ADD COLUMN IF NOT EXISTS client_id TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_id TEXT,
  ADD COLUMN IF NOT EXISTS quote_id TEXT,
  ADD COLUMN IF NOT EXISTS current_stage TEXT,
  ADD COLUMN IF NOT EXISTS stage_label TEXT,
  ADD COLUMN IF NOT EXISTS stage_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requires_human_approval BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS human_approval_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_tool_name TEXT,
  ADD COLUMN IF NOT EXISTS last_tool_status TEXT,
  ADD COLUMN IF NOT EXISTS completed_stages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS collected_data_summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS client_progress_message_id TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE ai_agent_runs ALTER COLUMN status SET DEFAULT 'queued';

UPDATE ai_agent_runs
SET trigger_message_id = COALESCE(trigger_message_id, source_message_id),
    heartbeat_at = COALESCE(heartbeat_at, started_at),
    updated_at = COALESCE(updated_at, created_at, now())
WHERE trigger_message_id IS NULL OR heartbeat_at IS NULL;

CREATE INDEX IF NOT EXISTS ai_agent_runs_org_conversation_status_heartbeat_idx
  ON ai_agent_runs (organization_id, conversation_id, status, heartbeat_at);
CREATE UNIQUE INDEX IF NOT EXISTS messenger_outbox_org_idempotency_uidx
  ON messenger_outbox (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_agent_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  stage TEXT,
  public_label TEXT,
  internal_label TEXT,
  tool_name TEXT,
  tool_status TEXT,
  duration_ms INTEGER,
  sanitized_payload JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_agent_run_events_run_created_idx
  ON ai_agent_run_events (run_id, created_at);
CREATE INDEX IF NOT EXISTS ai_agent_run_events_type_created_idx
  ON ai_agent_run_events (event_type, created_at);
