-- CreateTable
CREATE TABLE "bank_operation_categories" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL DEFAULT 'branch-main',
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'operating',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_operation_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_operation_classifications" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL DEFAULT 'branch-main',
    "account_number_hash" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "category_id" TEXT,
    "created_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_operation_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_operation_categories_branch_id_archived_idx" ON "bank_operation_categories"("branch_id", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "bank_operation_categories_branch_id_id_key" ON "bank_operation_categories"("branch_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_operation_categories_branch_code_key" ON "bank_operation_categories"("branch_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "bank_operation_categories_branch_name_key" ON "bank_operation_categories"("branch_id", "name_key");

-- CreateIndex
CREATE INDEX "bank_operation_classifications_branch_id_category_id_idx" ON "bank_operation_classifications"("branch_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_operation_classification_identity_key" ON "bank_operation_classifications"("branch_id", "account_number_hash", "operation_id");

-- AddForeignKey
ALTER TABLE "bank_operation_categories" ADD CONSTRAINT "bank_operation_categories_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_operation_classifications" ADD CONSTRAINT "bank_operation_classifications_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_operation_classifications" ADD CONSTRAINT "bank_operation_classifications_branch_id_category_id_fkey" FOREIGN KEY ("branch_id", "category_id") REFERENCES "bank_operation_categories"("branch_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "bank_operation_categories" ADD CONSTRAINT "bank_category_kind_valid"
  CHECK ("kind" IN ('operating', 'transfer', 'owner'));
ALTER TABLE "bank_operation_categories" ADD CONSTRAINT "bank_category_name_valid"
  CHECK (char_length(btrim("name")) BETWEEN 2 AND 80 AND char_length("name_key") > 0);
ALTER TABLE "bank_operation_classifications" ADD CONSTRAINT "bank_classification_identity_valid"
  CHECK ("account_number_hash" ~ '^[a-f0-9]{64}$' AND char_length(btrim("operation_id")) BETWEEN 1 AND 180);
