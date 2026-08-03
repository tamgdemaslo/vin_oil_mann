CREATE TABLE "ai_agent_settings" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "mode" TEXT NOT NULL DEFAULT 'observe',
  "agent_name" TEXT NOT NULL DEFAULT 'Помощник Там где масло',
  "model_name" TEXT DEFAULT 'gpt-5.6-terra',
  "prompt_version" TEXT NOT NULL DEFAULT 'tgm-client-agent-v1',
  "tone" TEXT NOT NULL DEFAULT 'friendly_brief',
  "greeting" TEXT,
  "language" TEXT NOT NULL DEFAULT 'ru',
  "channels_json" JSONB NOT NULL DEFAULT '["telegram"]'::jsonb,
  "allowed_services_json" JSONB NOT NULL DEFAULT '["engine_oil_change"]'::jsonb,
  "allowed_store_ids_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "business_hours_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "trusted_domains_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "calculation_rules_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "response_delay_seconds" INTEGER NOT NULL DEFAULT 8,
  "max_turns" INTEGER NOT NULL DEFAULT 12,
  "max_messages_without_handoff" INTEGER NOT NULL DEFAULT 8,
  "auto_booking_enabled" BOOLEAN NOT NULL DEFAULT false,
  "booking_approval_required" BOOLEAN NOT NULL DEFAULT true,
  "slot_hold_minutes" INTEGER NOT NULL DEFAULT 7,
  "min_booking_lead_minutes" INTEGER NOT NULL DEFAULT 60,
  "max_booking_horizon_days" INTEGER NOT NULL DEFAULT 30,
  "slot_suggestion_count" INTEGER NOT NULL DEFAULT 3,
  "rossko_search_enabled" BOOLEAN NOT NULL DEFAULT true,
  "rossko_order_approval_required" BOOLEAN NOT NULL DEFAULT true,
  "internet_search_enabled" BOOLEAN NOT NULL DEFAULT false,
  "handoff_rules_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_by_id" TEXT,
  "updated_by_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_agent_settings_mode_check" CHECK ("mode" IN ('observe', 'confirm', 'autonomous'))
);

CREATE UNIQUE INDEX "ai_agent_settings_organization_id_key" ON "ai_agent_settings"("organization_id");
CREATE INDEX "ai_agent_settings_enabled_mode_idx" ON "ai_agent_settings"("enabled", "mode");

CREATE TABLE "ai_agent_sessions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "conversation_id" TEXT NOT NULL,
  "client_id" TEXT,
  "counterparty_id" TEXT,
  "vehicle_id" TEXT,
  "appointment_id" TEXT,
  "quote_id" TEXT,
  "shipment_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'idle',
  "intent" TEXT,
  "confidence" DOUBLE PRECISION,
  "history_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "collected_data_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "pending_run_state" TEXT,
  "pending_approvals_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "last_draft_text" TEXT,
  "last_error" TEXT,
  "human_taken_over_at" TIMESTAMPTZ(6),
  "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_agent_sessions_organization_id_conversation_id_key" ON "ai_agent_sessions"("organization_id", "conversation_id");
CREATE INDEX "ai_agent_sessions_organization_id_status_last_activity_at_idx" ON "ai_agent_sessions"("organization_id", "status", "last_activity_at");
CREATE INDEX "ai_agent_sessions_client_id_idx" ON "ai_agent_sessions"("client_id");
CREATE INDEX "ai_agent_sessions_vehicle_id_idx" ON "ai_agent_sessions"("vehicle_id");

CREATE TABLE "ai_service_quotes" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "conversation_id" TEXT NOT NULL,
  "client_id" TEXT,
  "vehicle_id" TEXT,
  "appointment_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "service_type" TEXT NOT NULL,
  "vehicle_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "requirements_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "source_evidence" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "quote_options" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "selected_option" JSONB,
  "total_cents" INTEGER,
  "valid_until" TIMESTAMPTZ(6),
  "created_by" TEXT NOT NULL DEFAULT 'ai',
  "approved_by_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_service_quotes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_service_quotes_organization_id_conversation_id_created_at_idx" ON "ai_service_quotes"("organization_id", "conversation_id", "created_at");
CREATE INDEX "ai_service_quotes_client_id_idx" ON "ai_service_quotes"("client_id");
CREATE INDEX "ai_service_quotes_vehicle_id_idx" ON "ai_service_quotes"("vehicle_id");
CREATE INDEX "ai_service_quotes_status_valid_until_idx" ON "ai_service_quotes"("status", "valid_until");

CREATE TABLE "ai_agent_runs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "conversation_id" TEXT NOT NULL,
  "session_id" TEXT,
  "source_message_id" TEXT,
  "trigger_type" TEXT NOT NULL DEFAULT 'manual',
  "mode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "intent" TEXT,
  "model" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "input_text_masked" TEXT,
  "output_text" TEXT,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "estimated_cost_micros" INTEGER,
  "duration_ms" INTEGER,
  "error_message" TEXT,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_agent_runs_organization_id_source_message_id_key" ON "ai_agent_runs"("organization_id", "source_message_id");
CREATE INDEX "ai_agent_runs_organization_id_conversation_id_created_at_idx" ON "ai_agent_runs"("organization_id", "conversation_id", "created_at");
CREATE INDEX "ai_agent_runs_status_created_at_idx" ON "ai_agent_runs"("status", "created_at");

CREATE TABLE "ai_agent_tool_calls" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "run_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "tool_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'running',
  "arguments_masked" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "result_summary" JSONB,
  "requires_approval" BOOLEAN NOT NULL DEFAULT false,
  "approved_by_id" TEXT,
  "error_message" TEXT,
  "duration_ms" INTEGER,
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "ai_agent_tool_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_agent_tool_calls_organization_id_run_id_started_at_idx" ON "ai_agent_tool_calls"("organization_id", "run_id", "started_at");
CREATE INDEX "ai_agent_tool_calls_conversation_id_started_at_idx" ON "ai_agent_tool_calls"("conversation_id", "started_at");

CREATE TABLE "ai_agent_decisions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "run_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "decision_type" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "reason" TEXT,
  "confidence" DOUBLE PRECISION,
  "evidence_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_agent_decisions_organization_id_conversation_id_created_at_idx" ON "ai_agent_decisions"("organization_id", "conversation_id", "created_at");
CREATE INDEX "ai_agent_decisions_run_id_idx" ON "ai_agent_decisions"("run_id");

CREATE TABLE "ai_agent_handoffs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "run_id" TEXT,
  "conversation_id" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "collected_data_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "products_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "quote_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "assigned_to_id" TEXT,
  "resolved_by_id" TEXT,
  "resolved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_agent_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_agent_handoffs_organization_id_status_created_at_idx" ON "ai_agent_handoffs"("organization_id", "status", "created_at");
CREATE INDEX "ai_agent_handoffs_conversation_id_created_at_idx" ON "ai_agent_handoffs"("conversation_id", "created_at");

CREATE TABLE "ai_agent_slot_holds" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL DEFAULT 'default',
  "conversation_id" TEXT NOT NULL,
  "quote_id" TEXT,
  "slot_id" TEXT NOT NULL,
  "slot_snapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" TEXT NOT NULL DEFAULT 'held',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMPTZ(6),
  CONSTRAINT "ai_agent_slot_holds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_agent_slot_holds_organization_id_slot_id_expires_at_idx" ON "ai_agent_slot_holds"("organization_id", "slot_id", "expires_at");
CREATE INDEX "ai_agent_slot_holds_conversation_id_status_idx" ON "ai_agent_slot_holds"("conversation_id", "status");
