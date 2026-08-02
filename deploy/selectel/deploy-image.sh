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
  exit 64
}

[[ $# -eq 3 ]] || usage
IMAGE_DIGEST="$1"
RELEASE_TAG="$2"
COMMIT_SHA="$3"

[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "invalid image digest" 64
[[ "$RELEASE_TAG" =~ ^production-[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$ ]] || fail "invalid production release tag" 64
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "commit SHA must contain 40 lowercase hex characters" 64
[[ -f "$CONFIG_FILE" ]] || fail "missing $CONFIG_FILE; run the one-time server bootstrap" 78
[[ -f "$COMPOSE_FILE" ]] || fail "missing immutable Selectel compose file" 78
[[ -f "$ENV_FILE" ]] || fail "missing production environment file" 78

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

stage "preflight"
FREE_KB="$(df -Pk "$PROJECT_ROOT" | awk 'NR == 2 { print $4 }')"
MIN_FREE_KB="${MIN_FREE_KB:-3145728}"
[[ "$FREE_KB" =~ ^[0-9]+$ ]] || fail "cannot determine free disk space"
(( FREE_KB >= MIN_FREE_KB )) || fail "insufficient disk space (${FREE_KB} KiB free; ${MIN_FREE_KB} required)"

ACTIVE_SLOT=legacy
ACTIVE_UPSTREAM=127.0.0.1:3000
ACTIVE_RELEASE=legacy
ACTIVE_COMMIT_SHA=unknown
ACTIVE_IMAGE_DIGEST=unknown
ACTIVE_IMAGE=unknown
ACTIVE_BUILT_AT=unknown
ACTIVE_EXPECTED_MIGRATION=unknown
if [[ -f "$ACTIVE_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ACTIVE_FILE"
  set +a
fi
[[ "$ACTIVE_SLOT" =~ ^(blue|green|legacy)$ ]] || fail "invalid active slot state"

if [[ "$ACTIVE_SLOT" == blue ]]; then
  CANDIDATE_SLOT=green
  CANDIDATE_PORT=3002
else
  CANDIDATE_SLOT=blue
  CANDIDATE_PORT=3001
fi
CANDIDATE_SERVICE="app_$CANDIDATE_SLOT"
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
[[ "$IMAGE_EXPECTED_MIGRATION" != "" && "$IMAGE_EXPECTED_MIGRATION" != "unknown" ]] || fail "image has no expected migration label"
[[ "$IMAGE_TEST_RESULT" == "passed" ]] || fail "image does not carry a passed CI test label"

if [[ -f "$SLOTS_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SLOTS_FILE"
  set +a
fi

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

COMPOSE=(docker compose --env-file "$ENV_FILE" --env-file "$CONFIG_FILE" --env-file "$SLOTS_FILE" -f "$COMPOSE_FILE")
if [[ -f "$PROJECT_ROOT/deploy/selectel/wireguard/wg_confs/wg0.conf" ]]; then
  COMPOSE+=(-f "$WIREGUARD_FILE")
fi

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

smoke_url() {
  local base="$1"
  curl --fail --silent --show-error --max-time 10 "$base/api/health/ready" >/dev/null
  curl --fail --silent --show-error --max-time 10 "$base/login" >/dev/null
  curl --fail --silent --show-error --max-time 10 "$base/api/public/stats" >/dev/null
}

CANDIDATE_STARTED=0
TRAFFIC_SWITCHED=0
OLD_UPSTREAM_CONTENT=""
rollback_on_error() {
  local exit_code=$?
  trap - ERR INT TERM
  if (( TRAFFIC_SWITCHED == 1 )); then
    stage "automatic-rollback"
    printf '%s\n' "$OLD_UPSTREAM_CONTENT" >"$UPSTREAM_FILE.tmp.$$"
    mv "$UPSTREAM_FILE.tmp.$$" "$UPSTREAM_FILE"
    if [[ "$(id -u)" -eq 0 ]]; then
      systemctl reload caddy || true
    else
      sudo systemctl reload caddy || true
    fi
  fi
  if (( CANDIDATE_STARTED == 1 )); then
    "${COMPOSE[@]}" stop --timeout 20 "$CANDIDATE_SERVICE" || true
  fi
  printf 'deploy-image: deployment failed; active release remains %s\n' "$ACTIVE_RELEASE" >&2
  exit "$exit_code"
}
trap rollback_on_error ERR INT TERM

stage "start-$CANDIDATE_SLOT"
"${COMPOSE[@]}" up -d --no-deps --force-recreate "$CANDIDATE_SERVICE"
CANDIDATE_STARTED=1

stage "candidate-readiness"
wait_for_candidate || fail "candidate readiness timed out"
VERSION_JSON="$(curl --fail --silent --show-error --max-time 10 "$candidate_url/api/system/version")"
grep -Fq "\"release\":\"$RELEASE_TAG\"" <<<"$VERSION_JSON" || fail "candidate reports the wrong release"
grep -Fq "\"imageDigest\":\"$IMAGE_DIGEST\"" <<<"$VERSION_JSON" || fail "candidate reports the wrong image digest"
smoke_url "$candidate_url"

stage "switch-traffic"
if [[ -f "$UPSTREAM_FILE" ]]; then
  OLD_UPSTREAM_CONTENT="$(<"$UPSTREAM_FILE")"
else
  OLD_UPSTREAM_CONTENT="reverse_proxy $ACTIVE_UPSTREAM"
fi
printf 'reverse_proxy 127.0.0.1:%s\n' "$CANDIDATE_PORT" >"$UPSTREAM_FILE.tmp.$$"
mv "$UPSTREAM_FILE.tmp.$$" "$UPSTREAM_FILE"
TRAFFIC_SWITCHED=1
if [[ "$(id -u)" -eq 0 ]]; then
  systemctl reload caddy
else
  sudo systemctl reload caddy
fi

stage "post-switch-smoke"
FAILURES=0
SAMPLES="${POST_SWITCH_SAMPLES:-3}"
for _ in $(seq 1 "$SAMPLES"); do
  smoke_url "$PUBLIC_ORIGIN" || FAILURES=$((FAILURES + 1))
done
MAX_FAILURES="${POST_SWITCH_MAX_FAILURES:-0}"
(( FAILURES <= MAX_FAILURES )) || fail "post-switch error threshold exceeded ($FAILURES/$SAMPLES)"
PUBLIC_VERSION="$(curl --fail --silent --show-error --max-time 10 "$PUBLIC_ORIGIN/api/system/version")"
grep -Fq "\"imageDigest\":\"$IMAGE_DIGEST\"" <<<"$PUBLIC_VERSION" || fail "public endpoint does not report the candidate digest"

stage "record-release"
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
NODE_VERSION="$("${COMPOSE[@]}" exec -T "$CANDIDATE_SERVICE" node --version)"
MIGRATIONS_APPLIED="$("${COMPOSE[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc '\''SELECT COALESCE(json_agg(migration_name ORDER BY finished_at)::text, '\''\''[]'\''\'') FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'\''' | tail -n 1)"
[[ "$MIGRATIONS_APPLIED" == \[*\] ]] || fail "could not record applied migrations"

cp "$ACTIVE_FILE" "$PREVIOUS_FILE.tmp.$$" 2>/dev/null || {
  cat >"$PREVIOUS_FILE.tmp.$$" <<EOF
ACTIVE_SLOT=$ACTIVE_SLOT
ACTIVE_UPSTREAM=$ACTIVE_UPSTREAM
ACTIVE_RELEASE=$ACTIVE_RELEASE
ACTIVE_COMMIT_SHA=$ACTIVE_COMMIT_SHA
ACTIVE_IMAGE_DIGEST=$ACTIVE_IMAGE_DIGEST
ACTIVE_IMAGE=$ACTIVE_IMAGE
ACTIVE_BUILT_AT=$ACTIVE_BUILT_AT
ACTIVE_EXPECTED_MIGRATION=$ACTIVE_EXPECTED_MIGRATION
EOF
}
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
EOF
mv "$ACTIVE_FILE.tmp.$$" "$ACTIVE_FILE"

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
  "previousRelease": "$ACTIVE_RELEASE",
  "previousImageDigest": "$ACTIVE_IMAGE_DIGEST"
}
EOF
mv "$STATE_DIR/releases/$RELEASE_TAG.json.tmp.$$" "$STATE_DIR/releases/$RELEASE_TAG.json"

if [[ "$ACTIVE_SLOT" == blue || "$ACTIVE_SLOT" == green ]]; then
  "${COMPOSE[@]}" stop --timeout 20 "app_$ACTIVE_SLOT"
fi

TRAFFIC_SWITCHED=0
CANDIDATE_STARTED=0
trap - ERR INT TERM
stage "complete"
printf 'release=%s digest=%s slot=%s previous=%s\n' "$RELEASE_TAG" "$IMAGE_DIGEST" "$CANDIDATE_SLOT" "$ACTIVE_RELEASE"
