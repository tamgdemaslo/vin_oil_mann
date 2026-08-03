ALTER TABLE "diagnostic_map_photos"
  ADD COLUMN "content_type" TEXT,
  ADD COLUMN "size_bytes" INTEGER,
  ADD COLUMN "data" BYTEA;
