-- Expand-only foundation for controlled CRM -> client-site publication.
-- This creates empty configuration, binding, audit and preview/apply tables.
-- It intentionally does not configure a storefront, link products, publish
-- cards, backfill data or change existing rows.

BEGIN;

CREATE TABLE "storefronts" (
  "id" TEXT NOT NULL,
  "business_group_id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefronts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storefronts_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "storefronts_business_group_id_fkey"
    FOREIGN KEY ("business_group_id") REFERENCES "business_groups"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "storefronts_business_group_id_slug_key" ON "storefronts"("business_group_id", "slug");
CREATE INDEX "storefronts_status_idx" ON "storefronts"("status");

CREATE TABLE "storefront_branches" (
  "id" TEXT NOT NULL,
  "storefront_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "public_name" TEXT,
  "public_address" TEXT,
  "public_phone" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_branches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storefront_branches_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "storefront_branches_storefront_id_fkey"
    FOREIGN KEY ("storefront_id") REFERENCES "storefronts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "storefront_branches_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "storefront_branches_storefront_id_branch_id_key" ON "storefront_branches"("storefront_id", "branch_id");
CREATE UNIQUE INDEX "storefront_branches_id_branch_id_key" ON "storefront_branches"("id", "branch_id");
CREATE INDEX "storefront_branches_storefront_id_status_sort_order_idx" ON "storefront_branches"("storefront_id", "status", "sort_order");
CREATE INDEX "storefront_branches_branch_id_idx" ON "storefront_branches"("branch_id");

CREATE TABLE "storefront_branch_stores" (
  "id" TEXT NOT NULL,
  "storefront_branch_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "store_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_branch_stores_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storefront_branch_stores_storefront_branch_fkey"
    FOREIGN KEY ("storefront_branch_id", "branch_id") REFERENCES "storefront_branches"("id", "branch_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "storefront_branch_stores_store_fkey"
    FOREIGN KEY ("branch_id", "store_id") REFERENCES "local_stores"("branch_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "storefront_branch_stores_storefront_branch_id_store_id_key" ON "storefront_branch_stores"("storefront_branch_id", "store_id");
CREATE INDEX "storefront_branch_stores_branch_id_store_id_idx" ON "storefront_branch_stores"("branch_id", "store_id");

CREATE TABLE "storefront_products" (
  "id" TEXT NOT NULL,
  "storefront_id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "publication_state" TEXT NOT NULL DEFAULT 'HIDDEN',
  "content_source_branch_id" TEXT NOT NULL,
  "content_source_product_id" TEXT NOT NULL,
  "public_name" TEXT,
  "public_description" TEXT,
  "public_image_href" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_products_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storefront_products_publication_state_check" CHECK ("publication_state" IN ('HIDDEN', 'PUBLISHED')),
  CONSTRAINT "storefront_products_version_check" CHECK ("version" > 0),
  CONSTRAINT "storefront_products_storefront_id_fkey"
    FOREIGN KEY ("storefront_id") REFERENCES "storefronts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "storefront_products_content_source_fkey"
    FOREIGN KEY ("content_source_branch_id", "content_source_product_id") REFERENCES "local_products"("branch_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "storefront_products_storefront_id_slug_key" ON "storefront_products"("storefront_id", "slug");
CREATE INDEX "storefront_products_storefront_id_publication_state_updated_at_idx" ON "storefront_products"("storefront_id", "publication_state", "updated_at");
CREATE INDEX "storefront_products_content_source_branch_id_content_source_product_id_idx" ON "storefront_products"("content_source_branch_id", "content_source_product_id");

CREATE TABLE "storefront_product_bindings" (
  "id" TEXT NOT NULL,
  "storefront_product_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "local_product_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
  "identity_evidence" TEXT NOT NULL DEFAULT 'MANUAL',
  "confirmed_by_login" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_product_bindings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storefront_product_bindings_status_check" CHECK ("status" IN ('CONFIRMED', 'DISABLED')),
  CONSTRAINT "storefront_product_bindings_evidence_check" CHECK ("identity_evidence" IN ('CONFIRMED_BINDING', 'SOURCE_LINEAGE', 'BARCODE', 'BRAND_ARTICLE', 'MANUAL')),
  CONSTRAINT "storefront_product_bindings_storefront_product_id_fkey"
    FOREIGN KEY ("storefront_product_id") REFERENCES "storefront_products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "storefront_product_bindings_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "storefront_product_bindings_local_product_fkey"
    FOREIGN KEY ("branch_id", "local_product_id") REFERENCES "local_products"("branch_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "storefront_product_bindings_storefront_product_id_branch_id_key" ON "storefront_product_bindings"("storefront_product_id", "branch_id");
CREATE UNIQUE INDEX "storefront_product_bindings_local_product_id_key" ON "storefront_product_bindings"("local_product_id");
CREATE INDEX "storefront_product_bindings_branch_id_local_product_id_idx" ON "storefront_product_bindings"("branch_id", "local_product_id");
CREATE INDEX "storefront_product_bindings_status_idx" ON "storefront_product_bindings"("status");

CREATE TABLE "storefront_product_audits" (
  "id" TEXT NOT NULL,
  "storefront_product_id" TEXT NOT NULL,
  "actor_login" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before_state" TEXT,
  "after_state" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_product_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storefront_product_audits_storefront_product_id_fkey"
    FOREIGN KEY ("storefront_product_id") REFERENCES "storefront_products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "storefront_product_audits_storefront_product_id_created_at_idx" ON "storefront_product_audits"("storefront_product_id", "created_at");
CREATE INDEX "storefront_product_audits_actor_login_created_at_idx" ON "storefront_product_audits"("actor_login", "created_at");

CREATE TABLE "storefront_publication_batches" (
  "id" TEXT NOT NULL,
  "storefront_id" TEXT NOT NULL,
  "requested_state" TEXT NOT NULL,
  "selection_json" JSONB NOT NULL,
  "selection_hash" TEXT NOT NULL,
  "selected_rows" INTEGER NOT NULL DEFAULT 0,
  "unique_products" INTEGER NOT NULL DEFAULT 0,
  "already_desired" INTEGER NOT NULL DEFAULT 0,
  "ready_items" INTEGER NOT NULL DEFAULT 0,
  "blocked_items" INTEGER NOT NULL DEFAULT 0,
  "applied_items" INTEGER NOT NULL DEFAULT 0,
  "skipped_items" INTEGER NOT NULL DEFAULT 0,
  "failed_items" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PREVIEW',
  "created_by_login" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "applied_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_publication_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storefront_publication_batches_requested_state_check" CHECK ("requested_state" IN ('HIDDEN', 'PUBLISHED')),
  CONSTRAINT "storefront_publication_batches_status_check" CHECK ("status" IN ('PREVIEW', 'APPLIED', 'PARTIAL', 'EXPIRED')),
  CONSTRAINT "storefront_publication_batches_counts_check" CHECK (
    "selected_rows" >= 0 AND "unique_products" >= 0 AND "already_desired" >= 0 AND
    "ready_items" >= 0 AND "blocked_items" >= 0 AND "applied_items" >= 0 AND
    "skipped_items" >= 0 AND "failed_items" >= 0
  ),
  CONSTRAINT "storefront_publication_batches_storefront_id_fkey"
    FOREIGN KEY ("storefront_id") REFERENCES "storefronts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "storefront_publication_batches_storefront_id_created_at_idx" ON "storefront_publication_batches"("storefront_id", "created_at");
CREATE INDEX "storefront_publication_batches_created_by_login_status_expires_at_idx" ON "storefront_publication_batches"("created_by_login", "status", "expires_at");

CREATE TABLE "storefront_publication_batch_items" (
  "id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "branch_id" TEXT NOT NULL,
  "local_product_id" TEXT NOT NULL,
  "local_product_updated_at" TIMESTAMP(3) NOT NULL,
  "storefront_product_id" TEXT,
  "storefront_product_version" INTEGER,
  "readiness_json" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "result" TEXT NOT NULL DEFAULT 'PENDING',
  "error_code" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "storefront_publication_batch_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "storefront_publication_batch_items_result_check" CHECK ("result" IN ('PENDING', 'APPLIED', 'SKIPPED', 'BLOCKED', 'CONFLICT', 'ERROR')),
  CONSTRAINT "storefront_publication_batch_items_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "storefront_publication_batches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "storefront_publication_batch_items_local_product_fkey"
    FOREIGN KEY ("branch_id", "local_product_id") REFERENCES "local_products"("branch_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "storefront_publication_batch_items_storefront_product_id_fkey"
    FOREIGN KEY ("storefront_product_id") REFERENCES "storefront_products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "storefront_publication_batch_items_batch_id_local_product_id_key" ON "storefront_publication_batch_items"("batch_id", "local_product_id");
CREATE INDEX "storefront_publication_batch_items_storefront_product_id_idx" ON "storefront_publication_batch_items"("storefront_product_id");
CREATE INDEX "storefront_publication_batch_items_branch_id_local_product_id_idx" ON "storefront_publication_batch_items"("branch_id", "local_product_id");
CREATE INDEX "storefront_publication_batch_items_result_idx" ON "storefront_publication_batch_items"("result");

COMMIT;
