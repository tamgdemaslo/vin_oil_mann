#!/usr/bin/env sh
set -eu

if [ "${PRODUCTION_MIGRATION_APPROVED:-}" != "YES" ]; then
  echo "PRODUCTION_MIGRATION_APPROVED=YES is required" >&2
  exit 2
fi

node /app/scripts/check-selectel-database-url.mjs
exec /app/node_modules/.bin/prisma migrate deploy
