-- Idempotency for automatic replies: one inbound external message may produce
-- one agent run and one outbound message even if Telegram retries a webhook or
-- polling sees the same message after a reconnect.
ALTER TABLE "ai_agent_runs"
  ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
  ADD COLUMN IF NOT EXISTS "outbound_message_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_agent_runs_idempotency_key_key"
  ON "ai_agent_runs"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ai_agent_runs_org_idempotency_key_idx"
  ON "ai_agent_runs"("organization_id", "idempotency_key");
