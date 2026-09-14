# Аудит филиальной изоляции интеграций

Сгенерировано 2026-08-06. Runtime env/secret blockers: **0**; structural blockers: **0**.

| integration/path | file | status | evidence |
|---|---|---|---|
| YCLIENTS config | `src/lib/yclients/branch-config.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| YCLIENTS proxy auth | `src/app/api/yclients/route.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| ROSSKO | `src/lib/rossko.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| AQSI | `src/lib/aqsi.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| AQSI durable fiscalization | `src/lib/aqsi-fiscalization.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| Telegram app identity and branch session | `src/lib/telegram-user-integration.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| Telegram QR branch/user scope | `src/lib/messenger/channels/telegram-user-session.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| Integration role policy | `src/lib/integration-access.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| Owner integration notifications | `src/lib/integration-owner-notifications.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| Owner integration activity | `src/app/api/integrations/activity/route.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| YCLIENTS rehearsal mutation guard | `src/app/api/yclients/route.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| ROSSKO rehearsal order guard | `src/lib/rossko.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| T-Bank rehearsal mutation guard | `src/lib/tbank.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| Employee Telegram link | `src/lib/messenger/messenger-linking.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| Employee Telegram notification | `src/lib/messenger/messenger-employee-notifications.ts` | BRANCH_SCOPED | required branch loader/guard markers present |
| Legacy webhook | `src/app/api/messenger/webhook/telegram/route.ts` | DISABLED_410 | branch-addressed route required |
| Legacy webhook | `src/app/api/messenger/webhooks/telegram/route.ts` | DISABLED_410 | branch-addressed route required |
| Legacy webhook | `src/app/api/integrations/tbank/webhook/payment-status/route.ts` | DISABLED_410 | branch-addressed route required |

## Runtime credential scan

No unapproved YCLIENTS, ROSSKO, AQSI or Telegram runtime credential fallback and no known hardcoded provider secret under `src/`. The shared Telegram MTProto app identity is an explicit backend-only exception; account sessions remain branch-scoped.

## Maintenance-only scripts

The following scripts are classified **ADMIN_ONLY**, are not imported by request runtime, and must not be used as a production fallback. Production execution requires a separate reviewed branch-aware procedure:

- `scripts/test-branch-production-guards.mjs`

Provider credentials are stored as encrypted `IntegrationCredential` rows selected by active `branchId` and organization. Telegram uses one backend-only MTProto application identity from Timeweb, while every authorized account session remains selected and encrypted by branch. Other providers do not permit a silent global fallback.
