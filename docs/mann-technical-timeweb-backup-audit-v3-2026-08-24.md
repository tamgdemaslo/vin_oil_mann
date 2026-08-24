# MANN technical catalog v3 — повторный аудит Timeweb backup

Дата проверки: 2026-08-24

## Решение

**NO-GO на Prisma migration, materialization и runtime cutover.**

Новый matcher устранил опасные автоматические связи из проверенной риск-выборки, но стал намеренно консервативным. Это безопасная промежуточная версия, а не основание включать объединённый каталог в production.

| Главная метрика | Результат |
|---|---:|
| OLD SAFE COVERAGE | 279 / 16 349 MANN variants |
| NEW SAFE PREVIEW | 458 / 16 349 MANN variants |
| Requirements | 13 296 |
| `CONFIRMED_SINGLE` | 965 |
| `CONFIRMED_MULTI_APPLICABILITY` | 143 |
| `REVIEW_REQUIRED` | 4 652 |
| `NO_MATCH` | 2 121 |
| `CONFLICT` | 3 698 |
| `MANN_CATALOG_GAP` | 1 427 |
| `INSUFFICIENT_SOURCE_CONTEXT` | 290 |
| Parser suspicious before | 340+ |
| Parser suspicious after | 85 |

## Проверенный источник

- backup: `backup_20260823_190344.sql`;
- начало создания: `2026-08-23T19:03:45Z`;
- SHA-256: `44d907b23ea2a30ec20a1a41147f7ba0bc437c3815eaeff18a6026e4bddaa679`;
- локальная база: PostgreSQL 18.4;
- отдельная роль: `audit_reader`;
- `default_transaction_read_only=on`;
- requirements: 13 296;
- MANN rows: 37 600;
- MANN variants: 16 349;
- исторические links прочитаны только как evidence: 5 723;
- production DB, schema, runtime, API, UI и deploy не изменялись.

## Версии и воспроизводимость

- matcher: `mann-fluid-matcher-v3`;
- capacity parser: `capacity-parser-v2`;
- commit: `d217d2ec11ecf0ccc2903f3aac293bd0f2ccd5cb`;
- полный decision trace: 13 296 / 13 296;
- повторный dry-run выполнен после фиксации commit;
- итоговая invariant-проверка: `PASS_WITH_NO_GO_GATES_PRESERVED`.

## Что исправлено в v3

1. MANN filter application больше не считается доказательством модели коробки или агрегата.
2. Для AT/CVT/DSG/МКПП требуется подтверждение типа или component model в MANN vehicle context.
3. Для раздатки и AWD-агрегатов требуется подтверждение привода или component model.
4. Несколько component/capacity alternatives не превращаются в один технический факт.
5. Явно указанное поколение или кузов нельзя подтвердить только совпадением года.
6. Тормозная жидкость оценивается на уровне автомобиля и не получает ложный конфликт из-за engine-specific MANN rows.
7. PDF-contamination вида `266 2.54WD +++ For our complete` очищается до реального vehicle text.
8. Semantic fingerprint теперь сохраняет year, engine codes, transmission, drive и component applicability.
9. В preview association добавлен нормализованный applicability context.
10. Добавлен независимый safety truth-set из 30 рискованных исторических связей и потоковый scorer.

## Safety truth-set

Ручная проверка 30 рискованных связей дала:

- 3 `APPROVE`;
- 13 `REJECT`;
- 14 `REVIEW`.

Старый v2 автоматически активировал 9 случаев, из которых 7 были опасными false positive. Новый v3 не активировал ни одного из 27 запрещённых/неоднозначных случаев.

| Метрика truth-set | v2 | v3 |
|---|---:|---:|
| False positive | 7 | 0 |
| True positive | 2 | 0 |
| False negative | 1 | 3 |
| Safety gate | FAIL | PASS |

`PASS` означает только отсутствие false positive на этой риск-выборке. Recall v3 равен 0/3, поэтому truth-set не является основанием для GO.

## Главная системная причина

Каталог MANN описывает применяемость фильтров к двигателю/автомобилю, но обычно не содержит доказательств конкретной коробки передач, раздатки или её заправочного объёма.

Поэтому цепочка:

`совпал двигатель MANN → значит подтверждена жидкость конкретной АКПП/CVT/DSG`

небезопасна. Именно она создавала старые ложные связи. В v3 все transmission requirements остаются вне автоматической materialization, пока component/transmission condition не доказан отдельными данными или reviewer decision.

## Coverage по основным системам

| System | Confirmed single | Confirmed multi | Review | No match | Conflict |
|---|---:|---:|---:|---:|---:|
| ENGINE_OIL | 326 | 33 | 568 | 322 | 701 |
| ENGINE_COOLANT | 239 | 30 | 474 | 306 | 563 |
| BRAKE_FLUID | 30 | 29 | 1 051 | 220 | 91 |
| POWER_STEERING | 159 | 24 | 264 | 165 | 346 |
| AUTOMATIC_TRANSMISSION | 0 | 0 | 564 | 191 | 400 |
| MANUAL_TRANSMISSION | 0 | 0 | 524 | 128 | 303 |
| CVT_TRANSMISSION | 0 | 0 | 144 | 99 | 155 |
| ROBOT_TRANSMISSION | 0 | 0 | 80 | 14 | 71 |
| TRANSFER_CASE | 0 | 0 | 283 | 148 | 220 |
| FRONT_DIFFERENTIAL | 55 | 6 | 83 | 63 | 134 |
| REAR_DIFFERENTIAL | 103 | 20 | 307 | 221 | 379 |
| AWD_COUPLING | 0 | 0 | 42 | 1 | 29 |

## Future materialization preview

- associations before semantic dedupe: 1 317;
- after semantic dedupe: 1 308;
- proposed `ACTIVE`: 1 299;
- proposed `REVIEW`: 9;
- exact duplicates collapsed: 9;
- capacity conflict groups: 1;
- conditional alternative groups: 9;
- parser-review associations: 7;
- legitimate confirmed multi-applicability requirements: 143;
- vehicle coverage: 458 variants, +179 к старому safe baseline;
- transmission coverage: 0;
- core profile coverage: 0.

Review queue выросла до 12 188 requirements / 11 353 groups. Это не регресс безопасности: v2 уменьшал очередь за счёт неподтверждённых автоматических связей. Сжимать очередь дальше можно только дополнительными источниками applicability или зафиксированными reviewer decisions.

## Capacity parser

- parsed capacity tokens: 13 521;
- tolerance tokens: 467;
- range tokens: 622;
- rejected horsepower tokens: 9;
- requirements requiring parser review: 85;
- horsepower tokens parsed as litres: 0;
- golden regression set: 200 реальных строк, PASS.

## Выполненные проверки

- `test:mann-fluid-matcher-v2` — PASS для matcher v3;
- `test:mann-vehicle-resolver` — PASS;
- `test:fluid-capacity-parser` — PASS;
- TypeScript `tsc --noEmit` — PASS;
- full read-only dry-run — PASS;
- capacity audit — PASS;
- 30-case safety truth scorer — PASS по false-positive gate;
- preview invariant verifier — PASS;
- database write mode — запрещён и не использовался.

## Оставшиеся блокеры

1. Нет независимого retrieval/ranking golden set с правильными `vehicleVariantKey`; Top-1/3/20 пока измерены только на legacy proxy.
2. 200 future ACTIVE associations ещё не прошли независимый ручной review.
3. 200 ACTIVE associations опасных систем ещё не прошли независимый ручной review.
4. Три подтверждённых truth cases остаются false negative и требуют безопасного reviewer override/applicability design, а не ослабления общих правил.
5. Transmission coverage равен нулю: нужен отдельный источник gearbox applicability или condition registry.

## Следующий этап

1. Проверить 200 `active-association-sample-200.json`.
2. Проверить 200 `dangerous-systems-review.json`.
3. Зафиксировать reviewer decisions отдельно от matcher truth-set.
4. Создать независимый retrieval golden set с корректным MANN target и допустимыми multi-target cases.
5. Повторить dry-run и только после этого принимать решение о Prisma migration proposal.

Migration proposal готов: **нет**.

GO/NO-GO на создание unified schema: **NO-GO**.

## Артефакты

Каталог: `outputs/mann-technical-catalog-v3-timeweb-backup-20260823-190344/`.

- `mann-technical-materialization-summary.json`;
- `mann-technical-materialization-preview.json`;
- `mann-technical-requirement-decisions.ndjson`;
- `mann-fluid-review-truth-score.json`;
- `capacity-parser-audit.json`;
- `preview-invariant-check.json`;
- `active-association-sample-200.json`;
- `dangerous-systems-review.json`;
- `review-queue.csv`.
