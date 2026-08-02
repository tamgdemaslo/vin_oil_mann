#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="${DEPLOY_STATE_DIR:-$PROJECT_ROOT/.deploy}"
CONFIG_FILE="${DEPLOY_CONFIG_FILE:-$STATE_DIR/config.env}"
ENV_FILE="${PRODUCTION_ENV_FILE:-$PROJECT_ROOT/.env.production}"
SLOTS_FILE="$STATE_DIR/slots.env"
ACTIVE_FILE="$STATE_DIR/active-release.env"
PREVIOUS_FILE="$STATE_DIR/previous-release.env"
UPSTREAM_FILE="${CADDY_UPSTREAM_FILE:-$STATE_DIR/caddy-upstream.caddy}"

[[ -f "$CONFIG_FILE" && -f "$SLOTS_FILE" && -f "$ACTIVE_FILE" && -f "$PREVIOUS_FILE" ]] || {
  echo "rollback state is incomplete" >&2
  exit 78
}

exec 9>"$STATE_DIR/production-deploy.lock"
flock -n 9 || { echo "another production deployment or migration holds the lock" >&2; exit 75; }

set -a
# shellcheck disable=SC1090
source "$CONFIG_FILE"
# shellcheck disable=SC1090
source "$ACTIVE_FILE"
CURRENT_SLOT="$ACTIVE_SLOT"
CURRENT_UPSTREAM="$ACTIVE_UPSTREAM"
CURRENT_RELEASE="$ACTIVE_RELEASE"
CURRENT_COMMIT_SHA="$ACTIVE_COMMIT_SHA"
CURRENT_IMAGE_DIGEST="$ACTIVE_IMAGE_DIGEST"
CURRENT_IMAGE="$ACTIVE_IMAGE"
CURRENT_BUILT_AT="$ACTIVE_BUILT_AT"
CURRENT_EXPECTED_MIGRATION="$ACTIVE_EXPECTED_MIGRATION"
# shellcheck disable=SC1090
source "$PREVIOUS_FILE"
set +a

[[ "$ACTIVE_SLOT" =~ ^(blue|green|legacy)$ ]] || { echo "invalid previous slot" >&2; exit 78; }

COMPOSE=(docker compose --env-file "$ENV_FILE" --env-file "$CONFIG_FILE" --env-file "$SLOTS_FILE" -f "$PROJECT_ROOT/docker-compose.selectel.yml")
if [[ -f "$PROJECT_ROOT/deploy/selectel/wireguard/wg_confs/wg0.conf" ]]; then
  COMPOSE+=(-f "$PROJECT_ROOT/docker-compose.selectel.wireguard.yml")
fi

if [[ "$ACTIVE_SLOT" == blue || "$ACTIVE_SLOT" == green ]]; then
  PORT=3001
  [[ "$ACTIVE_SLOT" == green ]] && PORT=3002
  "${COMPOSE[@]}" up -d --no-deps "app_$ACTIVE_SLOT"
  for _ in $(seq 1 "${HEALTH_RETRIES:-30}"); do
    if curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$PORT/api/health/ready" >/dev/null; then
      break
    fi
    sleep "${HEALTH_INTERVAL_SECONDS:-2}"
  done
  curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$PORT/api/health/ready" >/dev/null
fi

printf 'reverse_proxy %s\n' "$ACTIVE_UPSTREAM" >"$UPSTREAM_FILE.tmp.$$"
mv "$UPSTREAM_FILE.tmp.$$" "$UPSTREAM_FILE"
if [[ "$(id -u)" -eq 0 ]]; then systemctl reload caddy; else sudo systemctl reload caddy; fi

cat >"$ACTIVE_FILE.tmp.$$" <<EOF
ACTIVE_SLOT=$ACTIVE_SLOT
ACTIVE_UPSTREAM=$ACTIVE_UPSTREAM
ACTIVE_RELEASE=$ACTIVE_RELEASE
ACTIVE_COMMIT_SHA=$ACTIVE_COMMIT_SHA
ACTIVE_IMAGE_DIGEST=$ACTIVE_IMAGE_DIGEST
ACTIVE_IMAGE=$ACTIVE_IMAGE
ACTIVE_BUILT_AT=$ACTIVE_BUILT_AT
ACTIVE_EXPECTED_MIGRATION=$ACTIVE_EXPECTED_MIGRATION
EOF
mv "$ACTIVE_FILE.tmp.$$" "$ACTIVE_FILE"

cat >"$PREVIOUS_FILE.tmp.$$" <<EOF
ACTIVE_SLOT=$CURRENT_SLOT
ACTIVE_UPSTREAM=$CURRENT_UPSTREAM
ACTIVE_RELEASE=$CURRENT_RELEASE
ACTIVE_COMMIT_SHA=$CURRENT_COMMIT_SHA
ACTIVE_IMAGE_DIGEST=$CURRENT_IMAGE_DIGEST
ACTIVE_IMAGE=$CURRENT_IMAGE
ACTIVE_BUILT_AT=$CURRENT_BUILT_AT
ACTIVE_EXPECTED_MIGRATION=$CURRENT_EXPECTED_MIGRATION
EOF
mv "$PREVIOUS_FILE.tmp.$$" "$PREVIOUS_FILE"

if [[ "$CURRENT_SLOT" == blue || "$CURRENT_SLOT" == green ]]; then
  "${COMPOSE[@]}" stop --timeout 20 "app_$CURRENT_SLOT"
fi

printf 'rollback complete: active=%s digest=%s previous=%s\n' "$ACTIVE_RELEASE" "$ACTIVE_IMAGE_DIGEST" "$CURRENT_RELEASE"
