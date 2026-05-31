# MoySklad Dependency Audit

Generated: 2026-05-28

This audit tracks runtime, sync, UI, script, env, and legacy-field dependencies on MoySklad. Critical live dependencies must be removed or guarded before `MOYSKLAD_ENABLED=false` is used in production.

| File / area | Lines / code area | Integration behavior | Type | Criticality | Local DB replacement | Disable now? | Migration needed? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `src/lib/moysklad.ts` | central fetch/auth wrapper | Auth headers, API base, fetch/retry target | read/write | Critical | `src/lib/moysklad-flags.ts` now blocks disabled reads/writes; callers must use local services | Yes, guarded by flags | No |
| `src/lib/local-inventory-sync.ts` | sync runner | Imports organizations, stores, products, services, counterparties, stock, demands | sync | Critical for cutover only | New CLI and guarded sync route; local DB after verify | No, keep admin/manual only | No for current entities |
| `src/lib/moysklad-customer-analytics-sync.ts` | analytics sync runner | Imports applicable demands and positions into analytics snapshot | sync | High | Prefer `LocalDemand`/`LocalDemandPosition` or existing snapshot | Yes after verify | No for snapshot; deprecate long term |
| `src/lib/payroll.ts` | demand/cashout loading | Used live demands and cashouts for salary | read | Critical | Now falls back to `LocalDemand`, `LocalDemandPosition`, `CashExpenseOrder` when read flag is off | Yes | No |
| `src/lib/demand-detail-load.ts` | detail loader | Loads demand header, positions, stock report from MoySklad | read | High | `loadLocalDemandDetailPayload` | Yes, guarded | No |
| `src/app/shipment/page.tsx` | shipment list fallback | Local list first, MoySklad fallback | read/UI | High | `loadLocalDemandList` | Yes after local data verified | No |
| `src/app/api/demands/[id]/payment/route.ts` | AQSI precheck/payment | Local demand first, MoySklad fallback | read | High | Local demand detail | Yes, fallback now blocked by read flag | No |
| `src/app/api/demands/[id]/copy/route.ts` | copy shipment | Local copy first, MoySklad fallback for legacy id | read/write | Medium | Local demand create | Yes after legacy ids verified | No |
| `src/app/api/demands/by-phone/route.ts` | customer history | Snapshot plus live phone lookup | read | Medium | `moySkladDemandSync` and/or `LocalDemand` | Yes, live lookup now skipped by read flag | No |
| `src/app/api/supplies/route.ts` | supply list/create | Live supply GET/POST | read/write | Critical for receipts | Local receipt documents via `LocalInventoryDocument` when flags are off | Yes, now local-backed when flags off | Local legacy MoySklad id fields still recommended |
| `src/app/api/supplies/[id]/route.ts` | supply detail | Live supply detail/positions | read | High | Local receipt detail from `LocalInventoryDocument` | Yes, now local-backed when flags off | Local legacy MoySklad id fields recommended |
| `src/app/api/moysklad/products/route.ts` | product search endpoint name | Already local-backed product search | read | Low | `searchLocalProducts` | Yes | No |
| `src/app/api/moysklad/counterparties/route.ts` | counterparty search/create endpoint name | Already local-backed counterparties | read/write | Low | `LocalCounterparty` | Yes | No |
| `src/app/api/moysklad/organizations/route.ts` | organization refs endpoint name | Already local-backed organizations | read | Low | `LocalOrganization` | Yes | No |
| `src/app/api/moysklad/stores/route.ts` | store refs endpoint name | Already local-backed stores | read | Low | `LocalStore` | Yes | No |
| `src/app/api/moysklad/cashouts/route.ts` | cashout list endpoint name | Already local-backed cash expense orders | read | Low | `CashExpenseOrder` | Yes | No |
| `src/app/api/moysklad/expense-items/route.ts` | expense items endpoint name | Already local-backed expense items | read | Low | `CashExpenseItem` | Yes | No |
| `src/app/api/moysklad/product-cells/route.ts` | product cell lookup endpoint name | Already local-backed cells | read | Low | `LocalProduct.cell` / attributes | Yes | No |
| `src/app/api/moysklad/supply-products/route.ts` | product search for supply | Live product search | read | Medium | Now local-backed when read flag is off | Yes | No |
| `src/app/api/moysklad/assortment/route.ts` | catalog modal assortment search | Live product/attribute search | read | Medium | Now local-backed when read flag is off | Yes | No |
| `src/app/api/moysklad/product-metadata/route.ts` | product attribute metadata | Live metadata read | read | Low | Local product attributes/raw fields; returns empty controlled response when disabled | Yes | No |
| `src/app/api/moysklad/image/route.ts` | image proxy endpoint name | Local photo first, no live fetch fallback | UI-only | Low | `LocalProductPhoto` / `imageHref` | Yes | No |
| `src/app/api/crm/deals/route.ts` | create MoySklad counterparty helper | Optional live counterparty creation | write | Medium | `LocalCounterparty` create | Yes, should be guarded/removed in UI | No |
| `src/app/crm/CrmPipelineClient.tsx` | counterparty search/create UI | Calls `/api/moysklad/counterparties`, labels MoySklad | UI/read/write | Medium | Endpoint is local-backed; relabel UI to local CRM | Yes | No |
| `src/app/cash/page.tsx` | cashout/expense refs UI | Calls local-backed `/api/moysklad/*`, displays MoySklad source links | UI-only/read | Medium | Local cash APIs and legacy source labels | Yes after relabel | No |
| `src/app/shipment/new/NewShipmentPageClient.tsx` | refs/product search/create | Calls `/api/moysklad/*`, many are local-backed | UI/read/write | High | Local-backed endpoints and `/api/demands` | Yes | No |
| `src/app/shipment/[id]/page.tsx` | product search, legacy links/raw JSON | Calls `/api/moysklad/products`, shows MoySklad links/raw fields | UI/read | High | Local-backed product endpoint and local detail payload | Yes after relabel | No |
| `src/app/operations/supply/SupplyClient.tsx` | supply workflow | Calls `/api/moysklad/*` refs/products and `/api/supplies` | UI/read/write | High | Local-backed refs/products and local receipts when flags off | Yes | No |
| `src/app/inventory/products/ProductsClient.tsx` | sync button | Starts local inventory sync from MoySklad | sync/UI | Medium | Admin-only manual sync; route now guarded | Hide when sync flag off | No |
| `src/app/cabinet/customer-analytics/CustomerAnalyticsClient.tsx` | sync button | Starts analytics sync from MoySklad | sync/UI | Medium | Local analytics from local demands | Hide when sync flag off | No |
| `src/lib/moysklad-stock-cache.ts` | lookup stock cache | Live stock report cache | read/cache | Medium | `LocalStockBalance` | Yes | No |
| `src/lib/oil-recommendations.ts` | oil search | Live MoySklad product search/metadata | read | Medium | `public-oil` / `LocalProduct` fields | Yes | No |
| `src/lib/moysklad-restock.ts` | restock helpers | Live stock/outflow data | read | Medium | `local-inventory-admin` restock logic | Yes | No |
| `src/lib/job-order-*` | poster/xls/org/history | Live org/counterparty/history lookups | read | Medium | Local demand/customer history | Yes | No |
| `scripts/import-from-moysklad.mjs` | legacy import script | Full import to local mirror | sync | Admin/manual | New `sync:moysklad:last-days` for final window | Keep manual only | No |
| `scripts/import-moysklad-motor-oil-photos.mjs` | photo import | Fetches MoySklad product images | sync/debug | Optional | `LocalProductPhoto` | Keep manual only | No |
| `scripts/refresh-moysklad-token.mjs`, `scripts/*attributes*`, `scripts/moysklad-oem-request.mjs` | debug helpers | Token/metadata/OEM checks | debug | Optional | None at runtime | Keep manual only | No |
| `.env.example`, `.env.local.template` | env variables | MoySklad credentials and flags | config | Critical | New `MOYSKLAD_*_ENABLED` flags | Yes | No |
| `prisma/schema.prisma` legacy fields | `moyskladId`, `moyskladHref`, `externalCode`, `syncedAt` | Legacy mapping and import keys | schema | High | Nullable legacy-only fields | Keep nullable | Supplies/writeoffs need legacy ids |

## Immediate Blockers

- `LocalInventoryDocument` does not currently have a nullable `moyskladId`/`moyskladHref`; safe automatic import of MoySklad supplies/writeoffs should remain blocked until that migration exists.
- `CashExpenseOrder` has `moyskladCashoutHref` but no explicit `moyskladCashoutId`; current safe match is by href.

## Step 8 Write Cutoff

- Runtime write access is disabled by default: `MOYSKLAD_WRITE_ENABLED=false`, and server write/sync flags are ignored unless `MOYSKLAD_DEBUG_ENABLED=true`.
- Runtime sync is disabled by default: `MOYSKLAD_SYNC_ENABLED=false`, and main UX sync buttons are hidden unless `NEXT_PUBLIC_MOYSKLAD_DEBUG_ENABLED=true`.
- `/api/demands/[id]/copy` now creates only local `LocalDemand` records and no longer has a live MoySklad create branch.
- `/api/supplies` now creates only local `LocalInventoryDocument(type=receipt)` records and no longer posts `/entity/supply`.
- CRM case creation now creates local counterparties only; the former `createMoyskladCounterparty` payload is treated as a legacy local-create request.
- Main UX no longer exposes the explicit controls “Создать контрагента в МойСклад”, “Синхр. МойСклад”, “Обновить из МойСклад”, “Открыть в МойСклад”, or “Удалить отгрузку в МойСклад”.
- Legacy external document links and raw legacy JSON are hidden behind `NEXT_PUBLIC_MOYSKLAD_DEBUG_ENABLED=true`.

## Step 9 Read Cutoff

- Runtime read access is disabled by default: `MOYSKLAD_ENABLED=false` in templates, `MOYSKLAD_READ_ENABLED=false`, and read is ignored unless `MOYSKLAD_DEBUG_ENABLED=true`.
- Ordinary shipment list/detail, copy, payment/precheck, Excel job-order export, salary, oil recommendations, restock, stock lookup cache, supplies, CRM, cash, and catalog endpoints now use local DB sources.
- Compatibility endpoints under `/api/moysklad/*` that are used by UI remain local-backed adapters for products, counterparties, organizations, stores, expense items, cashouts, product cells, supply products, assortment, and product metadata.
- Remaining direct `moyskladFetch` usage is limited to explicit sync modules: `local-inventory-sync` and `moysklad-customer-analytics-sync`; those routes are guarded by `MOYSKLAD_SYNC_ENABLED` and should stay admin/debug only.
- Legacy live helpers `demand-detail-load` and `job-order-poster-bortjournal` no longer perform live reads in ordinary runtime.
- User-facing lookup and shipment messages were relabeled from MoySklad to local catalog so disabled integration does not leak as a normal UX dependency.

## Step 10 UI Cutoff

- Removed main UX sync/debug controls from product inventory and customer analytics pages: no visible “Debug sync”, “Последние 100”, or “Полная пересинхронизация” controls remain in ordinary screens.
- Removed visible legacy MoySklad document links, raw legacy JSON blocks, and `moysklad id` fields from ordinary shipment, product, and cash UI.
- Relabeled legacy/import-only source labels to neutral archive wording in cash, invoices, CRM, print, and precheck UI.
- Added owner/admin-only `/cabinet/integrations` page for controlled status and manual service launches; it sanitizes technical errors and keeps manual sync outside the main workflow.
- Added “Интеграции” cabinet navigation only for owner/admin roles. Regular users keep local operational screens without MoySklad controls.
- Remaining visible “МойСклад” wording is intentionally limited to the admin integrations page; code/API legacy identifiers remain for audit and mapping only.

## Step 12 Legacy Field Retention

- Legacy fields are retained for audit, history, rollback and manual comparison. They are not part of the required local document creation flow.
- Added nullable legacy metadata to `LocalInventoryDocument`, `LocalInventoryDocumentPosition`, `LocalSupplierInvoice`, `LocalSupplierInvoicePayment`, and `CashExpenseOrder`.
- Newly added fields include nullable `moyskladId` or position id, `moyskladHref`, `moyskladMetaHref`, `externalCode`, `syncedAt`, `syncStatus`, and `syncError`; `source` has a local default where used.
- `CashExpenseOrder` keeps older specific href fields and now also has generic nullable `moyskladId`/`moyskladHref` for future comparison.
- Do not drop `moyskladId`, `moyskladHref`, `moyskladMetaHref`, `externalCode`, `source`, `syncedAt`, `syncStatus`, or `syncError` until final verify and rollback window are complete.

## Step 13 Rollback Plan

- Rollback plan is documented in `moysklad-rollback-plan.md`.
- Backfill must not run until a DB dump and env/config backup are confirmed.
- Normal cutover is flags-first: all `MOYSKLAD_*_ENABLED` runtime flags stay `false`.
- Read-only rollback profile is available through flags: `MOYSKLAD_ENABLED=true`, `MOYSKLAD_DEBUG_ENABLED=true`, `MOYSKLAD_READ_ENABLED=true`, `MOYSKLAD_SYNC_ENABLED=true`, `MOYSKLAD_WRITE_ENABLED=false`.
- Write integration must not be enabled automatically during rollback.
- Old integration code is retained until final verify, smoke tests, and rollback window are complete.

## Step 14 Acceptance Gate

- Acceptance report is generated at `moysklad-acceptance-report.md`.
- Current gate must remain `not passed` until real audit, backup-confirmed backfill, verify, and smoke tests complete in the target environment.
- Static criteria already implemented: readiness docs, migrations, feature flags, local-backed read/write paths, admin-only manual sync UI, legacy field retention, and rollback plan.
- Live criteria still require evidence from `audit`, `backfill`, `verify`, and browser/API smoke tests with all runtime MoySklad flags disabled.

## Cutover Decision

Do not remove MoySklad credentials until:

1. `pnpm sync:moysklad:last-days --days=14 --mode=audit` has no unresolved conflicts.
2. `backfill` has run with a confirmed DB backup.
3. `verify` shows no critical missing/changed remote records.
4. Smoke tests pass with all four flags set to `false`.
