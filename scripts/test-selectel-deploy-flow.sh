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
  format="$4"
  case "$format" in
    *RepoDigests*) echo "$MOCK_REPOSITORY@$MOCK_DIGEST" ;;
    *org.opencontainers.image.revision*) echo "$MOCK_COMMIT" ;;
    *org.opencontainers.image.version*) echo "$MOCK_RELEASE" ;;
    *org.opencontainers.image.created*) echo "2026-08-02T12:00:00Z" ;;
    *expected-migration*) echo "20260724090000_ai_assistant_quote_snapshots" ;;
    *package-lock-sha256*) printf '%064d\n' 1 ;;
    *prisma-schema-sha256*) printf '%064d\n' 2 ;;
    *migrations-included*) echo "20260723113000_internal_ai_assistant,20260724090000_ai_assistant_quote_snapshots" ;;
    *ru.tamgdemaslo.tests*) echo "passed" ;;
    *) echo "mock image inspect format not handled: $format" >&2; exit 1 ;;
  esac
  exit 0
fi
if [[ "$1" == pull ]]; then exit 0; fi
if [[ "$1" == compose ]]; then
  args=" $* "
  if [[ "$args" == *" exec -T app_"*" node --version "* ]]; then echo "v20.19.0"; exit 0; fi
  if [[ "$args" == *" exec -T postgres "* ]]; then echo '["20260724090000_ai_assistant_quote_snapshots"]'; exit 0; fi
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
  printf '{"release":"%s","imageDigest":"%s"}\n' "$MOCK_RELEASE" "$MOCK_DIGEST"
fi
exit 0
EOF

cat >"$MOCK_BIN/systemctl" <<'EOF'
#!/usr/bin/env sh
exit 0
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
EOF

export PATH="$MOCK_BIN:$PATH"
export DEPLOY_STATE_DIR="$STATE_DIR"
export DEPLOY_CONFIG_FILE="$STATE_DIR/config.env"
export PRODUCTION_ENV_FILE="$ROOT/deploy/selectel/.env.production.template"
export CADDY_UPSTREAM_FILE="$STATE_DIR/caddy-upstream.caddy"
export MOCK_REPOSITORY

export MOCK_DIGEST="sha256:$(printf 'a%.0s' {1..64})"
export MOCK_RELEASE=production-2026-08-02.1
export MOCK_COMMIT="$(printf 'b%.0s' {1..40})"
"$ROOT/deploy/selectel/deploy-image.sh" "$MOCK_DIGEST" "$MOCK_RELEASE" "$MOCK_COMMIT"

grep -Fxq 'ACTIVE_SLOT=blue' "$STATE_DIR/active-release.env"
grep -Fxq "ACTIVE_IMAGE_DIGEST=$MOCK_DIGEST" "$STATE_DIR/active-release.env"
grep -Fxq 'reverse_proxy 127.0.0.1:3001' "$STATE_DIR/caddy-upstream.caddy"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$STATE_DIR/releases/$MOCK_RELEASE.json"

FIRST_ACTIVE="$(<"$STATE_DIR/active-release.env")"
FIRST_UPSTREAM="$(<"$STATE_DIR/caddy-upstream.caddy")"
export MOCK_DIGEST="sha256:$(printf 'c%.0s' {1..64})"
export MOCK_RELEASE=production-2026-08-02.2
export MOCK_COMMIT="$(printf 'd%.0s' {1..40})"
export MOCK_PUBLIC_FAIL=1
if "$ROOT/deploy/selectel/deploy-image.sh" "$MOCK_DIGEST" "$MOCK_RELEASE" "$MOCK_COMMIT"; then
  echo "failed post-switch smoke unexpectedly succeeded" >&2
  exit 1
fi
[[ "$(<"$STATE_DIR/active-release.env")" == "$FIRST_ACTIVE" ]]
[[ "$(<"$STATE_DIR/caddy-upstream.caddy")" == "$FIRST_UPSTREAM" ]]
unset MOCK_PUBLIC_FAIL

"$ROOT/deploy/selectel/rollback-image.sh"
grep -Fxq 'ACTIVE_SLOT=legacy' "$STATE_DIR/active-release.env"
grep -Fxq 'reverse_proxy 127.0.0.1:3000' "$STATE_DIR/caddy-upstream.caddy"

echo "Selectel deploy flow tests — passed"
