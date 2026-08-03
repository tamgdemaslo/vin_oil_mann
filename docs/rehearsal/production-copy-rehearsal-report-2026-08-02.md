# Selectel production-copy branch rehearsal — 2026-08-02

**Status: PASS for the isolated database-migration scope.** This is evidence,
not permission for a production cutover.

The source was the fresh read-only Selectel `vin_oil` dump completed at
`2026-08-01T08:10:13Z` (1,025,328,094 bytes, SHA-256
`b753f93a7fc2bcb3f37d7bd880048446c5a2796596d5c28478edfb27d571b063`).
The final run used a new isolated clone named
`branch_selectel_final_rehearsal`; no application or integration was
connected and every external side effect remained disabled.

The pre-resolve journal gate reproduced 57 rows: 50 active, six rolled back
and the exact audited zero-step foundation attempt unfinished. Only in the
rehearsal clone, that attempt was marked rolled back. `prisma migrate deploy`
then applied all ten pending migrations in one invocation. Wall time was
19.34 seconds. The final journal has 60 active rows, seven rolled-back history
rows, zero unfinished rows and checksums matching all 60 repository
migrations.

Post-migration result: 148 public tables, 239 foreign keys, zero orphan rows,
129 branch-scoped tables with zero null `branch_id`, zero invalid indexes and
zero unvalidated constraints. There is one `branch-main` row and no Branch 2.
All 33 duplicate prechecks pass. Two manifest-driven repair runs both planned
and applied zero Selectel row mutations. `pg_amcheck` passed 1,592/1,592
relations.

All 137 baseline tables remain. Counts are unchanged in 135; the two expected
changes are ten journal rows and 13 supplier seed rows in
`local_counterparties`. Stock, shipment, payment, expense, payroll, message
and diagnostic totals match the baseline exactly.

Machine-readable result:
[`selectel-branch-rehearsal-result-2026-08-02.json`](selectel-branch-rehearsal-result-2026-08-02.json).

Production migration, production Branch 2, Railway import and production
mutation attempted: false.
