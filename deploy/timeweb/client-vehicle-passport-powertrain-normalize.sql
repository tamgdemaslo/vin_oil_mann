-- Normalize legacy gearbox and drive codes into operator-facing values.
-- Only LOW-confidence LEGACY passports are touched; confirmed data is excluded.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT pg_advisory_xact_lock(hashtextextended('client-vehicle-passport-powertrain-normalize-v2', 0));

WITH target AS (
  SELECT
    branch_id,
    id,
    transmission_type AS raw_transmission,
    drive_type AS raw_drive,
    CASE
      WHEN transmission_type ~* '(UNKNOWN_TRANSMISSION|неизвестн)' THEN NULL
      WHEN transmission_type ~* '(вариатор|VARIATOR|(^|[^A-Z])CVT([^A-Z]|$))' THEN 'Вариатор'
      WHEN transmission_type ~* '(робот|(^|[^A-Z])(ROBOT|DCT|DSG)([^A-Z]|$))' THEN 'Робот'
      WHEN transmission_type ~* '(акпп|AUTOMATIC|(^|[^A-Z])AUT([^A-Z]|$))' THEN 'АКПП'
      WHEN transmission_type ~* '(мкпп|MECHANICAL|MANUAL|(^|[^A-Z])MAN([^A-Z]|$))' THEN 'МКПП'
      ELSE transmission_type
    END AS normalized_transmission,
    CASE
      WHEN coalesce(drive_type, transmission_type) ~* '(полн|ALL_WHEEL|(^|[^A-Z])(AWD|4WD|4X4)([^A-Z]|$))' THEN 'Полный'
      WHEN coalesce(drive_type, transmission_type) ~* '(задн|REAR_DRIVE|REAR_WHEEL|(^|[^A-Z])RWD([^A-Z]|$))' THEN 'Задний'
      WHEN coalesce(drive_type, transmission_type) ~* '(передн|FORWARD_CONTROL|FRONT_WHEEL|(^|[^A-Z])FWD([^A-Z]|$))' THEN 'Передний'
      ELSE drive_type
    END AS normalized_drive
  FROM client_vehicles
  WHERE status = 'ACTIVE'
    AND verification_status = 'LEGACY'
    AND transmission_type IS NOT NULL
), updated AS (
  UPDATE client_vehicles vehicle
  SET
    transmission_type = target.normalized_transmission,
    drive_type = target.normalized_drive,
    field_sources_json = coalesce(vehicle.field_sources_json, '{}'::jsonb) || jsonb_build_object(
      'transmissionType', jsonb_build_object(
        'source', 'shipment_history_normalized',
        'confidence', 'LOW',
        'verificationStatus', 'LEGACY',
        'updatedAt', CURRENT_TIMESTAMP
      ),
      'driveType', jsonb_build_object(
        'source', 'shipment_history_normalized',
        'confidence', 'LOW',
        'verificationStatus', 'LEGACY',
        'updatedAt', CURRENT_TIMESTAMP
      )
    ),
    source_snapshot_json = coalesce(vehicle.source_snapshot_json, '{}'::jsonb) || jsonb_build_object(
      'legacyTransmissionRaw', target.raw_transmission,
      'legacyDriveRaw', target.raw_drive
    ),
    updated_at = CURRENT_TIMESTAMP
  FROM target
  WHERE vehicle.branch_id = target.branch_id
    AND vehicle.id = target.id
    AND (
      vehicle.transmission_type IS DISTINCT FROM target.normalized_transmission
      OR vehicle.drive_type IS DISTINCT FROM target.normalized_drive
    )
  RETURNING vehicle.*
)
INSERT INTO client_vehicle_revisions (
  id, branch_id, vehicle_id, source, verification_status,
  changed_fields_json, snapshot_json, actor_login, actor_name
)
SELECT
  'cvr_' || md5(branch_id || ':' || id || ':legacy-powertrain-normalize-v2'),
  branch_id,
  id,
  'shipment_history_normalized',
  'LEGACY',
  '["transmissionType", "driveType"]'::jsonb,
  to_jsonb(updated),
  'system',
  'Нормализация коробки и привода'
FROM updated
ON CONFLICT (id) DO NOTHING;

COMMIT;

SELECT transmission_type, drive_type, count(*)
FROM client_vehicles
WHERE status = 'ACTIVE' AND transmission_type IS NOT NULL
GROUP BY transmission_type, drive_type
ORDER BY count(*) DESC, transmission_type, drive_type;
