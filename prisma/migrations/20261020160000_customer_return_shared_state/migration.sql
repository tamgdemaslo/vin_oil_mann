-- Apply separately after an approved Timeweb backup. Never applied at startup.
CREATE TABLE "customer_return_states" (
  "branch_id" TEXT NOT NULL,
  "service_date" VARCHAR(10) NOT NULL,
  "client_key" VARCHAR(400) NOT NULL,
  "draft_text" TEXT,
  "draft_fingerprint" TEXT,
  "skipped" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by_login" TEXT NOT NULL,
  "updated_by_name" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_return_states_pkey" PRIMARY KEY ("branch_id", "service_date", "client_key"),
  CONSTRAINT "customer_return_states_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_return_states_version_check" CHECK ("version" > 0),
  CONSTRAINT "customer_return_states_date_check" CHECK ("service_date" ~ '^\d{4}-\d{2}-\d{2}$'),
  CONSTRAINT "customer_return_states_draft_check" CHECK (("draft_text" IS NULL) = ("draft_fingerprint" IS NULL)),
  CONSTRAINT "customer_return_states_text_length_check" CHECK ("draft_text" IS NULL OR length("draft_text") <= 10000)
);
