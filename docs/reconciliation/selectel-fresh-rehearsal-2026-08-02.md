# Selectel fresh backup and isolated reconciliation rehearsal — 2026-08-01/02

> Closure update, 2026-08-02: this report remains the historical result for
> the abandoned import path. The owner selected
> `CLOSED_ARCHIVE_ONLY_DO_NOT_IMPORT`; therefore these import conflicts were
> not rewritten as resolved and no import rehearsal was resumed. See
> [`railway-archive-closure-2026-08-02.md`](railway-archive-closure-2026-08-02.md).

## Decision

Status: **`NO_GO_FRESH_REHEARSAL_DRIFT`**.

Fresh Selectel backup, two independent restores and `pg_amcheck` completed.
The guarded import preflight failed against the current Selectel snapshot, so
no local import batch, idempotency mutation pass or production import was run.
No Selectel/Railway production data, service, deployment, DNS, webhook or
secret was changed.

## Fresh Selectel backup

- source: Selectel Compose PostgreSQL `vin_oil`, PostgreSQL 18.4;
- UTC interval: `2026-08-01T08:01:42Z`–`2026-08-01T08:10:13Z`;
- duration: 511 seconds;
- format: custom;
- size: 1,025,328,094 bytes;
- SHA-256:
  `b753f93a7fc2bcb3f37d7bd880048446c5a2796596d5c28478edfb27d571b063`;
- `pg_restore --list`: 1,061 TOC entries, 137 TABLE DATA entries;
- private location outside Git:
  `/Volumes/KINGSTON/ТГМ/Эко-платформа/selectel-production-readonly-rehearsal-2026-08-01-codex-019fb41a/selectel-full.dump`.

The source journal currently has 57 rows: 50 active, 6 rolled back and 1
unfinished. The unfinished row is
`20260728120000_branch_architecture_foundation`; it has zero applied steps.
The 2026-07-31 manifest expected 56 target journal rows, so its journal gate is
now stale.

## Isolated restores and integrity

The clean rehearsal used PostgreSQL 18.4 in a new 16 GiB APFS image on
KINGSTON. TCP was disabled; access was limited to a Unix socket below
`/private/tmp`; data page checksums were enabled; no application or integration
was connected.

- fresh Selectel restore: exit 0, empty stderr, 137 public tables;
- fresh Selectel `pg_amcheck --heapallindexed --parent-check --rootdescend
  --checkunique`: PASS, 1,357/1,357 relations;
- frozen Railway source reconstruction: verified 2026-07-28 backup plus the
  approved 190-row supplement with SHA-256
  `3b79f63aeabb0508ef6821d323bdc267f2880c537e386a2351e49fc5bfcf61cc`;
- Railway source supplement: PASS, local Unix socket only;
- Railway source `pg_amcheck`: PASS, 1,357/1,357 relations;
- independent rollback restore: exit 0, empty stderr, 137 public tables;
- all 137 table counts match the first Selectel restore exactly;
- rollback `pg_amcheck`: PASS, 1,357/1,357 relations;
- 99 foreign keys checked, orphan rows 0, invalid indexes 0, unvalidated
  constraints 0.

The first local image was interrupted when KINGSTON was automatically
unmounted. `fsck_apfs -n` rejected that image with an invalid container
superblock. It was not used as evidence and was preserved, not deleted, as
`selectel-rehearsal-20260801.corrupt-after-unmount.dmg`. The fresh dump retained
the same SHA-256 after KINGSTON was remounted. The clean replacement image
passed `fsck_apfs` with exit 0, PostgreSQL reported `shut down`, and the image
was verified by a read-only remount before final detach.

## Guarded dry-run result

The fresh guarded dry run returned **FAIL** with 60 conflicts:

- 1 migration journal count mismatch: source 57, target 57, while the manifest
  still models 57 source rows and 56 target rows;
- 59 business unique-index conflict occurrences affecting the planned
  identity, connection, conversation and notification-job inserts.

Unique conflict occurrences by index:

| Table/index | Count |
|---|---:|
| `communication_identities_org_account_user_uidx` | 8 |
| `communication_identities_organization_id_messenger_account__key` | 8 |
| `messenger_connections_channel_external_chat_id_key` | 8 |
| `messenger_conversations_channel_external_conversation_id_key` | 8 |
| `messenger_conversations_channel_external_uidx` | 8 |
| `notification_jobs_org_idempotency_uidx` | 19 |

Per the import runbook, no import batch was attempted after this failure.

## Fresh pre-import full diff

The read-only PK/row-hash diff found:

- Railway source-only: 529;
- Selectel target-only: 9,035;
- shared identical: 282,285;
- shared different: 346;
- 234 source-only rows still correspond to planned `INSERT_MISSING` actions;
- 20 additional source-only `scheduled_working_days` rows have no manifest
  action;
- 62 shared differences have no same-PK resolution entry:
  `local_products` 11, `local_stock_balances` 25,
  `messenger_attachments` 12, `messenger_conversations` 2 and
  `messenger_messages` 12.

The old Selectel-only protection contract is also stale: 4 protected
`local_demand_positions` rows from the explicit denylist are absent in the
fresh Selectel snapshot. A fresh protected checksum was therefore refused.

## Runtime and safety evidence

- public Selectel `/`, `/login` and `/api/public/stats`: HTTP 200 after the
  rehearsal;
- production mutation attempted: false;
- production import attempted: false;
- Selectel deploy attempted: false;
- Railway access attempted: false;
- Git/AppleDouble files changed or deleted by this rehearsal: false.

Private machine-readable evidence is under the same private KINGSTON directory
in `metadata/`, including `fresh-dry-run.json`,
`fresh-preimport-full-diff.json`, restore logs and `pg_amcheck` progress logs.

## Required next action

Before another import rehearsal:

1. Resolve and document the unfinished Selectel Prisma journal row without
   treating it as an applied migration.
2. Rebuild the Railway-only and same-PK manifests against this exact fresh
   Selectel snapshot.
3. Reclassify the 59 unique conflicts, 20 unmanifested source-only rows and 62
   unmanifested shared differences.
4. Rebuild the Selectel-only denylist/protection checksum contract, accounting
   for the four missing protected rows.
5. Repeat fresh dry run. Only a zero-conflict PASS may unlock local import,
   post-import full diff and idempotency checks.

Production execution remains separately prohibited.
