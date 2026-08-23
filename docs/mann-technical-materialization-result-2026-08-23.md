# MANN technical catalog v2 — итог dry-run

Дата: 2026-08-23
Алгоритмы: `mann-fluid-matcher-v2`, `capacity-parser-v2`
Источник: локально восстановленный frozen archive `railway-final-frozen-backup-2026-08-02-codex-019fb41a`
Режим: только read-only audit и локальные артефакты; schema, migration, runtime, API, UI, AI и deploy не менялись.

## Первая страница: решение и ключевые метрики

**Решение: NO-GO для migration/materialization/runtime cutover.**

| Метрика | Результат |
|---|---:|
| Уникальные MANN `vehicleVariantKey` | 16 349 |
| Требования технических жидкостей | 13 296 |
| `CONFIRMED_SINGLE` | 3 087 |
| `CONFIRMED_MULTI_APPLICABILITY` | 339 |
| `REVIEW_REQUIRED` | 1 962 |
| `CONFLICT` | 4 170 |
| `NO_MATCH` | 2 210 |
| `MANN_CATALOG_GAP` | 1 238 |
| `INSUFFICIENT_SOURCE_CONTEXT` | 290 |
| Предлагаемые associations до semantic dedupe | 3 886 |
| После semantic dedupe | 3 803 |
| **ACTIVE preview associations** | **3 764** |
| REVIEW preview associations | 39 |
| Vehicles с ACTIVE technical profile | **666** |
| Старый безопасный unique-target baseline | 279 vehicles |
| Изменение покрытия | **+387; ×2,387** |
| Retrieval Top-1 / Top-3 / Top-20 | 89,5% / 99,0% / 100% на 200 legacy proxy cases |
| Review queue | 9 870 requirements / 9 197 grouped tasks |
| Приоритеты queue | P0 3 804; P1 1 989; P2 3 150; P3 254 |

Top-N выше — **не golden accuracy**. Это диагностика на детерминированной выборке из 200 старых HIGH unique-target links, которые не использовались matcher как истина. Независимый matcher golden/manual truth set пока отсутствует.

NO-GO сохраняется по трём независимым причинам:

1. нет актуального backup/read-only audit текущей Timeweb PostgreSQL;
2. matcher Top-N ещё не измерен на независимом golden/manual truth set;
3. подготовленные выборки 200 ACTIVE и 200 dangerous-system ACTIVE ожидают независимого ручного review.

## Capacity parser v2

Полный прогон по 13 296 requirements:

| Метрика | Значение |
|---|---:|
| Requirements с source text | 12 895 |
| Requirements с распознанным объёмом | 11 910 |
| Parsed capacity tokens | 13 521 |
| Exact | 12 332 |
| Range | 622 |
| Tolerance `±` | 467 |
| Approximate | 94 |
| Up-to | 6 |
| Отклонённые horsepower tokens | 9 в 5 requirements |
| Horsepower tokens, ошибочно ставшие литрами | **0** |
| Parser review | 85 requirements |
| Unresolved conditional capacity | 84 |
| Plausibility anomaly | 1 |

Структура каждого результата содержит `kind`, `minLiters`, `maxLiters`, `nominalLiters`, `toleranceLiters`, `context`, `confidence`, `raw` и qualifier. Kind-marker выбирается по suffix/prefix сегменту конкретного numeric token, поэтому `WITH_FILTER`, `WITHOUT_FILTER`, `PARTIAL`, `TOTAL`, `DRY_FILL`, `REFILL` не смешиваются с соседними значениями.

Conditional values вроде 2WD/4WD, разных годов, заднего отопителя или разных трансмиссий сохраняются как отдельные values с context. Если один source requirement содержит взаимоисключающие значения одного kind, он получает `UNRESOLVED_CONDITIONAL_CAPACITY` и не может стать ACTIVE до структурирования условия.

Golden fixture содержит 200 distinct реальных `fillVolumeText`: 78 multi-capacity, 37 range, 35 tolerance, 20 filter-context, 10 uncertainty, 5 horsepower и другие классы. Независимые hand-authored regression assertions проверяют пробел после `±`, decimal comma/dot, range separators, Russian liter words, `лс`/`л.с.`/`л. с.`, filter contexts, partial/total/refill, Latin component codes и source-specific lexicon.

## Matcher v2

Matcher повторно оценил все 13 296 requirements. Старые `MannFluidRequirementLink` прочитаны только после новых решений и сохранены как `legacyLinkEvidence`; `legacyEvidenceUsedForDecision=false` в trace.

Использованы общие production primitives:

- `normalizeDecodedVehicleForTest` и общая vehicle normalization;
- тот же MANN make retrieval/model similarity;
- тот же candidate scorer и negative evidence для engine, displacement, power, fuel, generation/body/year, transmission и drive;
- та же semantic consolidation одинаковых MANN variants.

Поверх production resolver добавлена только офлайн system-aware policy:

- каждый target `vehicleVariantKey` повторно валидируется независимо;
- фактические mismatches становятся hard conflicts;
- неподтверждённые MANN conditions блокируют ACTIVE, но классифицируются как review blocker, а не conflict;
- близкие неэквивалентные candidates остаются `REVIEW_REQUIRED` без targets;
- multi-applicability разрешается только для независимо валидированных эквивалентных targets;
- Top-20 diagnostics сохраняются для каждого requirement.

Основные причины 4 162 matcher conflicts до materialization-level capacity conflicts: базовая модель 1 069, body code 955, power 746, engine code 744, generation 737, year 604, displacement 263, non-overlapping years 129, fuel 78. Ещё 8 requirements стали `CONFLICT` на materialization-level в трёх группах взаимоисключающих cross-source capacities.

Review причины до materialization post-pass:

- strict system-aware policy без достаточного безопасного подтверждения — 1 241;
- близкие неэквивалентные targets — 474;
- рядом с допустимой целью есть близкий/сильный противоречивый candidate — 226;
- unverified MANN condition встречается в Top-3 review candidates 1 006 раз.

## Materialization preview

Semantic fingerprint включает target variant, system, normalized component model, structured capacities, specifications, viscosity, recommendation и service interval. В результате 83 exact semantic duplicates схлопнуты без потери списка source requirement/row IDs.

Результаты conflict analysis:

- 3 cross-source capacity conflict groups оставлены в REVIEW;
- 33 associations заблокированы parser review;
- 104 группы component/transmission alternatives признаны условными alternatives, а не conflicts;
- 232 ACTIVE associations сохраняют явный маркер `CONDITIONAL_COMPONENT_ALTERNATIVE_NOT_CONFLICT` и отдельный `componentModel`.

Field-level confidence среди 3 764 ACTIVE:

| Поле | HIGH | MEDIUM | LOW | NONE |
|---|---:|---:|---:|---:|
| Vehicle applicability | 3 764 | 0 | 0 | 0 |
| Capacity | 3 577 | 22 | 0 | 165 |
| Specification | 2 852 | 912 | 0 | 0 |
| Component model | 0 | 1 173 | 13 | 2 578 |

Capacity `NONE` не удаляет association: в этих случаях source может содержать спецификацию/рекомендацию без числового объёма. Component model остаётся source-only conditional evidence и не повышается до HIGH, потому что MANN его не подтверждает.

Vehicle feature coverage среди 666 ACTIVE variants:

| Профиль | Vehicles |
|---|---:|
| Engine oil | 615 |
| Transmission | 501 |
| Drivetrain | 287 |
| Coolant | 490 |
| Brake fluid | 535 |
| Core: oil + transmission + coolant + brake | 476 |

## Safety invariants

`verify:mann-technical-preview` подтвердил:

- classification sum и decision trace равны 13 296;
- 3 803 semantic fingerprints уникальны;
- все 3 764 ACTIVE targets independently validated, без hard conflicts и review blockers;
- ни одна parser-review association не ACTIVE;
- ACTIVE sample содержит 200 distinct ACTIVE rows;
- dangerous sample содержит 200 ACTIVE rows соответствующих систем;
- golden capacity set содержит 200 distinct source texts;
- `л.с.` никогда не интерпретируется как литры;
- preview помечен `DRY_RUN_ONLY`, source transaction — read-only;
- отсутствие current Timeweb audit сохраняет `NO_GO`.

## Локальные артефакты

Каталог: `outputs/mann-technical-catalog-v2-frozen-2026-08-23/`.

- `mann-technical-materialization-preview.json` — 3 803 future associations, ACTIVE/REVIEW, technical payload и provenance;
- `mann-technical-materialization-summary.json` — итоговые counts и gates;
- `mann-technical-requirement-decisions.ndjson` — 13 296 полных decisions с Top-20;
- `coverage.json`, `coverage.csv` — requirement/system/vehicle coverage;
- `review-queue.json`, `review-queue.csv` — raw и grouped P0–P3 queue;
- `active-association-sample-200.json` — стратифицированная ACTIVE выборка;
- `dangerous-systems-review.json` — стратифицированная dangerous-system ACTIVE выборка;
- `retrieval-legacy-proxy.json` — Top-N proxy, не truth set;
- `capacity-parser-audit.json` — полный parser audit;
- `preview-invariant-check.json` — машинная проверка инвариантов.

## Что сознательно не сделано

- нет Prisma schema edits и migration files;
- нет materialization/backfill в PostgreSQL;
- нет удаления/замены source rows или старых links;
- нет runtime/API/UI/AI cutover;
- нет deploy;
- текущая Timeweb PostgreSQL не открывалась и не изменялась;
- manual-review samples не отмечены как проверенные без независимого человека.
