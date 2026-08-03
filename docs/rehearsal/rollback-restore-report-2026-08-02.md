# Rollback restore rehearsal — 2026-08-02

**Status: PASS for the isolated restore scope.**

An independent empty rollback target was restored from the immutable Selectel
dump. Restore started at `2026-08-02T20:32:29.584Z`, finished at
`2026-08-02T20:33:35.114Z`, and took 65.522 seconds.

- public tables: 137;
- table counts matching the canonical restore: 137/137;
- invalid indexes: 0;
- unvalidated constraints: 0;
- `pg_amcheck`: PASS, 1,357/1,357 relations.

This proves database restoreability for the captured snapshot. It does not
measure application reconfiguration/startup, endpoint smoke time, or a future
production data delta. Railway is not a rollback target.
