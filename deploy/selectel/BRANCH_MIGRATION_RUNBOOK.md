# Runbook: миграция Branch 1 на Selectel

Эта процедура выполняется только после закрытия блокеров из `docs/branch-architecture-audit-2026-07-28.md`. Она не создаёт Branch 2.

## 1. Preconditions

- `RAILWAY_SELECTEL_RECONCILIATION_STATUS=VERIFIED`. Любое другое значение означает немедленный NO-GO.
- `DATABASE_URL` указывает на Selectel PostgreSQL и не содержит `railway`/Railway hostname.
- Есть свежий `pg_dump`, проверенный пробным restore в изолированную Selectel БД.
- Пройдены `npm run test:branch-isolation`, `npx prisma validate`, `npx tsc --noEmit`, `npm run build`.
- Остановлены application writes, cron и workers на время backfill.
- Назначены ответственный за миграцию и rollback owner.
- Для rehearsal заданы `APP_ENV=branch-migration-rehearsal`, `DEPLOYMENT_PROVIDER=selectel-rehearsal` и все side-effect flags из `scripts/branch-migration-preflight.mjs` равны `false`, включая YCLIENTS/MoySklad/ROSSKO mutations.
- `npm run migration:branch:preflight` завершён успешно.
- `BRANCH_CREATION_ENABLED=false` до отдельного итогового решения GO для Branch 2.

Если URL указывает на Railway, миграцию прекратить. Railway разрешён только для документированного read-only аудита/backup/decommissioning.

## 2. Dry run на копии Selectel

1. Восстановить утверждённый backup в отдельную пустую тестовую БД Selectel через `deploy/selectel/prepare-branch-rehearsal.sh`; скрипт не создаёт dump и не подключается к Railway.
2. Подставить URL тестовой БД локально, не коммитить секрет.
3. Выполнить `npx prisma migrate deploy`.
4. Проверить, что существует ровно одна `business_groups` запись и `branch-main`.
5. Проверить, что у каждой мигрированной операционной таблицы `branch_id = 'branch-main'` и нет `NULL`.
   Использовать read-only набор `deploy/selectel/branch-post-migration-verification.sql`.
6. Проверить FK, composite unique indexes и один открытый cash shift на филиал.
7. Войти каждым текущим аккаунтом и проверить memberships.
8. Выполнить двухфилиальные security-тесты на синтетическом Branch 2.
9. Удалить только тестовую БД после сохранения протокола; production и Railway не менять.
10. Выполнить `deploy/selectel/BRANCH_ROLLBACK_RUNBOOK.md` на отдельной rollback rehearsal DB и сохранить фактические restore/RTO/RPO timings.

## 3. Production change

1. Включить maintenance/read-only окно.
2. Остановить web workers, messenger media worker и cron.
3. Сделать и проверить финальный Selectel backup.
4. Ещё раз проверить hostname `DATABASE_URL`.
5. Выполнить `npx prisma migrate deploy` в текущем Selectel release-контуре.
6. Запустить SQL-проверки из dry run.
7. Запустить приложение, но оставить Branch 2 выключенным.
8. Выполнить smoke tests: login, branch selector, клиенты, товары, остатки, отгрузка, касса, смена, CRM, AI read.
9. Возобновить cron/workers только после проверки их branch payload/config.

## 4. Rollback

Миграция добавляет обязательные поля и новые индексы, поэтому rollback выполняется восстановлением проверенного Selectel backup в новый экземпляр/БД и переключением приложения по утверждённой Selectel процедуре. Не удалять таблицы и не изменять Railway.

## 5. Go/no-go для Branch 2

Branch 2 можно создать только после 100% прохождения security-набора, подтверждения файлов/exports/workers/messenger и минимум одного полного рабочего цикла Branch 1 после миграции. Только после этого в Selectel release environment допускается установить `BRANCH_CREATION_ENABLED=true`; изменение должно проходить как отдельная контролируемая операция с записью в журнале миграции.
