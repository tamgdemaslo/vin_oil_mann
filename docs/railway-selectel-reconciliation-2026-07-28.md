# Railway → Selectel reconciliation — 2026-07-28/29

## Decision

`RAILWAY_SELECTEL_RECONCILIATION_STATUS=NO-GO`

Selectel remains the canonical production database. No production row, service,
environment variable, DNS record, webhook, integration session, branch
migration, or Railway/Selectel deployment was changed. No new `pg_dump` was
created. No production import was run.

The 342 Railway-only records are fully enumerated and classified with
`UNKNOWN=0`, but reconciliation is not `VERIFIED`: Railway compute is still
running, ten records require owner/file review, and 73 same-PK conflicts touch
critical business fields.

## Evidence and isolated environment

Existing verified dumps were used:

- Selectel PostgreSQL 18.4, database `vin_oil`, 137 public tables, 56 Prisma
  migration rows;
- Railway PostgreSQL 18.3 legacy `hopper` database, 137 public tables, 56
  Prisma migration rows.

The dumps were restored into an isolated PostgreSQL 18.4 cluster with only a
local Unix socket and no TCP listener:

- `reconciliation_selectel`;
- `reconciliation_railway`.

No application, cron process, worker, queue consumer, Telegram/email/T-Bank/
Yclients/MoySklad/ROSSKO integration, supplier order process, or webhook was
connected to the restored databases.

An initial sparse APFS image on the exFAT KINGSTON filesystem developed a local
TOAST checksum error and was rejected. Both databases were restored again into
a fixed APFS image on KINGSTON. `pg_amcheck --heapallindexed --parent-check
--rootdescend` then passed for both databases. Only the fixed-image results are
used below.

## Snapshot boundary: why the dump contains 332, not 342

The Railway full dump contains 332 of the later 342 Railway-only records. The
remaining ten were written after that dump and before the existing PK-hash
audit ended at `2026-07-28T18:43:08Z`:

- 4 `notification_jobs`;
- 6 `notification_logs`.

They were recovered with a narrow repeatable-read, read-only query against the
actual legacy Railway application database. No message body, rendered
notification, payload JSON, error text, phone, VIN, or secret was queried for
the supplement. The private ten-row supplement is stored outside Git on
KINGSTON. This was not a new backup or dump.

Railway remains online. The web service still uses the legacy `hopper` endpoint,
not the current `Postgres-BmbT` proxy. Therefore the snapshot is suitable for
reconciliation evidence, not for declaring a final freeze.

## Full composition of the 342 records

| Table | Total | Action breakdown |
|---|---:|---|
| `cash_shifts` | 1 | 1 `MAP_TO_EXISTING` |
| `client_case_events` | 35 | 35 `INSERT_MISSING` |
| `communication_identities` | 3 | 2 `MAP_TO_EXISTING`; 1 `MANUAL_REVIEW` |
| `conversation_entity_links` | 3 | 2 `SKIP_DUPLICATE`; 1 `MANUAL_REVIEW` |
| `integration_audit_logs` | 3 | 3 `INSERT_MISSING` |
| `messenger_attachments` | 7 | 7 `MANUAL_REVIEW` |
| `messenger_connections` | 3 | 2 `MAP_TO_EXISTING`; 1 `MANUAL_REVIEW` |
| `messenger_conversations` | 3 | 3 `MAP_TO_EXISTING` |
| `messenger_media_jobs` | 145 | 145 `SKIP_EPHEMERAL` |
| `messenger_messages` | 58 | 53 `INSERT_MISSING`; 5 `MAP_TO_EXISTING` |
| `messenger_outbox` | 18 | 18 `SKIP_OBSOLETE` |
| `notification_jobs` | 18 | 18 `MAP_TO_EXISTING` |
| `notification_logs` | 44 | 39 `SKIP_DUPLICATE`; 5 `INSERT_MISSING` |
| `shifts` | 1 | 1 `MAP_TO_EXISTING` |
| **Total** | **342** | |

Data classification:

| Classification | Count |
|---|---:|
| `DURABLE_BUSINESS_DATA` | 79 |
| `APPEND_ONLY_HISTORY` | 82 |
| `DELIVERY_STATE` | 181 |
| `EPHEMERAL` | 0 |
| `DERIVED` | 0 |
| `CONFIGURATION` | 0 |
| `UNKNOWN` | **0** |

Recommended action summary:

| Outcome | Count |
|---|---:|
| True missing business/history records (`INSERT_MISSING`) | **96** |
| Business equivalents under different IDs (`MAP_TO_EXISTING`) | **32** |
| Semantic/full duplicates (`SKIP_DUPLICATE`) | **41** |
| Ephemeral delivery jobs (`SKIP_EPHEMERAL`) | **145** |
| Obsolete already-sent delivery state (`SKIP_OBSOLETE`) | **18** |
| Recreate job | **0** |
| Derived/recompute | **0** |
| Manual review | **10** |
| Invalid/orphan | **0** |

The 96 insert candidates comprise 53 messenger messages, 35 client-case events,
3 integration audit rows, and 5 notification history rows. They are candidates,
not an authorization to import.

## Business-key and dependency reconciliation

Primary-key difference alone was not treated as evidence of a missing business
entity. Matching used actual unique indexes plus domain keys, with HMAC-SHA-256
values in Git artifacts:

- cash shift: service date;
- employee shift: login + shift date;
- communication identity: organization + messenger account + external user;
- messenger connection: channel + external chat;
- conversation: channel + external conversation;
- message: channel + external message ID, otherwise conversation + direction +
  timestamp + content hash;
- notification job: organization + idempotency key;
- notification history: remapped job + event type + status.

Dependency order is:

```text
identity / connection
  -> conversation
    -> message
      -> attachment
        -> media delivery state

notification job mapping
  -> notification history

crm_deal
  -> client_case_event
```

All required declared parents for the 96 insert candidates exist in Selectel or
have an explicit parent mapping. The dry-run found no orphan, missing parent,
incomplete mapping, primary-key conflict, or unique conflict.

Eight deterministic dependency batches are present in the manifest:

| Batch | Records | Purpose |
|---|---:|---|
| `batch-00-skip` | 204 | duplicate/ephemeral/obsolete rows; no mutation |
| `batch-01-operational-mappings` | 2 | cash/employee shift mappings |
| `batch-01-identities` | 4 | identity/connection mappings |
| `batch-02-conversations` | 3 | conversation mappings |
| `batch-03-messages` | 58 | 53 candidate inserts + 5 mappings |
| `batch-05-history` | 43 | case/integration/notification history inserts |
| `batch-06-semantic-jobs` | 18 | notification job mappings; no job-row copy |
| `batch-90-owner-review` | 10 | unresolved identity/link/file evidence |

## Messenger and media decision

The messenger/media records were not copied mechanically:

- 58 messages: 5 map to an existing Selectel message and 53 are durable insert
  candidates;
- 7 attachments report `ready`, but the PostgreSQL dumps cannot prove that the
  underlying legacy files/blobs are present and readable; all seven remain
  `MANUAL_REVIEW`;
- 145 media jobs: 106 are completed and 39 failed. All are technical delivery
  state and are `SKIP_EPHEMERAL`; lock, retry, attempt, and error state is not
  transferred;
- 18 outbox rows are already `sent`; all are `SKIP_OBSOLETE` to prevent replay;
- 18 notification jobs all map by idempotency key to Selectel jobs under other
  IDs; none is copied or recreated;
- 39 notification log rows are semantic duplicates after job remapping; five
  unique history rows remain insert candidates.

`RECREATE_JOB=0`: no job needs automatic recreation on current evidence. If
owner/file review later proves a missing attachment workflow, a new clean job
must be created through the Selectel application workflow, never by copying a
legacy job row.

## Same-PK conflicts

Same-PK differences are excluded from the 342 Railway-only records. The separate
report contains 282 conflicts:

| Conflict type | Count | Resolution |
|---|---:|---|
| Runtime/timestamp drift | 154 | keep Selectel canonical |
| Noncritical metadata difference | 55 | keep Selectel canonical |
| Critical business-field difference | **73** | owner/manual resolution; no update |

Critical conflicts include CRM deal fields, local stock balances, messenger
conversation/message/attachment fields, notification job state, a product
field, and a vehicle lookup field. They are not resolved by `updatedAt`, and the
manifest contains no update action for them.

## Selectel-only preservation

All **3,709** Selectel-only records were re-established from the restored
Selectel snapshot across 37 tables. Per-table created/updated ranges and safe
source classifications are stored in the private preservation audit outside
Git. Their ranges extend through `2026-07-28`, including Selectel-origin
messenger, inventory, AI-assistant, case, shipment revision, and product work.

Protection is structural:

- Selectel is the target and source of truth;
- no manifest action is `DELETE` or `UPDATE`;
- inserts are allowed only when the target PK and every applicable unique key
  are absent;
- `MAP_TO_EXISTING` changes no target row;
- skips and owner-review entries change no target row;
- repeat execution is gated by manifest checksum and migration audit.

The migration manifest therefore cannot overwrite or delete any of the 3,709
Selectel-only rows.

## Manifest, dry-run, and import tooling

Public privacy-safe artifacts:

- `docs/reconciliation/railway-only-records.json` — 342 records, masked/HMAC
  identifiers, business-key hashes, dependency graph, classification, action,
  and reason;
- `docs/reconciliation/railway-to-selectel-migration-manifest.json` — 342
  deterministic actions, eight dependency batches, parent mappings,
  transformations, checksums, and approval gates;
- `docs/reconciliation/same-pk-conflicts.json` — 282 conflicts with field names
  only, no values;
- `docs/reconciliation/dry-run-result.json` — local dry-run evidence.

Dry-run result:

| Check | Result |
|---|---|
| Local Unix socket only | PASS |
| Source/target schema hash | PASS |
| 137 tables / 56 migrations | PASS |
| Manifest checksums/actions | PASS |
| Parent/FK mappings | PASS |
| Unique constraints | PASS |
| Orphans | 0 |
| Planned inserts | 96 |
| Mappings | 32 |
| Skips | 204 |
| Manual review | 10 |
| Conflicts/errors | **0** |

`scripts/reconciliation/dry-run-railway-import.mjs` refuses TCP/remote hosts,
requires the exact local database names, exits nonzero for unknown actions,
missing parents, unique conflicts, incomplete mappings, or schema differences,
and does not mutate either database.

`scripts/reconciliation/import-railway-records.mjs` is prepared but was not run.
It is local-only, batch-only, transaction-based, idempotent, never updates an
existing row, never copies/replays a job automatically, requires explicit owner
approval for gated inserts, and writes an external JSONL
`InfrastructureMigrationAudit` with:

`batchId`, `sourceProvider`, `sourceTable`, `sourcePrimaryKey`,
`targetPrimaryKey`, `action`, `status`, `checksum`, `importedAt`, `error`, and
`notes`.

## Owner decisions, duration, and rollback

Before any production import the owner must decide:

1. whether the one unmatched communication identity and one unmatched
   connection are legitimate production entities;
2. whether the unmatched dynamic conversation link is valid;
3. whether all seven attachment files exist and can be rehearsed end-to-end;
4. how to resolve the 73 critical same-PK conflicts;
5. whether the 53 messages and 43 append-only history rows may be imported.

Estimated remaining reconciliation work after a real Railway freeze:

- owner/file review: 2–4 hours depending on access to legacy files;
- isolated import + repeat diff rehearsal: 30–60 minutes;
- final production window after approval: approximately 15–30 minutes, plus
  observation time.

Rollback strategy for an approved future import:

1. import one dependency batch per transaction;
2. write the external audit only after the transaction outcome is known;
3. mappings/skips require no rollback;
4. for inserted rows, use the audit checksum and target PK to identify exactly
   that batch, then remove only those inserts in reverse dependency order under
   a separate explicit approval;
5. do not roll back by overwriting Selectel with Railway;
6. retain the verified Selectel dump as the last-resort restore point and test
   any restore only in isolation before production approval.

## What remains before VERIFIED

Reconciliation remains **NO-GO** until all of the following are true:

1. Railway compute/autodeploy is stopped without deleting data.
2. Two timestamp-separated Railway snapshots prove no writes after freeze.
3. The ten owner-review records and 73 critical same-PK conflicts are resolved.
4. Legacy files for the seven attachments pass an isolated rehearsal.
5. The 96 approved candidates are imported into a fresh isolated copy and a
   repeat business-key/PK diff passes.
6. All 3,709 Selectel-only records remain present.
7. The production import plan and rollback procedure receive explicit owner
   approval.

Until then: no production import, no branch architecture migration, no Branch 2,
no service/env/DNS/webhook change, and no Railway deletion.
