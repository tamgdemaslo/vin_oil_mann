# Selectel production backup and reconciliation audit — 2026-07-28

## Decision

Status remains **NO-GO**. No production migration, Branch 2 creation, cutover,
service change, environment change, DNS change, webhook change, restore to
production, or Railway/Selectel mutation was performed.

## Actual production database gate

The runtime `DATABASE_URL` inside `tgm-app-1` was inspected without printing the
URL or password. It resolves to the Selectel Compose PostgreSQL service:

- provider classification: `SELECTEL_COMPOSE_POSTGRES`;
- PostgreSQL: `18.4 (Debian 18.4-1.pgdg12+1)`;
- database: `vin_oil`;
- public tables: `137`;
- rows in `_prisma_migrations`: `56`.

## Private backup location

The dumps are outside the repository and Codex workspace in a mode-`0700`
directory on the local KINGSTON disk:

`/Volumes/KINGSTON/ТГМ/Эко-платформа/selectel-production-readonly-audit-2026-07-28-codex-019fa778`

The directory contains production data and must remain private. It was not
added to Git, uploaded to an external service, or copied to Railway.

## Dump manifest

| Scope | UTC interval | Format | Bytes | SHA-256 | Dump exit | Readability |
| --- | --- | --- | ---: | --- | ---: | --- |
| full | 18:10:27–18:23:00 | custom | 1,024,934,448 | `86c1f4de654f9010f268544ef3214ec6dc5733ebddb3069a00d402546ed7ce5f` | 0 | `pg_restore --list`: 0; 1,061 TOC entries; 137 TABLE DATA |
| schema-only | 18:23:13–18:23:15 | plain SQL | 288,911 | `aaad4b0950d4b6d51a8a61184f6523df21eb22fd2efcdb5f1c2c633f054b502f` | 0 | 137 `CREATE TABLE`; completion marker present; local restore: 0 |
| data-only | 18:23:28–18:34:22 | custom | 1,024,513,895 | `c1d31e631359fc8af9c72baaa4dbcd9a3b7801adf1add19fedd250bc1080618f` | 0 | `pg_restore --list`: 0; 137 TOC/TABLE DATA entries; local restore: 0 |

Every dump records PostgreSQL 18.4, source classification
`selectel_compose_postgresql`, 137 tables, 56 migration rows, timestamps, size,
exit code, checksum, and readability evidence in the private `metadata/`
directory.

## Local restore verification

No application was started against the restore cluster. Telegram, email,
T-Bank, Yclients, MoySklad, ROSSKO, and all other integrations were absent.

Full custom restore:

- isolated PostgreSQL 18.4 on loopback only;
- restore used `--single-transaction --exit-on-error`;
- exit code 0;
- 137 public tables and 56 migration rows;
- 0 invalid indexes and 0 unvalidated constraints;
- restored database size: 1,284,380,351 bytes;
- all 137 counts and 195 timestamp ranges are inside the observed Selectel
  audit window.

Schema-only plus data-only restore:

- both restore exit codes are 0;
- 137 public tables and 56 migration rows;
- 0 invalid indexes and 0 unvalidated constraints;
- restored database size: 1,311,512,255 bytes;
- all 137 counts and all timestamp ranges are inside the observed Selectel
  audit window.

## Selectel read-only aggregate audit

The start and end snapshots used repeatable-read, read-only transactions with
short lock and statement timeouts. They collected exact table counts,
`createdAt`/`updatedAt` ranges, numeric primary-key maxima, sequences, tables
without temporal columns, and cumulative table/database statistics.

- exact table counts: 137;
- timestamp ranges: 195;
- numeric PK maxima: none (the schema uses non-numeric identifiers);
- sequences: none;
- tables without `createdAt`/`updatedAt`: 15.

The Selectel database changed during the 18:09:48–18:34:39 UTC audit window.
Counts changed in:

- `inventory_ledger_entries`;
- `messenger_attachments`;
- `messenger_media_jobs`;
- `messenger_messages`;
- `shipment_revisions`.

Timestamp maxima changed across 11 tables. PostgreSQL statistics increased by
177 inserts, 1,636 updates, and 137 deletes. Conflicts and deadlocks remained
zero. Therefore the three dumps are individually consistent snapshots, but are
not one common point-in-time snapshot.

Tables without the requested temporal columns:

`_prisma_migrations`, `ai_agent_tool_calls`, `ai_assistant_tool_calls`,
`client_case_notification_log`, `customer_analytics_settings`,
`inventory_locks`, `local_demand_positions`,
`local_inventory_document_positions`, `local_stock_balances`,
`moysklad_demand_position_sync`, `moysklad_demand_sync`, `product_import_rows`,
`product_mann_poman_migration_audit`, `shift_rates`, and `shifts`.

## Railway comparison

Railway remains online. The `vin-oil-mann` web service still uses the legacy
`hopper` proxy for database `railway`; that endpoint is not the current proxy
of the online `Postgres-BmbT` service. The full URL and credentials were never
printed.

Both database inventories contain the same 137 public table names. Exact
counts differ in 37 tables. Of 60 differing temporal ranges, Selectel has the
later maximum in 53 and Railway in 7. The Railway-later ranges are limited to
`ai_assistant_labor_pricing_rules`, `messenger_outbox`, `notification_jobs`, and
`notification_logs`.

A privacy-safe primary-key set comparison used only table names and salted MD5
hashes of composite PK values. Raw identifiers and row contents were not
exported. Excluding random service IDs in `_prisma_migrations`:

- shared records: 282,651;
- Railway-only records: 342;
- Selectel-only records: 3,709;
- business tables with one-sided records: 38.

Largest exact set differences:

| Table | Railway-only | Selectel-only |
| --- | ---: | ---: |
| `messenger_media_jobs` | 145 | 2,406 |
| `messenger_messages` | 58 | 275 |
| `ai_assistant_tool_calls` | 0 | 264 |
| `shipment_revisions` | 0 | 147 |
| `ai_assistant_sources` | 0 | 122 |
| `notification_logs` | 44 | 51 |
| `client_case_events` | 35 | 42 |
| `messenger_attachments` | 7 | 54 |
| `messenger_outbox` | 18 | 32 |
| `notification_jobs` | 18 | 20 |

Two Railway aggregate snapshots at 18:41:22–18:44:43 UTC showed no changed
row counts, timestamp maxima, inserts, updates, or deletes. This short interval
does not constitute a write freeze: the service remains online and earlier
audits on the same date proved recent Railway writes.

The 56 Prisma migration rows are byte-for-byte identical between Railway and
Selectel. They contain 50 unique migration names and six duplicate names on
both sides. This explains why random `_prisma_migrations.id` values differ even
though migration name/checksum/status multisets match.

## Baseline-chain defect

The repository has no historical creation migration for `crm_deals`; migration
`20260528150000_crm_client_cases` starts with `ALTER TABLE crm_deals`. No
production fix was attempted.

A rehearsal-only candidate was stored only in the private metadata directory:

`metadata/20260528000000_crm_legacy_baseline_candidate.sql`

Verification results:

- on the restored Selectel copy it was a no-op and left the normalized schema
  SHA-256 unchanged;
- on a new isolated scratch database, the CRM chain through
  `20260707120000_client_case_queue` completed with exit code 0;
- 0 invalid indexes and 0 unvalidated constraints;
- no branch migration was applied.

The candidate repairs only the immediate CRM baseline blocker. It is not
approved for production and does not prove that the complete empty-database
migration chain has a sufficient historical baseline.

## Remaining blockers

Reconciliation is still **NOT VERIFIED** because both contours remain live and
there are 342 Railway-only plus 3,709 Selectel-only business records. A
conflict/authority policy, controlled freeze, final point-in-time comparison,
legacy file rehearsal, migration rehearsal, and rollback restore rehearsal are
still required.

Production cutover, Branch 2 creation, and filial migration remain forbidden
without new explicit approval.
