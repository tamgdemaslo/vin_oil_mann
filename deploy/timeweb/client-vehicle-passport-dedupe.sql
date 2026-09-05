-- Consolidate only unambiguous legacy duplicates created from shipment history.
-- A duplicate is safe when the same client, plate, make and model have exactly one
-- VIN-bearing passport and one or more VIN-less passports. Losers are archived,
-- never deleted, and the winning passport receives an immutable revision.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtextextended('client-vehicle-passport-dedupe-v1', 0));

CREATE TEMP TABLE _client_vehicle_duplicate_pairs ON COMMIT DROP AS
WITH safe_groups AS (
  SELECT branch_id, counterparty_id, plate, upper(make) AS make_key, upper(model) AS model_key
  FROM client_vehicles
  WHERE status = 'ACTIVE'
    AND verification_status = 'LEGACY'
    AND id LIKE 'cvh_%'
    AND plate IS NOT NULL
  GROUP BY branch_id, counterparty_id, plate, upper(make), upper(model)
  HAVING count(*) > 1
     AND count(*) FILTER (WHERE vin IS NOT NULL) = 1
), winners AS (
  SELECT v.branch_id, v.counterparty_id, v.plate, upper(v.make) AS make_key,
         upper(v.model) AS model_key, v.id AS winner_id
  FROM client_vehicles v
  JOIN safe_groups g
    ON g.branch_id = v.branch_id
   AND g.counterparty_id = v.counterparty_id
   AND g.plate = v.plate
   AND g.make_key = upper(v.make)
   AND g.model_key = upper(v.model)
  WHERE v.status = 'ACTIVE'
    AND v.verification_status = 'LEGACY'
    AND v.id LIKE 'cvh_%'
    AND v.vin IS NOT NULL
)
SELECT w.branch_id, w.winner_id, loser.id AS loser_id
FROM winners w
JOIN client_vehicles loser
  ON loser.branch_id = w.branch_id
 AND loser.counterparty_id = w.counterparty_id
 AND loser.plate = w.plate
 AND upper(loser.make) = w.make_key
 AND upper(loser.model) = w.model_key
WHERE loser.status = 'ACTIVE'
  AND loser.verification_status = 'LEGACY'
  AND loser.id LIKE 'cvh_%'
  AND loser.vin IS NULL;

WITH merged AS (
  SELECT
    pairs.branch_id,
    pairs.winner_id,
    array_agg(loser.id ORDER BY loser.id) AS loser_ids,
    max(loser.generation) AS generation,
    max(loser.generation_canonical) AS generation_canonical,
    max(loser.year) AS year,
    max(loser.model_year_from) AS model_year_from,
    max(loser.model_year_to) AS model_year_to,
    max(loser.frame_number) AS frame_number,
    max(loser.body_name) AS body_name,
    max(loser.body_code) AS body_code,
    max(loser.body_type) AS body_type,
    max(loser.engine_name) AS engine_name,
    max(loser.engine_code) AS engine_code,
    max(loser.engine_series) AS engine_series,
    max(loser.engine_volume_cc) AS engine_volume_cc,
    max(loser.power_hp) AS power_hp,
    max(loser.power_kw) AS power_kw,
    max(loser.fuel_type) AS fuel_type,
    max(loser.transmission_type) AS transmission_type,
    max(loser.transmission_name) AS transmission_name,
    max(loser.drive_type) AS drive_type,
    max(loser.steering_position) AS steering_position,
    max(loser.market) AS market,
    max(loser.country_of_origin) AS country_of_origin,
    (array_agg(loser.mileage ORDER BY loser.mileage_recorded_at DESC NULLS LAST)
      FILTER (WHERE loser.mileage IS NOT NULL))[1] AS mileage,
    max(loser.mileage_recorded_at) AS mileage_recorded_at,
    max(loser.owners_count) AS owners_count
  FROM _client_vehicle_duplicate_pairs pairs
  JOIN client_vehicles loser
    ON loser.branch_id = pairs.branch_id
   AND loser.id = pairs.loser_id
  GROUP BY pairs.branch_id, pairs.winner_id
), updated AS (
  UPDATE client_vehicles winner
  SET
    generation = coalesce(winner.generation, merged.generation),
    generation_canonical = coalesce(winner.generation_canonical, merged.generation_canonical),
    year = coalesce(winner.year, merged.year),
    model_year_from = coalesce(winner.model_year_from, merged.model_year_from),
    model_year_to = coalesce(winner.model_year_to, merged.model_year_to),
    frame_number = coalesce(winner.frame_number, merged.frame_number),
    body_name = coalesce(winner.body_name, merged.body_name),
    body_code = coalesce(winner.body_code, merged.body_code),
    body_type = coalesce(winner.body_type, merged.body_type),
    engine_name = coalesce(winner.engine_name, merged.engine_name),
    engine_code = coalesce(winner.engine_code, merged.engine_code),
    engine_series = coalesce(winner.engine_series, merged.engine_series),
    engine_volume_cc = coalesce(winner.engine_volume_cc, merged.engine_volume_cc),
    power_hp = coalesce(winner.power_hp, merged.power_hp),
    power_kw = coalesce(winner.power_kw, merged.power_kw),
    fuel_type = coalesce(winner.fuel_type, merged.fuel_type),
    transmission_type = coalesce(winner.transmission_type, merged.transmission_type),
    transmission_name = coalesce(winner.transmission_name, merged.transmission_name),
    drive_type = coalesce(winner.drive_type, merged.drive_type),
    steering_position = coalesce(winner.steering_position, merged.steering_position),
    market = coalesce(winner.market, merged.market),
    country_of_origin = coalesce(winner.country_of_origin, merged.country_of_origin),
    mileage = CASE
      WHEN merged.mileage_recorded_at > winner.mileage_recorded_at OR winner.mileage IS NULL THEN merged.mileage
      ELSE winner.mileage
    END,
    mileage_recorded_at = greatest(winner.mileage_recorded_at, merged.mileage_recorded_at),
    owners_count = coalesce(winner.owners_count, merged.owners_count),
    source_snapshot_json = coalesce(winner.source_snapshot_json, '{}'::jsonb)
      || jsonb_build_object('deduplicatedFrom', to_jsonb(merged.loser_ids)),
    updated_at = CURRENT_TIMESTAMP
  FROM merged
  WHERE winner.branch_id = merged.branch_id
    AND winner.id = merged.winner_id
  RETURNING winner.*
)
INSERT INTO client_vehicle_revisions (
  id, branch_id, vehicle_id, source, verification_status,
  changed_fields_json, snapshot_json, actor_login, actor_name
)
SELECT
  'cvr_' || md5(branch_id || ':' || id || ':legacy-dedupe-v1'),
  branch_id,
  id,
  'shipment_history_dedupe',
  'LEGACY',
  '["legacyDuplicateMerge"]'::jsonb,
  to_jsonb(updated),
  'system',
  'Объединение дублей истории отгрузок'
FROM updated
ON CONFLICT (id) DO NOTHING;

UPDATE client_vehicles loser
SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP
FROM _client_vehicle_duplicate_pairs pairs
WHERE loser.branch_id = pairs.branch_id
  AND loser.id = pairs.loser_id
  AND loser.status = 'ACTIVE'
  AND loser.verification_status = 'LEGACY';

COMMIT;

SELECT
  count(*) FILTER (WHERE status = 'ACTIVE') AS active_passports,
  count(*) FILTER (WHERE status = 'ARCHIVED') AS archived_legacy_duplicates,
  count(*) FILTER (WHERE status = 'ACTIVE' AND verification_status = 'LEGACY') AS awaiting_review
FROM client_vehicles;
