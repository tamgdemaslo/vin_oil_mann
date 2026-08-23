# MANN technical catalog v2 — аудит актуального Timeweb backup

Дата проверки: 2026-08-23

## Решение

**Текущий статус: NO-GO для migration/materialization/runtime cutover.**

Блокер отсутствия актуального Timeweb snapshot снят. Остаются два обязательных блока:

1. Top-N измерен на legacy proxy, а не на независимом matcher golden/manual truth set.
2. Выборки 200 ACTIVE и 200 dangerous-system ACTIVE ожидают независимого ручного review.

## Проверенный backup

- файл: `backup_20260823_190344.sql`;
- начало создания: `2026-08-23T19:03:45Z`;
- размер: 2 253 111 822 байта;
- SHA-256: `44d907b23ea2a30ec20a1a41147f7ba0bc437c3815eaeff18a6026e4bddaa679`;
- PostgreSQL source: 18.4;
- локальное восстановление: PostgreSQL 18.4, отдельный временный кластер;
- audit role: `audit_reader`, только `SELECT`;
- `default_transaction_read_only=on`;
- размер восстановленной базы: 1 259 MB;
- последняя применённая production migration: `20260816120000_internal_booking_system`.

## Актуальный прогон

Алгоритмы: `mann-fluid-matcher-v2`, `capacity-parser-v2`.

Commit: `c69cd5b39c0295685f45f93079b16201e46e9931`.

| Метрика | Значение |
|---|---:|
| Requirements | 13 296 |
| MANN rows | 37 600 |
| MANN vehicle variants | 16 349 |
| Legacy links, evidence only | 5 723 |
| `CONFIRMED_SINGLE` | 3 087 |
| `CONFIRMED_MULTI_APPLICABILITY` | 339 |
| `REVIEW_REQUIRED` | 1 962 |
| `CONFLICT` | 4 170 |
| `NO_MATCH` | 2 210 |
| `MANN_CATALOG_GAP` | 1 238 |
| `INSUFFICIENT_SOURCE_CONTEXT` | 290 |
| Associations after semantic dedupe | 3 803 |
| ACTIVE | 3 764 |
| REVIEW | 39 |
| Vehicles with ACTIVE profile | 666 |
| Review queue | 9 870 requirements / 9 197 groups |

Parser audit также совпал с frozen baseline: 13 521 capacity tokens, 85 parser-review requirements и 0 horsepower tokens, ошибочно распознанных как литры.

## Сравнение с frozen baseline

Результат: `IDENTICAL_DOMAIN_RESULTS`.

- summary scope/classification/system/materialization/coverage/review sections совпадают;
- 3 803 association fingerprints совпадают;
- added associations: 0;
- removed associations: 0;
- changed associations: 0;
- полный decision trace из 13 296 строк имеет одинаковый SHA-256 `a94a8e84897ee0735a46f47925ecd3b60f5301f28c77ced34d1287e01649bfd6`;
- `coverage.csv`, `review-queue.csv` и retrieval proxy побайтно совпадают.

Машинная проверка: `PASS_WITH_NO_GO_GATES_PRESERVED`.

## Следующий шаг

Подготовить экспертный review package:

1. 200 ACTIVE associations;
2. 200 ACTIVE associations опасных систем;
3. независимый matcher golden set с правильным MANN `vehicleVariantKey` и допустимыми multi-applicability cases;
4. зафиксированные решения reviewer с причиной и исправленным target/condition при необходимости.

После review нужно повторить dry-run на том же алгоритме или его новой версии и только затем пересматривать NO-GO.

## Артефакты

Каталог: `outputs/mann-technical-catalog-v2-timeweb-backup-20260823-190344/`.

- `mann-technical-materialization-summary.json`;
- `mann-technical-materialization-preview.json`;
- `mann-technical-requirement-decisions.ndjson`;
- `capacity-parser-audit.json`;
- `preview-invariant-check.json`;
- `frozen-comparison.json`;
- `active-association-sample-200.json`;
- `dangerous-systems-review.json`;
- `review-queue.csv`.

Production Timeweb PostgreSQL, schema, runtime, API, UI, AI и deploy во время аудита не изменялись.
