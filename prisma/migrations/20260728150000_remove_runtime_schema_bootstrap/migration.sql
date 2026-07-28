-- Runtime code must never create application tables. Keep the cache schema in
-- the reviewed migration chain, including installations where the historical
-- lazy bootstrap was never executed.
CREATE TABLE IF NOT EXISTS "vin_lookup_cache" (
  "branch_id" TEXT NOT NULL,
  "vin" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "vin_lookup_cache_pkey" PRIMARY KEY ("branch_id", "vin")
);

CREATE INDEX IF NOT EXISTS "vin_lookup_cache_expires_at_idx"
  ON "vin_lookup_cache"("expires_at");
CREATE INDEX IF NOT EXISTS "vin_lookup_cache_branch_id_idx"
  ON "vin_lookup_cache"("branch_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vin_lookup_cache_branch_id_fkey'
  ) THEN
    ALTER TABLE "vin_lookup_cache"
      ADD CONSTRAINT "vin_lookup_cache_branch_id_fkey"
      FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
