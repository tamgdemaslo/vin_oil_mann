-- The internal assistant is intentionally isolated from the retired
-- client-facing agent. It has no foreign keys to CRM conversations.
UPDATE "ai_agent_settings"
SET "enabled" = false,
    "mode" = 'off',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "enabled" = true OR "mode" <> 'off';

CREATE TABLE "ai_assistant_threads" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "created_by_id" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT 'Новый разговор',
  "status" TEXT NOT NULL DEFAULT 'active',
  "last_response_id" TEXT,
  "summary" TEXT,
  "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_assistant_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_assistant_messages" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "citations_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "attachments_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "run_id" TEXT,
  "created_by_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_assistant_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_assistant_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "ai_assistant_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ai_assistant_runs" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "requested_by_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "model" TEXT NOT NULL,
  "reasoning" TEXT NOT NULL,
  "input_message_id" TEXT,
  "response_id" TEXT,
  "tool_summary_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "error_code" TEXT,
  "error_message" TEXT,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "duration_ms" INTEGER,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_assistant_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_assistant_runs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "ai_assistant_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ai_assistant_tool_calls" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "tool_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "arguments_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "result_summary" JSONB,
  "error_message" TEXT,
  "duration_ms" INTEGER,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "ai_assistant_tool_calls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_assistant_tool_calls_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_assistant_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ai_assistant_sources" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "message_id" TEXT,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "source_type" TEXT NOT NULL,
  "title" TEXT,
  "url" TEXT,
  "excerpt" TEXT,
  "metadata_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_assistant_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_assistant_sources_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_assistant_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ai_assistant_threads_org_creator_activity_idx" ON "ai_assistant_threads"("organization_id", "created_by_id", "last_message_at");
CREATE INDEX "ai_assistant_threads_org_status_activity_idx" ON "ai_assistant_threads"("organization_id", "status", "last_message_at");
CREATE INDEX "ai_assistant_messages_thread_created_idx" ON "ai_assistant_messages"("thread_id", "created_at");
CREATE INDEX "ai_assistant_messages_org_created_idx" ON "ai_assistant_messages"("organization_id", "created_at");
CREATE INDEX "ai_assistant_runs_org_thread_created_idx" ON "ai_assistant_runs"("organization_id", "thread_id", "created_at");
CREATE INDEX "ai_assistant_runs_org_status_started_idx" ON "ai_assistant_runs"("organization_id", "status", "started_at");
CREATE INDEX "ai_assistant_tool_calls_run_started_idx" ON "ai_assistant_tool_calls"("run_id", "started_at");
CREATE INDEX "ai_assistant_tool_calls_org_tool_started_idx" ON "ai_assistant_tool_calls"("organization_id", "tool_name", "started_at");
CREATE INDEX "ai_assistant_sources_run_created_idx" ON "ai_assistant_sources"("run_id", "created_at");
CREATE INDEX "ai_assistant_sources_org_type_created_idx" ON "ai_assistant_sources"("organization_id", "source_type", "created_at");
