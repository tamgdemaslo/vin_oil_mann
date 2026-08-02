# Production infrastructure policy

Production deployment of the Eco Platform is allowed only on Selectel.

- Do not use the Railway CLI, Railway API, or Railway deploy commands for
  application work.
- Do not add `railway.toml`, `railway.json`, Railway GitHub Actions, Railway
  URLs, or Railway environment-variable fallbacks.
- All production deployments, migrations, workers, and environment variables
  must be scoped to the current Selectel deployment instructions in
  [`deploy/selectel/README.md`](deploy/selectel/README.md).
- Production migrations must be refused when the configured database URL points
  to Railway. Never use a Railway database as a fallback.
- Railway is decommissioned and may not be accessed by application,
  deployment, migration, worker or fallback code. Its verified offline archive
  is evidence only; it is not a runtime or rollback target.

Current archive status (2026-08-02): **`RAILWAY_DECOMMISSIONED_ARCHIVED`**.
Selectel `vin_oil` is canonical. All legacy-only/shared differences are
`ARCHIVE_ONLY_DO_NOT_IMPORT`; see
`docs/reconciliation/railway-decommission-archive-manifest-2026-08-02.json`.
