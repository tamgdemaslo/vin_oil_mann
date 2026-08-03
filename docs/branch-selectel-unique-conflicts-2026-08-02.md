# Selectel unique-conflict classification — 2026-08-02

## Result

Status: **`CLOSED_ARCHIVE_ONLY_NO_SELECTEL_REPAIR`**.

The reported 59 occurrences are not duplicate rows inside the canonical
Selectel database and are not blockers created by the branch migrations. They
were conflicts that the abandoned Railway import would have caused when
legacy rows met already-existing Selectel unique keys. Railway data is now
archive-only, so all 59 occurrences are category
**D — `LEGACY_TECHNICAL_DUPLICATE`**. `UNKNOWN = 0`.

| Source import constraint | Occurrences | Resolution |
|---|---:|---|
| `communication_identities_org_account_user_uidx` | 8 | archive legacy row; keep Selectel |
| `communication_identities_organization_id_messenger_account__key` | 8 | archive legacy row; keep Selectel |
| `messenger_connections_channel_external_chat_id_key` | 8 | archive legacy row; keep Selectel |
| `messenger_conversations_channel_external_conversation_id_key` | 8 | archive legacy row; keep Selectel |
| `messenger_conversations_channel_external_uidx` | 8 | archive legacy row; keep Selectel |
| `notification_jobs_org_idempotency_uidx` | 19 | archive legacy row; keep Selectel |

The two identity and two conversation indexes overlap by business row, but
the original report counted constraint occurrences rather than distinct
records. The total therefore remains 59 for traceability.

## Selectel action

No merge, delete, rename, re-key or branch reassignment is allowed or needed.
The rehearsal manifest contains an empty mutation list. The guarded script
`scripts/branch/repair-selectel-unique-conflicts.mjs` verifies the manifest,
rejects Railway URLs, requires rehearsal-only environment flags, checks index
and constraint validity, and reports zero mutations in both dry-run and apply
modes. A second execution is inherently idempotent because there is no write
operation.

This classification does not authorize production migration or Branch 2
creation.

## Canonical Selectel branch-schema finding

The first new rehearsal also caught a separate issue that is not part of the
59 Railway occurrences. The proposed unique key
`local_demands(branch_id, name)` conflicts with 795 Selectel groups (1,591
rows, 796 excess rows). In 789 groups the same display name belongs to
different MoySklad ids, and all 795 groups contain different monetary totals.
These are not safe merge candidates: `name` is a reused business/document
label, not an identity.

The repair therefore changes no rows. The invalid proposed UNIQUE index was
replaced in the unapplied branch migration and Prisma schema by a normal
`(branch_id, name)` lookup index. Stable shipment identity remains the
branch-scoped MoySklad id or global technical id.

The migration's own full duplicate precheck then found four more proposed
business-key constraints that do not describe identities:

| Proposed key | Duplicate groups | Rows in groups | Resolution |
|---|---:|---:|---|
| counterparty normalized phone | 202 | 419 | lookup index; MoySklad id remains identity |
| product article | 11 | 24 | lookup index; MoySklad id remains identity |
| product code | 36 | 74 | lookup index; MoySklad id remains identity |
| product EAN-13 | 2 | 6 | lookup index; MoySklad id remains identity |

The evidence shows distinct MoySklad entities and/or names inside these
groups, so an automatic merge, delete or re-key would be unsafe. EAN-8 and
Code-128 were moved to the same search-only policy for consistency even though
this snapshot has no duplicate group for them. All other branch-unique
prechecks pass.
