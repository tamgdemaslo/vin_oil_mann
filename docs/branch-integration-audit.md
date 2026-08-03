# Аудит филиальной изоляции интеграций

Сгенерировано 2026-07-28. Runtime env/secret blockers: **0**; structural blockers: **0**.

| integration/path | file | status | evidence |
|---|---|---|---|
| YCLIENTS config | `src/lib/yclients/branch-config.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| YCLIENTS proxy auth | `src/app/api/yclients/route.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| YCLIENTS AI | `src/lib/ai-agent/yclients.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| YCLIENTS dashboard | `src/app/api/dashboard/operations/route.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| ROSSKO | `src/lib/rossko.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| MoySklad | `src/lib/moysklad.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| MoySklad rehearsal mutation guard | `src/lib/moysklad.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| YCLIENTS rehearsal mutation guard | `src/app/api/yclients/route.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| ROSSKO rehearsal order guard | `src/lib/rossko.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| T-Bank rehearsal mutation guard | `src/lib/tbank.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| Employee Telegram link | `src/lib/messenger/messenger-linking.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| Employee Telegram notification | `src/lib/messenger/messenger-employee-notifications.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| Legacy webhook | `src/app/api/messenger/webhook/telegram/route.ts` | DISABLED_410 | branch-addressed route required |
| Legacy webhook | `src/app/api/messenger/webhooks/telegram/route.ts` | DISABLED_410 | branch-addressed route required |
| Legacy webhook | `src/app/api/integrations/tbank/webhook/payment-status/route.ts` | DISABLED_410 | branch-addressed route required |

## Runtime credential scan

No YCLIENTS, ROSSKO, or MoySklad credential env fallback and no known hardcoded provider secret under `src/`.

## Maintenance-only scripts

The following scripts still accept operator-supplied MoySklad environment credentials. They are classified **ADMIN_ONLY**, are not imported by request runtime, and must not be used as a production fallback. Production execution requires a separate reviewed branch-aware migration/import procedure:

- `scripts/import-from-moysklad.mjs`
- `scripts/import-moysklad-motor-oil-photos.mjs`
- `scripts/list-product-attributes.mjs`
- `scripts/moysklad-attributes-uuid.mjs`
- `scripts/moysklad-oem-request.mjs`
- `scripts/sync-moysklad-last-days.mjs`
- `scripts/test-branch-production-guards.mjs`

Provider credentials are stored as encrypted `IntegrationCredential` rows selected by active `branchId` and organization. A missing row is an explicit not-configured state; no silent global fallback is permitted.
