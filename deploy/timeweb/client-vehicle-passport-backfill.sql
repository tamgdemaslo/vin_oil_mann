-- One-time, insert-only backfill of client vehicle passports from shipment history.
-- Safety: never updates an existing passport and never marks imported data as confirmed.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtextextended('client-vehicle-passport-backfill-v1', 0));

DO $$
BEGIN
  IF current_database() <> 'vin_oil' THEN
    RAISE EXCEPTION 'wrong database: expected vin_oil, got %', current_database();
  END IF;
  IF to_regclass('public.client_vehicle_revisions') IS NULL THEN
    RAISE EXCEPTION 'client vehicle passport migration is not applied';
  END IF;
END $$;

CREATE TEMP TABLE _client_vehicle_backfill_baseline ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM client_vehicles) AS vehicles,
  (SELECT count(*) FROM client_vehicle_revisions) AS revisions;

WITH demand_fields AS (
  SELECT
    d.id,
    d.name,
    d.branch_id,
    d.counterparty_id,
    d.moment_at,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'модель авто') AS vehicle_model,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'марка') AS make_value,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'модель') AS model_value,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'поколение') AS generation,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'vin номер') AS vin,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'номер кузова') AS frame_number,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'гос. номер') AS plate,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'год') AS year_value,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'модельный год с') AS model_year_from,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'модельный год по') AS model_year_to,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'пробег') AS mileage_value,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'двигатель') AS engine_name,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'код двигателя') AS engine_code,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'серия двигателя') AS engine_series,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'объем двигателя') AS engine_volume,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'мощность') AS power_hp_value,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'мощность квт') AS power_kw_value,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'топливо') AS fuel_type,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'коробка') AS transmission_type,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'модель коробки') AS transmission_name,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'привод') AS drive_type,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'кузов') AS body_name,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'код кузова') AS body_code,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'тип кузова') AS body_type,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'руль') AS steering_position,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'рынок') AS market,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'страна сборки') AS country_of_origin,
    max(nullif(trim(a->>'value'), '')) FILTER (WHERE lower(trim(a->>'name')) = 'владельцев') AS owners_count_value
  FROM local_demands d
  JOIN local_counterparties c
    ON c.branch_id = d.branch_id
   AND c.id = d.counterparty_id
   AND c.archived = false
   AND c.category = 'INDIVIDUAL'
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(d.attributes) = 'array' THEN d.attributes ELSE '[]'::jsonb END
  ) a
  WHERE d.counterparty_id IS NOT NULL
  GROUP BY d.id, d.name, d.branch_id, d.counterparty_id, d.moment_at
), normalized AS (
  SELECT
    demand_fields.*,
    upper(regexp_replace(coalesce(vin, ''), '\s', '', 'g')) AS vin_clean,
    upper(regexp_replace(coalesce(frame_number, ''), '\s', '', 'g')) AS frame_clean,
    upper(regexp_replace(coalesce(plate, ''), '[\s-]', '', 'g')) AS plate_clean,
    upper(trim(coalesce(nullif(concat_ws(' ', make_value, model_value), ''), vehicle_model, ''))) AS model_clean
  FROM demand_fields
  WHERE nullif(trim(coalesce(nullif(concat_ws(' ', make_value, model_value), ''), vehicle_model, '')), '') IS NOT NULL
), keyed AS (
  SELECT
    normalized.*,
    CASE
      WHEN length(vin_clean) BETWEEN 8 AND 17 THEN 'vin:' || vin_clean
      WHEN length(frame_clean) >= 6 THEN 'frame:' || frame_clean
      WHEN length(plate_clean) >= 6 THEN 'plate:' || plate_clean
      ELSE 'model:' || model_clean || ':' || coalesce(year_value, '')
    END AS vehicle_key
  FROM normalized
  WHERE model_clean NOT IN ('-', '.', 'НЕ УКАЗАНО', 'АВТОМОБИЛЬ')
), ranked AS (
  SELECT
    keyed.*,
    row_number() OVER (
      PARTITION BY branch_id, counterparty_id, vehicle_key
      ORDER BY moment_at DESC, id DESC
    ) AS rank_number
  FROM keyed
  WHERE vehicle_key <> 'model::'
), split_model AS (
  SELECT
    ranked.*,
    CASE
      WHEN model_clean LIKE 'LAND ROVER %' THEN 'LAND ROVER'
      WHEN model_clean LIKE 'ALFA ROMEO %' THEN 'ALFA ROMEO'
      WHEN model_clean LIKE 'ASTON MARTIN %' THEN 'ASTON MARTIN'
      WHEN model_clean LIKE 'GREAT WALL %' THEN 'GREAT WALL'
      WHEN model_clean LIKE 'MERCEDES BENZ %' THEN 'MERCEDES-BENZ'
      WHEN model_clean LIKE 'MERCEDES-BENZ %' THEN 'MERCEDES-BENZ'
      ELSE split_part(model_clean, ' ', 1)
    END AS parsed_make
  FROM ranked
  WHERE rank_number = 1
), prepared AS (
  SELECT
    split_model.*,
    trim(substr(model_clean, length(parsed_make) + 1)) AS parsed_model,
    CASE
      WHEN year_value ~ '[12][0-9]{3}'
       AND substring(year_value FROM '([12][0-9]{3})')::integer BETWEEN 1886 AND 2200
      THEN substring(year_value FROM '([12][0-9]{3})')::integer
    END AS parsed_year,
    CASE
      WHEN model_year_from ~ '[12][0-9]{3}'
       AND substring(model_year_from FROM '([12][0-9]{3})')::integer BETWEEN 1886 AND 2200
      THEN substring(model_year_from FROM '([12][0-9]{3})')::integer
    END AS parsed_model_year_from,
    CASE
      WHEN model_year_to ~ '[12][0-9]{3}'
       AND substring(model_year_to FROM '([12][0-9]{3})')::integer BETWEEN 1886 AND 2200
      THEN substring(model_year_to FROM '([12][0-9]{3})')::integer
    END AS parsed_model_year_to,
    CASE WHEN mileage_value ~ '[0-9]' THEN least(regexp_replace(mileage_value, '[^0-9]', '', 'g')::numeric, 2147483647)::integer END AS parsed_mileage,
    CASE WHEN engine_volume ~ '[0-9]' THEN nullif(round(replace((regexp_match(engine_volume, '[0-9]+[.,]?[0-9]*'))[1], ',', '.')::numeric * 1000)::integer, 0) END AS parsed_engine_volume_cc,
    CASE WHEN power_hp_value ~ '[0-9]' THEN nullif(round(replace((regexp_match(power_hp_value, '[0-9]+[.,]?[0-9]*'))[1], ',', '.')::numeric)::integer, 0) END AS parsed_power_hp,
    CASE WHEN power_kw_value ~ '[0-9]' THEN nullif(round(replace((regexp_match(power_kw_value, '[0-9]+[.,]?[0-9]*'))[1], ',', '.')::numeric)::integer, 0) END AS parsed_power_kw,
    CASE WHEN owners_count_value ~ '[0-9]' THEN least(regexp_replace(owners_count_value, '[^0-9]', '', 'g')::numeric, 2147483647)::integer END AS parsed_owners_count
  FROM split_model
), candidates AS (
  SELECT *
  FROM prepared
  WHERE parsed_make <> ''
    AND parsed_model <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM client_vehicles existing
      WHERE existing.branch_id = prepared.branch_id
        AND existing.counterparty_id = prepared.counterparty_id
        AND existing.status = 'ACTIVE'
        AND (
          (length(prepared.vin_clean) >= 8 AND existing.vin = prepared.vin_clean)
          OR (length(prepared.frame_clean) >= 6 AND existing.frame_number = prepared.frame_clean)
          OR (length(prepared.plate_clean) >= 6 AND existing.plate = prepared.plate_clean)
          OR (
            length(prepared.vin_clean) < 8
            AND length(prepared.frame_clean) < 6
            AND length(prepared.plate_clean) < 6
            AND upper(existing.make) = prepared.parsed_make
            AND upper(existing.model) = prepared.parsed_model
            AND existing.year IS NOT DISTINCT FROM prepared.parsed_year
          )
        )
    )
), inserted AS (
  INSERT INTO client_vehicles (
    id, branch_id, counterparty_id,
    make, make_canonical, model, model_canonical, generation,
    year, model_year_from, model_year_to,
    plate, vin, frame_number,
    body_name, body_code, body_type,
    engine_name, engine_code, engine_series, engine_volume_cc,
    power_hp, power_kw, fuel_type,
    transmission_type, transmission_name, drive_type,
    steering_position, market, country_of_origin,
    mileage, mileage_recorded_at, owners_count,
    field_sources_json, source_snapshot_json,
    confidence, verification_status, status, created_at, updated_at
  )
  SELECT
    'cvh_' || md5(branch_id || ':' || counterparty_id || ':' || vehicle_key),
    branch_id,
    counterparty_id,
    parsed_make,
    parsed_make,
    parsed_model,
    parsed_model,
    generation,
    parsed_year,
    parsed_model_year_from,
    parsed_model_year_to,
    nullif(plate_clean, ''),
    CASE WHEN length(vin_clean) BETWEEN 8 AND 17 THEN vin_clean END,
    nullif(frame_clean, ''),
    body_name,
    upper(body_code),
    body_type,
    engine_name,
    upper(engine_code),
    upper(engine_series),
    parsed_engine_volume_cc,
    parsed_power_hp,
    parsed_power_kw,
    fuel_type,
    transmission_type,
    transmission_name,
    drive_type,
    steering_position,
    market,
    country_of_origin,
    parsed_mileage,
    CASE WHEN parsed_mileage IS NOT NULL THEN moment_at END,
    parsed_owners_count,
    jsonb_build_object(
      'legacyImport', jsonb_build_object(
        'source', 'shipment_history',
        'confidence', 'LOW',
        'verificationStatus', 'LEGACY',
        'updatedAt', moment_at
      )
    ),
    jsonb_build_object('shipmentId', id, 'shipmentName', name, 'vehicleKey', vehicle_key),
    'LOW',
    'LEGACY',
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM candidates
  ON CONFLICT (id) DO NOTHING
  RETURNING *
)
INSERT INTO client_vehicle_revisions (
  id, branch_id, vehicle_id, source, verification_status,
  changed_fields_json, snapshot_json, actor_login, actor_name
)
SELECT
  'cvr_' || md5(branch_id || ':' || id || ':legacy-import-v1'),
  branch_id,
  id,
  'shipment_history',
  'LEGACY',
  '["legacyImport"]'::jsonb,
  to_jsonb(inserted),
  'system',
  'Импорт истории отгрузок'
FROM inserted
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  baseline record;
BEGIN
  SELECT * INTO baseline FROM _client_vehicle_backfill_baseline;
  IF (SELECT count(*) FROM client_vehicles) < baseline.vehicles THEN
    RAISE EXCEPTION 'vehicle row count decreased during insert-only backfill';
  END IF;
  IF (SELECT count(*) FROM client_vehicle_revisions) < baseline.revisions THEN
    RAISE EXCEPTION 'revision row count decreased during insert-only backfill';
  END IF;
END $$;

COMMIT;

SELECT
  count(*) AS vehicle_passports,
  count(*) FILTER (WHERE verification_status = 'LEGACY') AS awaiting_review,
  count(*) FILTER (WHERE vin IS NOT NULL) AS with_vin,
  count(*) FILTER (WHERE plate IS NOT NULL) AS with_plate,
  count(*) FILTER (WHERE mileage IS NOT NULL) AS with_mileage,
  count(*) FILTER (WHERE transmission_type IS NOT NULL) AS with_transmission
FROM client_vehicles;
