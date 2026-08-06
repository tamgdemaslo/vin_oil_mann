# Production infrastructure policy

The only production provider is Timeweb Cloud App Platform.

- App Platform deploys the `main` branch from GitHub. GitHub Actions run source
  verification only; they must not publish images or connect to production over
  SSH.
- Use the root `Dockerfile` with its final `app` stage. Never use Selectel for
  deployment, runtime secrets, database access, OpenAI API access, or fallback.
- Production secrets belong in Timeweb App Platform variables, never in the
  repository or GitHub Actions logs.
- Database schema changes require a separately approved migration and a
  verified Timeweb backup. Application startup must not apply migrations.
- Railway is decommissioned and may not be accessed by application,
  deployment, migration, worker or fallback code. Its verified offline archive
  is evidence only; it is not a runtime or rollback target.

Before any production action, read `deploy/timeweb/README.md` and run
`npm run check:timeweb-only`.

Selectel is decommissioned. Only the short notice in
`docs/SELECTEL_DECOMMISSIONED.md` and isolated historical evidence under
`docs/legacy/selectel/` may mention it; neither is an operational runbook.
