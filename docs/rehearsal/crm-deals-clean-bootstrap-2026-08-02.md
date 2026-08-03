# `crm_deals` clean bootstrap check — 2026-08-02

**Status: PASS for current-schema bootstrap; historical baseline limitation remains documented.**

The current Prisma schema was pushed into a separate empty PostgreSQL 18.4
database. It created `crm_deals` with 43 columns, 20 indexes, one foreign key
and zero rows. The two-branch security matrix passed all 13 database
assertions, blocked eight direct cross-branch FK attacks, passed the
application policy matrix and rolled synthetic data back. `pg_amcheck` passed.
The temporary database was then dropped.

This does not rewrite historical migrations. The old chain assumes
`crm_deals` exists in the production baseline; therefore migration-chain
validation is performed against the canonical Selectel production copy, while
clean-bootstrap validation proves the current schema and security model.
