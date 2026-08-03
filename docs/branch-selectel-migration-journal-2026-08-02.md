# Selectel Prisma migration journal investigation — 2026-08-02

## Finding

The fresh canonical Selectel copy contains 57 journal rows, not 56 successful
migrations:

- 49 active, finished migrations initially matched the repository;
- `20260703120000_client_auto_notifications` retained the checksum of its
  originally deployed content, while its repository file had later been
  amended with messenger timestamp defaults/backfill;
- 6 historical failed attempts already marked rolled back, each followed by a
  successful row for the same migration;
- 1 unfinished, zero-step row for
  `20260728120000_branch_architecture_foundation`.

The applied migration was restored to its original, production-recorded
checksum. Its later idempotent statements were moved to the new forward
migration `20260802123000_messenger_message_timestamp_defaults`. The fresh
Selectel copy already has both timestamp defaults and zero null
`messenger_messages.updated_at` rows, so replaying that forward migration is a
schema-preserving no-op plus a zero-row update.

The unfinished row has the audited original checksum
`14de5716128ff19ba5acf6df3f9f25902179b3d0f05d23b1d8137cab45051d8b`
and `applied_steps_count = 0`. The first new rehearsal proved that this version
contained an invalid uniqueness assumption for shipment display names. The
unapplied migration was corrected to use a normal lookup index. The checker
therefore requires the exact original checksum on the zero-step failed row and
also requires the repaired repository checksum to differ. It is a stale failed
attempt, not an applied branch migration. Production data and the production
journal were not changed.

## Rehearsal handling

Only on an isolated Selectel restore:

1. run `scripts/branch/check-selectel-migration-journal.mjs --phase=pre-resolve`;
2. mark the exact zero-step foundation attempt rolled back with Prisma
   `migrate resolve --rolled-back 20260728120000_branch_architecture_foundation`;
3. run `prisma migrate deploy`;
4. run the checker again with `--phase=post-deploy`.

Manual journal SQL is prohibited. The expected post-deploy state is one active
row for every migration directory in the repository, seven rolled-back
historical rows, no unfinished row and matching checksums.

## Final isolated result

The clean final clone reproduced the pre-resolve state exactly: 57 total, 50
active, six rolled back and one unfinished zero-step row. After the guarded
resolve, one `prisma migrate deploy` invocation applied the ten pending
migrations in 19.34 seconds wall time. The post-deploy checker passed with 60
repository migrations, 67 journal rows, 60 active, seven rolled back, zero
unfinished and all active checksums matching.

For a future production cutover the same `migrate resolve` action requires a
new maintenance-window approval and a fresh zero-step/checksum proof. This
report does not authorize that production action.
