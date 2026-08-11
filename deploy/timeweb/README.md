# Timeweb Cloud App Platform deployment

Production is deployed by Timeweb Cloud App Platform from the `main` branch of
this repository. GitHub Actions verify source only; they do not publish images
or connect to a production host.

## App Platform configuration

- Type: **Dockerfile**.
- Dockerfile: repository root `Dockerfile` (the final `app` stage runs the web
  application on port `3000`).
- Branch: `main`.
- Auto-deploy: enabled.
- Health endpoint: `/api/health/live`. The runtime image includes `curl` for
  Timeweb's container-side probe. Verify `/api/health/ready` separately after
  each release.

Set production values as App Platform variables. At minimum the application
requires `DEPLOYMENT_PROVIDER=timeweb`, `DATABASE_URL`, `APP_ORIGIN`, and
`MESSENGER_CREDENTIAL_ENCRYPTION_KEY`; use `.env.example` as the complete
variable inventory. The encryption key is required for branch-scoped AQSI,
Telegram, ROSSKO, and T-Bank credentials. `OPENAI_API_KEY` is a server-side
Timeweb runtime secret: never set `NEXT_PUBLIC_OPENAI_API_KEY`, a Docker build
argument, or a GitHub Actions variable. Secrets must stay in the Timeweb
control panel.

The platform filesystem is replaced on every deployment. Do not use
`/app/.data` as the durable source of business files: store them in PostgreSQL
or object storage instead.

## Database changes

App startup never applies Prisma migrations. Before a schema change reaches
`main`, create and verify a Timeweb database backup, apply the migration in an
approved maintenance operation, then verify `/api/health/ready` after the App
Platform release.

## Preflight

Before any production action, run `npm run check:timeweb-only`. The check must
pass before a release is promoted. The only GitHub workflow is source
verification; Timeweb performs the deployment after the approved `main` change.
