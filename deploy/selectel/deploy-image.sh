#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="${DEPLOY_STATE_DIR:-$PROJECT_ROOT/.deploy}"
CONFIG_FILE="${DEPLOY_CONFIG_FILE:-$STATE_DIR/config.env}"
ENV_FILE="${PRODUCTION_ENV_FILE:-$PROJECT_ROOT/.env.production}"
SLOTS_FILE="$STATE_DIR/slots.env"
ACTIVE_FILE="$STATE_DIR/active-release.env"
PREVIOUS_FILE="$STATE_DIR/previous-release.env"
LOCK_FILE="$STATE_DIR/production-deploy.lock"
UPSTREAM_FILE="${CADDY_UPSTREAM_FILE:-$STATE_DIR/caddy-upstream.caddy}"
CADDY_CONFIG_FILE="${CADDY_CONFIG_FILE:-/etc/caddy/Caddyfile}"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.selectel.yml"
WIREGUARD_FILE="$PROJECT_ROOT/docker-compose.selectel.wireguard.yml"

stage() {
  printf '[%s] stage=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1"
}

fail() {
  printf 'deploy-image: %s\n' "$1" >&2
  return "${2:-1}"
}

usage() {
  echo "Usage: deploy-image.sh sha256:<digest> production-YYYY-MM-DD.N <40-char-commit-sha>" >&2
  echo "       deploy-image.sh --dry-run" >&2
  exit 64
}

MODE=deploy
if [[ $# -eq 1 && "$1" == --dry-run ]]; then
  MODE=dry-run
elif [[ $# -eq 3 ]]; then
  IMAGE_DIGEST="$1"
  RELEASE_TAG="$2"
  COMMIT_SHA="$3"
  [[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "invalid image digest" 64
  [[ "$RELEASE_TAG" =~ ^production-[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$ ]] || fail "invalid production release tag" 64
  [[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "commit SHA must contain 40 lowercase hex characters" 64
else
  usage
fi

[[ -f "$CONFIG_FILE" ]] || fail "missing $CONFIG_FILE; run the one-time server bootstrap" 78
[[ -f "$COMPOSE_FILE" ]] || fail "missing immutable Selectel compose file" 78
[[ -f "$ENV_FILE" ]] || fail "missing production environment file" 78
[[ -f "$ACTIVE_FILE" ]] || fail "missing active release state" 78
[[ -f "$SLOTS_FILE" ]] || fail "missing slot state" 78
[[ -f "$UPSTREAM_FILE" ]] || fail "missing managed Caddy upstream include" 78

set -a
# shellcheck disable=SC1090
source "$CONFIG_FILE"
set +a

: "${APP_IMAGE_REPOSITORY:?APP_IMAGE_REPOSITORY is required in config.env}"
: "${PUBLIC_ORIGIN:?PUBLIC_ORIGIN is required in config.env}"
[[ "$APP_IMAGE_REPOSITORY" == cr.selcloud.ru/* ]] || fail "only cr.selcloud.ru images are permitted"
[[ "$PUBLIC_ORIGIN" == https://* ]] || fail "PUBLIC_ORIGIN must use HTTPS"

mkdir -p "$STATE_DIR" "$STATE_DIR/releases"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  fail "another production deployment or migration holds the lock" 75
fi

ACTIVE_SLOT=unknown
ACTIVE_UPSTREAM=unknown
ACTIVE_RELEASE=unknown
ACTIVE_COMMIT_SHA=unknown
ACTIVE_IMAGE_DIGEST=unknown
ACTIVE_IMAGE=unknown
ACTIVE_BUILT_AT=unknown
ACTIVE_EXPECTED_MIGRATION=unknown
ACTIVE_CONTAINER=unknown
ACTIVE_CONTAINER_ID=unknown
ACTIVE_WORKER_SERVICE=unknown
ACTIVE_WORKER_CONTAINER=unknown
ACTIVE_WORKER_CONTAINER_ID=unknown
set -a
# shellcheck disable=SC1090
source "$ACTIVE_FILE"
# shellcheck disable=SC1090
source "$SLOTS_FILE"
set +a

[[ "$ACTIVE_SLOT" =~ ^(blue|green|legacy)$ ]] || fail "invalid active slot state"
[[ "$ACTIVE_UPSTREAM" =~ ^127\.0\.0\.1:[0-9]{2,5}$ ]] || fail "invalid active upstream state"
[[ "$ACTIVE_RELEASE" =~ ^(production-[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+|[A-Za-z0-9._-]+)$ ]] || fail "invalid active release state"
if [[ "$ACTIVE_SLOT" != legacy ]]; then
  [[ "$ACTIVE_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "invalid active commit state"
  [[ "$ACTIVE_IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "invalid active digest state"
  [[ "$ACTIVE_IMAGE" == "$APP_IMAGE_REPOSITORY@$ACTIVE_IMAGE_DIGEST" ]] || fail "active image state is not the configured immutable repository digest"
fi
grep -Fxq "reverse_proxy $ACTIVE_UPSTREAM" "$UPSTREAM_FILE" || fail "managed Caddy include does not match active release state"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-tgm}"
[[ "$COMPOSE_PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || fail "invalid COMPOSE_PROJECT_NAME"
COMPOSE=(docker compose -p "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" --env-file "$CONFIG_FILE" --env-file "$SLOTS_FILE" -f "$COMPOSE_FILE")
if [[ -f "$PROJECT_ROOT/deploy/selectel/wireguard/wg_confs/wg0.conf" ]]; then
  COMPOSE+=(-f "$WIREGUARD_FILE")
fi

validate_compose_policy() {
  ! grep -Eq '^[[:space:]]+build:' "$COMPOSE_FILE"
  ! grep -Eqi 'npm (install|run build)|prisma generate|prisma migrate deploy' "$COMPOSE_FILE"
  "${COMPOSE[@]}" config --quiet
}

container_env_has() {
  local container="$1"
  local expected="$2"
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" | grep -Fxq "$expected"
}

verify_web_background_disabled() {
  local container="$1"
  container_env_has "$container" 'WORKERS_ENABLED=false'
  container_env_has "$container" 'CRON_ENABLED=false'
  container_env_has "$container" 'QUEUE_CONSUMER_ENABLED=false'
  container_env_has "$container" 'CLIENT_NOTIFICATIONS_WORKER_DISABLED=1'
  container_env_has "$container" 'CLIENT_NOTIFICATIONS_WORKER_ENABLED=0'
  container_env_has "$container" 'MESSENGER_MEDIA_IN_PROCESS_WORKER=false'
}

verify_notification_worker_role() {
  local container="$1"
  container_env_has "$container" 'WORKERS_ENABLED=true'
  container_env_has "$container" 'CRON_ENABLED=false'
  container_env_has "$container" 'QUEUE_CONSUMER_ENABLED=false'
  container_env_has "$container" 'CLIENT_NOTIFICATIONS_WORKER_DISABLED=0'
  container_env_has "$container" 'CLIENT_NOTIFICATIONS_WORKER_ENABLED=1'
  container_env_has "$container" 'MESSENGER_MEDIA_IN_PROCESS_WORKER=true'
}

smoke_url() {
  local base="$1"
  curl --fail --silent --show-error --max-time 10 "$base/api/health/live" >/dev/null
  curl --fail --silent --show-error --max-time 10 "$base/api/health/ready" >/dev/null
  curl --fail --silent --show-error --max-time 10 "$base/login" >/dev/null
  curl --fail --silent --show-error --max-time 10 "$base/api/public/stats" >/dev/null
}

verify_version() {
  local base="$1"
  local release="$2"
  local commit="$3"
  local digest="$4"
  local version
  version="$(curl --fail --silent --show-error --max-time 10 "$base/api/system/version")"
  grep -Fq "\"release\":\"$release\"" <<<"$version"
  grep -Fq "\"commitSha\":\"$commit\"" <<<"$version"
  grep -Fq "\"imageDigest\":\"$digest\"" <<<"$version"
}

validate_caddy() {
  caddy validate --config "$CADDY_CONFIG_FILE" >/dev/null
}

if [[ "$MODE" == dry-run ]]; then
  stage "dry-run-preflight"
  validate_compose_policy || fail "immutable Compose policy validation failed"
  validate_caddy || fail "Caddy validation failed"
  systemctl is-active --quiet caddy || fail "Caddy is not active"
  [[ "$ACTIVE_SLOT" != legacy ]] || fail "automatic deployment requires an immutable active slot"
  docker image inspect "$ACTIVE_IMAGE" >/dev/null
  IMAGE_COMMIT="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$ACTIVE_IMAGE")"
  [[ "$IMAGE_COMMIT" == "$ACTIVE_COMMIT_SHA" ]] || fail "active image commit label mismatch"
  docker inspect "$ACTIVE_CONTAINER" >/dev/null
  [[ "$(docker inspect --format '{{.State.Running}}' "$ACTIVE_CONTAINER")" == true ]] || fail "active web container is not running"
  verify_web_background_disabled "$ACTIVE_CONTAINER" || fail "active web container background flags are unsafe"
  active_url="http://$ACTIVE_UPSTREAM"
  smoke_url "$active_url"
  verify_version "$active_url" "$ACTIVE_RELEASE" "$ACTIVE_COMMIT_SHA" "$ACTIVE_IMAGE_DIGEST"
  if [[ "$ACTIVE_WORKER_CONTAINER" != unknown ]]; then
    [[ "$(docker inspect --format '{{.State.Running}}' "$ACTIVE_WORKER_CONTAINER")" == true ]] || fail "active notification worker is not running"
    verify_notification_worker_role "$ACTIVE_WORKER_CONTAINER" || fail "active notification worker flags are unsafe"
  fi
  smoke_url "$PUBLIC_ORIGIN"
  verify_version "$PUBLIC_ORIGIN" "$ACTIVE_RELEASE" "$ACTIVE_COMMIT_SHA" "$ACTIVE_IMAGE_DIGEST"
  stage "dry-run-complete"
  printf 'dry-run=passed release=%s digest=%s upstream=%s production_changed=no\n' \
    "$ACTIVE_RELEASE" "$ACTIVE_IMAGE_DIGEST" "$ACTIVE_UPSTREAM"
  exit 0
fi

stage "preflight"
validate_compose_policy || fail "immutable Compose policy validation failed"
validate_caddy || fail "Caddy validation failed"
FREE_KB="$(df -Pk "$PROJECT_ROOT" | awk 'NR == 2 { print $4 }')"
MIN_FREE_KB="${MIN_FREE_KB:-3145728}"
[[ "$FREE_KB" =~ ^[0-9]+$ ]] || fail "cannot determine free disk space"
(( FREE_KB >= MIN_FREE_KB )) || fail "insufficient disk space (${FREE_KB} KiB free; ${MIN_FREE_KB} required)"

if [[ "$ACTIVE_SLOT" == blue ]]; then
  CANDIDATE_SLOT=green
  CANDIDATE_PORT=3002
else
  CANDIDATE_SLOT=blue
  CANDIDATE_PORT=3001
fi
CANDIDATE_SERVICE="app_$CANDIDATE_SLOT"
CANDIDATE_WORKER_SERVICE="worker_notifications_$CANDIDATE_SLOT"
IMAGE_REFERENCE="$APP_IMAGE_REPOSITORY@$IMAGE_DIGEST"

stage "pull-image"
docker pull "$IMAGE_REFERENCE"
PULLED_DIGESTS="$(docker image inspect --format '{{ join .RepoDigests "\n" }}' "$IMAGE_REFERENCE")"
grep -Fxq "$IMAGE_REFERENCE" <<<"$PULLED_DIGESTS" || fail "pulled image does not expose the requested immutable digest"

IMAGE_COMMIT="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE_REFERENCE")"
IMAGE_RELEASE="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$IMAGE_REFERENCE")"
IMAGE_BUILT_AT="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.created" }}' "$IMAGE_REFERENCE")"
IMAGE_EXPECTED_MIGRATION="$(docker image inspect --format '{{ index .Config.Labels "ru.tamgdemaslo.expected-migration" }}' "$IMAGE_REFERENCE")"
IMAGE_LOCK_HASH="$(docker image inspect --format '{{ index .Config.Labels "ru.tamgdemaslo.package-lock-sha256" }}' "$IMAGE_REFERENCE")"
IMAGE_SCHEMA_HASH="$(docker image inspect --format '{{ index .Config.Labels "ru.tamgdemaslo.prisma-schema-sha256" }}' "$IMAGE_REFERENCE")"
IMAGE_MIGRATIONS="$(docker image inspect --format '{{ index .Config.Labels "ru.tamgdemaslo.migrations-included" }}' "$IMAGE_REFERENCE")"
IMAGE_TEST_RESULT="$(docker image inspect --format '{{ index .Config.Labels "ru.tamgdemaslo.tests" }}' "$IMAGE_REFERENCE")"

[[ "$IMAGE_COMMIT" == "$COMMIT_SHA" ]] || fail "image commit label does not match requested commit"
[[ "$IMAGE_RELEASE" == "$RELEASE_TAG" ]] || fail "image release label does not match requested release"
[[ "$IMAGE_EXPECTED_MIGRATION" != "" && "$IMAGE_EXPECTED_MIGRATION" != unknown ]] || fail "image has no expected migration label"
[[ "$IMAGE_TEST_RESULT" == passed ]] || fail "image does not carry a passed CI test label"

PREFIX=APP_BLUE
[[ "$CANDIDATE_SLOT" == green ]] && PREFIX=APP_GREEN
printf -v "${PREFIX}_IMAGE" '%s' "$IMAGE_REFERENCE"
printf -v "${PREFIX}_RELEASE" '%s' "$RELEASE_TAG"
printf -v "${PREFIX}_COMMIT_SHA" '%s' "$COMMIT_SHA"
printf -v "${PREFIX}_IMAGE_DIGEST" '%s' "$IMAGE_DIGEST"
printf -v "${PREFIX}_BUILT_AT" '%s' "$IMAGE_BUILT_AT"
printf -v "${PREFIX}_EXPECTED_MIGRATION" '%s' "$IMAGE_EXPECTED_MIGRATION"

SLOTS_TMP="$SLOTS_FILE.tmp.$$"
{
  for slot in BLUE GREEN; do
    for key in IMAGE RELEASE COMMIT_SHA IMAGE_DIGEST BUILT_AT EXPECTED_MIGRATION; do
      var="APP_${slot}_${key}"
      printf '%s=%s\n' "$var" "${!var:-unknown}"
    done
  done
} >"$SLOTS_TMP"
mv "$SLOTS_TMP" "$SLOTS_FILE"

candidate_url="http://127.0.0.1:$CANDIDATE_PORT"
wait_for_candidate() {
  local attempt
  for attempt in $(seq 1 "${HEALTH_RETRIES:-30}"); do
    if curl --fail --silent --show-error --max-time 5 "$candidate_url/api/health/ready" >/dev/null; then
      return 0
    fi
    sleep "${HEALTH_INTERVAL_SECONDS:-2}"
  done
  return 1
}

wait_for_worker() {
  local container="$1"
  local attempt
  for attempt in $(seq 1 "${HEALTH_RETRIES:-30}"); do
    if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true)" == healthy ]]; then
      return 0
    fi
    sleep "${HEALTH_INTERVAL_SECONDS:-2}"
  done
  return 1
}

check_runtime_logs() {
  local service="$1"
  local logs
  logs="$("${COMPOSE[@]}" logs --no-color --tail 300 "$service" 2>&1 || true)"
  if grep -Eqi 'PrismaClient[^ ]*Error|column .* does not exist|relation .* does not exist|migration mismatch|P[0-9]{4}|unhandled rejection|uncaught exception' <<<"$logs"; then
    printf '%s\n' "$logs" >&2
    fail "runtime logs contain a database or startup error"
  fi
}

CANDIDATE_STARTED=0
TRAFFIC_SWITCHED=0
CANDIDATE_WORKER_STARTED=0
OLD_WORKER_STOPPED=0
STATE_RECORDED=0
OLD_UPSTREAM_CONTENT=""
rollback_on_error() {
  local exit_code=$?
  trap - ERR INT TERM
  if (( CANDIDATE_WORKER_STARTED == 1 )); then
    "${COMPOSE[@]}" stop --timeout 20 "$CANDIDATE_WORKER_SERVICE" || true
  fi
  if (( OLD_WORKER_STOPPED == 1 )) && [[ "$ACTIVE_WORKER_CONTAINER" != unknown ]]; then
    docker start "$ACTIVE_WORKER_CONTAINER" || true
  fi
  if (( TRAFFIC_SWITCHED == 1 )); then
    stage "automatic-rollback"
    printf '%s\n' "$OLD_UPSTREAM_CONTENT" >"$UPSTREAM_FILE.tmp.$$"
    mv "$UPSTREAM_FILE.tmp.$$" "$UPSTREAM_FILE"
    validate_caddy || true
    if [[ "$(id -u)" -eq 0 ]]; then systemctl reload caddy || true; else sudo systemctl reload caddy || true; fi
  fi
  if (( CANDIDATE_STARTED == 1 )); then
    "${COMPOSE[@]}" stop --timeout 20 "$CANDIDATE_SERVICE" || true
  fi
  if (( STATE_RECORDED == 1 )) && [[ -f "$PREVIOUS_FILE" ]]; then
    cp "$PREVIOUS_FILE" "$ACTIVE_FILE" || true
  fi
  printf 'deploy-image: deployment failed; active release remains %s\n' "$ACTIVE_RELEASE" >&2
  exit "$exit_code"
}
trap rollback_on_error ERR INT TERM

stage "start-$CANDIDATE_SLOT"
"${COMPOSE[@]}" up -d --no-deps --force-recreate "$CANDIDATE_SERVICE"
CANDIDATE_STARTED=1
CANDIDATE_CONTAINER_ID="$("${COMPOSE[@]}" ps -q "$CANDIDATE_SERVICE")"
[[ "$CANDIDATE_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] || fail "candidate container ID is invalid"
CANDIDATE_CONTAINER="$(docker inspect --format '{{.Name}}' "$CANDIDATE_CONTAINER_ID" | sed 's#^/##')"
verify_web_background_disabled "$CANDIDATE_CONTAINER_ID" || fail "candidate web background handlers are not disabled"

stage "candidate-readiness"
wait_for_candidate || fail "candidate readiness timed out"
verify_version "$candidate_url" "$RELEASE_TAG" "$COMMIT_SHA" "$IMAGE_DIGEST"
smoke_url "$candidate_url"
[[ "$(docker inspect --format '{{.RestartCount}}' "$CANDIDATE_CONTAINER_ID")" == 0 ]] || fail "candidate entered a restart cycle"
check_runtime_logs "$CANDIDATE_SERVICE"

stage "switch-traffic"
OLD_UPSTREAM_CONTENT="$(<"$UPSTREAM_FILE")"
printf 'reverse_proxy 127.0.0.1:%s\n' "$CANDIDATE_PORT" >"$UPSTREAM_FILE.tmp.$$"
mv "$UPSTREAM_FILE.tmp.$$" "$UPSTREAM_FILE"
TRAFFIC_SWITCHED=1
validate_caddy || fail "Caddy validation failed after candidate upstream update"
if [[ "$(id -u)" -eq 0 ]]; then systemctl reload caddy; else sudo systemctl reload caddy; fi

stage "post-switch-observation"
FAILURES=0
SAMPLES="${POST_SWITCH_SAMPLES:-3}"
for _ in $(seq 1 "$SAMPLES"); do
  smoke_url "$PUBLIC_ORIGIN" || FAILURES=$((FAILURES + 1))
done
MAX_FAILURES="${POST_SWITCH_MAX_FAILURES:-0}"
(( FAILURES <= MAX_FAILURES )) || fail "post-switch error threshold exceeded ($FAILURES/$SAMPLES)"
verify_version "$PUBLIC_ORIGIN" "$RELEASE_TAG" "$COMMIT_SHA" "$IMAGE_DIGEST"

OBSERVATION_SECONDS="${POST_SWITCH_OBSERVATION_SECONDS:-600}"
OBSERVATION_INTERVAL="${POST_SWITCH_INTERVAL_SECONDS:-20}"
[[ "$OBSERVATION_SECONDS" =~ ^[0-9]+$ && "$OBSERVATION_INTERVAL" =~ ^[1-9][0-9]*$ ]] || fail "invalid observation settings"
observation_deadline=$((SECONDS + OBSERVATION_SECONDS))
while (( SECONDS < observation_deadline )); do
  sleep "$OBSERVATION_INTERVAL"
  smoke_url "$PUBLIC_ORIGIN"
  verify_version "$PUBLIC_ORIGIN" "$RELEASE_TAG" "$COMMIT_SHA" "$IMAGE_DIGEST"
  check_runtime_logs "$CANDIDATE_SERVICE"
done

stage "switch-notification-worker"
if [[ "$ACTIVE_WORKER_CONTAINER" != unknown ]] && docker inspect "$ACTIVE_WORKER_CONTAINER" >/dev/null 2>&1; then
  docker stop --time 20 "$ACTIVE_WORKER_CONTAINER"
  OLD_WORKER_STOPPED=1
fi
"${COMPOSE[@]}" up -d --no-deps --force-recreate "$CANDIDATE_WORKER_SERVICE"
CANDIDATE_WORKER_STARTED=1
CANDIDATE_WORKER_CONTAINER_ID="$("${COMPOSE[@]}" ps -q "$CANDIDATE_WORKER_SERVICE")"
[[ "$CANDIDATE_WORKER_CONTAINER_ID" =~ ^[0-9a-f]{64}$ ]] || fail "candidate worker container ID is invalid"
CANDIDATE_WORKER_CONTAINER="$(docker inspect --format '{{.Name}}' "$CANDIDATE_WORKER_CONTAINER_ID" | sed 's#^/##')"
verify_notification_worker_role "$CANDIDATE_WORKER_CONTAINER_ID" || fail "candidate notification worker flags are unsafe"
wait_for_worker "$CANDIDATE_WORKER_CONTAINER_ID" || fail "candidate notification worker did not become healthy"
[[ "$(docker inspect --format '{{.RestartCount}}' "$CANDIDATE_WORKER_CONTAINER_ID")" == 0 ]] || fail "candidate notification worker entered a restart cycle"
check_runtime_logs "$CANDIDATE_WORKER_SERVICE"

stage "record-release"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NODE_VERSION="$("${COMPOSE[@]}" exec -T "$CANDIDATE_SERVICE" node --version)"
MIGRATIONS_APPLIED="$("${COMPOSE[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc '\''SELECT COALESCE(json_agg(migration_name ORDER BY finished_at)::text, '\''\''[]'\''\'') FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'\''' | tail -n 1)"
[[ "$MIGRATIONS_APPLIED" == \[*\] ]] || fail "could not record applied migrations"

cp "$ACTIVE_FILE" "$PREVIOUS_FILE.tmp.$$"
mv "$PREVIOUS_FILE.tmp.$$" "$PREVIOUS_FILE"

cat >"$ACTIVE_FILE.tmp.$$" <<EOF
ACTIVE_SLOT=$CANDIDATE_SLOT
ACTIVE_UPSTREAM=127.0.0.1:$CANDIDATE_PORT
ACTIVE_RELEASE=$RELEASE_TAG
ACTIVE_COMMIT_SHA=$COMMIT_SHA
ACTIVE_IMAGE_DIGEST=$IMAGE_DIGEST
ACTIVE_IMAGE=$IMAGE_REFERENCE
ACTIVE_BUILT_AT=$IMAGE_BUILT_AT
ACTIVE_EXPECTED_MIGRATION=$IMAGE_EXPECTED_MIGRATION
ACTIVE_CONTAINER=$CANDIDATE_CONTAINER
ACTIVE_CONTAINER_ID=$CANDIDATE_CONTAINER_ID
ACTIVE_WORKER_SERVICE=$CANDIDATE_WORKER_SERVICE
ACTIVE_WORKER_CONTAINER=$CANDIDATE_WORKER_CONTAINER
ACTIVE_WORKER_CONTAINER_ID=$CANDIDATE_WORKER_CONTAINER_ID
EOF
mv "$ACTIVE_FILE.tmp.$$" "$ACTIVE_FILE"
STATE_RECORDED=1

cat >"$STATE_DIR/releases/$RELEASE_TAG.json.tmp.$$" <<EOF
{
  "release": "$RELEASE_TAG",
  "commitSha": "$COMMIT_SHA",
  "imageDigest": "$IMAGE_DIGEST",
  "imageReference": "$IMAGE_REFERENCE",
  "builtAt": "$IMAGE_BUILT_AT",
  "deployedAt": "$DEPLOYED_AT",
  "nodeVersion": "$NODE_VERSION",
  "packageLockSha256": "$IMAGE_LOCK_HASH",
  "prismaSchemaSha256": "$IMAGE_SCHEMA_HASH",
  "migrationsIncluded": "$IMAGE_MIGRATIONS",
  "migrationsApplied": $MIGRATIONS_APPLIED,
  "testResult": "$IMAGE_TEST_RESULT",
  "healthStatus": "passed",
  "slot": "$CANDIDATE_SLOT",
  "workerService": "$CANDIDATE_WORKER_SERVICE",
  "previousRelease": "$ACTIVE_RELEASE",
  "previousImageDigest": "$ACTIVE_IMAGE_DIGEST"
}
EOF
mv "$STATE_DIR/releases/$RELEASE_TAG.json.tmp.$$" "$STATE_DIR/releases/$RELEASE_TAG.json"

if [[ "$ACTIVE_SLOT" == blue || "$ACTIVE_SLOT" == green ]]; then
  "${COMPOSE[@]}" stop --timeout 20 "app_$ACTIVE_SLOT"
elif [[ "$ACTIVE_SLOT" == legacy && "$ACTIVE_CONTAINER" != unknown ]]; then
  docker stop --time 20 "$ACTIVE_CONTAINER" || true
fi

TRAFFIC_SWITCHED=0
CANDIDATE_STARTED=0
CANDIDATE_WORKER_STARTED=0
OLD_WORKER_STOPPED=0
STATE_RECORDED=0
trap - ERR INT TERM
stage "complete"
printf 'release=%s digest=%s slot=%s worker=%s previous=%s\n' \
  "$RELEASE_TAG" "$IMAGE_DIGEST" "$CANDIDATE_SLOT" "$CANDIDATE_WORKER_SERVICE" "$ACTIVE_RELEASE"
