# Аудит экспортов по филиалам

Сгенерировано 2026-07-28. Exports: **9**; blockers: **0**. Все реализованные выгрузки являются synchronous `SINGLE_BRANCH` (кроме безопасного пустого шаблона), поэтому permissions snapshot export-job пока неприменим: retained export jobs отсутствуют.

| export | file | scope | data class | authorization/source scope | status |
|---|---|---|---|---|---|
| Products XLSX | `src/app/api/products/export/route.ts` | SINGLE_BRANCH | products | server session + scoped DB/service | SCOPED |
| Product import result XLSX | `src/app/api/products/import/[jobId]/report/route.ts` | SINGLE_BRANCH | products | server session + scoped DB/service | SCOPED |
| Product template XLSX | `src/app/api/products/export-template/route.ts` | GLOBAL_SAFE | template | server session + scoped DB/service | SCOPED |
| Warehouse analytics CSV | `src/app/api/warehouse/analytics/_shared.ts` | SINGLE_BRANCH | inventory | server session + scoped DB/service | SCOPED |
| Inventory count CSV/HTML | `src/app/api/inventory/sessions/[...path]/route.ts` | SINGLE_BRANCH | inventory | server session + scoped DB/service | SCOPED |
| Job order XLS | `src/app/api/demands/[id]/job-order/route.ts` | SINGLE_BRANCH | clients+shipments | server session + scoped DB/service | SCOPED |
| Finance JSON/CSV source | `src/app/api/finance/[report]/route.ts` | SINGLE_BRANCH | finances | server session + scoped DB/service | SCOPED |
| Closing document PDF | `src/app/api/closing-documents/[id]/pdf/route.ts` | SINGLE_BRANCH | finances+shipments | server session + scoped DB/service | SCOPED |
| Demand closing PDF | `src/app/api/demands/[id]/closing-documents/pdf/route.ts` | SINGLE_BRANCH | finances+shipments | server session + scoped DB/service | SCOPED |

## All-branches policy

No current export accepts `scope=MULTI_BRANCH`. In all-branches mode the database policy requires explicit allowed branch IDs for reads and blocks every mutation. Personal-data multi-branch exports are therefore disabled, not implicitly granted to owners. Any future multi-branch export must add a retained permission snapshot and one of `branches.export_clients`, `branches.export_finances`, `branches.export_payroll`, or `branches.export_messages`.

Client-side finance CSV is derived only from the already server-scoped finance response; it cannot widen scope. ZIP, payroll, message, appointment, and client-list export endpoints are not implemented.
