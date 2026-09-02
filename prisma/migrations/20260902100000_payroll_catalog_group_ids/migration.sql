-- Payroll groups are first-class branch data.  Runtime payroll never compares
-- group captions: every product/service position uses a stable group id.

BEGIN;

CREATE OR REPLACE FUNCTION local_catalog_group_normalized(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(regexp_replace(COALESCE(value, ''), '\\s+', ' ', 'g')))
$$;

CREATE TABLE IF NOT EXISTS "local_catalog_groups" (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL DEFAULT 'branch-main',
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT local_catalog_groups_branch_id_id_unique UNIQUE (branch_id, id),
  CONSTRAINT local_catalog_groups_branch_kind_normalized_unique UNIQUE (branch_id, kind, normalized_name)
);

CREATE INDEX IF NOT EXISTS local_catalog_groups_branch_kind_archived_idx
  ON local_catalog_groups (branch_id, kind, archived);

ALTER TABLE local_products
  ADD COLUMN IF NOT EXISTS group_id TEXT;

ALTER TABLE local_demand_positions
  ADD COLUMN IF NOT EXISTS group_id_snapshot TEXT;

-- Backfill one canonical group for each existing text category.  Text is used
-- here only to migrate legacy records; it is not part of later calculation.
WITH source_groups AS (
  SELECT DISTINCT
    branch_id,
    CASE WHEN entity_type = 'service' THEN 'service' ELSE 'product' END AS kind,
    btrim(group_path) AS name,
    local_catalog_group_normalized(group_path) AS normalized_name
  FROM local_products
  WHERE NULLIF(btrim(COALESCE(group_path, '')), '') IS NOT NULL
)
INSERT INTO local_catalog_groups (id, branch_id, kind, name, normalized_name)
SELECT
  'grp_' || md5(branch_id || ':' || kind || ':' || normalized_name),
  branch_id,
  kind,
  name,
  normalized_name
FROM source_groups
ON CONFLICT (branch_id, kind, normalized_name) DO NOTHING;

UPDATE local_products AS product
SET group_id = groups.id
FROM local_catalog_groups AS groups
WHERE groups.branch_id = product.branch_id
  AND groups.kind = CASE WHEN product.entity_type = 'service' THEN 'service' ELSE 'product' END
  AND groups.normalized_name = local_catalog_group_normalized(product.group_path)
  AND NULLIF(btrim(COALESCE(product.group_path, '')), '') IS NOT NULL;

UPDATE local_demand_positions AS position
SET group_id_snapshot = product.group_id
FROM local_products AS product
WHERE product.branch_id = position.branch_id
  AND product.id = position.product_id
  AND position.group_id_snapshot IS NULL;

CREATE OR REPLACE FUNCTION assign_local_product_catalog_group()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_kind TEXT;
  next_name TEXT;
  next_normalized_name TEXT;
  next_group_id TEXT;
BEGIN
  next_name := NULLIF(btrim(COALESCE(NEW.group_path, '')), '');
  IF next_name IS NULL THEN
    NEW.group_id := NULL;
    RETURN NEW;
  END IF;

  next_kind := CASE WHEN NEW.entity_type = 'service' THEN 'service' ELSE 'product' END;
  next_normalized_name := local_catalog_group_normalized(next_name);

  INSERT INTO local_catalog_groups (id, branch_id, kind, name, normalized_name)
  VALUES (
    'grp_' || md5(NEW.branch_id || ':' || next_kind || ':' || next_normalized_name),
    NEW.branch_id,
    next_kind,
    next_name,
    next_normalized_name
  )
  ON CONFLICT (branch_id, kind, normalized_name) DO UPDATE
  SET updated_at = CURRENT_TIMESTAMP
  RETURNING id INTO next_group_id;

  NEW.group_id := next_group_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS local_products_assign_catalog_group ON local_products;
CREATE TRIGGER local_products_assign_catalog_group
BEFORE INSERT OR UPDATE ON local_products
FOR EACH ROW
EXECUTE FUNCTION assign_local_product_catalog_group();

CREATE OR REPLACE FUNCTION snapshot_local_demand_position_group()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.product_id IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.group_id_snapshot IS NULL) THEN
    SELECT group_id
    INTO NEW.group_id_snapshot
    FROM local_products
    WHERE branch_id = NEW.branch_id
      AND id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS local_demand_positions_snapshot_catalog_group ON local_demand_positions;
CREATE TRIGGER local_demand_positions_snapshot_catalog_group
BEFORE INSERT OR UPDATE OF product_id, group_id_snapshot ON local_demand_positions
FOR EACH ROW
EXECUTE FUNCTION snapshot_local_demand_position_group();

CREATE INDEX IF NOT EXISTS local_products_branch_group_id_idx
  ON local_products (branch_id, group_id);
CREATE INDEX IF NOT EXISTS local_demand_positions_branch_group_snapshot_idx
  ON local_demand_positions (branch_id, group_id_snapshot);

ALTER TABLE local_products
  DROP CONSTRAINT IF EXISTS local_products_branch_group_id_fkey;
ALTER TABLE local_products
  ADD CONSTRAINT local_products_branch_group_id_fkey
  FOREIGN KEY (branch_id, group_id)
  REFERENCES local_catalog_groups (branch_id, id)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

ALTER TABLE local_demand_positions
  DROP CONSTRAINT IF EXISTS local_demand_positions_branch_group_snapshot_fkey;
ALTER TABLE local_demand_positions
  ADD CONSTRAINT local_demand_positions_branch_group_snapshot_fkey
  FOREIGN KEY (branch_id, group_id_snapshot)
  REFERENCES local_catalog_groups (branch_id, id)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;

-- Convert the previous hard-coded product-group rule identifiers to the
-- newly created canonical group ids. Existing edited values win over defaults.
WITH legacy_defaults (legacy_target_id, normalized_name) AS (
  VALUES
    ('autochemicals', 'автохимия'),
    ('antifreeze', 'антифриз'),
    ('air-filters', 'воздушные фильтры'),
    ('hydraulic-fluids', 'гидравлические жидкости'),
    ('motor-oil-cans', 'масло в канистрах моторное'),
    ('transmission-oil-cans', 'масло в канистрах трансмиссионное'),
    ('motor-oil-barrels', 'масло моторное в бочках на розлив'),
    ('transmission-oil-barrels', 'масло трансмиссионное в бочках на розлив'),
    ('oil-filters', 'масляные фильтры'),
    ('transmission-oil-filters', 'масляные фильтры акпп'),
    ('cabin-filters', 'салонные фильтры'),
    ('online-store-goods', 'товары интернет-магазинов'),
    ('fuel-filters', 'топливные фильтры'),
    ('brake-fluid', 'тормозная жидкость'),
    ('seals-and-gaskets', 'уплотнительные кольца и прокладки')
), matching_rules AS (
  SELECT rules.id AS rule_id, groups.id AS group_id, groups.name AS group_name
  FROM piecework_rules AS rules
  JOIN legacy_defaults AS legacy ON legacy.legacy_target_id = rules.target_id
  JOIN local_catalog_groups AS groups
    ON groups.branch_id = rules.branch_id
    AND groups.kind = 'product'
    AND groups.normalized_name = legacy.normalized_name
  WHERE rules.target_type = 'product_group'
    AND rules.role = 'admin'
)
UPDATE piecework_rules AS rules
SET target_id = matching_rules.group_id,
    target_name = matching_rules.group_name,
    updated_at = CURRENT_TIMESTAMP
FROM matching_rules
WHERE rules.id = matching_rules.rule_id;

-- Preserve the former 20% product defaults as persisted ID-based rules for
-- the groups that actually exist in this branch. New groups intentionally
-- remain unconfigured and are shown to the owner in the payroll screen.
WITH legacy_defaults (normalized_name) AS (
  VALUES
    ('автохимия'),
    ('антифриз'),
    ('воздушные фильтры'),
    ('гидравлические жидкости'),
    ('масло в канистрах моторное'),
    ('масло в канистрах трансмиссионное'),
    ('масло моторное в бочках на розлив'),
    ('масло трансмиссионное в бочках на розлив'),
    ('масляные фильтры'),
    ('масляные фильтры акпп'),
    ('салонные фильтры'),
    ('товары интернет-магазинов'),
    ('топливные фильтры'),
    ('тормозная жидкость'),
    ('уплотнительные кольца и прокладки')
)
INSERT INTO piecework_rules (
  id,
  branch_id,
  target_type,
  target_id,
  target_name,
  role,
  mode,
  fixed_cents,
  percent_basis_points,
  created_at,
  updated_at
)
SELECT
  'pwr_' || md5(groups.branch_id || ':product_group:' || groups.id || ':admin'),
  groups.branch_id,
  'product_group',
  groups.id,
  groups.name,
  'admin',
  'percent',
  NULL,
  2000,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM local_catalog_groups AS groups
JOIN legacy_defaults AS legacy ON legacy.normalized_name = groups.normalized_name
WHERE groups.kind = 'product'
ON CONFLICT (branch_id, target_type, target_id, role) DO NOTHING;

COMMIT;
