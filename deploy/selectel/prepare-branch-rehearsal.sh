#!/usr/bin/env bash
set -euo pipefail

# Restores an already approved custom-format backup into a pre-created, empty
# rehearsal database. It never connects to the decommissioned legacy platform
# or takes a production dump.
: "${REHEARSAL_BACKUP_PATH:?Set REHEARSAL_BACKUP_PATH to an approved custom-format backup}"
: "${DATABASE_URL:?Set DATABASE_URL to the empty Selectel rehearsal database}"
: "${APP_ENV:?Set APP_ENV}"
: "${DEPLOYMENT_PROVIDER:?Set DEPLOYMENT_PROVIDER}"
: "${LEGACY_PLATFORM_ARCHIVE_STATUS:?Set legacy platform archive status}"
: "${BRANCH_LEGACY_PLATFORM_ARCHIVE_EVIDENCE:?Set verified legacy archive manifest path}"

if [[ "$APP_ENV" != "branch-migration-rehearsal" ]]; then
  echo "Refused: APP_ENV must be branch-migration-rehearsal" >&2
  exit 2
fi
if [[ "$DEPLOYMENT_PROVIDER" != "selectel-rehearsal" ]]; then
  echo "Refused: DEPLOYMENT_PROVIDER must be selectel-rehearsal" >&2
  exit 2
fi
if [[ "$LEGACY_PLATFORM_ARCHIVE_STATUS" != "RAILWAY_DECOMMISSIONED_ARCHIVED" ]]; then
  echo "Refused: legacy platform archive status is not RAILWAY_DECOMMISSIONED_ARCHIVED" >&2
  exit 2
fi
if [[ "$DATABASE_URL" =~ [Rr][Aa][Ii][Ll][Ww][Aa][Yy] || "$DATABASE_URL" =~ [Rr][Ll][Ww][Yy]\.net ]]; then
  echo "Refused: decommissioned legacy database URL" >&2
  exit 2
fi
if [[ ! -f "$BRANCH_LEGACY_PLATFORM_ARCHIVE_EVIDENCE" ]]; then
  echo "Refused: verified legacy archive manifest does not exist" >&2
  exit 2
fi
if [[ "$DATABASE_URL" != *rehearsal* ]]; then
  echo "Refused: target database name must contain rehearsal" >&2
  exit 2
fi
if [[ ! -f "$REHEARSAL_BACKUP_PATH" ]]; then
  echo "Refused: backup file does not exist" >&2
  exit 2
fi

for name in EXTERNAL_SIDE_EFFECTS_ENABLED TELEGRAM_SEND_ENABLED WEBHOOK_PROCESSING_ENABLED PAYMENT_MUTATIONS_ENABLED TBANK_MUTATIONS_ENABLED SUPPLIER_ORDER_ENABLED EMAIL_SEND_ENABLED YCLIENTS_MUTATIONS_ENABLED MOYSKLAD_MUTATIONS_ENABLED ROSSKO_ORDER_ENABLED; do
  if [[ "${!name:-}" != "false" ]]; then
    echo "Refused: $name must equal false" >&2
    exit 2
  fi
done

npm run migration:branch:preflight
pg_restore --exit-on-error --no-owner --no-privileges --dbname "$DATABASE_URL" "$REHEARSAL_BACKUP_PATH"
npx prisma migrate deploy --schema prisma/schema.prisma
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file deploy/selectel/branch-post-migration-verification.sql

echo "Rehearsal copy prepared. External effects remain disabled. Run security matrix and rollback rehearsal before any GO decision."
