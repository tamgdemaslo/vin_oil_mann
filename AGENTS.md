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
- Railway may only be accessed for the documented, read-only migration audit,
  backup, and controlled decommissioning procedure. It is not a production
  platform.

Current audit status (2026-07-25): the Railway-to-Selectel migration is **not
verified**. Do not delete or alter Railway data, services, DNS, or secrets until
the blockers in `docs/railway-selectel-audit-2026-07-25.md` are resolved.
