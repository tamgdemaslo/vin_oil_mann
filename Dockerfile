# syntax=docker/dockerfile:1.7

FROM node:20-bookworm AS wireproxy

ARG TARGETARCH=amd64
ARG WIREPROXY_VERSION=v1.1.3

# Download a pinned upstream release instead of installing WireGuard kernel
# tooling. wireproxy runs entirely in userspace, which is compatible with App
# Platform containers. Both supported artifacts are verified before extraction.
RUN set -eu; \
  case "$TARGETARCH" in \
    amd64) wireproxy_sha256="e88c1d090740373fc606c1bafd81d9a5eadc642cce5667616e20e9d7a444f51c" ;; \
    arm64) wireproxy_sha256="370e00bd2167960d1ecd1c3c1439715bbaa94a0a110a2040468670c9af6021b6" ;; \
    *) echo "Unsupported wireproxy architecture: $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  archive="/tmp/wireproxy_linux_${TARGETARCH}.tar.gz"; \
  curl --fail --location --silent --show-error \
    --retry 3 --retry-all-errors \
    --output "$archive" \
    "https://github.com/windtf/wireproxy/releases/download/${WIREPROXY_VERSION}/wireproxy_linux_${TARGETARCH}.tar.gz"; \
  echo "$wireproxy_sha256  $archive" | sha256sum --check --strict; \
  tar --extract --gzip --file "$archive" --directory /usr/local/bin wireproxy; \
  chmod 0555 /usr/local/bin/wireproxy; \
  /usr/local/bin/wireproxy --version

FROM node:20-bookworm AS dependencies

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  set -eu; \
  attempt=1; \
  while [ "$attempt" -le 3 ]; do \
    rm -rf node_modules; \
    if npm ci \
      --no-audit \
      --no-fund \
      --prefer-offline \
      --maxsockets=5 \
      --fetch-retries=3 \
      --fetch-retry-factor=2 \
      --fetch-retry-mintimeout=5000 \
      --fetch-retry-maxtimeout=30000 \
      --fetch-timeout=60000 \
      && test -x node_modules/.bin/prisma \
      && test -x node_modules/.bin/next; then \
      break; \
    fi; \
    if [ "$attempt" -eq 3 ]; then \
      echo "npm ci failed after $attempt attempts" >&2; \
      exit 1; \
    fi; \
    attempt=$((attempt + 1)); \
    echo "npm ci incomplete; retrying attempt $attempt" >&2; \
    sleep 5; \
  done

# Prisma generation is isolated from application source so it remains cached
# when only TypeScript/React files change.
COPY prisma ./prisma
RUN set -eu; \
  attempt=1; \
  while [ "$attempt" -le 3 ]; do \
    if ./node_modules/.bin/prisma generate; then \
      break; \
    fi; \
    if [ "$attempt" -eq 3 ]; then \
      echo "prisma generate failed after $attempt attempts" >&2; \
      exit 1; \
    fi; \
    attempt=$((attempt + 1)); \
    echo "prisma generate failed; retrying attempt $attempt" >&2; \
    sleep 5; \
  done

FROM dependencies AS build

ARG APP_RELEASE=development
ARG APP_COMMIT_SHA=unknown
ARG APP_BUILT_AT=unknown
ARG APP_EXPECTED_MIGRATION=unknown

ENV APP_RELEASE=$APP_RELEASE \
    APP_COMMIT_SHA=$APP_COMMIT_SHA \
    APP_BUILT_AT=$APP_BUILT_AT \
    APP_EXPECTED_MIGRATION=$APP_EXPECTED_MIGRATION

COPY . ./
RUN --mount=type=cache,target=/app/.next/cache,sharing=locked \
  set -eu; \
  if [ -n "$APP_COMMIT_SHA" ] && [ "$APP_COMMIT_SHA" != "unknown" ]; then \
    deployment_id="$APP_COMMIT_SHA"; \
  else \
    deployment_id="$(find . -path ./node_modules -prune -o -type f -print0 \
      | sort -z \
      | xargs -0 sha256sum \
      | sha256sum \
      | cut -d ' ' -f 1)"; \
  fi; \
  echo "Building Next.js deployment ${deployment_id}"; \
  NEXT_DEPLOYMENT_ID="$deployment_id" ./node_modules/.bin/next build --webpack

FROM node:20-bookworm AS app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_DATA_DIR=/app/.data

# PDF generation uses the @sparticuz/chromium binary traced into the standalone
# output. The full official Node/Debian image already provides TLS and curl, so
# runtime assembly does not depend on Debian package repositories.
RUN groupadd --gid 1001 app \
  && useradd --uid 1001 --gid app --create-home app \
  && mkdir -p /app/.data \
  && chown app:app /app/.data

WORKDIR /app

ARG APP_RELEASE=development
ARG APP_COMMIT_SHA=unknown
ARG APP_BUILT_AT=unknown
ARG APP_PACKAGE_LOCK_SHA256=unknown
ARG APP_PRISMA_SCHEMA_SHA256=unknown
ARG APP_MIGRATIONS_INCLUDED=unknown
ARG APP_EXPECTED_MIGRATION=unknown
ARG APP_TEST_RESULT=unknown

LABEL org.opencontainers.image.title="Eco Platform" \
      org.opencontainers.image.revision=$APP_COMMIT_SHA \
      org.opencontainers.image.version=$APP_RELEASE \
      org.opencontainers.image.created=$APP_BUILT_AT \
      ru.tamgdemaslo.package-lock-sha256=$APP_PACKAGE_LOCK_SHA256 \
      ru.tamgdemaslo.prisma-schema-sha256=$APP_PRISMA_SCHEMA_SHA256 \
      ru.tamgdemaslo.migrations-included=$APP_MIGRATIONS_INCLUDED \
      ru.tamgdemaslo.expected-migration=$APP_EXPECTED_MIGRATION \
      ru.tamgdemaslo.tests=$APP_TEST_RESULT

ENV APP_RELEASE=$APP_RELEASE \
    APP_COMMIT_SHA=$APP_COMMIT_SHA \
    APP_BUILT_AT=$APP_BUILT_AT \
    APP_EXPECTED_MIGRATION=$APP_EXPECTED_MIGRATION

COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/assets/price-label-fonts ./assets/price-label-fonts
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=wireproxy /usr/local/bin/wireproxy /usr/local/bin/wireproxy
COPY --from=build --chown=app:app /app/deploy/timeweb/start-app.sh /usr/local/bin/start-app
RUN chmod 755 /usr/local/bin/start-app

USER app
EXPOSE 3000

CMD ["/usr/local/bin/start-app"]
