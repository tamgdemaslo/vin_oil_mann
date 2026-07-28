-- File and stock children must not point at parents from another branch.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM local_product_photos c JOIN local_products p ON p.id = c.product_id
    WHERE c.branch_id <> p.branch_id
  ) THEN
    RAISE EXCEPTION 'Cross-branch precheck failed: local_product_photos.product_id';
  END IF;
  IF EXISTS (
    SELECT 1 FROM local_stock_balances c JOIN local_products p ON p.id = c.product_id
    WHERE c.branch_id <> p.branch_id
  ) THEN
    RAISE EXCEPTION 'Cross-branch precheck failed: local_stock_balances.product_id';
  END IF;
  IF EXISTS (
    SELECT 1 FROM local_stock_balances c JOIN local_stores s ON s.id = c.store_id
    WHERE c.branch_id <> s.branch_id
  ) THEN
    RAISE EXCEPTION 'Cross-branch precheck failed: local_stock_balances.store_id';
  END IF;
END $$;

DO $$
DECLARE
  target record;
  constraint_row record;
  attribute_number smallint;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('local_product_photos','product_id'),
    ('local_stock_balances','product_id'),
    ('local_stock_balances','store_id')
  ) AS targets(table_name, column_name)
  LOOP
    SELECT attnum INTO attribute_number FROM pg_attribute
      WHERE attrelid = to_regclass('public.' || target.table_name) AND attname = target.column_name;
    FOR constraint_row IN SELECT conname FROM pg_constraint
      WHERE conrelid = to_regclass('public.' || target.table_name)
        AND contype = 'f'
        AND conkey @> ARRAY[attribute_number]::smallint[]
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', target.table_name, constraint_row.conname);
    END LOOP;
  END LOOP;
END $$;

ALTER TABLE local_product_photos
  ADD CONSTRAINT local_product_photos_branch_product_fk
  FOREIGN KEY (branch_id, product_id) REFERENCES local_products(branch_id, id)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE local_stock_balances
  ADD CONSTRAINT local_stock_balances_branch_product_fk
  FOREIGN KEY (branch_id, product_id) REFERENCES local_products(branch_id, id)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE local_stock_balances
  ADD CONSTRAINT local_stock_balances_branch_store_fk
  FOREIGN KEY (branch_id, store_id) REFERENCES local_stores(branch_id, id)
  ON DELETE CASCADE ON UPDATE CASCADE;
