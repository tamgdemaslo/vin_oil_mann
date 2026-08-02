# GitHub Actions configuration for Selectel

The application release workflow builds in GitHub Actions, pushes to Selectel
Container Registry, and sends one short SSH command containing an immutable
digest. It never uploads source and never builds on the production server.

## Repository secrets

These are needed by the image job before production approval:

| Secret | Value |
| --- | --- |
| `SELECTEL_REGISTRY_USERNAME` | Username of a Selectel registry read/write token. |
| `SELECTEL_REGISTRY_PASSWORD` | Password of that token. |

## Repository variable

| Variable | Value |
| --- | --- |
| `SELECTEL_REGISTRY_NAME` | Registry name only, the segment after `cr.selcloud.ru/`. |

## `production` environment

Require an owner/reviewer. Add:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `DEPLOY_HOST` | Selectel server hostname or IP. |
| Secret | `DEPLOY_USER` | Restricted Docker deploy user. |
| Secret | `DEPLOY_SSH_KEY` | Private half of a dedicated Actions key. |
| Secret | `DEPLOY_KNOWN_HOSTS` | Pinned `ssh-keyscan -H` line reviewed out of band. |
| Variable | `DEPLOY_SCRIPT_PATH` | `/opt/vin-oil-mann/deploy/selectel/deploy-image.sh`. |
| Variable | `PUBLIC_ORIGIN` | `https://www.tamgdemaslocrm.ru`. |

## `production-migration` environment

Use a separate, stricter approval group. Add the same four SSH secrets and:

| Variable | Value |
| --- | --- |
| `MIGRATION_SCRIPT_PATH` | `/opt/vin-oil-mann/deploy/selectel/migrate-image.sh`. |

## Release behavior

Dispatch `Build and deploy immutable release to Selectel` from an allowed ref
with a new `production-YYYY-MM-DD.N` value. GitHub displays each stage and its
duration separately. BuildKit exports cache to the application repository's
`buildcache` tag. After a successful public health check, the workflow creates
the production Git tag on the deployed SHA.

Migration is never an implicit application step. Dispatch the migration
workflow only with the migration digest from the release manifest, a verified
backup reference, and explicit approval.
