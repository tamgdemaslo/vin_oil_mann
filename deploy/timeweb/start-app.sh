#!/bin/sh
set -eu

APP_ROOT="${APP_ROOT:-$(pwd)}"

# App Platform builds the repository directly, rather than through the former
# image-publishing workflow. The newest migration bundled with that build is
# used for readiness checks unless an operator explicitly overrides it.
if { [ -z "${APP_EXPECTED_MIGRATION:-}" ] || [ "${APP_EXPECTED_MIGRATION}" = "unknown" ]; } \
  && [ -d "$APP_ROOT/prisma/migrations" ]; then
  APP_EXPECTED_MIGRATION="$(find "$APP_ROOT/prisma/migrations" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort | tail -n 1)"
  export APP_EXPECTED_MIGRATION
fi

# Docker copies the standalone output into /app, while Timeweb's Node builder
# keeps it under .next/standalone. Support both layouts and force a reachable
# listen address even when the platform injects its container hostname.
export HOSTNAME=0.0.0.0

if [ -f "$APP_ROOT/server.js" ]; then
  exec node "$APP_ROOT/server.js"
fi

STANDALONE_ROOT="$APP_ROOT/.next/standalone"
if [ ! -f "$STANDALONE_ROOT/server.js" ]; then
  echo "Standalone server not found: $STANDALONE_ROOT/server.js" >&2
  exit 1
fi

if [ ! -d "$STANDALONE_ROOT/.next/static" ]; then
  echo "Standalone static assets not found: $STANDALONE_ROOT/.next/static" >&2
  exit 1
fi

cd "$STANDALONE_ROOT"
exec node server.js
