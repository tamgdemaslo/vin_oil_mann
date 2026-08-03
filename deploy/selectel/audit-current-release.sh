#!/usr/bin/env bash
set -Eeuo pipefail

# Read-only inventory for the legacy production container. It intentionally
# does not tag, restart, copy, or modify any container/file.
APP_CONTAINER="${APP_CONTAINER:-tgm-app-1}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-tgm-postgres-1}"
PROJECT_ROOT="${PROJECT_ROOT:-/opt/vin-oil-mann}"

docker inspect "$APP_CONTAINER" >/dev/null 2>&1 || {
  echo "application container not found: $APP_CONTAINER" >&2
  exit 1
}

IMAGE_ID="$(docker inspect --format '{{.Image}}' "$APP_CONTAINER")"
IMAGE_REFERENCE="$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER")"
IMAGE_DIGESTS="$(docker image inspect --format '{{ join .RepoDigests "," }}' "$IMAGE_ID")"
STARTED_AT="$(docker inspect --format '{{.State.StartedAt}}' "$APP_CONTAINER")"
CREATED_AT="$(docker inspect --format '{{.Created}}' "$APP_CONTAINER")"
BUILD_ID="$(docker exec "$APP_CONTAINER" sh -c 'test -f /app/.next/BUILD_ID && cat /app/.next/BUILD_ID || true')"
COMMIT_LABEL="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE_ID")"
RELEASE_LABEL="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$IMAGE_ID")"

printf 'container=%s\n' "$APP_CONTAINER"
printf 'imageReference=%s\n' "$IMAGE_REFERENCE"
printf 'imageId=%s\n' "$IMAGE_ID"
printf 'repoDigests=%s\n' "${IMAGE_DIGESTS:-none}"
printf 'containerCreatedAt=%s\n' "$CREATED_AT"
printf 'containerStartedAt=%s\n' "$STARTED_AT"
printf 'nextBuildId=%s\n' "${BUILD_ID:-unknown}"
printf 'commitLabel=%s\n' "${COMMIT_LABEL:-unknown}"
printf 'releaseLabel=%s\n' "${RELEASE_LABEL:-unknown}"

if VERSION="$(curl --fail --silent --show-error --max-time 5 http://127.0.0.1:3000/api/system/version 2>/dev/null)"; then
  printf 'versionEndpoint=%s\n' "$VERSION"
else
  printf 'versionEndpoint=unavailable\n'
fi

if docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
  MIGRATIONS="$(docker exec "$POSTGRES_CONTAINER" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc '\''SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at'\''')"
  printf 'appliedMigrationCount=%s\n' "$(printf '%s\n' "$MIGRATIONS" | sed '/^$/d' | wc -l | tr -d ' ')"
  printf '%s\n' 'appliedMigrations<<EOF'
  printf '%s\n' "$MIGRATIONS"
  printf '%s\n' 'EOF'
fi

if [[ -d "$PROJECT_ROOT/src" ]]; then
  SOURCE_FINGERPRINT="$(
    cd "$PROJECT_ROOT"
    {
      find src prisma -type f ! -name '.DS_Store' ! -name '._*' -print0
      printf '%s\0' package.json package-lock.json next.config.ts
    } | sort -z | xargs -0 sha256sum | sha256sum | awk '{print $1}'
  )"
  printf 'serverSourceFingerprint=%s\n' "$SOURCE_FINGERPRINT"
else
  printf 'serverSourceFingerprint=unavailable\n'
fi
