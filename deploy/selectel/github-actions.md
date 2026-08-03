# GitHub Actions configuration for Selectel

The application workflow verifies every pushed branch and pull request. A push
to `main` additionally builds and pushes immutable application and migration
images, compares the candidate's Prisma migration history with the active
Selectel release, and deploys only when the database gate is clear.

Production deployment always passes an application `sha256` digest to the
server-side blue/green script. Source is never uploaded to the server and the
server never builds an application image.

## Triggers and production conditions

| Event | Checks and Next.js build | Registry push | Production switch | Git tag |
| --- | --- | --- | --- | --- |
| Push to a feature branch | Yes | No | No | No |
| Pull request | Yes | No | No | No |
| Push to `main`, no new migrations | Yes | Yes | Automatic after the gate | After successful switch |
| Push to `main`, new migrations | Yes | Yes | Blocked as `migration_approval_required` | No |
| Manual `BUILD_ONLY` | Yes | Yes | No | No |
| Manual `DEPLOY_PRODUCTION` from `main` | Yes | Yes | Only after the gate | After successful switch |

`BUILD_ONLY` is a `workflow_dispatch` mode only. It is not a permanent switch
for normal pushes to `main`.

The deploy job is eligible only when all of these are true:

1. source ref is `main`;
2. the checkout is a clean committed state;
3. verification, tests, TypeScript, and the Next.js build succeeded;
4. both images were pushed and the application digest is valid;
5. the active production commit exists in Git history and is an ancestor of
   the candidate;
6. migration history was not changed or removed;
7. no new migration exists, or its separately approved migration workflow has
   written the matching commit marker;
8. the shared `production-deploy` concurrency lock is available.

## Repository secrets

These are used only by image publication jobs:

| Secret | Value |
| --- | --- |
| `SELECTEL_REGISTRY_USERNAME` | Username of a Selectel registry read/write token. |
| `SELECTEL_REGISTRY_PASSWORD` | Password of that token. |

## Repository variable

| Variable | Value |
| --- | --- |
| `SELECTEL_REGISTRY_NAME` | Registry name only, the segment after `cr.selcloud.ru/`. |
| `SELECTEL_AUTO_DEPLOY_ENABLED` | Set to `false` during bootstrap, then to `true` after BUILD_ONLY and server dry-run pass. |

## `production` environment

Automatic deployments require no manual reviewer on this environment. Limit
its deployment branch policy to `main`, and add:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `DEPLOY_HOST` | Selectel server hostname or IP. |
| Secret | `DEPLOY_USER` | Restricted Docker deploy user. |
| Secret | `DEPLOY_SSH_KEY` | Private half of a dedicated Actions key. |
| Secret | `DEPLOY_KNOWN_HOSTS` | Pinned host key reviewed out of band. |
| Variable | `DEPLOY_SCRIPT_PATH` | `/opt/tgm/deploy/selectel/deploy-image.sh`. |
| Variable | `DEPLOY_ACTIVE_RELEASE_PATH` | `/opt/tgm/.deploy/active-release.env`. |
| Variable | `PUBLIC_ORIGIN` | `https://www.tamgdemaslocrm.ru`. |

The workflow also enforces `refs/heads/main` in the deploy job, independently
of the GitHub environment branch policy.

The one-time activation variable prevents the commit which installs this
workflow from switching production. Changing it from `false` to `true` does not
emit a push event; every later push to `main` follows the automatic path.

## `production-migration` environment

This environment must retain a separate owner/reviewer and must be used only in
an agreed maintenance window. Add the same four SSH secrets and:

| Variable | Value |
| --- | --- |
| `MIGRATION_SCRIPT_PATH` | `/opt/tgm/deploy/selectel/migrate-image.sh`. |

## Migration approval flow

When the candidate adds one or more directories under `prisma/migrations`
relative to the active production commit, the normal `main` run still builds
and pushes both images but fails the blocker job named
`migration_approval_required`. Caddy, containers, and the production database
remain unchanged.

The owner then:

1. reviews the release manifest and exact migration image digest;
2. schedules a maintenance window and verifies the Selectel backup;
3. dispatches `migrate-selectel.yml` with the release tag, commit, immutable
   migration digest, backup reference, and explicit confirmation;
4. after the migration succeeds, dispatches this workflow from `main` with the
   same release tag and `DEPLOY_PRODUCTION`.

The manual deployment is allowed only when the server migration marker contains
the same release and candidate commit. Changed or removed existing migration
directories are never auto-approved and return `migration_history_violation`.

Migration is never an application startup step. The application runtime image
does not contain Prisma CLI, and `docker-compose.selectel.yml` has no migration
command on either app slot.

## Server prerequisite

Before enabling automatic `main` deployment, the server must have the reviewed
`docker-compose.selectel.yml`, Caddy include, `deploy-image.sh`, shared deploy
state, and `COMPOSE_PROJECT_NAME=tgm` under one canonical project root. The live
Caddy upstream must be managed through `.deploy/caddy-upstream.caddy`; the
deploy script performs health checks, the atomic switch, public smoke tests,
and automatic rollback.

The active production commit recorded in `.deploy/active-release.env` must be
reachable from `main`. If it is missing or not an ancestor, the workflow stops
as `production_history_alignment_required` instead of changing production.

## Release tags and retention

A successful automatic switch creates an annotated
`production-YYYY-MM-DD.<run_number>` tag on the exact deployed commit. A failed
or migration-blocked run creates no Git tag. Image tags are discovery metadata;
deployment and rollback continue to use immutable digests.

The deploy script keeps the previous release and does not prune images. Do not
delete the active image, rollback image, legacy container, or backups as part
of this workflow.
