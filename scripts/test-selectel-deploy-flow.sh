#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
node "$ROOT/scripts/test-branch-production-guards.mjs"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
MOCK_BIN="$TEST_ROOT/bin"
STATE_DIR="$TEST_ROOT/state"
mkdir -p "$MOCK_BIN" "$STATE_DIR"

cat >"$MOCK_BIN/docker" <<'EOF'
#!/usr/bin/env bash
set -eu
if [[ "$1 $2" == "image inspect" ]]; then
  if [[ "${3:-}" != --format ]]; then exit 0; fi
  format="$4"
  case "$format" in
    *RepoDigests*) echo "$MOCK_REPOSITORY@$MOCK_DIGEST" ;;
    *org.opencontainers.image.revision*) echo "$MOCK_COMMIT" ;;
    *org.opencontainers.image.version*) echo "$MOCK_RELEASE" ;;
    *org.opencontainers.image.created*) echo "2026-08-03T12:00:00Z" ;;
    *expected-migration*) echo "20260802125000_branch_query_planner_statistics" ;;
    *package-lock-sha256*) printf '%064d\n' 1 ;;
    *prisma-schema-sha256*) printf '%064d\n' 2 ;;
    *migrations-included*) echo "20260802124000_branch_query_performance_indexes,20260802125000_branch_query_planner_statistics" ;;
    *ru.tamgdemaslo.tests*) echo "passed" ;;
    *) echo "mock image inspect format not handled: $format" >&2; exit 1 ;;
  esac
  exit 0
fi
if [[ "$1" == pull || "$1" == start || "$1" == stop ]]; then exit 0; fi
if [[ "$1" == inspect ]]; then
  if [[ "${2:-}" != --format ]]; then exit 0; fi
  format="$3"
  container="${4:-mock}"
  case "$format" in
    *Config.Env*)
      if [[ "$container" == *worker* || "$container" == "$(printf '2%.0s' {1..64})" ]]; then
        printf '%s\n' \
          'WORKERS_ENABLED=true' \
          'CRON_ENABLED=false' \
          'QUEUE_CONSUMER_ENABLED=false' \
          'CLIENT_NOTIFICATIONS_WORKER_DISABLED=0' \
          'CLIENT_NOTIFICATIONS_WORKER_ENABLED=1' \
          'MESSENGER_MEDIA_IN_PROCESS_WORKER=true'
      else
        printf '%s\n' \
          'WORKERS_ENABLED=false' \
          'CRON_ENABLED=false' \
          'QUEUE_CONSUMER_ENABLED=false' \
          'CLIENT_NOTIFICATIONS_WORKER_DISABLED=1' \
          'CLIENT_NOTIFICATIONS_WORKER_ENABLED=0' \
          'MESSENGER_MEDIA_IN_PROCESS_WORKER=false'
      fi
      ;;
    *State.Running*) echo true ;;
    *State.Health.Status*) echo healthy ;;
    *RestartCount*) echo 0 ;;
    *'.Name'*)
      if [[ "$container" == "$(printf '2%.0s' {1..64})" ]]; then echo /tgm-worker_notifications-blue-1
      elif [[ "$container" == "$(printf '4%.0s' {1..64})" ]]; then echo /tgm-worker_notifications-green-1
      elif [[ "$container" == "$(printf '3%.0s' {1..64})" ]]; then echo /tgm-app-green-1
      else echo /tgm-app-blue-1
      fi
      ;;
    *) echo "mock docker inspect format not handled: $format" >&2; exit 1 ;;
  esac
  exit 0
fi
if [[ "$1" == compose ]]; then
  args=" $* "
  if [[ "$args" == *" config --quiet "* ]]; then exit 0; fi
  if [[ "$args" == *" ps -q worker_notifications_blue "* ]]; then printf '2%.0s' {1..64}; echo; exit 0; fi
  if [[ "$args" == *" ps -q worker_notifications_green "* ]]; then printf '4%.0s' {1..64}; echo; exit 0; fi
  if [[ "$args" == *" ps -q app_green "* ]]; then printf '3%.0s' {1..64}; echo; exit 0; fi
  if [[ "$args" == *" ps -q app_blue "* ]]; then printf '1%.0s' {1..64}; echo; exit 0; fi
  if [[ "$args" == *" exec -T app_"*" node --version "* ]]; then echo "v20.19.0"; exit 0; fi
  if [[ "$args" == *" exec -T postgres "* ]]; then echo '["20260802125000_branch_query_planner_statistics"]'; exit 0; fi
  if [[ "$args" == *" logs --no-color "* ]]; then exit 0; fi
  exit 0
fi
echo "mock docker command not handled: $*" >&2
exit 1
EOF

cat >"$MOCK_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -eu
url="${!#}"
if [[ "${MOCK_PUBLIC_FAIL:-0}" == 1 && "$url" == https://*"/api/public/stats" ]]; then exit 22; fi
if [[ "$url" == *"/api/system/version" ]]; then
  printf '{"release":"%s","commitSha":"%s","imageDigest":"%s"}\n' "$MOCK_RELEASE" "$MOCK_COMMIT" "$MOCK_DIGEST"
fi
exit 0
EOF

cat >"$MOCK_BIN/caddy" <<'EOF'
#!/usr/bin/env sh
test "$1" = validate
exit 0
EOF

cat >"$MOCK_BIN/systemctl" <<'EOF'
#!/usr/bin/env sh
if [ "$1" = is-active ]; then exit 0; fi
if [ "$1" = reload ]; then exit 0; fi
exit 1
EOF

cat >"$MOCK_BIN/sudo" <<'EOF'
#!/usr/bin/env sh
exec "$@"
EOF

cat >"$MOCK_BIN/flock" <<'EOF'
#!/usr/bin/env sh
exit 0
EOF
chmod 755 "$MOCK_BIN"/*

MOCK_REPOSITORY=cr.selcloud.ru/test/eco-platform
cat >"$STATE_DIR/config.env" <<EOF
APP_IMAGE_REPOSITORY=$MOCK_REPOSITORY
MIGRATION_IMAGE_REPOSITORY=cr.selcloud.ru/test/eco-platform-migrations
PUBLIC_ORIGIN=https://production.example.test
MIN_FREE_KB=1
HEALTH_RETRIES=1
HEALTH_INTERVAL_SECONDS=0
POST_SWITCH_SAMPLES=2
POST_SWITCH_MAX_FAILURES=0
POST_SWITCH_OBSERVATION_SECONDS=0
POST_SWITCH_INTERVAL_SECONDS=1
EOF

cat >"$STATE_DIR/active-release.env" <<'EOF'
ACTIVE_SLOT=legacy
ACTIVE_UPSTREAM=127.0.0.1:3000
ACTIVE_RELEASE=markdown-hotfix-20260802
ACTIVE_COMMIT_SHA=unknown
ACTIVE_IMAGE_DIGEST=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
ACTIVE_IMAGE=tgm-app:markdown-hotfix-20260802
ACTIVE_BUILT_AT=2026-08-02T17:17:05Z
ACTIVE_EXPECTED_MIGRATION=unknown
ACTIVE_CONTAINER=tgm-app-markdown-hotfix-20260802
ACTIVE_CONTAINER_ID=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
ACTIVE_WORKER_SERVICE=unknown
ACTIVE_WORKER_CONTAINER=unknown
ACTIVE_WORKER_CONTAINER_ID=unknown
EOF

cat >"$STATE_DIR/slots.env" <<'EOF'
APP_BLUE_IMAGE=unknown
APP_BLUE_RELEASE=unknown
APP_BLUE_COMMIT_SHA=unknown
APP_BLUE_IMAGE_DIGEST=unknown
APP_BLUE_BUILT_AT=unknown
APP_BLUE_EXPECTED_MIGRATION=unknown
APP_GREEN_IMAGE=unknown
APP_GREEN_RELEASE=unknown
APP_GREEN_COMMIT_SHA=unknown
APP_GREEN_IMAGE_DIGEST=unknown
APP_GREEN_BUILT_AT=unknown
APP_GREEN_EXPECTED_MIGRATION=unknown
EOF
printf 'reverse_proxy 127.0.0.1:3000\n' >"$STATE_DIR/caddy-upstream.caddy"
: >"$STATE_DIR/production-deploy.lock"
: >"$TEST_ROOT/Caddyfile"

export PATH="$MOCK_BIN:$PATH"
export DEPLOY_STATE_DIR="$STATE_DIR"
export DEPLOY_CONFIG_FILE="$STATE_DIR/config.env"
export PRODUCTION_ENV_FILE="$ROOT/deploy/selectel/.env.production.template"
export CADDY_UPSTREAM_FILE="$STATE_DIR/caddy-upstream.caddy"
export CADDY_CONFIG_FILE="$TEST_ROOT/Caddyfile"
export MOCK_REPOSITORY

export MOCK_DIGEST="sha256:$(printf 'a%.0s' {1..64})"
export MOCK_RELEASE=production-2026-08-03.3
export MOCK_COMMIT="$(printf 'b%.0s' {1..40})"
"$ROOT/deploy/selectel/deploy-image.sh" "$MOCK_DIGEST" "$MOCK_RELEASE" "$MOCK_COMMIT"

grep -Fxq 'ACTIVE_SLOT=blue' "$STATE_DIR/active-release.env"
grep -Fxq "ACTIVE_IMAGE_DIGEST=$MOCK_DIGEST" "$STATE_DIR/active-release.env"
grep -Fxq 'ACTIVE_WORKER_SERVICE=worker_notifications_blue' "$STATE_DIR/active-release.env"
grep -Fxq 'reverse_proxy 127.0.0.1:3001' "$STATE_DIR/caddy-upstream.caddy"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$STATE_DIR/releases/$MOCK_RELEASE.json"
"$ROOT/deploy/selectel/deploy-image.sh" --dry-run

FIRST_ACTIVE="$(<"$STATE_DIR/active-release.env")"
FIRST_UPSTREAM="$(<"$STATE_DIR/caddy-upstream.caddy")"
export MOCK_DIGEST="sha256:$(printf 'd%.0s' {1..64})"
export MOCK_RELEASE=production-2026-08-03.4
export MOCK_COMMIT="$(printf 'e%.0s' {1..40})"
export MOCK_PUBLIC_FAIL=1
if "$ROOT/deploy/selectel/deploy-image.sh" "$MOCK_DIGEST" "$MOCK_RELEASE" "$MOCK_COMMIT"; then
  echo "failed post-switch smoke unexpectedly succeeded" >&2
  exit 1
fi
[[ "$(<"$STATE_DIR/active-release.env")" == "$FIRST_ACTIVE" ]]
[[ "$(<"$STATE_DIR/caddy-upstream.caddy")" == "$FIRST_UPSTREAM" ]]
unset MOCK_PUBLIC_FAIL

export MOCK_DIGEST="sha256:$(printf 'a%.0s' {1..64})"
export MOCK_RELEASE=production-2026-08-03.3
export MOCK_COMMIT="$(printf 'b%.0s' {1..40})"
"$ROOT/deploy/selectel/rollback-image.sh"
grep -Fxq 'ACTIVE_SLOT=legacy' "$STATE_DIR/active-release.env"
grep -Fxq 'reverse_proxy 127.0.0.1:3000' "$STATE_DIR/caddy-upstream.caddy"

echo "Selectel deploy, worker, dry-run, and rollback flow tests — passed"
