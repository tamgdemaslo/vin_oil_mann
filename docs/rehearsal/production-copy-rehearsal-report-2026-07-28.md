# Production-copy rehearsal — 2026-07-28

**Status: NOT RUN / NO-GO.**

The rehearsal is intentionally blocked because Railway → Selectel
reconciliation is not `VERIFIED`, Railway compute is still running, and a fresh
post-reconciliation Selectel backup does not exist. No Selectel production dump
was restored, no branch migration was applied, and Branch 2 was not created.

Required evidence when unblocked:

- approved fresh Selectel backup metadata and checksum;
- restore into an empty database containing `rehearsal` in its name;
- pre-migration baseline;
- preflight output;
- migration duration and lock observations;
- post-migration row/totals/relation comparison;
- Branch 1/Branch 2 and smoke-test results.

This file is a status report and must not be supplied to `branch:go-check` as
successful rehearsal evidence.
