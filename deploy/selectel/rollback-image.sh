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
CADDY_CONFIG_FILE="${CADDY_CONFIG_FILE:-/etc/caddy/Caddyfile}"

[[ -f "$CONFIG_FILE" && -f "$SLOTS_FILE" && -f "$ACTIVE_FILE" && -f "$PREVIOUS_FILE" && -f "$UPSTREAM_FILE" ]] || {
  echo "rollback state is incomplete" >&2
  exit 78
}

exec 9>"$STATE_DIR/production-deploy.lock"
flock -n 9 || { echo "another production deployment or migration holds the lock" >&2; exit 75; }

set -a
# shellcheck disable=SC1090
source "$CONFIG_FILE"
# shellcheck disable=SC1090
source "$SLOTS_FILE"
# shellcheck disable=SC1090
source "$ACTIVE_FILE"
set +a

CURRENT_SLOT="$ACTIVE_SLOT"
CURRENT_UPSTREAM="$ACTIVE_UPSTREAM"
CURRENT_RELEASE="$ACTIVE_RELEASE"
CURRENT_COMMIT_SHA="$ACTIVE_COMMIT_SHA"
CURRENT_IMAGE_DIGEST="$ACTIVE_IMAGE_DIGEST"
CURRENT_IMAGE="$ACTIVE_IMAGE"
CURRENT_BUILT_AT="$ACTIVE_BUILT_AT"
CURRENT_EXPECTED_MIGRATION="$ACTIVE_EXPECTED_MIGRATION"
CURRENT_CONTAINER="${ACTIVE_CONTAINER:-unknown}"
CURRENT_CONTAINER_ID="${ACTIVE_CONTAINER_ID:-unknown}"
CURRENT_WORKER_SERVICE="${ACTIVE_WORKER_SERVICE:-unknown}"
CURRENT_WORKER_CONTAINER="${ACTIVE_WORKER_CONTAINER:-unknown}"
CURRENT_WORKER_CONTAINER_ID="${ACTIVE_WORKER_CONTAINER_ID:-unknown}"

set -a
# shellcheck disable=SC1090
source "$PREVIOUS_FILE"
set +a

[[ "$ACTIVE_SLOT" =~ ^(blue|green|legacy)$ ]] || { echo "invalid previous slot" >&2; exit 78; }
[[ "$ACTIVE_UPSTREAM" =~ ^127\.0\.0\.1:[0-9]{2,5}$ ]] || { echo "invalid previous upstream" >&2; exit 78; }
grep -Fxq "reverse_proxy $CURRENT_UPSTREAM" "$UPSTREAM_FILE" || {
  echo "managed Caddy include does not match current release" >&2
  exit 78
}

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-tgm}"
[[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "invalid COMPOSE_PROJECT_NAME" >&2; exit 78; }
COMPOSE=(docker compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" --env-file "$CONFIG_FILE" --env-file "$SLOTS_FILE" -f "$PROJECT_ROOT/docker-compose.selectel.yml")
if [[ -f "$PROJECT_ROOT/deploy/selectel/wireguard/wg_confs/wg0.conf" ]]; then
  COMPOSE+=(-f "$PROJECT_ROOT/docker-compose.selectel.wireguard.yml")
fi

smoke_url() {
  local base="$1"
  curl --fail --silent --show-error --max-time 10 "$base/api/health/live" >/dev/null
  curl --fail --silent --show-error --max-time 10 "$base/api/health/ready" >/dev/null
  curl --fail --silent --show-error --max-time 10 "$base/login" >/dev/null
  curl --fail --silent --show-error --max-time 10 "$base/api/public/stats" >/dev/null
}

PREVIOUS_WEB_STARTED=0
PREVIOUS_WORKER_STARTED=0
CURRENT_WORKER_STOPPED=0
TRAFFIC_SWITCHED=0
rollback_failed_rollback() {
  local exit_code=$?
  trap - ERR INT TERM
  if (( TRAFFIC_SWITCHED == 1 )); then
    printf 'reverse_proxy %s\n' "$CURRENT_UPSTREAM" >"$UPSTREAM_FILE.tmp.$$"
    mv "$UPSTREAM_FILE.tmp.$$" "$UPSTREAM_FILE"
    caddy validate --config "$CADDY_CONFIG_FILE" >/dev/null || true
    if [[ "$(id -u)" -eq 0 ]]; then systemctl reload caddy || true; else sudo systemctl reload caddy || true; fi
  fi
  if (( PREVIOUS_WORKER_STARTED == 1 )) && [[ "${ACTIVE_WORKER_CONTAINER:-unknown}" != unknown ]]; then
    docker stop --time 20 "$ACTIVE_WORKER_CONTAINER" || true
  fi
  if (( CURRENT_WORKER_STOPPED == 1 )) && [[ "$CURRENT_WORKER_CONTAINER" != unknown ]]; then
    docker start "$CURRENT_WORKER_CONTAINER" || true
  fi
  if (( PREVIOUS_WEB_STARTED == 1 )); then
    if [[ "$ACTIVE_SLOT" == legacy ]]; then
      docker stop --time 20 "$ACTIVE_CONTAINER" || true
    else
      "${COMPOSE[@]}" stop --timeout 20 "app_$ACTIVE_SLOT" || true
    fi
  fi
  echo "rollback failed; current release remains $CURRENT_RELEASE" >&2
  exit "$exit_code"
}
trap rollback_failed_rollback ERR INT TERM

if [[ "$ACTIVE_SLOT" == legacy ]]; then
  [[ "${ACTIVE_CONTAINER:-unknown}" != unknown ]] || { echo "legacy rollback container is missing" >&2; exit 78; }
  docker start "$ACTIVE_CONTAINER"
  PREVIOUS_WEB_STARTED=1
else
  "${COMPOSE[@]}" up -d --no-deps "app_$ACTIVE_SLOT"
  ACTIVE_CONTAINER_ID="$("${COMPOSE[@]}" ps -q "app_$ACTIVE_SLOT")"
  ACTIVE_CONTAINER="$(docker inspect --format '{{.Name}}' "$ACTIVE_CONTAINER_ID" | sed 's#^/##')"
  PREVIOUS_WEB_STARTED=1
fi

for _ in $(seq 1 "${HEALTH_RETRIES:-30}"); do
  if curl --fail --silent --show-error --max-time 5 "http://$ACTIVE_UPSTREAM/api/health/ready" >/dev/null; then
    break
  fi
  sleep "${HEALTH_INTERVAL_SECONDS:-2}"
done
smoke_url "http://$ACTIVE_UPSTREAM"

if [[ "$CURRENT_WORKER_CONTAINER" != unknown ]] && docker inspect "$CURRENT_WORKER_CONTAINER" >/dev/null 2>&1; then
  docker stop --time 20 "$CURRENT_WORKER_CONTAINER"
  CURRENT_WORKER_STOPPED=1
fi
if [[ "${ACTIVE_WORKER_CONTAINER:-unknown}" != unknown ]]; then
  if docker inspect "$ACTIVE_WORKER_CONTAINER" >/dev/null 2>&1; then
    docker start "$ACTIVE_WORKER_CONTAINER"
  elif [[ "${ACTIVE_WORKER_SERVICE:-unknown}" =~ ^worker_notifications_(blue|green)$ ]]; then
    "${COMPOSE[@]}" up -d --no-deps "$ACTIVE_WORKER_SERVICE"
    ACTIVE_WORKER_CONTAINER_ID="$("${COMPOSE[@]}" ps -q "$ACTIVE_WORKER_SERVICE")"
    ACTIVE_WORKER_CONTAINER="$(docker inspect --format '{{.Name}}' "$ACTIVE_WORKER_CONTAINER_ID" | sed 's#^/##')"
  else
    echo "previous worker state is not restorable" >&2
    exit 78
  fi
  PREVIOUS_WORKER_STARTED=1
fi

printf 'reverse_proxy %s\n' "$ACTIVE_UPSTREAM" >"$UPSTREAM_FILE.tmp.$$"
mv "$UPSTREAM_FILE.tmp.$$" "$UPSTREAM_FILE"
TRAFFIC_SWITCHED=1
caddy validate --config "$CADDY_CONFIG_FILE" >/dev/null
if [[ "$(id -u)" -eq 0 ]]; then systemctl reload caddy; else sudo systemctl reload caddy; fi
smoke_url "$PUBLIC_ORIGIN"

cat >"$ACTIVE_FILE.tmp.$$" <<EOF
ACTIVE_SLOT=$ACTIVE_SLOT
ACTIVE_UPSTREAM=$ACTIVE_UPSTREAM
ACTIVE_RELEASE=$ACTIVE_RELEASE
ACTIVE_COMMIT_SHA=$ACTIVE_COMMIT_SHA
ACTIVE_IMAGE_DIGEST=$ACTIVE_IMAGE_DIGEST
ACTIVE_IMAGE=$ACTIVE_IMAGE
ACTIVE_BUILT_AT=$ACTIVE_BUILT_AT
ACTIVE_EXPECTED_MIGRATION=$ACTIVE_EXPECTED_MIGRATION
ACTIVE_CONTAINER=${ACTIVE_CONTAINER:-unknown}
ACTIVE_CONTAINER_ID=${ACTIVE_CONTAINER_ID:-unknown}
ACTIVE_WORKER_SERVICE=${ACTIVE_WORKER_SERVICE:-unknown}
ACTIVE_WORKER_CONTAINER=${ACTIVE_WORKER_CONTAINER:-unknown}
ACTIVE_WORKER_CONTAINER_ID=${ACTIVE_WORKER_CONTAINER_ID:-unknown}
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
ACTIVE_CONTAINER=$CURRENT_CONTAINER
ACTIVE_CONTAINER_ID=$CURRENT_CONTAINER_ID
ACTIVE_WORKER_SERVICE=$CURRENT_WORKER_SERVICE
ACTIVE_WORKER_CONTAINER=$CURRENT_WORKER_CONTAINER
ACTIVE_WORKER_CONTAINER_ID=$CURRENT_WORKER_CONTAINER_ID
EOF
mv "$PREVIOUS_FILE.tmp.$$" "$PREVIOUS_FILE"

if [[ "$CURRENT_SLOT" == blue || "$CURRENT_SLOT" == green ]]; then
  "${COMPOSE[@]}" stop --timeout 20 "app_$CURRENT_SLOT"
elif [[ "$CURRENT_CONTAINER" != unknown ]]; then
  docker stop --time 20 "$CURRENT_CONTAINER" || true
fi

PREVIOUS_WEB_STARTED=0
PREVIOUS_WORKER_STARTED=0
CURRENT_WORKER_STOPPED=0
TRAFFIC_SWITCHED=0
trap - ERR INT TERM
printf 'rollback complete: active=%s digest=%s previous=%s\n' "$ACTIVE_RELEASE" "$ACTIVE_IMAGE_DIGEST" "$CURRENT_RELEASE"
