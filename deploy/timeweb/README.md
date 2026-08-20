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
- App Platform starts Docker builds in a clean environment. The Dockerfile uses
  BuildKit caches where the platform supports them and retries npm downloads so
  a short registry timeout does not abort an otherwise healthy deployment.

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

## OpenAI WireGuard route

If the App Platform region cannot reach OpenAI directly, set
`WIREPROXY_CONFIG` to a standard WireGuard client profile as a multiline secret.
The container validates the profile, appends an HTTP CONNECT listener bound only
to `127.0.0.1:8888`, and exports `OPENAI_PROXY_URL` to the application. Only
OpenAI clients use that URL; application and database traffic keep their normal
route.

Do not add proxy sections to the stored profile and do not set a public bind
address. Startup removes the profile from the Node process environment, checks
the configuration, and requires an HTTP 401 response from the unauthenticated
OpenAI models endpoint through the tunnel. A regional HTTP 403 or an unavailable
tunnel stops the container instead of silently falling back to a direct route.

## Database changes

App startup never applies Prisma migrations. Before a schema change reaches
`main`, create and verify a Timeweb database backup, apply the migration in an
approved maintenance operation, then verify `/api/health/ready` after the App
Platform release.

## Preflight

Before any production action, run `npm run check:timeweb-only`. The check must
pass before a release is promoted. The only GitHub workflow is source
verification; Timeweb performs the deployment after the approved `main` change.
