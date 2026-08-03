# MoySklad cutover acceptance report

Generated: 2026-05-31T19:59:48.184Z

## Decision

- Acceptance: not passed.
- Cutover ready: no.
- Last sync report mode: `verify`.
- Period: last 7 days.

## Blocking Items

- Для import supplies/writeoffs нужен проверенный transformer/upsert; legacy-поля уже nullable и не блокируют локальную работу
- Для import supplier invoices нужна проверка связей с приёмками/оплатами; legacy-поля уже nullable
- Для import payments нужна проверка связи с локальным счётом/кассовым документом; legacy-поля уже nullable
- Есть записи для ручной проверки: 18.

## Acceptance Criteria

| Scenario | Status | Evidence | Next action |
| --- | --- | --- | --- |
| 1 — Аудит | Implemented, evidence pending | `moysklad-last-days-sync-dry-run.json` содержит сравнение за период; mode=`verify`. | Для отдельного audit evidence сохранить артефакт после `--mode=audit`. |
| 2 — Readiness | Passed | `local-db-readiness-report.md`, `moysklad-dependency-audit.md`, legacy migration and nullable fields are present. | Перед production backfill применить миграции и повторить readiness-check на целевой БД. |
| 3 — Backfill | Blocked | Backfill не запускался или backup не подтверждён; `--backup-confirmed` / `LOCAL_DB_BACKUP_CONFIRMED=1` обязателен. | После backup запустить `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=backfill --backup-confirmed`. |
| 4 — Verify | Blocked | Финальный verify после backfill не выполнен или остались расхождения. | Запустить `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=verify` и проверить final report. |
| 5 — Отключение | Partial | Write/read flags and local-backed runtime paths are implemented; `MOYSKLAD_WRITE_ENABLED=false` by default. Runtime smoke is still pending in this environment. | После verify прогнать smoke с `MOYSKLAD_ENABLED=false`, `MOYSKLAD_READ_ENABLED=false`, `MOYSKLAD_WRITE_ENABLED=false`, `MOYSKLAD_SYNC_ENABLED=false`. |
| 6 — UI | Passed | Main UX sync/debug/raw legacy controls removed; manual sync is owner/admin-only at `/cabinet/integrations`. | Проверить визуально после восстановления local Next build/dev environment. |
| 7 — Бизнес-сценарии | Implemented, evidence pending | Shipment, warehouse, cash, supplier invoice, CRM and analytics paths are local-backed in code; full browser smoke is pending. | Пройти сценарии операций, склада, финансов, CRM and кабинет на целевой среде. |

## Required Production Gate

Before declaring the platform fully autonomous on local DB, complete this sequence in the target environment:

1. Confirm DB and env/config backups from `moysklad-rollback-plan.md`.
2. Run `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=audit`.
3. Resolve `conflicts` and `needsManualReview` or document blockers.
4. Run `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=backfill --backup-confirmed`.
5. Run `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=verify`.
6. Run smoke tests with all runtime MoySklad flags disabled.
7. Regenerate this report with `node scripts/sync-moysklad-last-days.mjs --days=14 --mode=report`.

## Evidence Files

- `moysklad-dependency-audit.md`
- `local-db-readiness-report.md`
- `moysklad-last-days-sync-dry-run.json`
- `moysklad-last-days-sync-dry-run.md`
- `moysklad-final-sync-report.md`
- `moysklad-rollback-plan.md`
- `moysklad-legacy-fields-retention.md`
