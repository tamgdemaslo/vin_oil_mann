#!/bin/sh
set -eu

# App Platform builds the repository directly, rather than through the former
# image-publishing workflow. The newest migration bundled with that build is
# used for readiness checks unless an operator explicitly overrides it.
if [ -z "${APP_EXPECTED_MIGRATION:-}" ] || [ "${APP_EXPECTED_MIGRATION}" = "unknown" ]; then
  APP_EXPECTED_MIGRATION="$(find /app/prisma/migrations -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort | tail -n 1)"
  export APP_EXPECTED_MIGRATION
fi

exec node /app/server.js
