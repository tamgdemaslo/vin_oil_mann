# Railway archive and decommission closure — 2026-08-02

## Final status

**`RAILWAY_DECOMMISSIONED_ARCHIVED`**.

Selectel PostgreSQL `vin_oil` is the only canonical production database. Every
Railway-only record and every shared-row difference is
`ARCHIVE_ONLY_DO_NOT_IMPORT`. No Railway data was imported into Selectel.

## Frozen offline archive

The private archive is outside Git at:

`/Volumes/KINGSTON/ТГМ/Эко-платформа/railway-final-frozen-backup-2026-08-02-codex-019fb41a`

- source: actual stopped 137-table application database;
- read mode: repeatable-read, read-only, 0 active external backends;
- final/post-backup snapshots: 137/137 tables unchanged, 0 new rows;
- aggregate data hash:
  `e6a70fcfd2210fef08bca1c315d51657a4e070cb9f54f732b0932bb0eb6ee5d9`;
- 271 canonical artifacts, 933,445,336 bytes;
- checksum-list SHA-256:
  `d021a8ae86c1e0fc09bdd82cc95b728f0d739aa88e474f561cc64c46fbc9dd77`;
- final verified manifest SHA-256:
  `b1a6e0e800f3484199b117e845a7359e6703e76d8d111c440af3a9cf755d3310`.

Two independent PostgreSQL 18.4 restores (segmented full and schema+data)
contain 137 tables, reproduce the frozen aggregate hash, have no invalid
indexes/unvalidated constraints and pass `pg_amcheck`.

The auxiliary `Postgres-BmbT` service was separately archived before deletion:
34 tables, two restore modes and two `pg_amcheck` passes. Its verified manifest
SHA-256 is
`18e348a80a44b33bca8659f5340e33a9f0c7a7859c7d1e8f2df96a8bf07fa070`.
Failed monolithic dump attempts remain diagnostic evidence and are not backup
inputs.

## Railway deletion

The exact project `vin-oil-mann`
(`46b4c35a-9a75-4514-9fff-8d2e705bcb0f`) was deleted after both archives were
VERIFIED. Provider state has `deletedAt`; Railway CLI returns `Project is
deleted`, and volumes are unavailable.

Deleted scope:

- production environment `02fb4fcf-b5b9-47c9-be96-ecfda3e88988`;
- app service `6efc8232-66f0-4f41-89a5-c69903e41ace`;
- PostgreSQL services `add79dab-ede1-4ce4-87f9-9330c6449d92` and
  `c14d847b-b87e-47c1-9d51-8c1935d69932`;
- volumes `c8447fec-76ea-4b20-be15-8fe10318fcd7` and
  `c524bf46-2d1a-41c7-98a5-e7b41372a077`.

The local Railway link was removed and CLI session logged out. Railway URLs in
local `.env` files were replaced with a loopback development URL.

## GitHub and Selectel cleanup

GitHub API inventory returned zero repository Actions secrets/variables, zero
Dependabot secrets and zero Codespaces secrets. The real Selectel `production`
environment and its five deploy secrets were preserved. The empty
`vin-oil-mann / production` environment was proved Railway-owned by its 89
`railway-app[bot]` deployments and deleted. Railway references remaining: 0.
An account-wide Railway App installation was not changed because other Railway
projects are outside this repository's scope.

On Selectel, 11 `RAILWAY_*` keys were removed from `/opt/tgm/.env.production`
and four stale Railway build/config files were deleted. Running containers were
not restarted. Public Selectel `/` returned the same content hash and HTTP 200
before and after decommission.

## Machine-readable evidence

Repository gate:
[`railway-decommission-archive-manifest-2026-08-02.json`](railway-decommission-archive-manifest-2026-08-02.json).

Private GitHub cleanup evidence SHA-256:
`13fdd40fa97812422941fc5747ce99a7ed733151e49af6d4e6bdb12add458c64`.

No production migration, branch cutover, Branch 2 creation, DNS change or
external side effect was performed.
