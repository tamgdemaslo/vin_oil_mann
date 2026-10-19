-- CreateTable
CREATE TABLE "product_kits" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_kit_items" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "kit_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_kit_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_kit_stock_targets" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "kit_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_kit_stock_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_kits_branch_id_archived_name_idx" ON "product_kits"("branch_id", "archived", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_kits_branch_id_id_key" ON "product_kits"("branch_id", "id");

-- CreateIndex
CREATE INDEX "product_kit_items_branch_id_product_id_idx" ON "product_kit_items"("branch_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_kit_items_branch_id_kit_id_product_id_key" ON "product_kit_items"("branch_id", "kit_id", "product_id");

-- CreateIndex
CREATE INDEX "product_kit_stock_targets_branch_id_store_id_idx" ON "product_kit_stock_targets"("branch_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_kit_stock_targets_branch_id_kit_id_store_id_key" ON "product_kit_stock_targets"("branch_id", "kit_id", "store_id");

-- AddForeignKey
ALTER TABLE "product_kit_items" ADD CONSTRAINT "product_kit_items_branch_id_kit_id_fkey" FOREIGN KEY ("branch_id", "kit_id") REFERENCES "product_kits"("branch_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_kit_items" ADD CONSTRAINT "product_kit_items_branch_id_product_id_fkey" FOREIGN KEY ("branch_id", "product_id") REFERENCES "local_products"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_kit_stock_targets" ADD CONSTRAINT "product_kit_stock_targets_branch_id_kit_id_fkey" FOREIGN KEY ("branch_id", "kit_id") REFERENCES "product_kits"("branch_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_kit_stock_targets" ADD CONSTRAINT "product_kit_stock_targets_branch_id_store_id_fkey" FOREIGN KEY ("branch_id", "store_id") REFERENCES "local_stores"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants also apply to direct SQL writes.
ALTER TABLE "product_kits" ADD CONSTRAINT "product_kits_valid_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200);
ALTER TABLE "product_kits" ADD CONSTRAINT "product_kits_positive_version" CHECK ("version" > 0);
ALTER TABLE "product_kit_items" ADD CONSTRAINT "product_kit_items_positive_quantity" CHECK ("quantity" > 0 AND "quantity" <= 1000000);
ALTER TABLE "product_kit_items" ADD CONSTRAINT "product_kit_items_nonnegative_position" CHECK ("position" >= 0);
ALTER TABLE "product_kit_stock_targets" ADD CONSTRAINT "product_kit_stock_targets_valid_quantity" CHECK ("quantity" BETWEEN 0 AND 1000000);
