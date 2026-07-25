# Railway → Selectel production migration audit

Audit date: 2026-07-25 (UTC)  
Status: **NOT VERIFIED — do not decommission Railway**

This is the phase-A report. No Railway service, database, volume, domain,
variable, deployment, secret, or DNS record was changed during the audit.

## Decision

Railway is still a live, second production contour. It must not be deleted or
treated as a fallback. The migration cannot be accepted because the Railway web
service and its database are online, Railway continues to deploy from GitHub,
and the two databases have diverged while both contours were live.

## Actual Selectel architecture

| Component | Observed implementation | Evidence |
| --- | --- | --- |
| Provider | Selectel VPS | server `tgm`, SSH audit |
| Application | Next.js in Docker Compose | container `tgm-app-1` |
| Database | PostgreSQL 18 in same Compose project | container `tgm-postgres-1`, healthy |
| Reverse proxy / TLS | Caddy on the host | service active; ports 80/443 listening |
| Public endpoint | `www.tamgdemaslocrm.ru` | Caddy host rule → `127.0.0.1:3000` |
| Egress proxy | optional userspace WireGuard sidecar | container `tgm-wireguard-proxy-1` |
| Deploy | GitHub Actions → SSH → `docker compose up -d --build` | `.github/workflows/deploy-selectel.yml` |
| Object storage | external S3-compatible messenger storage | storage variables present; contents not audited |
| Redis / queue | no Redis service or Redis dependency found | Compose, package manifest, service inventory |
| Host cron | no application crontab or application systemd timer found | server timer/crontab inspection |

The Selectel root request and proxied HTTPS request both reached the running
application and returned its expected authentication redirect (`307`).

## Railway inventory

| Service | State | Last relevant deployment | Finding |
| --- | --- | --- | --- |
| `vin-oil-mann` | **online** | 2026-07-25 20:11:14 UTC | Successful Git-triggered production deployment from `codex-local-work`, commit `4fad86d`; used `/railway.json` and ran `npm run db:deploy`. |
| `Postgres-BmbT` | **online** | 2026-05-19 20:53:55 UTC | Persistent `postgres-volume-YmT7` mounted at `/var/lib/postgresql/data`; approximately 0.2 GB used. |
| `Postgres` | offline | 2026-05-04 | Historic failed/removed database deployment; still has a volume record and must remain read-only until backed up and classified. |

There are no separately listed Railway worker or Redis services. The web service
itself has Railway platform variables that activate the in-process client
notifications worker, so it is a worker risk even without a separate service.

## Deployment and DNS findings

- The repository GitHub Actions workflow is Selectel-only, but Railway has an
  independent active Git integration. Its successful deployment on the audit
  date is direct evidence that push events still deploy to Railway.
- Railway declares `https://www.tamgdemaslocrm.ru` for the web service while
  Caddy on Selectel is also configured for that hostname. Public DNS A lookup
  for `www.tamgdemaslocrm.ru` resolves to the Selectel server (`161.104.45.31`).
  The apex and other audited subdomains had no public A record; their redirect,
  CNAME, AAAA, and provider-side DNS settings still require dashboard review.
- `vercel.json` contains a daily production cron definition. Whether Vercel is
  still connected is not verifiable from this checkout and must be checked
  before declaring Selectel the sole scheduler.
- GitHub Actions repository/environment secret values cannot be read through
  the available local tooling; only the Selectel workflow definition was
  verified. The owner must inspect repository and `production` environment
  secrets for `RAILWAY_*`, Railway tokens, project/service/environment IDs, and
  Railway webhooks before phase B.

## Environment comparison (values redacted)

The Selectel `DATABASE_URL` does not contain a Railway literal and the local
PostgreSQL Compose service is the intended database provider. However,
`.env.production` on Selectel still contains and passes the following legacy
Railway platform variables into `tgm-app-1`:

`RAILWAY_ENVIRONMENT`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_ENVIRONMENT_NAME`,
`RAILWAY_PRIVATE_DOMAIN`, `RAILWAY_PROJECT_ID`, `RAILWAY_PROJECT_NAME`,
`RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_SERVICE_ID`, `RAILWAY_SERVICE_NAME`,
`RAILWAY_SERVICE_VIN_OIL_MANN_URL`, and `RAILWAY_STATIC_URL`.

The same environment lacks explicit client-notification worker enable/disable
flags. The current code enables that worker when Railway platform variables are
present, which explains why the Railway web deployment can process jobs. The
local developer `.env.local` also still points at the old Railway-named
database; it must not be used for production operations.

No secret values, connection strings, or access keys were printed in this
audit.

## PostgreSQL comparison

- Railway: PostgreSQL 18.3, database `railway`, timezone `Etc/UTC`.
- Selectel: PostgreSQL 18 Compose service, database `vin_oil`.
- Both databases expose the same set of public tables and have **56** rows in
  `_prisma_migrations`, so the tracked Prisma migration history is aligned.
- Exact `COUNT(*)` was collected for every public table on both databases.
  Table inventories match, but row counts do not. This is expected only after a
  documented cutover with a reconciliation policy; no such cutover timestamp
  was available during the audit.

Selected exact differences at audit time:

| Table | Railway | Selectel | Delta / interpretation |
| --- | ---: | ---: | --- |
| `local_demands` | 6110 | 6119 | Selectel +9 |
| `local_demand_positions` | 18389 | 18415 | Selectel +26 |
| `shipment_revisions` | 1321 | 1401 | Selectel +80 |
| `inventory_ledger_entries` | 318 | 339 | Selectel +21 |
| `ai_assistant_threads` | 5 | 13 | Selectel +8 |
| `ai_assistant_tool_calls` | 259 | 335 | Selectel +76 |
| `messenger_messages` | 5336 | 5371 | Selectel +35 |
| `messenger_outbox` | 277 | 291 | Selectel +14 |
| `messenger_media_jobs` | 70044 | 69972 | Railway +72 |
| `client_case_events` | 318 | 316 | Railway +2 |
| `communication_identities` | 67 | 66 | Railway +1 |
| `messenger_connections` | 69 | 68 | Railway +1 |

There is therefore no evidence that a Railway database stopped receiving writes
after a cutover. Sequence heads, row-level checksums, timestamps by table,
foreign-key validation, extensions, permissions, and backup/restore validation
remain pending.

## Files, queues, workers, and callbacks

- The Railway web deployment has no application volume. Its PostgreSQL services
  do have database volumes. Messenger media uses external object storage in
  both environments; bucket object count, bytes, hashes, lifecycle, and restore
  were not verifiable without a safe storage inventory.
- No Redis or BullMQ deployment was found. Messenger and notification work is
  database-backed/in-process in the observed configuration.
- No Selectel application scheduler was found in host crontab or systemd. The
  current Vercel cron file and Railway in-process worker make scheduler
  ownership unverified.
- External webhook/callback dashboards (Telegram, OAuth, Yclients, TRONK,
  ROSSKO, payment, monitoring, DNS/CDN) were not available through the audit
  credentials. They remain required checks.

## Repository findings

Active Railway-specific configuration and behaviour remains in the checkout:

| Path | Classification | Required phase-B action |
| --- | --- | --- |
| `railway.json` | active deploy configuration | remove after backup and controlled shutdown |
| `.railwayignore` | active Railway deploy support | remove |
| `railpack.json` | Railway Railpack configuration | remove |
| `deploy/railway-wireproxy/` | Railway-only service definition | remove after Selectel proxy is confirmed |
| `src/lib/client-notifications/worker.ts` | Railway runtime dependency | replace with explicit Selectel worker configuration |
| `.env.example`, `.env.local.template` | stale Railway examples/comments | replace with provider-neutral or Selectel examples |
| `README.md`, `ONBOARDING.md`, `docs/messenger-production-e2e.md` | stale operations documentation | replace with one Selectel-only runbook |
| `moysklad-rollback-plan.md` | historical backup command | update to remove Railway configuration copy |
| `src/app/shipment/new/NewShipmentPageClient.tsx` | stale user-facing text | replace "Railway logs" with neutral wording |

`nixpacks.toml` is not currently referenced by the observed Selectel Compose
stack. Its need must be confirmed before deletion, but it must not be treated as
part of a Selectel deploy.

## Required reconciliation before phase B

1. Stop new Railway Git deployments and stop Railway in-process work **only
   after** taking a final Railway database and volume backup. Do not delete the
   project, database, volume, domains, or variables yet.
2. Choose and document a cutover timestamp plus an authority for records that
   differ between databases. Reconcile the Railway-only rows (especially media
   jobs and message-related state) and preserve Selectel-only rows.
3. Run a repeatable, point-in-time comparison: schema, indexes, constraints,
   extensions, sequences, per-table min/max timestamps, row checksums, and
   foreign keys. Confirm that Railway has no writes after the cutover.
4. Inventory and validate external object storage; then verify Telegram,
   Yclients, OAuth, payment, monitoring, GitHub, Vercel, and DNS dashboard
   callbacks contain no Railway domain or IP.
5. Remove every `RAILWAY_*` entry from Selectel `.env.production` and replace
   Railway-derived worker activation with explicit Selectel worker settings.
   Validate in a controlled Selectel restart before adding a fail-fast guard.
6. Add the runtime Railway URL guard, production migration guard,
   `npm run check:no-railway`, and CI/deploy enforcement. Only then remove the
   listed repository files and obsolete docs.
7. Hold a monitoring window after disabling Railway web/workers. Create and
   validate final backups outside Railway, rotate eligible secrets, and obtain
   explicit owner approval before deleting Railway services/project.

## Phase-B gate

Do not proceed to Railway removal until every required reconciliation item above
is verified. The current gate is **BLOCKED** by active Railway deployments,
dual-write evidence, unremoved Railway environment variables on Selectel, and
unverified external integrations/backups.
