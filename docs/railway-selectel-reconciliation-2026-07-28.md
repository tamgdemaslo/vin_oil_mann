# Railway → Selectel reconciliation — 2026-07-28

## Status

`RAILWAY_SELECTEL_RECONCILIATION_STATUS=NOT_VERIFIED`

No Railway or Selectel service, database row, deployment, variable, domain,
DNS record, webhook, or integration session was changed by this verification.

## Railway freeze check

Read-only Railway inventory on 2026-07-28 shows that the required freeze has
**not** happened:

- `vin-oil-mann`: one running replica; deployment is not stopped.
- Latest web deployment: `2026-07-26T19:45:07.312Z`, commit `b0123b3`, Git
  source `tamgdemaslo/vin_oil_mann`, branch `codex-local-work`.
- Railway deploy config still runs `npm run db:deploy` and `npm run start`.
- Railway custom domain `www.tamgdemaslocrm.ru` remains attached.
- `Postgres-BmbT`: one running replica; deployment is not stopped.
- Historical `Postgres`: no running deployment, but its volume remains.

Therefore compute, autodeploy, database-write freeze, and technical deployment
blocking criteria are not satisfied.

Fresh max-timestamp aggregation proves the legacy database continued to receive
writes on the audit date. Examples include messenger rows at approximately
`2026-07-28T12:00:09Z` and notification job/log rows at approximately
`2026-07-28T13:28:09Z`. Across tables with `created_at`/`updated_at`, 29 maxima
are on or after 2026-07-25. This is direct evidence that no freeze timestamp can
currently be asserted.

## Database source discrepancy

The Railway web-service `DATABASE_URL` points to the legacy proxy
`hopper.proxy.rlwy.net:19484/railway`. Credentials were not printed.

That actual application database reports:

- PostgreSQL 18.3;
- 137 public tables;
- 56 `_prisma_migrations` rows;
- database size approximately 1,351 MB.

The running `Postgres-BmbT` service exposes a different current public proxy and
contains only 34 public tables with no `_prisma_migrations` relation. The
historical `Postgres` service public endpoint is offline. This service/URL
discrepancy must be resolved before any freeze, data transfer, or decommission.

## Selectel observation

Read-only SSH verification at `2026-07-28T12:51:30Z` reached host `tgm`:

- `tgm-app-1`: running;
- `tgm-postgres-1`: healthy;
- `tgm-wireguard-proxy-1`: running;
- Caddy: active.

This proves availability, not database reconciliation or sole production
traffic ownership.

## Backup status

Fresh logical backups are written outside Git under:

`/Volumes/KINGSTON/ТГМ/Эко-платформа/external-verification-2026-07-28-codex-019fa778`

Railway audit snapshots completed:

- full custom dump: 976 MB; SHA-256
  `87c144052f452ba9f62dfcd17428526f0e1158590bcde1191f3b22fac8578c4c`;
- schema-only SQL: 282 KB; SHA-256
  `261470116caf4402d9ca5d71ba44277d5237ae9b6b716caf0a2a065663be666d`;
- data-only custom dump: 976 MB; SHA-256
  `f66824e51f2db698f2ad461a5a0ac1addb2e08e8678ed65975b6acd1ab428161`.

`pg_restore --list` passed for both custom archives. The full dump schema was
restored into the separate local database `railway_backup_readcheck`: 137 public
tables were created, and restoring only `_prisma_migrations` from the archive
produced the expected 56 rows. A full data restore was intentionally not run on
the local system volume because only 4 GB remained free.

Selectel read-only metadata reports PostgreSQL 18.4, database `vin_oil`, 1,241
MB, 137 public tables, and 56 migrations. Copying the full Selectel production
database was not authorized in this task and did not start; the Selectel backup
directory remains empty.

Fresh Selectel per-table counts/timestamps and any further Selectel database
access require separate explicit owner permission and were not attempted after
that gate was raised.

A dump taken while Railway is still writable is an audit snapshot, not the
final post-freeze backup.

## Required work before VERIFIED

1. Owner-authorized final Railway backup and write freeze.
2. Disable Railway Git autodeploy/web worker without deleting the project.
3. Identify the authoritative legacy proxy/service relationship.
4. Confirm two timestamp-separated Railway database snapshots are unchanged
   after freeze.
5. Complete row/business-key reconciliation with Selectel while preserving all
   Selectel-only data.
6. Classify durable, append-only, derived, ephemeral, delivery, and unknown
   tables; do not copy queues/leases/sessions mechanically.
7. Repeat the comparison and document every remaining conflict/exclusion.
8. Verify DNS, GitHub, Vercel, worker, webhook, and callback ownership.
9. Create a final signed/approved reconciliation report.

Until then, production-copy branch migration rehearsal is forbidden and the
platform remains **NO-GO**.
