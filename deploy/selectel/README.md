# Immutable production deployment on Selectel

Production is deployed only from a committed Git SHA to Selectel Container
Registry and then by immutable `sha256` digest. The Selectel server never
receives the application source and never runs `npm`, `next build`, Prisma
generation, or `docker build` during an ordinary release.

The current production container must remain unchanged while this workflow is
being installed and rehearsed. The first real switch is a separate,
owner-approved release task.

## Release flow

```text
allowed Git ref + clean commit
  -> GitHub verify (npm ci, Prisma, tests, TypeScript, Next build, policy)
  -> BuildKit standalone image + registry cache
  -> Selectel Container Registry tags (git SHA + release tag)
  -> production environment approval
  -> Selectel pulls image@sha256
  -> inactive blue/green slot readiness + smoke
  -> atomic Caddy upstream switch
  -> public smoke and automatic rollback on failure
  -> production Git tag
```

`deploy-image.sh` retains the previous slot and never prunes images. A failed
candidate before the switch cannot affect traffic. A failed public smoke after
the switch restores the old Caddy upstream and stops the candidate.

## Files and ownership

- `Dockerfile`: cached build stages, minimal standalone runtime, separate
  migration image target.
- `docker-compose.selectel.yml`: PostgreSQL, `app_blue`, `app_green`, and an
  opt-in migration profile. Application startup never migrates the database.
- `deploy-image.sh`: only pull, start, ready/smoke, switch, record, rollback.
- `rollback-image.sh`: deterministic switch to the previous recorded digest.
- `migrate-image.sh`: separately approved migration-only operation with a
  verified backup reference and decommissioned legacy-database deny rule.
- `.github/workflows/deploy-selectel.yml`: build and application deployment.
- `.github/workflows/migrate-selectel.yml`: database migration only.

Runtime identity is public at `GET /api/system/version`. Liveness is
`GET /api/health/live`; readiness is `GET /api/health/ready`. Readiness checks
PostgreSQL, required runtime config, the image's expected Prisma migration, and
the writable application data volume. Optional providers such as ROSSKO are not
part of readiness.

## 1. Audit and freeze the existing release

Before installing Caddy blue/green config, record all of the following in a
release evidence document:

1. existing container name, image ID, repo digest (if any), start time, and
   `/api/system/version` response if available;
2. every successfully applied `_prisma_migrations` row;
3. the GitHub Actions run and commit that last uploaded production source;
4. hashes/diffs of server-side source against candidate Git commits;
5. every useful production-only hotfix, moved into its own Git commit.

If an exact commit cannot be proven, do not invent a tag. Preserve the running
container, make a read-only filesystem capture for comparison, and keep the
release status `UNVERIFIED` until the diff is resolved. Production must not be
switched while the container is the only source of truth.

The former hosting platform is a verified offline archive only. It is never a
deployment, migration, rehearsal, or rollback target.

The latest read-only inventory status is recorded in
[`docs/selectel-production-release-audit-2026-08-02.md`](../../docs/selectel-production-release-audit-2026-08-02.md).

## 2. One-time Container Registry setup

Create a Selectel registry and separate tokens:

- CI token: read/write for pushing images;
- server token: read-only for pulling images.

The registry endpoint is `cr.selcloud.ru/<registry>/<repository>`. On the
server, log in once using the read-only token. GitHub uses the write token.
Selectel's current registry quick start is:
<https://docs.selectel.ru/en/craas/quickstart/>.

Images are published as:

```text
cr.selcloud.ru/<registry>/eco-platform:git-<40-char-sha>
cr.selcloud.ru/<registry>/eco-platform:production-YYYY-MM-DD.N
cr.selcloud.ru/<registry>/eco-platform-migrations:<same tags>
```

Tags are discovery metadata only. Deployment always uses
`cr.selcloud.ru/.../eco-platform@sha256:...`.

## 3. One-time server bootstrap

Place only the reviewed infrastructure files under `/opt/vin-oil-mann`:

```text
docker-compose.selectel.yml
docker-compose.selectel.wireguard.yml
deploy/selectel/deploy-image.sh
deploy/selectel/rollback-image.sh
deploy/selectel/migrate-image.sh
deploy/selectel/Caddyfile
```

Keep `.env.production` where it is. Copy `config.env.template` to
`/opt/vin-oil-mann/.deploy/config.env`, fill only Selectel repositories and
public origin, and restrict it to the deploy user. The server's Docker login
must use the read-only Selectel token.

Keep `COMPOSE_PROJECT_NAME=tgm` in `config.env` so the immutable application
slots join the canonical production network and reuse the existing PostgreSQL
and application-data volumes. Changing this value would create an isolated
Compose project and is not a production migration mechanism.

Before the first switch, initialize
`/opt/vin-oil-mann/.deploy/caddy-upstream.caddy` with the existing legacy
upstream:

```caddyfile
reverse_proxy 127.0.0.1:3000
```

Install the reviewed `deploy/selectel/Caddyfile`, validate it, and reload Caddy
without restarting the current application. Confirm `/login` and the current
public endpoint still work. The deploy user needs narrowly scoped permission to
run only `systemctl reload caddy` through sudo.

Do not initialize `active-release.env` with guessed metadata. If it is absent,
the first deployment treats port 3000 as a legacy rollback target. Retire that
legacy container only after the first immutable release has passed its agreed
monitoring window.

## 4. GitHub configuration

Detailed secret and variable names are in [github-actions.md](github-actions.md).
Both environments must require an owner/reviewer:

- `production` for application traffic switches;
- `production-migration` for database mutations.

The release workflow is manual. Run it from `main`, `release/*`, or `hotfix/*`
with a new tag such as `production-2026-08-02.1`. It defaults to `BUILD_ONLY`,
which verifies and pushes immutable images without starting a server container
or switching traffic. The deploy and Git-tag jobs run only when the owner
deliberately selects `DEPLOY_PRODUCTION`. The workflow rejects other branches,
dirty source, reused Git tags, and any attempt to combine deployment with a
migration.

## 5. Normal hotfix

1. Read `.deploy/active-release.env` and identify the active production tag.
2. Create `hotfix/<name>` from that tag, not from unfinished branch work.
3. Commit and test the minimal patch.
4. Merge the reviewed patch to `main` and forward-port it to development.
5. Dispatch the Selectel release workflow with a new production tag.
6. Approve only after the manifest identifies the intended SHA and both image
   digests.

No Prisma migration workflow is run when the hotfix contains no new migration.
The unfinished branch architecture migration remains NO-GO.

## 6. Database migrations are separate

The application image cannot run Prisma CLI. A migration image is built in CI
but can only be executed by the manual migration workflow. It requires:

- exact migration image digest and commit SHA;
- a verified Selectel backup reference/checksum;
- `production-migration` approval;
- the literal confirmation `APPLY_PRODUCTION_MIGRATIONS`;
- a database hostname allowed by `SELECTEL_DATABASE_HOSTS`.

Any hostname containing decommissioned legacy-platform markers is refused. The branch foundation
migration is additionally refused until the existing branch cutover runbook is
verified and `BRANCH_MIGRATION_GO=VERIFIED` is deliberately placed in the
server config during the approved migration window.

## 7. Rollback and state

Automatic rollback is part of `deploy-image.sh`. Manual rollback is:

```bash
cd /opt/vin-oil-mann
deploy/selectel/rollback-image.sh
```

No rebuild is performed. State and evidence live under `.deploy/`:

```text
active-release.env
previous-release.env
slots.env
releases/production-*.json
migrations/production-*.env
production-deploy.lock
```

Every release JSON records release/tag, SHA, digest, build/deploy times, Node
version, lock/schema hashes, included/applied migrations, CI result, health,
slot, and previous digest. Keep these files in the production backup scope.

Do not run `docker system prune -a`. Retain at least the current image, previous
stable image, and several recent release digests in Selectel Registry. Registry
retention and alerting are an operator policy outside the deploy script.

## 8. Local/staging verification before first production switch

Run:

```bash
npm ci
npx prisma generate
npm run check:selectel-deploy
npm run test:selectel-deploy-flow
npm run test:ai-tool-loop-policy
npx tsc --noEmit
npm run build
bash -n deploy/selectel/deploy-image.sh deploy/selectel/rollback-image.sh deploy/selectel/migrate-image.sh
```

Then build both Docker targets on a non-production runner, start a disposable
PostgreSQL database with all currently approved migrations, exercise a failed
readiness deployment, a successful blue/green switch, and manual rollback.
Only after that rehearsal and a separate owner confirmation may the first
production digest be deployed.
