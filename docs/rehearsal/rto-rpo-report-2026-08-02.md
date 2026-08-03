# RTO/RPO rehearsal result — 2026-08-02

**Status: NO-GO for production RPO acceptance; database restore measurement is complete.**

The measured isolated database-restore component is 65.522 seconds. The
restored snapshot reproduces 137/137 table counts and passes `pg_amcheck`.
Snapshot-relative RPO is zero because both comparison targets use the same
immutable dump.

Production RTO is not yet the 65.522-second number: it must also include
application reconfiguration, container startup, health checks and module
smoke tests. Production RPO is unmeasured until a separately authorized
maintenance window freezes writes, records the final accepted transaction and
creates the fresh pre-cutover Selectel backup. No theoretical zero-RPO claim
is made.
