# Final reconciliation readiness

## Final result — 2026-08-02

Status: **`RAILWAY_DECOMMISSIONED_ARCHIVED`**.

Railway-to-Selectel reconciliation is closed and is no longer a branch
migration blocker. Selectel `vin_oil` is authoritative. The 509 Railway-only
records, 284 same-PK differences and 26 owner decisions are all closed under
`ARCHIVE_ONLY_DO_NOT_IMPORT`; no target mutation is permitted.

The final frozen Railway archive and the auxiliary Railway PostgreSQL service
were restored independently and passed checksums, structural validation and
`pg_amcheck`. The Railway project, services, volumes and environment were then
deleted. Local CLI link/session, Selectel `RAILWAY_*` variables, obsolete
Railway configs and the Railway-owned GitHub environment were removed. GitHub
secret/variable inventory is complete and has no Railway reference remaining.

Canonical evidence:

- [`railway-archive-closure-2026-08-02.md`](railway-archive-closure-2026-08-02.md);
- [`railway-decommission-archive-manifest-2026-08-02.json`](railway-decommission-archive-manifest-2026-08-02.json);
- private archive final manifest SHA-256
  `b1a6e0e800f3484199b117e845a7359e6703e76d8d111c440af3a9cf755d3310`.

## Superseded import blockers

The earlier fresh import dry run remains accurate historical evidence but no
longer gates anything: its 59 unique-conflict occurrences were attempted
Railway inserts colliding with canonical Selectel keys. They are classified
`D_LEGACY_TECHNICAL_DUPLICATE` and archived. The 20 unmanifested source-only
rows, 62 unmanifested shared differences and old protection-denylist drift are
also archive-only; import/reconciliation scripts were removed.

## Separate branch-migration state

The Selectel-only branch rehearsal is documented separately. It repaired no
business rows. It established an immutable Prisma history, resolved the exact
zero-step failed foundation row only on a local restore, corrected invalid
proposed uniqueness for reused search/display attributes, and applied all 60
repository migrations. Production still has 50 active, 6 rolled-back and 1
zero-step unfinished journal row; production was not changed.

`crm_deals` clean bootstrap is a separate historical-baseline limitation. The
current Prisma schema was bootstrapped into an empty isolated database and
produced `crm_deals` with 43 columns, 20 indexes, one FK and zero rows; the
two-branch security matrix and `pg_amcheck` passed. This does not rewrite old
migration history and is not a Railway reconciliation or production cutover
blocker.

## Production decision

Railway decommission: **complete**.

Branch production cutover: **not authorized and not executed**. Branch 2 was
not created in production. A future cutover still requires its own fresh
maintenance-window approval and the Selectel runbook gates; Railway is not a
rollback target.
