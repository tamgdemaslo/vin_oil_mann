CREATE TABLE "ai_assistant_quotes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL DEFAULT 'default',
    "thread_id" TEXT NOT NULL,
    "run_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "vehicle_id" TEXT,
    "vehicle_display_name" TEXT,
    "vehicle_snapshot_json" JSONB NOT NULL DEFAULT '{}',
    "service_name" TEXT,
    "selected_scenario" TEXT,
    "included_items_json" JSONB NOT NULL DEFAULT '[]',
    "optional_items_json" JSONB NOT NULL DEFAULT '[]',
    "base_total_cents" INTEGER NOT NULL,
    "maximum_total_cents" INTEGER,
    "price_range_json" JSONB NOT NULL DEFAULT '{}',
    "assumptions_json" JSONB NOT NULL DEFAULT '[]',
    "internal_warnings_json" JSONB NOT NULL DEFAULT '[]',
    "customer_safe_warnings_json" JSONB NOT NULL DEFAULT '[]',
    "valid_until" TIMESTAMPTZ(6),
    "is_selected" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_assistant_quotes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_assistant_quotes_organization_id_thread_id_is_selected_created_at_idx"
ON "ai_assistant_quotes"("organization_id", "thread_id", "is_selected", "created_at");

CREATE INDEX "ai_assistant_quotes_organization_id_run_id_idx"
ON "ai_assistant_quotes"("organization_id", "run_id");

ALTER TABLE "ai_assistant_quotes"
ADD CONSTRAINT "ai_assistant_quotes_thread_id_fkey"
FOREIGN KEY ("thread_id") REFERENCES "ai_assistant_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_assistant_quotes"
ADD CONSTRAINT "ai_assistant_quotes_run_id_fkey"
FOREIGN KEY ("run_id") REFERENCES "ai_assistant_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
