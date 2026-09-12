ALTER TABLE "local_product_photos"
ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'AVITO';

ALTER TABLE "local_product_photos"
ADD CONSTRAINT "local_product_photos_purpose_check"
CHECK ("purpose" IN ('AVITO', 'STOREFRONT'));

CREATE INDEX "local_product_photos_branch_id_product_id_purpose_created_at_idx"
ON "local_product_photos"("branch_id", "product_id", "purpose", "created_at");
