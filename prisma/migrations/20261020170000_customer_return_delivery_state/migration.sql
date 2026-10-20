-- Apply separately after approval and a verified Timeweb backup. No startup DDL.
ALTER TABLE "customer_return_states"
  ADD COLUMN "delivery_status" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "delivery_attempt_id" TEXT,
  ADD COLUMN "delivery_conversation_id" TEXT,
  ADD COLUMN "delivery_message_id" TEXT,
  ADD COLUMN "delivery_at" TIMESTAMPTZ(6),
  ADD COLUMN "delivery_error" TEXT,
  ADD CONSTRAINT "customer_return_states_delivery_status_check" CHECK ("delivery_status" IN ('none','sending','sent','queued','failed','unknown'));
