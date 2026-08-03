CREATE TABLE "local_product_photos" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "file_name" TEXT,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_product_photos_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "local_product_photos_product_id_idx" ON "local_product_photos"("product_id");

ALTER TABLE "local_product_photos"
ADD CONSTRAINT "local_product_photos_product_id_fkey"
FOREIGN KEY ("product_id") REFERENCES "local_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
