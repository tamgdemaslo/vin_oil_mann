# Selectel production release audit — 2026-08-02

Status: **NO-GO FOR A NEW RELEASE — legacy identity is not yet verified**

This audit was read-only. No production container, image, database, Caddy
configuration, DNS, secret, Railway resource, or Git reference was changed.

## Verified on 2026-08-02

At `2026-08-02T13:49:42Z`, direct public HTTPS checks returned:

| Check | Result |
| --- | --- |
| `GET /login` | `200` |
| `GET /api/public/stats` | `200 application/json`; `replacementsCount=5412`, source `moysklad_demand_sync` |
| `GET /api/system/version` | `404` |
| `GET /api/health/live` | `404` |

The two `404` responses are expected from the legacy image and confirm that the
new release identity/health endpoints have not been deployed accidentally.

The repository checkout is on `codex-local-work` at committed HEAD
`5bd3ce4b2ef770b2f219b0c3637af3f36ba9d154`, but the working tree contains
uncommitted product/reconciliation/tool-loop work plus the deployment redesign.
There are currently no `production-*` Git tags. This checkout is therefore not
an authorized production release source.

## Not re-verified because SSH was unavailable

The existing audit from 2026-07-25 identifies `tgm-app-1` and
`tgm-postgres-1`, but the following current values could not be collected on
2026-08-02:

- application image ID and repo digest;
- current container creation/start timestamp;
- exact matching Git commit;
- current complete `_prisma_migrations` list;
- server source fingerprint and production-only source diffs.

Read-only SSH reached the server once but the initial Docker formatting command
was rejected without changing state. Subsequent connections timed out during
SSH banner exchange. No metadata has been guessed and no production tag has
been created.

## Required follow-up before first immutable deployment

When SSH is stable, run on the Selectel host:

```bash
cd /opt/vin-oil-mann
deploy/selectel/audit-current-release.sh
```

Then compare `serverSourceFingerprint` against clean checkouts near the last
successful Selectel GitHub Actions run. Preserve and commit every useful
production-only hotfix separately. Only after an exact commit is proven may the
owner create the baseline production tag and bootstrap blue/green state.

The unfinished branch migrations remain NO-GO and must not be applied as part
of this follow-up.
