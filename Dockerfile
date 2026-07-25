FROM node:20-bookworm-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    CHROME_PATH=/usr/bin/chromium

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates chromium fonts-dejavu-core openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1001 app \
  && useradd --uid 1001 --gid app --create-home app

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm install --no-save --no-package-lock prisma@6.9.0

COPY --from=build /app/prisma ./prisma
RUN npx prisma generate

COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/next.config.ts ./next.config.ts

USER app
EXPOSE 3000

CMD ["npm", "run", "start"]
