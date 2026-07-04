CREATE TABLE "diagnostic_map_vehicle_photos" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "content_type" TEXT,
  "size_bytes" INTEGER,
  "data" BYTEA,
  "caption" TEXT,
  "uploaded_by" TEXT,
  "source" TEXT NOT NULL DEFAULT 'diagnostic',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "diagnostic_map_vehicle_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "diagnostic_map_vehicle_photos_session_id_key" ON "diagnostic_map_vehicle_photos"("session_id");

ALTER TABLE "diagnostic_map_vehicle_photos"
  ADD CONSTRAINT "diagnostic_map_vehicle_photos_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "diagnostic_map_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
