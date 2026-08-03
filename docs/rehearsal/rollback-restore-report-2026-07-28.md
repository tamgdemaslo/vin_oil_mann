# Rollback restore rehearsal — 2026-07-28

**Status: NOT RUN / NO-GO.**

The rollback runbook exists, but no approved pre-migration Selectel backup has
been restored into a separate rollback-target database. Schema, migration
history, row counts, checksums, application startup, authorization, health, and
module smoke tests therefore have no measured result.

Do not use this status report as `BRANCH_ROLLBACK_REHEARSAL_EVIDENCE`.
