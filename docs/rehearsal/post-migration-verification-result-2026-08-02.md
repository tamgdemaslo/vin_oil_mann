# Post-migration verification — 2026-08-02

**Status: PASS for `branch_selectel_final_rehearsal`.**

- 148 public tables; all 137 baseline tables remain.
- 135 baseline table counts are unchanged.
- Expected deltas only: `_prisma_migrations` +10 and
  `local_counterparties` +13 supplier seed rows.
- 239 foreign keys checked; orphan rows 0.
- 129 branch-scoped tables checked; null `branch_id` rows 0.
- Invalid indexes 0; unvalidated constraints 0.
- Branches: `branch-main` 1, Branch 2 0.
- Migration journal: 67 total, 60 active, 7 rolled back, 0 unfinished;
  every active checksum matches the repository.
- Duplicate precheck: 33/33 PASS.
- Manifest repair idempotency: two passes, 0 planned and 0 applied mutations.
- `pg_amcheck`: PASS, 1,592/1,592 relations.

Critical stock and financial totals match the pre-migration baseline:
quantity `4979.350`, reserve `3.000`, available `4976.350`, shipment sum
`3814379163`, supplier payments `28956350`, expenses `45243988`, payroll
`7932288` cents. Messages remain 5,736 and diagnostic items 2,261.

The evidence covers database state. Full HTTP/browser module smoke tests against
the migrated copy remain a production-cutover gate.
