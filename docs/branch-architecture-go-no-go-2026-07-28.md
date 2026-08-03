# Branch architecture GO/NO-GO — 2026-07-28

## Итоговый статус: NO-GO

Кодовые и схемные блокеры, доступные без production, существенно закрыты. Production migration, создание Branch 2, изменение DNS/webhooks/integration sessions и любые операции с Railway запрещены. Production/Selectel/Railway в этой работе не изменялись.

## Машинные проверки

| область | результат | команда / evidence |
|---|---|---|
| Prisma model scope | 145 моделей: 11 GLOBAL, 6 GROUP, 128 BRANCH; blockers 0 | `npm run audit:branch-models` |
| Raw SQL | 230 обращений к branch tables; UNKNOWN 0; UNSAFE 0 | `npm run audit:branch-raw-sql`, `docs/branch-raw-sql-review.md` |
| Unique/PK | 247 constraints; blockers 0 | `npm run audit:branch-unique`, duplicate precheck SQL |
| Composite FK | 40 critical relations; blockers 0 | `npm run audit:branch-relations` |
| Integrations | 15 branch credential/context/mutation-guard checks; blockers 0 | `npm run audit:branch-integrations` |
| Files | 10 structural checks; blockers 0 | `npm run audit:branch-files` |
| Public token routes | 8 routes; blockers 0 | `npm run audit:branch-public-routes` |
| Exports | 9 implemented exports; blockers 0 | `npm run audit:branch-exports` |
| Branch policy | fail-closed unit/static tests pass | `npm run test:branch-isolation` |
| PostgreSQL two-branch matrix | **PASS** on PostgreSQL 18.4: 13 DB assertions, 8 direct FK attacks blocked, application policy matrix passed, rollback confirmed | `docs/branch-security-postgres-result-2026-07-28.md` |

## Git repository health

The repository was independently backed up before repair. All 16,907
AppleDouble metadata files were classified and removed only after backup and
signature/counterpart verification. `git fsck --full` and `git diff --check`
exit 0; there are no missing/corrupt/bad-SHA findings. The full evidence is in
`docs/git-recovery-report-2026-07-28.md`. Pre-existing modified and untracked
working-tree files were preserved.

## Raw SQL progress

Все найденные текущим AST-аудитом обращения к филиальным таблицам классифицированы. Branch queries используют параметризованный `branch_id`, проверенный parent join или разрешённый group/all-branches read scope. CI strict mode не допускает новый UNKNOWN/UNSAFE call. Число 230 — текущий набор после удаления/переписывания вызовов и добавления четырёх read-only MIGRATION_ONLY manifest queries; исходный baseline 259 больше не является актуальным количеством call sites.

## Unique constraints progress

Внешние provider IDs, document numbers, idempotency keys, inventory/payroll/messenger/YCLIENTS/T-Bank/AI keys переведены в branch scope. Глобальными оставлены только технические UUID/CUID и высокоэнтропийные capability tokens с явным основанием. `deploy/selectel/branch-unique-duplicate-precheck.sql` обязан пройти до migration.

## Composite FK progress

Добавлены composite `(branch_id, parent_id) -> (branch_id, id)` связи для shipment/client/store/product, payroll period, messenger account/conversation/message/outbox/media, diagnostics/photos, inventory session/line/attachment/ledger, product photos и stock balances. Миграции сначала останавливаются на cross-branch precheck; durable references используют RESTRICT, owned children — CASCADE.

## Integration credentials progress

- YCLIENTS: config/credential resolution только из активного branch; cache user token разделён по branch; `company_id` нельзя подменить; proxy требует session + active branch; legacy interactive token выдача отключена.
- МойСклад: request runtime использует только branch credential; mutation guard действует в rehearsal; unknown/non-owned local entity не получает default Branch 1.
- ROSSKO: credentials, delivery/address/markup config выбираются по branch; checkout блокируется отдельными supplier/ROSSKO rehearsal flags.
- Employee Telegram: connection/link/session/account resolution использует branch + employee/account; raw SQL audit не оставляет unscoped lookup.
- Отсутствующая настройка даёт explicit `IntegrationNotConfiguredForBranch`; fallback на Branch 1/global provider env в `src/` отсутствует.

## File audit

Новые messenger и diagnostic keys/paths начинаются с `branches/{branchId}/...`. Messenger content/thumbnail/avatar выдаются только через authenticated branch proxy; permanent public object URL из file routes удалён. Private diagnostic/MoySklad image GET routes устанавливают verified tenant. Product photos получили composite branch FK. Legacy physical move не выполнялся; подготовлен read-only dry-run generator `scripts/build-branch-file-migration-manifest.mjs`.

## Public report audit

Public UUID/CUID token связывает ровно один report entity; child photo routes дополнительно проверяют parent token relation и не используют activeBranch cookie. Публичный map payload очищен от internal session/demand/client IDs, client phone, sender/upload actor и CRM action IDs. Classic reminder mutation после token lookup выполняется внутри tenant, построенного из `diagnostic.branchId`.

## Export audit

Все существующие data exports — SINGLE_BRANCH synchronous streams; template — GLOBAL_SAFE. Multi-branch export endpoints отсутствуют. В режиме all-branches scoped DB требует явный набор разрешённых branch IDs и блокирует mutations. Будущий retained multi-branch job обязан сохранять permission snapshot и проверять `branches.export_clients`, `branches.export_finances`, `branches.export_payroll` или `branches.export_messages`.

## Security matrix readiness

`scripts/test-branch-security-db.mjs` фактически запущен на изолированном
PostgreSQL 18.4 (`127.0.0.1:55432`, `eco_branch_security`). Current Prisma
schema was pushed into the empty synthetic database; 13 DB assertions and the
application policy matrix passed, 8 direct cross-branch FK attacks were
blocked, and synthetic data rolled back to zero rows.

The historical migration chain cannot bootstrap a completely empty database:
`20260528150000_crm_client_cases` expects the production-baseline table
`crm_deals`. This does not invalidate the schema security result, but reinforces
that the real migration chain must be proven on a canonical production copy.
Full HTTP/browser E2E and the post-migration copy matrix remain pending.

## Selectel rehearsal readiness

Подготовлены:

- `deploy/selectel/.env.branch-rehearsal.template` со всеми side effects false;
- `deploy/selectel/prepare-branch-rehearsal.sh`, который принимает только готовый approved backup и пустую rehearsal DB;
- migration preflight, duplicate precheck и post-migration verification SQL;
- file legacy manifest dry-run;
- `deploy/selectel/BRANCH_ROLLBACK_RUNBOOK.md`.

Production-copy rehearsal и restore rollback **не запускались**. RTO/RPO/downtime остаются UNKNOWN до фактического замера.

## Railway reconciliation dependency

`RAILWAY_SELECTEL_RECONCILIATION_STATUS` не подтверждён как `VERIFIED`. Fresh
read-only inventory shows both Railway web and `Postgres-BmbT` still have one
running replica, Git autodeploy remains connected, and the custom production
domain remains attached. The web-service database URL points to a different
legacy PostgreSQL 18.3 database (137 tables, 56 migrations, about 1,351 MB)
than the running `Postgres-BmbT` service (34 tables, no migration table).
Fresh table maxima include Railway writes on 2026-07-28 at approximately
13:28 UTC, so the database is demonstrably not frozen.
Details are recorded in `docs/railway-selectel-reconciliation-2026-07-28.md`.

## Остаточные блокеры GO

1. Railway → Selectel reconciliation не имеет статуса VERIFIED; Railway is not frozen.
2. Production-copy rehearsal Selectel не выполнена.
3. Post-migration HTTP/browser/security smoke matrix не выполнена.
4. Rollback restore rehearsal не выполнена; нет evidence с фактическим RTO/RPO.
5. Legacy file manifest/rehearsal не выполнены.
6. Before/after performance comparison не выполнено.
7. Owner has not confirmed a production maintenance window.

The final local `npm run branch:go-check`, supplied with the isolated
PostgreSQL URL, passed Prisma validate/generate, TypeScript, production build,
branch isolation, every code audit, and the PostgreSQL security matrix. It
returned **NO-GO with 11 operational/evidence blockers**: rehearsal preflight,
unverified reconciliation, missing reconciliation/production-copy/post-
migration/file/rollback/RTO-RPO/performance evidence, and no owner-confirmed
maintenance window. A successful build or synthetic database matrix never
grants GO by itself.
