# Branch architecture GO/NO-GO — 2026-08-02

## Decision

**`NO_GO_PRODUCTION_CUTOVER_NOT_AUTHORIZED`.**

Railway reconciliation is closed and is no longer a blocker. Railway is
`RAILWAY_DECOMMISSIONED_ARCHIVED`; Selectel `vin_oil` is the sole canonical
production database. The database-migration rehearsal is PASS, but the
remaining production-only gates below are deliberately not inferred from a
local test. No production migration or Branch 2 creation was performed.

## Closed gates

| Gate | Result | Evidence |
|---|---|---|
| Legacy platform | Railway project/services/volumes deleted after two restore-tested archives; import policy `ARCHIVE_ONLY_DO_NOT_IMPORT` | `docs/reconciliation/railway-decommission-archive-manifest-2026-08-02.json` |
| Canonical baseline | 137 tables, exact counts/totals/checksums, 60 repository migration checksums, no raw rows/secrets | `docs/rehearsal/selectel-pre-branch-baseline-2026-08-02.json` |
| Final production-copy DB rehearsal | PASS; ten pending migrations in one 19.34 s deploy | `docs/rehearsal/selectel-branch-rehearsal-result-2026-08-02.json` |
| Journal | 60 active, 7 rolled back, 0 unfinished, checksums match | `docs/branch-selectel-migration-journal-2026-08-02.md` |
| Post-migration integrity | 0 orphans/null branch rows/invalid indexes/unvalidated constraints; `pg_amcheck` 1,592/1,592 | `docs/rehearsal/post-migration-verification-result-2026-08-02.md` |
| Business totals | Stock, shipments, payments, expenses, payroll, messages and diagnostics match; only 13 documented supplier seed rows added | same post-migration evidence |
| Unique conflicts | 33/33 gates PASS; 59 abandoned-import occurrences archive-only; two repair passes apply 0 mutations | `docs/branch-selectel-unique-conflicts-2026-08-02.md` |
| Rollback restore | 137/137 tables, `pg_amcheck` 1,357/1,357; database restore 65.522 s | `docs/rehearsal/rollback-restore-report-2026-08-02.md` |
| Performance | All five sampled paths below 0.1 ms; planner statistics refresh included | `docs/rehearsal/performance-comparison-2026-08-02.md` |
| Current-schema bootstrap/security | `crm_deals` 43 columns/20 indexes/1 FK; 13 DB assertions and eight cross-branch attacks PASS | `docs/rehearsal/crm-deals-clean-bootstrap-2026-08-02.md` |
| Code gates | Selectel policy, Prisma validation/generation, TypeScript, production build, branch isolation and all branch audits PASS | local 2026-08-02 run |
| Public Selectel | HTTP 200 from `161.104.45.31`, content SHA-256 unchanged (`a3fca160...`) | final read-only health check |

## Remaining production blockers

1. The legacy file ownership manifest is still `NOT BUILT`, and the isolated
   file copy/checksum/authorization rehearsal is still `NOT RUN`.
2. Full authenticated HTTP/browser module, file and integration read-only
   smoke tests have not run against the migrated production copy.
3. The measured 65.522 seconds covers database restore only. Final production
   RTO and RPO require a fresh pre-cutover Selectel backup after writes are
   frozen; production RPO is currently unmeasured.
4. An immutable release commit/image digest and a clean reviewed production
   change set have not been selected from the current dirty worktree.
5. The owner has not separately confirmed a production maintenance window,
   named cutover operators or authorized the production migration.

The final local `npm run branch:go-check` passed Prisma validation/generation,
TypeScript, production build, branch isolation, all model/SQL/constraint/
integration/file/export/public-route audits, the 13-assertion PostgreSQL
security matrix and Selectel preflight. It returned **NO-GO with four enforced
blockers**: legacy file manifest, legacy file rehearsal, accepted production
RTO/RPO evidence and the maintenance-window confirmation. The immutable
release and endpoint smoke requirements remain checklist gates outside those
four evidence variables.

## Next authorized stage

Build the read-only legacy file manifest, run the isolated file and
authenticated application smoke rehearsals, package an immutable Selectel
release and repeat the final-backup/RTO/RPO gate. Only a new explicit owner
authorization may begin production maintenance. Railway must never be used as
a fallback or rollback target.
