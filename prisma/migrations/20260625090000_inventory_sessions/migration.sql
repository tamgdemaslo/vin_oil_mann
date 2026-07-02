ALTER TABLE "inventory_ledger_entries"
  ADD COLUMN "organization_id" TEXT,
  ADD COLUMN "cell_id" TEXT,
  ADD COLUMN "batch_id" TEXT,
  ADD COLUMN "total_cost_snapshot" INTEGER,
  ADD COLUMN "analytics_impact" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "inventory_sessions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "count_mode" TEXT NOT NULL DEFAULT 'BLIND',
  "warehouse_mode" TEXT NOT NULL DEFAULT 'LOCKED',
  "scope_type" TEXT NOT NULL DEFAULT 'WAREHOUSE',
  "scope_json" JSONB,
  "options_json" JSONB,
  "snapshot_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "counting_completed_at" TIMESTAMP(3),
  "reviewed_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "posted_at" TIMESTAMP(3),
  "reversed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "responsible_id" TEXT,
  "approved_by_id" TEXT,
  "comment" TEXT,
  "reverse_reason" TEXT,
  "cancel_reason" TEXT,
  "total_lines" INTEGER NOT NULL DEFAULT 0,
  "counted_lines" INTEGER NOT NULL DEFAULT 0,
  "matching_lines" INTEGER NOT NULL DEFAULT 0,
  "shortage_lines" INTEGER NOT NULL DEFAULT 0,
  "surplus_lines" INTEGER NOT NULL DEFAULT 0,
  "recount_required_lines" INTEGER NOT NULL DEFAULT 0,
  "total_shortage_cost_cents" INTEGER NOT NULL DEFAULT 0,
  "total_surplus_cost_cents" INTEGER NOT NULL DEFAULT 0,
  "management_expense_cents" INTEGER NOT NULL DEFAULT 0,
  "technical_adjustment_cents" INTEGER NOT NULL DEFAULT 0,
  "last_post_idempotency_key" TEXT,
  "last_reverse_idempotency_key" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_lines" (
  "id" TEXT NOT NULL,
  "inventory_session_id" TEXT NOT NULL,
  "product_id" TEXT,
  "warehouse_id" TEXT NOT NULL,
  "cell_id" TEXT,
  "batch_id" TEXT,
  "unit_id" TEXT,
  "snapshot_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "snapshot_reserved_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "snapshot_available_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "expected_quantity_at_count" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "first_count_quantity" DECIMAL(14,3),
  "second_count_quantity" DECIMAL(14,3),
  "final_quantity" DECIMAL(14,3),
  "difference_quantity" DECIMAL(14,3),
  "unit_cost_snapshot_cents" INTEGER,
  "difference_cost_cents" INTEGER,
  "counted_at" TIMESTAMP(3),
  "counted_by_id" TEXT,
  "recounted_at" TIMESTAMP(3),
  "recounted_by_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'NOT_COUNTED',
  "proposed_action" TEXT,
  "final_action" TEXT,
  "reason_code" TEXT,
  "comment" TEXT,
  "requires_recount" BOOLEAN NOT NULL DEFAULT false,
  "affects_management_profit" BOOLEAN NOT NULL DEFAULT true,
  "is_unexpected" BOOLEAN NOT NULL DEFAULT false,
  "exclusion_reason" TEXT,
  "stock_version" INTEGER NOT NULL DEFAULT 1,
  "lock_owner_id" TEXT,
  "lock_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_count_entries" (
  "id" TEXT NOT NULL,
  "inventory_line_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "counter_id" TEXT,
  "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "comment" TEXT,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_count_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_attachments" (
  "id" TEXT NOT NULL,
  "inventory_line_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "uploaded_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_movement_links" (
  "id" TEXT NOT NULL,
  "inventory_session_id" TEXT NOT NULL,
  "inventory_line_id" TEXT,
  "ledger_entry_id" TEXT,
  "document_type" TEXT,
  "document_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_movement_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_assignments" (
  "id" TEXT NOT NULL,
  "inventory_session_id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "scope_json" JSONB,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_locks" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "product_id" TEXT,
  "category_id" TEXT,
  "cell_id" TEXT,
  "batch_id" TEXT,
  "inventory_session_id" TEXT NOT NULL,
  "locked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMP(3),
  CONSTRAINT "inventory_locks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_schedules" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "warehouse_id" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_json" JSONB,
  "frequency" TEXT NOT NULL,
  "responsible_id" TEXT,
  "next_date" TIMESTAMP(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_audit_logs" (
  "id" TEXT NOT NULL,
  "inventory_session_id" TEXT NOT NULL,
  "inventory_line_id" TEXT,
  "action" TEXT NOT NULL,
  "old_value_json" JSONB,
  "new_value_json" JSONB,
  "user_id" TEXT,
  "user_name" TEXT,
  "source" TEXT DEFAULT 'UI',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_sessions_organization_id_number_key" ON "inventory_sessions"("organization_id", "number");
CREATE INDEX "inventory_sessions_warehouse_id_idx" ON "inventory_sessions"("warehouse_id");
CREATE INDEX "inventory_sessions_status_idx" ON "inventory_sessions"("status");
CREATE INDEX "inventory_sessions_scope_type_idx" ON "inventory_sessions"("scope_type");
CREATE INDEX "inventory_sessions_snapshot_at_idx" ON "inventory_sessions"("snapshot_at");
CREATE INDEX "inventory_sessions_started_at_idx" ON "inventory_sessions"("started_at");
CREATE INDEX "inventory_sessions_posted_at_idx" ON "inventory_sessions"("posted_at");

CREATE INDEX "inventory_lines_inventory_session_id_idx" ON "inventory_lines"("inventory_session_id");
CREATE INDEX "inventory_lines_product_id_idx" ON "inventory_lines"("product_id");
CREATE INDEX "inventory_lines_warehouse_id_idx" ON "inventory_lines"("warehouse_id");
CREATE INDEX "inventory_lines_cell_id_idx" ON "inventory_lines"("cell_id");
CREATE INDEX "inventory_lines_batch_id_idx" ON "inventory_lines"("batch_id");
CREATE INDEX "inventory_lines_status_idx" ON "inventory_lines"("status");
CREATE INDEX "inventory_lines_requires_recount_idx" ON "inventory_lines"("requires_recount");

CREATE UNIQUE INDEX "inventory_count_entries_inventory_line_id_sequence_key" ON "inventory_count_entries"("inventory_line_id", "sequence");
CREATE INDEX "inventory_count_entries_inventory_line_id_idx" ON "inventory_count_entries"("inventory_line_id");
CREATE INDEX "inventory_count_entries_counter_id_idx" ON "inventory_count_entries"("counter_id");
CREATE INDEX "inventory_count_entries_source_idx" ON "inventory_count_entries"("source");

CREATE INDEX "inventory_attachments_inventory_line_id_idx" ON "inventory_attachments"("inventory_line_id");
CREATE INDEX "inventory_attachments_type_idx" ON "inventory_attachments"("type");

CREATE INDEX "inventory_movement_links_inventory_session_id_idx" ON "inventory_movement_links"("inventory_session_id");
CREATE INDEX "inventory_movement_links_inventory_line_id_idx" ON "inventory_movement_links"("inventory_line_id");
CREATE INDEX "inventory_movement_links_ledger_entry_id_idx" ON "inventory_movement_links"("ledger_entry_id");
CREATE INDEX "inventory_movement_links_document_type_document_id_idx" ON "inventory_movement_links"("document_type", "document_id");

CREATE INDEX "inventory_assignments_inventory_session_id_idx" ON "inventory_assignments"("inventory_session_id");
CREATE INDEX "inventory_assignments_employee_id_idx" ON "inventory_assignments"("employee_id");
CREATE INDEX "inventory_assignments_status_idx" ON "inventory_assignments"("status");

CREATE INDEX "inventory_locks_organization_id_warehouse_id_idx" ON "inventory_locks"("organization_id", "warehouse_id");
CREATE INDEX "inventory_locks_product_id_idx" ON "inventory_locks"("product_id");
CREATE INDEX "inventory_locks_category_id_idx" ON "inventory_locks"("category_id");
CREATE INDEX "inventory_locks_cell_id_idx" ON "inventory_locks"("cell_id");
CREATE INDEX "inventory_locks_inventory_session_id_idx" ON "inventory_locks"("inventory_session_id");
CREATE INDEX "inventory_locks_released_at_idx" ON "inventory_locks"("released_at");

CREATE INDEX "inventory_schedules_organization_id_warehouse_id_idx" ON "inventory_schedules"("organization_id", "warehouse_id");
CREATE INDEX "inventory_schedules_next_date_idx" ON "inventory_schedules"("next_date");
CREATE INDEX "inventory_schedules_active_idx" ON "inventory_schedules"("active");

CREATE INDEX "inventory_audit_logs_inventory_session_id_idx" ON "inventory_audit_logs"("inventory_session_id");
CREATE INDEX "inventory_audit_logs_inventory_line_id_idx" ON "inventory_audit_logs"("inventory_line_id");
CREATE INDEX "inventory_audit_logs_action_idx" ON "inventory_audit_logs"("action");
CREATE INDEX "inventory_audit_logs_user_id_idx" ON "inventory_audit_logs"("user_id");
CREATE INDEX "inventory_audit_logs_created_at_idx" ON "inventory_audit_logs"("created_at");

CREATE INDEX "inventory_ledger_entries_organization_id_idx" ON "inventory_ledger_entries"("organization_id");
CREATE INDEX "inventory_ledger_entries_cell_id_idx" ON "inventory_ledger_entries"("cell_id");
CREATE INDEX "inventory_ledger_entries_batch_id_idx" ON "inventory_ledger_entries"("batch_id");

ALTER TABLE "inventory_ledger_entries"
  ADD CONSTRAINT "inventory_ledger_entries_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "local_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_sessions"
  ADD CONSTRAINT "inventory_sessions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "local_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_sessions"
  ADD CONSTRAINT "inventory_sessions_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "local_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_lines"
  ADD CONSTRAINT "inventory_lines_inventory_session_id_fkey"
  FOREIGN KEY ("inventory_session_id") REFERENCES "inventory_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_lines"
  ADD CONSTRAINT "inventory_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "local_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_lines"
  ADD CONSTRAINT "inventory_lines_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "local_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_count_entries"
  ADD CONSTRAINT "inventory_count_entries_inventory_line_id_fkey"
  FOREIGN KEY ("inventory_line_id") REFERENCES "inventory_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_attachments"
  ADD CONSTRAINT "inventory_attachments_inventory_line_id_fkey"
  FOREIGN KEY ("inventory_line_id") REFERENCES "inventory_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_movement_links"
  ADD CONSTRAINT "inventory_movement_links_inventory_session_id_fkey"
  FOREIGN KEY ("inventory_session_id") REFERENCES "inventory_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_movement_links"
  ADD CONSTRAINT "inventory_movement_links_inventory_line_id_fkey"
  FOREIGN KEY ("inventory_line_id") REFERENCES "inventory_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_movement_links"
  ADD CONSTRAINT "inventory_movement_links_ledger_entry_id_fkey"
  FOREIGN KEY ("ledger_entry_id") REFERENCES "inventory_ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "inventory_assignments"
  ADD CONSTRAINT "inventory_assignments_inventory_session_id_fkey"
  FOREIGN KEY ("inventory_session_id") REFERENCES "inventory_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_locks"
  ADD CONSTRAINT "inventory_locks_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "local_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_locks"
  ADD CONSTRAINT "inventory_locks_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "local_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_locks"
  ADD CONSTRAINT "inventory_locks_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "local_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_locks"
  ADD CONSTRAINT "inventory_locks_inventory_session_id_fkey"
  FOREIGN KEY ("inventory_session_id") REFERENCES "inventory_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_audit_logs"
  ADD CONSTRAINT "inventory_audit_logs_inventory_session_id_fkey"
  FOREIGN KEY ("inventory_session_id") REFERENCES "inventory_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_audit_logs"
  ADD CONSTRAINT "inventory_audit_logs_inventory_line_id_fkey"
  FOREIGN KEY ("inventory_line_id") REFERENCES "inventory_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
