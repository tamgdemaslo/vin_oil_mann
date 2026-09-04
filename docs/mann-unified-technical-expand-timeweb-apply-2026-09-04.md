# Timeweb apply: MANN unified technical catalog expand

Дата применения: 2026-09-04 19:28 Europe/Kaliningrad
Окружение: Timeweb production, база `vin_oil`, схема `public`
Режим: expand-only, без backfill, staging-данных и runtime cutover

## Исходная миграция

- migration: `20260902400000_mann_unified_technical_catalog_expand`;
- source commit: `b6643f7582ab855fd27ebba6e0be9ad33738c9b8`;
- SHA-256: `0ded8fba9d14ef93f499fdee2b634ad88ff39812d0394df74e767895a7590122`;
- migration file: `prisma/migrations/20260902400000_mann_unified_technical_catalog_expand/migration.sql`.

Перед операцией был создан и проверен ручной физический backup Timeweb от
2026-09-02 21:18 Europe/Kaliningrad.

## Preflight

- `npm run check:timeweb-only`: PASS;
- `npm run test:mann-unified-technical-expand`: PASS;
- рабочая база подтверждена как `vin_oil`;
- предыдущая применённая миграция: `20260902300000_branch_sales_plans`;
- целевая миграция и четыре целевые таблицы отсутствовали;
- таблиц в `public` до операции: 167;
- `mann_filter_applications`: 37 600 строк;
- `vehicle_fluid_requirements`: 13 296 строк;
- `fluid_source_rows`: 13 287 строк;
- пользователь обслуживания имел `CREATE` в `public` и `INSERT` в
  `_prisma_migrations`.

## Применение

DDL и запись в `_prisma_migrations` выполнены одной транзакцией под advisory
lock, с `lock_timeout = 5s`, `statement_timeout = 60s` и остановкой Adminer при
первой ошибке. Любая ошибка должна была откатить и DDL, и migration journal.

Созданы только:

- `mann_vehicle_variants`;
- `mann_technical_materialization_runs`;
- `mann_technical_association_revisions`;
- `mann_technical_review_decisions`.

## Проверка после применения

- таблиц в `public`: 171;
- все четыре новые таблицы существуют;
- во всех четырёх новых таблицах: 0 строк;
- индексов новых таблиц: 16;
- ограничений PostgreSQL новых таблиц: 84, включая автоматически
  представленные `NOT NULL` constraints;
- невалидированных ограничений: 0;
- запись migration journal: ровно 1, checksum совпадает, `finished_at` заполнен,
  `rolled_back_at` пуст, `applied_steps_count = 1`;
- `mann_filter_applications`: 37 600 строк, без изменения;
- `vehicle_fluid_requirements`: 13 296 строк, без изменения;
- `fluid_source_rows`: 13 287 строк, без изменения;
- `GET /api/health/ready`: HTTP 200, config/database/migrations/appData — `ok`.

Staging-материализация, импорт связей и переключение runtime не выполнялись.
Действующий `NO_GO` на публикацию непроверенных технических значений сохранён.
