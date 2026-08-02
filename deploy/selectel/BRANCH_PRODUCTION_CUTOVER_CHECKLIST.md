# Branch architecture production cutover checklist

This checklist is a gate, not authorization to perform the cutover. Every item
must have linked evidence and explicit owner approval in a separate task.

## Immutable prerequisites

- [ ] Git recovery report is PASS and the release commit/branch is identified.
- [ ] Legacy platform archive status is `RAILWAY_DECOMMISSIONED_ARCHIVED` and
  the verified archive manifest is linked.
- [ ] The legacy platform is decommissioned and cannot receive traffic or writes.
- [ ] The archival legacy backup and current Selectel backup are readable,
  checksummed, and separately restore-tested.
- [ ] Test PostgreSQL security matrix has zero failures.
- [ ] Production-copy security matrix has zero failures.
- [ ] Migration rehearsal and post-migration verification pass.
- [ ] Row loss, unexpected duplicates, and cross-branch relations are zero.
- [ ] Financial and stock totals match the pre-migration baseline.
- [ ] Legacy file manifest and temporary-storage rehearsal pass.
- [ ] Rollback backup was restored into a separate target database.
- [ ] Measured RTO and RPO are accepted by the owner.
- [ ] Performance comparison has no unaccepted regression.
- [ ] Production maintenance window is explicitly confirmed by the owner.

## Before maintenance

- [ ] Name the incident commander, database operator, application operator, and
  validation owner.
- [ ] Record the exact release commit, migration set, image digest, and current
  `_prisma_migrations` state.
- [ ] Confirm all external mutation flags and worker stop commands.
- [ ] Confirm free disk, connection capacity, backup target, and restore target.
- [ ] Publish maintenance and rollback decision deadlines.

## Cutover (separate owner-authorized task only)

- [ ] Enter maintenance and stop application mutations/workers.
- [ ] Record the last accepted transaction time and create the final backup.
- [ ] Verify backup checksum/readability before migration.
- [ ] Run the reviewed migration command exactly once.
- [ ] Run post-migration SQL, totals, sequence, relation, and file checks.
- [ ] Start the reviewed release with external mutations still disabled.
- [ ] Run branch, authentication, module, file, public report, export, AI, and
  integration read-only smoke tests.
- [ ] Enable mutations only after the validation owner approves.

## Rollback trigger

- [ ] Stop on migration error, row loss, financial/stock mismatch, cross-branch
  relation, security failure, unacceptable lock, or critical smoke failure.
- [ ] Restore into the reviewed rollback target and follow
  `BRANCH_ROLLBACK_RUNBOOK.md`.
- [ ] Record actual restore time, health time, RTO, RPO, and data delta.

## Explicit prohibitions

- Do not run this checklist from a decommissioned legacy database URL.
- Do not use the archival legacy backup as a production, migration, or rollback target.
- Do not change DNS, webhooks, Telegram sessions, payment callbacks, or provider
  credentials without their own reviewed step.
- Do not create production Branch 2 before all post-migration gates pass.
