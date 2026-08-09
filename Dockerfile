# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS dependencies

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

# Prisma generation is isolated from application source so it remains cached
# when only TypeScript/React files change.
COPY prisma ./prisma
RUN npx prisma generate

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
RUN npx next build --webpack

FROM node:20-bookworm-slim AS app

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

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CHROME_PATH=/usr/bin/chromium \
    APP_RELEASE=$APP_RELEASE \
    APP_COMMIT_SHA=$APP_COMMIT_SHA \
    APP_BUILT_AT=$APP_BUILT_AT \
    APP_EXPECTED_MIGRATION=$APP_EXPECTED_MIGRATION \
    APP_DATA_DIR=/app/.data

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates chromium fonts-dejavu-core openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1001 app \
  && useradd --uid 1001 --gid app --create-home app \
  && mkdir -p /app/.data \
  && chown app:app /app/.data

WORKDIR /app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/assets/price-label-fonts ./assets/price-label-fonts
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/deploy/timeweb/start-app.sh /usr/local/bin/start-app
RUN chmod 755 /usr/local/bin/start-app

USER app
EXPOSE 3000

CMD ["/usr/local/bin/start-app"]
