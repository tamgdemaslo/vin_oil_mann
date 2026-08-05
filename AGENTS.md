# Production infrastructure policy

Production runs on Timeweb Cloud App Platform.

- App Platform deploys the `main` branch from GitHub. GitHub Actions run source
  verification only; they must not publish images or connect to production over
  SSH.
- Use the root `Dockerfile` with its final `app` stage. Do not use the legacy
  Selectel Compose files for new production work.
- Production secrets belong in Timeweb App Platform variables, never in the
  repository or GitHub Actions logs.
- Database schema changes require a separately approved migration and a
  verified Timeweb backup. Application startup must not apply migrations.
- Railway is decommissioned and may not be accessed by application,
  deployment, migration, worker or fallback code. Its verified offline archive
  is evidence only; it is not a runtime or rollback target.

Legacy Selectel deployment files and audit evidence are retained for history;
they are not an active production target.
