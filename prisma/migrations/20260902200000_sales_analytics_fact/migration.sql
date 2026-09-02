-- Stage 2: canonical factual sales analytics. This migration does not create
-- plans and never changes source shipment values. It only adds mappings and
-- controlled analytics snapshots that can be rebuilt from the same versioned rules.

CREATE TABLE IF NOT EXISTS sales_analytics_metrics (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  unit TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  parent_code TEXT,
  settings_json JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS sales_analytics_metrics_type_active_sort_idx
  ON sales_analytics_metrics (type, active, sort_order);

INSERT INTO sales_analytics_metrics (code, type, title, unit, sort_order)
VALUES
  ('ENGINE_OIL', 'PRODUCT_CATEGORY', 'Моторное масло', 'LITER', 10),
  ('TRANSMISSION_FLUID', 'PRODUCT_CATEGORY', 'Трансмиссионное масло / ATF / CVT Fluid', 'LITER', 20),
  ('OIL_FILTER', 'PRODUCT_CATEGORY', 'Масляные фильтры', 'PCS', 30),
  ('AIR_FILTER', 'PRODUCT_CATEGORY', 'Воздушные фильтры', 'PCS', 40),
  ('CABIN_FILTER', 'PRODUCT_CATEGORY', 'Салонные фильтры', 'PCS', 50),
  ('FUEL_FILTER', 'PRODUCT_CATEGORY', 'Топливные фильтры', 'PCS', 60),
  ('TRANSMISSION_FILTER', 'PRODUCT_CATEGORY', 'Фильтры и поддоны АКПП / CVT', 'PCS', 70),
  ('BRAKE_FLUID', 'PRODUCT_CATEGORY', 'Тормозная жидкость', 'LITER', 80),
  ('COOLANT', 'PRODUCT_CATEGORY', 'Антифриз', 'LITER', 90),
  ('AUTOCHEMISTRY', 'PRODUCT_CATEGORY', 'Автохимия', 'PCS', 100),
  ('SEALS_GASKETS', 'PRODUCT_CATEGORY', 'Прокладки, пробки и уплотнения', 'PCS', 110),
  ('OTHER_PRODUCT', 'PRODUCT_CATEGORY', 'Другие товары', 'PCS', 120),
  ('ENGINE_OIL_CHANGE', 'SERVICE_OPERATION', 'Замена моторного масла', 'OPERATION', 210),
  ('AIR_FILTER_REPLACEMENT', 'SERVICE_OPERATION', 'Замена воздушного фильтра', 'OPERATION', 220),
  ('CABIN_FILTER_REPLACEMENT', 'SERVICE_OPERATION', 'Замена салонного фильтра', 'OPERATION', 230),
  ('FUEL_FILTER_REPLACEMENT', 'SERVICE_OPERATION', 'Замена топливного фильтра', 'OPERATION', 240),
  ('TRANSMISSION_FLUID_SERVICE', 'SERVICE_OPERATION', 'Обслуживание трансмиссии', 'OPERATION', 250),
  ('TRANSFER_CASE_FLUID_CHANGE', 'SERVICE_OPERATION', 'Замена масла в раздатке', 'OPERATION', 260),
  ('FRONT_DIFFERENTIAL_FLUID_CHANGE', 'SERVICE_OPERATION', 'Замена масла в переднем редукторе', 'OPERATION', 270),
  ('REAR_DIFFERENTIAL_FLUID_CHANGE', 'SERVICE_OPERATION', 'Замена масла в заднем редукторе', 'OPERATION', 280),
  ('BRAKE_FLUID_CHANGE', 'SERVICE_OPERATION', 'Замена тормозной жидкости', 'OPERATION', 290),
  ('COOLANT_CHANGE', 'SERVICE_OPERATION', 'Замена антифриза', 'OPERATION', 300),
  ('DIAGNOSTIC', 'SERVICE_OPERATION', 'Диагностика', 'OPERATION', 310),
  ('OTHER_SERVICE', 'SERVICE_OPERATION', 'Другие услуги', 'OPERATION', 320)
ON CONFLICT (code) DO UPDATE
SET type = EXCLUDED.type,
    title = EXCLUDED.title,
    unit = EXCLUDED.unit,
    sort_order = EXCLUDED.sort_order,
    updated_at = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS "sales_analytics_mappings" (
  id TEXT PRIMARY KEY,
  business_group_id TEXT NOT NULL,
  branch_id TEXT NOT NULL DEFAULT 'branch-main',
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  metric_code TEXT NOT NULL,
  match_method TEXT NOT NULL,
  aggregate_type TEXT,
  procedure TEXT,
  configuration TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  confirmed_by_id TEXT,
  confirmed_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sales_analytics_mappings_metric_code_fkey
    FOREIGN KEY (metric_code) REFERENCES sales_analytics_metrics(code)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT sales_analytics_mappings_branch_source_unique
    UNIQUE (branch_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS sales_analytics_mappings_group_branch_active_idx
  ON sales_analytics_mappings (business_group_id, branch_id, active);
CREATE INDEX IF NOT EXISTS sales_analytics_mappings_branch_metric_idx
  ON sales_analytics_mappings (branch_id, metric_code);

-- Exact catalog-group aliases. Text is read only once during this controlled
-- seed; runtime aggregation uses the persisted group id mapping.
WITH group_aliases (normalized_name, metric_code) AS (
  VALUES
    ('масло в канистрах моторное/масло в канистрах моторное', 'ENGINE_OIL'),
    ('масло моторное в бочках на розлив', 'ENGINE_OIL'),
    ('масло в канистрах трансмисионное', 'TRANSMISSION_FLUID'),
    ('масло в канистрах трансмиссионное', 'TRANSMISSION_FLUID'),
    ('масло трансмиссионное в бочках на розлив', 'TRANSMISSION_FLUID'),
    ('масляные фильтры', 'OIL_FILTER'),
    ('воздушные фильтры', 'AIR_FILTER'),
    ('салонные фильтры', 'CABIN_FILTER'),
    ('топливные фильтры', 'FUEL_FILTER'),
    ('масляные фильтры акпп', 'TRANSMISSION_FILTER'),
    ('фильтры и поддоны акпп / cvt', 'TRANSMISSION_FILTER'),
    ('тормозная жидкость', 'BRAKE_FLUID'),
    ('антифриз', 'COOLANT'),
    ('автохимия', 'AUTOCHEMISTRY'),
    ('уплотнительные кольца и проклдаки', 'SEALS_GASKETS'),
    ('уплотнительные кольца и прокладки', 'SEALS_GASKETS')
)
INSERT INTO sales_analytics_mappings (
  id, business_group_id, branch_id, source_type, source_id, metric_code,
  match_method, version, confirmed_at
)
SELECT
  'sam_' || md5(groups.branch_id || ':CATALOG_GROUP:' || groups.id),
  branches.business_group_id,
  groups.branch_id,
  'CATALOG_GROUP',
  groups.id,
  aliases.metric_code,
  'GROUP',
  1,
  CURRENT_TIMESTAMP
FROM local_catalog_groups AS groups
JOIN branches ON branches.id = groups.branch_id
JOIN group_aliases AS aliases ON aliases.normalized_name = groups.normalized_name
WHERE groups.kind = 'product'
ON CONFLICT (branch_id, source_type, source_id) DO NOTHING;

-- The eleven stable service ids approved in the Stage 1 manifest.
WITH service_aliases (source_id, metric_code, aggregate_type, procedure, configuration) AS (
  VALUES
    ('cmphdnx1z01sm8zksgngu23b7', 'ENGINE_OIL_CHANGE', NULL, NULL, NULL),
    ('cmphdo2mc01t48zksevroqafy', 'AIR_FILTER_REPLACEMENT', NULL, NULL, NULL),
    ('cmphdnwh201sk8zksfqm75ji8', 'TRANSMISSION_FLUID_SERVICE', 'UNKNOWN', 'PARTIAL', 'UNKNOWN'),
    ('cmphdo00h01sw8zkszvuoqkrd', 'CABIN_FILTER_REPLACEMENT', NULL, NULL, NULL),
    ('cmphdnvw601si8zkssrecv1st', 'TRANSMISSION_FLUID_SERVICE', 'UNKNOWN', 'MACHINE', 'UNKNOWN'),
    ('cmphdo0vn01sy8zksk93r3s86', 'FUEL_FILTER_REPLACEMENT', NULL, NULL, NULL),
    ('cmphdnvbh01sg8zksw77y6k78', 'REAR_DIFFERENTIAL_FLUID_CHANGE', NULL, NULL, NULL),
    ('cmphdnyti01ss8zkst25ozud4', 'TRANSFER_CASE_FLUID_CHANGE', NULL, NULL, NULL),
    ('cmphdo1gl01t08zkskn4tsbpd', 'TRANSMISSION_FLUID_SERVICE', 'MANUAL', 'STANDARD', 'UNKNOWN'),
    ('cmphdo3s901t88zksj9bc309u', 'FRONT_DIFFERENTIAL_FLUID_CHANGE', NULL, NULL, NULL),
    ('cmphdo2bw01t38zksr8sllkxn', 'BRAKE_FLUID_CHANGE', NULL, NULL, NULL)
)
INSERT INTO sales_analytics_mappings (
  id, business_group_id, branch_id, source_type, source_id, metric_code,
  match_method, aggregate_type, procedure, configuration, version, confirmed_at
)
SELECT
  'sam_' || md5(products.branch_id || ':CATALOG_ITEM:' || products.id),
  branches.business_group_id,
  products.branch_id,
  'CATALOG_ITEM',
  products.id,
  aliases.metric_code,
  'ID',
  aliases.aggregate_type,
  aliases.procedure,
  aliases.configuration,
  1,
  CURRENT_TIMESTAMP
FROM local_products AS products
JOIN branches ON branches.id = products.branch_id
JOIN service_aliases AS aliases ON aliases.source_id = products.id
WHERE products.entity_type = 'service'
ON CONFLICT (branch_id, source_type, source_id) DO NOTHING;

-- Eight exact verified legacy aliases. No substring or fuzzy match is used.
WITH legacy_aliases (source_id, metric_code) AS (
  VALUES
    ('работа по замене моторного масла и масляного фильтра', 'ENGINE_OIL_CHANGE'),
    ('работа по замене моторного масла', 'ENGINE_OIL_CHANGE'),
    ('проверка уровня масла в акпп', 'DIAGNOSTIC'),
    ('проверка уровня масла в трансмиссии', 'DIAGNOSTIC'),
    ('замена толпивного фильтра', 'FUEL_FILTER_REPLACEMENT'),
    ('замена антфриза', 'COOLANT_CHANGE'),
    ('замена антифриза и проверка системы охлаждения', 'COOLANT_CHANGE'),
    ('замена клапана тнвд', 'OTHER_SERVICE')
)
INSERT INTO sales_analytics_mappings (
  id, business_group_id, branch_id, source_type, source_id, metric_code,
  match_method, version, confirmed_at
)
SELECT
  'sam_' || md5(branches.id || ':LEGACY_NAME:' || aliases.source_id),
  branches.business_group_id,
  branches.id,
  'LEGACY_NAME',
  aliases.source_id,
  aliases.metric_code,
  'VERIFIED_LEGACY',
  1,
  CURRENT_TIMESTAMP
FROM branches
CROSS JOIN legacy_aliases AS aliases
ON CONFLICT (branch_id, source_type, source_id) DO NOTHING;

ALTER TABLE local_demand_positions
  ADD COLUMN IF NOT EXISTS analytics_metric_code TEXT,
  ADD COLUMN IF NOT EXISTS analytics_category_label TEXT,
  ADD COLUMN IF NOT EXISTS analytics_match_method TEXT,
  ADD COLUMN IF NOT EXISTS analytics_mapping_version INTEGER,
  ADD COLUMN IF NOT EXISTS service_aggregate_type TEXT,
  ADD COLUMN IF NOT EXISTS service_procedure TEXT,
  ADD COLUMN IF NOT EXISTS service_configuration TEXT,
  ADD COLUMN IF NOT EXISTS analytics_base_quantity NUMERIC(14, 3),
  ADD COLUMN IF NOT EXISTS analytics_base_unit TEXT;

CREATE INDEX IF NOT EXISTS local_demand_positions_branch_analytics_metric_idx
  ON local_demand_positions (branch_id, analytics_metric_code);
CREATE INDEX IF NOT EXISTS local_demand_positions_branch_demand_analytics_metric_idx
  ON local_demand_positions (branch_id, demand_id, analytics_metric_code);

-- Controlled snapshot backfill by stable catalog item.
UPDATE local_demand_positions AS positions
SET analytics_metric_code = mappings.metric_code,
    analytics_category_label = metrics.title,
    analytics_match_method = mappings.match_method,
    analytics_mapping_version = mappings.version,
    service_aggregate_type = mappings.aggregate_type,
    service_procedure = mappings.procedure,
    service_configuration = mappings.configuration,
    analytics_base_unit = CASE WHEN metrics.unit = 'OPERATION' THEN 'OPERATION' ELSE positions.analytics_base_unit END
FROM sales_analytics_mappings AS mappings
JOIN sales_analytics_metrics AS metrics ON metrics.code = mappings.metric_code
WHERE mappings.branch_id = positions.branch_id
  AND mappings.source_type = 'CATALOG_ITEM'
  AND mappings.source_id = positions.product_id
  AND mappings.active = TRUE
  AND positions.analytics_metric_code IS NULL;

-- Controlled snapshot backfill by stable product group.
UPDATE local_demand_positions AS positions
SET analytics_metric_code = mappings.metric_code,
    analytics_category_label = metrics.title,
    analytics_match_method = mappings.match_method,
    analytics_mapping_version = mappings.version,
    analytics_base_quantity = CASE WHEN metrics.unit = 'PCS' THEN positions.quantity ELSE positions.analytics_base_quantity END,
    analytics_base_unit = CASE WHEN metrics.unit = 'PCS' THEN 'PCS' ELSE positions.analytics_base_unit END
FROM sales_analytics_mappings AS mappings
JOIN sales_analytics_metrics AS metrics ON metrics.code = mappings.metric_code
WHERE mappings.branch_id = positions.branch_id
  AND mappings.source_type = 'CATALOG_GROUP'
  AND mappings.source_id = positions.group_id_snapshot
  AND mappings.active = TRUE
  AND positions.assortment_type <> 'service'
  AND positions.analytics_metric_code IS NULL;

-- Litres are safe only where the catalog UOM explicitly says litre. Package
-- captions are deliberately not parsed in this migration.
UPDATE local_demand_positions AS positions
SET analytics_base_quantity = positions.quantity,
    analytics_base_unit = 'LITER'
FROM local_products AS products
JOIN sales_analytics_metrics AS metrics ON metrics.unit = 'LITER'
WHERE products.branch_id = positions.branch_id
  AND products.id = positions.product_id
  AND metrics.code = positions.analytics_metric_code
  AND lower(btrim(COALESCE(products.uom_name, ''))) IN ('л', 'л.', 'литр', 'литры', 'литров')
  AND positions.analytics_base_quantity IS NULL;

-- Exact legacy aliases are allowed only for service rows without a stable id.
UPDATE local_demand_positions AS positions
SET analytics_metric_code = mappings.metric_code,
    analytics_category_label = metrics.title,
    analytics_match_method = mappings.match_method,
    analytics_mapping_version = mappings.version,
    analytics_base_unit = 'OPERATION'
FROM sales_analytics_mappings AS mappings
JOIN sales_analytics_metrics AS metrics ON metrics.code = mappings.metric_code
WHERE mappings.branch_id = positions.branch_id
  AND mappings.source_type = 'LEGACY_NAME'
  AND mappings.source_id = lower(btrim(regexp_replace(COALESCE(positions.name, ''), '[[:space:]]+', ' ', 'g')))
  AND mappings.active = TRUE
  AND positions.assortment_type = 'service'
  AND positions.product_id IS NULL
  AND positions.analytics_metric_code IS NULL;

-- Structured one-off products that existed before this migration.
UPDATE local_demand_positions AS positions
SET analytics_metric_code = CASE upper(COALESCE(positions.raw->'oneOffProduct'->>'groupCode', ''))
      WHEN 'ENGINE_OIL' THEN 'ENGINE_OIL'
      WHEN 'TRANSMISSION_FLUID' THEN 'TRANSMISSION_FLUID'
      WHEN 'OIL_FILTER' THEN 'OIL_FILTER'
      WHEN 'AIR_FILTER' THEN 'AIR_FILTER'
      WHEN 'CABIN_FILTER' THEN 'CABIN_FILTER'
      WHEN 'FUEL_FILTER' THEN 'FUEL_FILTER'
      WHEN 'TRANSMISSION_FILTER' THEN 'TRANSMISSION_FILTER'
      WHEN 'GASKET_OR_PAN' THEN 'SEALS_GASKETS'
      WHEN 'DRAIN_PLUG_OR_SEAL' THEN 'SEALS_GASKETS'
      WHEN 'ANTIFREEZE' THEN 'COOLANT'
      WHEN 'CONSUMABLE' THEN 'OTHER_PRODUCT'
      WHEN 'SPARE_PART' THEN 'OTHER_PRODUCT'
      WHEN 'OTHER' THEN 'OTHER_PRODUCT'
    END,
    analytics_match_method = 'STRUCTURED_RAW',
    analytics_mapping_version = 1
WHERE positions.analytics_metric_code IS NULL
  AND positions.raw ? 'oneOffProduct'
  AND upper(COALESCE(positions.raw->'oneOffProduct'->>'groupCode', '')) IN (
    'ENGINE_OIL', 'TRANSMISSION_FLUID', 'OIL_FILTER', 'AIR_FILTER', 'CABIN_FILTER',
    'FUEL_FILTER', 'TRANSMISSION_FILTER', 'GASKET_OR_PAN', 'DRAIN_PLUG_OR_SEAL',
    'ANTIFREEZE', 'CONSUMABLE', 'SPARE_PART', 'OTHER'
  );

UPDATE local_demand_positions AS positions
SET analytics_category_label = metrics.title,
    analytics_base_quantity = CASE
      WHEN metrics.unit = 'PCS' THEN positions.quantity
      WHEN metrics.unit = 'LITER' AND upper(COALESCE(positions.raw->'oneOffProduct'->>'uomCode', '')) = 'L' THEN positions.quantity
      ELSE positions.analytics_base_quantity
    END,
    analytics_base_unit = CASE
      WHEN metrics.unit = 'PCS' THEN 'PCS'
      WHEN metrics.unit = 'LITER' AND upper(COALESCE(positions.raw->'oneOffProduct'->>'uomCode', '')) = 'L' THEN 'LITER'
      ELSE positions.analytics_base_unit
    END
FROM sales_analytics_metrics AS metrics
WHERE metrics.code = positions.analytics_metric_code
  AND positions.analytics_category_label IS NULL;
