#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
STATE_DIR="${DEPLOY_STATE_DIR:-$PROJECT_ROOT/.deploy}"
CONFIG_FILE="${DEPLOY_CONFIG_FILE:-$STATE_DIR/config.env}"
ENV_FILE="${PRODUCTION_ENV_FILE:-$PROJECT_ROOT/.env.production}"
LOCK_FILE="$STATE_DIR/production-deploy.lock"

usage() {
  echo "Usage: migrate-image.sh sha256:<digest> production-YYYY-MM-DD.N <40-char-commit-sha> <backup-reference> APPLY_PRODUCTION_MIGRATIONS" >&2
  exit 64
}

[[ $# -eq 5 ]] || usage
IMAGE_DIGEST="$1"
RELEASE_TAG="$2"
COMMIT_SHA="$3"
BACKUP_REFERENCE="$4"
CONFIRMATION="$5"

[[ "$IMAGE_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "invalid image digest" >&2; exit 64; }
[[ "$RELEASE_TAG" =~ ^production-[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$ ]] || { echo "invalid release tag" >&2; exit 64; }
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "invalid commit SHA" >&2; exit 64; }
[[ "$BACKUP_REFERENCE" =~ ^[A-Za-z0-9._:/-]{8,200}$ ]] || { echo "invalid backup reference" >&2; exit 64; }
[[ "$CONFIRMATION" == APPLY_PRODUCTION_MIGRATIONS ]] || { echo "explicit migration confirmation is required" >&2; exit 64; }
[[ -f "$CONFIG_FILE" && -f "$ENV_FILE" ]] || { echo "Selectel deployment config is missing" >&2; exit 78; }

set -a
# shellcheck disable=SC1090
source "$CONFIG_FILE"
set +a

: "${MIGRATION_IMAGE_REPOSITORY:?MIGRATION_IMAGE_REPOSITORY is required in config.env}"
[[ "$MIGRATION_IMAGE_REPOSITORY" == cr.selcloud.ru/* ]] || { echo "only cr.selcloud.ru images are permitted" >&2; exit 78; }

mkdir -p "$STATE_DIR/migrations"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "another production deployment or migration holds the lock" >&2; exit 75; }

IMAGE_REFERENCE="$MIGRATION_IMAGE_REPOSITORY@$IMAGE_DIGEST"
docker pull "$IMAGE_REFERENCE"

IMAGE_COMMIT="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$IMAGE_REFERENCE")"
IMAGE_RELEASE="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.version" }}' "$IMAGE_REFERENCE")"
IMAGE_MIGRATIONS="$(docker image inspect --format '{{ index .Config.Labels "ru.tamgdemaslo.migrations-included" }}' "$IMAGE_REFERENCE")"
[[ "$IMAGE_COMMIT" == "$COMMIT_SHA" ]] || { echo "migration image commit mismatch" >&2; exit 65; }
[[ "$IMAGE_RELEASE" == "$RELEASE_TAG" ]] || { echo "migration image release mismatch" >&2; exit 65; }

if [[ "$IMAGE_MIGRATIONS" == *20260728120000_branch_architecture_foundation* && "${BRANCH_MIGRATION_GO:-NO_GO}" != VERIFIED ]]; then
  echo "branch migration is NO-GO; set BRANCH_MIGRATION_GO=VERIFIED only after the approved cutover checklist" >&2
  exit 66
fi

COMPOSE=(docker compose --env-file "$ENV_FILE" --env-file "$CONFIG_FILE" -f "$PROJECT_ROOT/docker-compose.selectel.yml")
BEFORE="$("${COMPOSE[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc '\''SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at'\''')"

export MIGRATION_IMAGE="$IMAGE_REFERENCE"
export PRODUCTION_MIGRATION_APPROVED=YES
export SELECTEL_DATABASE_HOSTS="${SELECTEL_DATABASE_HOSTS:-postgres}"
"${COMPOSE[@]}" --profile migration run --rm migration

AFTER="$("${COMPOSE[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc '\''SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at'\''')"
APPLIED="$(comm -13 <(printf '%s\n' "$BEFORE" | sort) <(printf '%s\n' "$AFTER" | sort) | paste -sd, -)"
RECORDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat >"$STATE_DIR/migrations/$RELEASE_TAG.env.tmp.$$" <<EOF
release=$RELEASE_TAG
commitSha=$COMMIT_SHA
imageDigest=$IMAGE_DIGEST
backupReference=$BACKUP_REFERENCE
recordedAt=$RECORDED_AT
migrationsApplied=${APPLIED:-none}
EOF
mv "$STATE_DIR/migrations/$RELEASE_TAG.env.tmp.$$" "$STATE_DIR/migrations/$RELEASE_TAG.env"

printf 'migration complete: release=%s applied=%s backup=%s\n' "$RELEASE_TAG" "${APPLIED:-none}" "$BACKUP_REFERENCE"
