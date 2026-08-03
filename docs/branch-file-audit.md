# Аудит файловых подсистем по филиалам

Сгенерировано 2026-07-28. Structural checks: **10**; blockers: **0**. Новые disk/object keys обязаны начинаться с `branches/{branchId}/`. Знание storage key не даёт доступа: приватная выдача идёт через authenticated proxy и branch-owned DB row.

| subsystem | storage | new key format | owner relation | authorization | public/signed URL | legacy handling | status |
|---|---|---|---|---|---|---|---|
| Messenger attachments | S3-compatible object storage | branches/{branchId}/messenger/... | message/conversation | session + branch SQL | no; authenticated proxy | legacy unprefixed keys resolved only through branch-owned DB row | ENFORCED |
| Telegram downloaded media | same object storage | branches/{branchId}/messenger/... | MessengerAttachment | worker and proxy use branchId | no | dry-run key migration required | ENFORCED_NEW |
| Diagnostic photos (legacy) | local disk | branches/{branchId}/diagnostics/{diagnosticId}/{photoId} | DiagnosticPhoto | session or report token + entity relation | token route only | old paths remain readable from branch-owned row | ENFORCED_NEW |
| Diagnostic map photos | DB bytes + local disk cache | branches/{branchId}/diagnostics/{sessionId}/{photoId} | DiagnosticMapPhoto | session or report token + entity relation | token-bound route | old cache paths remain entity-bound | ENFORCED_NEW |
| Vehicle photos | DB bytes + local disk cache | branches/{branchId}/diagnostics/{sessionId}/vehicle-* | DiagnosticMapVehiclePhoto | session or report token | token-bound route | old cache paths remain entity-bound | ENFORCED_NEW |
| Product photos | PostgreSQL bytes | n/a | LocalProductPhoto -> LocalProduct | session + branch relation | no | none | ENFORCED |
| Generated PDFs | ephemeral memory/tmp | random temp directory | closing document/demand/report token | session+branch or public token | public only for one report token | no persistent object | ENFORCED |
| Shipment documents | generated on demand | n/a | LocalDemand/ClosingDocument | session + scoped Prisma | no | none | ENFORCED |
| Exports | response stream | n/a | scoped source rows | session + export permission | no | no retained export job | ENFORCED_SYNC |
| AI attachments | branch-scoped JSON in PostgreSQL | n/a | AIAssistantMessage | thread branch scope | no | binary upload not implemented | SCHEMA_ONLY |
| Inventory attachments | object-key schema only | must be branches/{branchId}/inventory/... | InventoryAttachment | no download route implemented | no | must enforce when activated | SCHEMA_ONLY |
| Cash/invoice attachment URLs | external URL metadata | provider-controlled | branch-scoped expense/invoice | visible only with parent entity | provider URL may be external | move to proxy storage in separate feature | LEGACY_POINTER |
| Temporary files | OS temp | random UUID dir | single render job | not addressable via app route | no | cleanup in finally | ENFORCED |
| Generated images | on-demand SVG/image response | n/a | single report token | token-bound | yes, report-scoped | none | ENFORCED |
| Backups | outside application runtime | Selectel runbook only | database/deployment | operator control | no | application has no backup read route | NOT_APP_ACCESSIBLE |

## Automated evidence

| check | file | status |
|---|---|---|
| Messenger attachments | `src/lib/messenger/messenger-storage.ts` | ENFORCED |
| Messenger attachment content | `src/app/api/messenger/attachments/[id]/content/route.ts` | ENFORCED |
| Messenger thumbnails | `src/app/api/messenger/attachments/[id]/thumbnail/route.ts` | ENFORCED |
| Messenger avatars | `src/app/api/messenger/conversations/[id]/avatar/route.ts` | ENFORCED |
| Classic diagnostic upload path | `src/lib/diagnostic-photos.ts` | ENFORCED |
| Diagnostic map upload path | `src/lib/diagnostic-map-service.ts` | ENFORCED |
| Private diagnostic photo | `src/app/api/diagnostics/[id]/photos/[photoId]/route.ts` | ENFORCED |
| Private vehicle photo | `src/app/api/diagnostics/[id]/vehicle-photo/route.ts` | ENFORCED |
| Public diagnostic photo | `src/app/api/diagnostics/public/[token]/photos/[photoId]/route.ts` | ENFORCED |
| MoySklad image proxy | `src/app/api/moysklad/image/route.ts` | ENFORCED |

## Legacy dry-run

Physical moves are forbidden before rehearsal. `scripts/build-branch-file-migration-manifest.mjs` produces the required oldKey/newKey/branchId/entity/size/checksum/conflict manifest against an explicitly configured non-production copy.
