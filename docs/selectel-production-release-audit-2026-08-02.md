# Selectel production release audit — 2026-08-02

Status: **LEGACY IDENTITY VERIFIED; IMMUTABLE RELEASE BOOTSTRAP PENDING**

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

The original read-only inventory could not prove the legacy release identity.
The follow-up audit at `2026-08-02T21:30Z` restored SSH access and identified
the active container as `tgm-app-markdown-hotfix-20260802`, using image
`tgm-app:markdown-hotfix-20260802` with image ID
`sha256:c3f9a7298b9fd67c95ceb1147086a17f12a94295a1a63db1f74c4296af3cc1c0`.
It was created and started at `2026-08-02T17:19:50Z` and still serves the
legacy upstream `127.0.0.1:3000` through Caddy.

The normalized source fingerprint for `/opt/tgm-hotfix-b0123b3` is
`3a4e0069d587d2558ed24ce06a7745609c7e31d10488ebfb327488fe2f38fbcb`.
An archive of Git commit
`b0123b32d5ff6cf631056d92f63c8c59838b60f4` produces the exact same
fingerprint. The legacy rollback source is therefore verified and must remain
available through the first immutable release monitoring window.

The database reports 50 successfully applied Prisma migrations; the latest is
`20260725110000_ai_assistant_labor_pricing_rules`. No migration was executed by
this audit.

## Immutable deployment bootstrap inventory

The one-time immutable deployment directory `/opt/vin-oil-mann` and a server
login for `cr.selcloud.ru` are not present yet. GitHub has the existing
`production` SSH secrets, but the repository has no Selectel registry secrets
or registry-name variable. The root filesystem has approximately 2.7 GiB free
(93% used), below the deploy script's 3 GiB safety threshold.

The canonical Compose project is `tgm`; the immutable scripts explicitly pass
`-p tgm` so candidate slots join the existing `tgm_default` network and reuse
the canonical PostgreSQL and application-data volumes. An isolated Compose
project must never be used as a substitute database migration.

## Required follow-up before first immutable deployment

1. Provision a Selectel Container Registry with separate CI read/write and
   server read-only tokens.
2. Configure the documented GitHub repository secrets/variables and the server
   registry login without exposing either token in release evidence.
3. Reclaim only audited, unused Docker build data until at least 3 GiB is free;
   retain the active legacy image and rollback material.
4. Install the reviewed immutable infrastructure files, validate/reload Caddy
   while it still points to `127.0.0.1:3000`, and run the release workflow from
   the committed `release/selectel-2026-08-02` ref.

The release uses `NO_DATABASE_MIGRATION`. The unfinished branch migration
remains NO-GO and is not part of the application deployment. The former hosting
platform is decommissioned; its verified offline archive is evidence only and
is not a runtime or rollback target.
