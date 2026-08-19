# Госномер/VIN → TRONK → MANN → LocalProduct: поколение 2

Дата: 19 августа 2026 г.

Статус: Dataset D завершён как полноценный blind holdout. Manifest и алгоритм были заморожены до первого вызова TRONK, а raw result — до разметки. После этой оценки D становится development evidence; следующая настройка порогов потребует новый Dataset E.

## Первый экран

| Метрика | Frozen C baseline | После системных изменений на A/B/C | Delta |
|---|---:|---:|---:|
| TRONK usable decode | 70/100 = 70% | 78/100 = 78% | +8 п.п. |
| MANN Top-1, exact labels | 41/49 = 83,7% | 49/49 = 100% | +16,3 п.п. |
| MANN Top-3, exact labels | 42/49 = 85,7% | 49/49 = 100% | +14,3 п.п. |
| Top-20 retrieval recall | не измерялся | 49/49 = 100% | новая метрика |
| Dangerous HIGH errors | 1/11 = 9,1% | 0/9 = 0% | −9,1 п.п. |
| LocalProduct unique coverage | 20/95 = 21,1% | 21/95 = 22,1% на том же baseline scope | +1 товар / +1,0 п.п. |
| LocalProduct any-candidate coverage | 64/95 = 67,4% | 64/95 = 67,4% | без изменения |
| Strict end-to-end | 2/100 = 2% | 2/100 = 2% | локальный каталог остаётся bottleneck |

На расширившемся после исправления Top-1 scope C получено 115 корректных MANN-артикулов: 26 unique LocalProduct, 55 неоднозначных, 34 отсутствуют. Этот scope нельзя напрямую сравнивать с исходными 95 артикулами, поэтому delta выше дана на одинаковом baseline scope.

## Blind Dataset D: официальный результат

| Метрика | Результат |
|---|---:|
| TRONK usable decode | 90/100 = 90% |
| Complete / partial / failed decode | 69 / 21 / 10 |
| MANN catalog coverage среди decoded | 74/90 = 82,2% |
| Подтверждённые MANN data gaps | 16/90 = 17,8% |
| MANN Top-1, exact labels | 52/60 = 86,7% |
| MANN Top-3, exact labels | 58/60 = 96,7% |
| Top-20 retrieval recall | 59/60 = 98,3% |
| Automatic HIGH proposals | 12 |
| Dangerous automatic errors | 0/12 = 0% |
| Strict ambiguity handling | 11/14 = 78,6% |
| Strict data-gap/no-match handling | 12/16 = 75% |
| Correct Top-1 MANN filter precision / recall | 100% / 100% |
| Strict end-to-end с корректной OEM-семантикой | 37/100 = 37% |

Разметка была создана только после фиксации blind result: 60 однозначных `match`, 14 `ambiguous`, 16 `MANN_DATA_MISSING`, 10 `TRONK_MISSING_DATA`. Все 14 неоднозначных и все 16 data-gap cases были маршрутизированы без автоназначения; strict метрика ниже 100%, потому что часть безопасных manual outcomes попала в соседний класс `confirmation_required`, `ambiguous` или `no_match`.

Из восьми Top-1 ошибок шесть уже имеют правильный вариант в Top-3 и требуют общего исправления scoring. Ещё один вариант есть в Top-20, но теряется на model normalization/acceptance; один не попадает в Top-20 из-за make normalization/retrieval. Поэтому основной резерв качества — ranking и два ограниченных normalization gaps, а не расширение всех порогов.

## Три независимых слоя

### Layer A — TRONK decode coverage

У исходных 30 `TRONK_UNUSABLE_DECODE` нет таймаутов или сетевых ошибок:

| Исходный класс | Случаев | Primary | Fallback | Результат поколения 2 |
|---|---:|---|---|---|
| Госномер не преобразован в VIN, все plate fallback без данных | 22 | `number2vin`: no VIN | B2B/Gate: provider no data | остаётся `DECODE_FAILED / VIN_NOT_RESOLVED` |
| VIN получен, primary содержит марку без модели, extended без данных | 3 | `DECODE_MISSING_MODEL` | ранее plate fallback не вызывался | 3/3 восстановлены B2B/Gate |
| B2B/Gate вернули vehicle text, но parser потерял make/model | 5 | VIN отсутствует | данные были в fallback response | 5/5 восстановлены общей нормализацией |

Итого из исходных 30 отказов восстановлено 8, остаётся 22 подтверждённых provider no-data.

Введены:

- `complete / partial / insufficient` decode completeness;
- решения `PRIMARY_COMPLETE`, `PRIMARY_PARTIAL`, `FALLBACK_COMPLETE`, `FALLBACK_PARTIAL`, `FAILED`;
- отдельные failure codes без VIN/госномера в telemetry;
- short-circuit: complete primary не вызывает платные fallback;
- partial/failed VIN decode вызывает `vindecode2`, а plate lookup после неуспеха VIN продолжает B2B/Gate;
- безопасный cache остаётся разделённым по типу identifier и хранит только hash/masked input в открытых полях.

### Layer B — canonical vehicle → MANN vehicle

Исправлены общие классы, не testcase→ID mappings:

| Класс | Пример входного формата | Canonical/MANN format | Подтверждённый охват MANN snapshot | Почему общий |
|---|---|---|---:|---|
| Mixed Cyrillic/Latin homoglyphs | `СRUISЕR`, короткий `РТ` | `CRUISER`, `PT` | 133 строк CHRYSLER | нормализация алфавита внутри токена |
| Полные brand aliases | `МИНИ`, `DS`, aggregate Chevrolet | `MINI`, `DS AUTOMOBILES`, `CHEVROLET` | 196 MINI, 225 DS, 92+287 Chevrolet | alias описывает производителя целиком |
| Provider placeholders | `БЕЗ МОДЕЛИ …` | полезный хвост без placeholder | применяется ко всем make/model strings | удаляется provenance noise, не конкретная модель |
| Локализованный numeric series | `6 серии` | `6` | 1 581 numeric-series строк | структурное правило серии 1–8 |
| Chassis с несколькими suffix letters | `F07GT` | отдельный body/platform code | 278 model headings этого класса | расширенный parser body code |
| Model fallback by structured anchors | искажённый model text | bounded make pool + year/engine/body/power | только если model retrieval не дал кандидатов | не расширяет каждый запрос на весь каталог |
| Broad engine-family label | `NU` против точного `G4NA` | missing/weak, не hard contradiction | все короткие MANN engine labels | двухбуквенный family label не равен точному engine code |

Fuel parser различает `gasoline`, `diesel`, `BiFuel`, `LPG`, `CNG`, `HEV`, `PHEV`, `MHEV`, `EV`. Gasoline↔BiFuel/LPG/CNG является сильным negative evidence, но не hard reject. Hybrid compatibility помечается conditional и требует подтверждения.

Confidence теперь зависит от absolute score, margin Top-1/Top-2, сильных evidence и contradictions. HIGH требует model + powertrain anchor, score не ниже 78, gap не меньше 12 и отсутствие contradictions. На C dangerous gasoline/BiFuel auto false positive исчез.

Production policy до Dataset D: даже HIGH — только предложенный кандидат. Автоматически применяются только ранее сохранённые ручные подтверждения. MEDIUM/LOW требуют выбора пользователя.

### Layer C — MANN article → LocalProduct

Создан единый `normalizePartArticle()` с двумя представлениями:

- `structural` сохраняет значимый `/`;
- `compact` используется только для retrieval/fallback и не становится strong match без brand/cross-reference evidence.

Strong MANN key: `MANN|MANN-FILTER|MANN FILTER + structural article`. `MANNOL` и `DENCKERMANN` не считаются MANN. Для аналогов strong evidence даёт явный OEM cross-reference или `ProductMannLink`; одинаковый article другого производителя сам по себе остаётся `needs_review`.

Аудит исходных 95 article occurrences:

| Класс | Кол-во |
|---|---:|
| Активный явный OEM cross-reference аналога | 61 |
| Активный `ProductMannLink` | 1 |
| Активный MANN formatting variant | 2 |
| Реально отсутствует в доступном branch dump | 31 |

Неоднозначности: 42 occurrences имеют несколько аналогов с явным OEM cross-reference, ещё 1 — несколько strong products другого состава. Нельзя безопасно выбирать первый товар. В offline dump представлен один branch, поэтому наличие в другом branch доказать невозможно.

LocalProduct не создаётся автоматически при vehicle lookup. Если MANN‑фильтр есть, а товара нет, слой возвращает отдельный local-catalog status.

## End-to-end statuses и performance

Система различает:

- `DECODE_FAILED`;
- `VEHICLE_NO_MATCH`;
- `VEHICLE_AMBIGUOUS`;
- `VEHICLE_MATCHED_FILTERS_FOUND`;
- `FILTERS_FOUND_LOCAL_PRODUCTS_PARTIAL`;
- `FILTERS_FOUND_LOCAL_PRODUCTS_COMPLETE`.

Offline replay C после оптимизации (TRONK cache/replay, поэтому decode latency здесь не репрезентативна):

| Этап | p50 | p95 |
|---|---:|---:|
| MANN retrieval | 28,2 мс | 92,0 мс |
| MANN scoring | 1,0 мс | 8,7 мс |
| Filters | 1,6 мс | 2,5 мс |
| LocalProduct mapping | 155,9 мс | 311,8 мс |
| Offline product path total | 187,3 мс | 369,3 мс |

Live Dataset D, все 100 запросов:

| Этап | p50 | p95 | max |
|---|---:|---:|---:|
| TRONK decode | 1,895 с | 5,919 с | 26,495 с |
| MANN retrieval | 72,8 мс | 132,7 мс | 240,2 мс |
| MANN scoring | 2,4 мс | 12,0 мс | 21,8 мс |
| Filters | 2,2 мс | 11,2 мс | 16,6 мс |
| LocalProduct mapping | 163,8 мс | 314,8 мс | 392,7 мс |
| Live end-to-end total | 2,136 с | 6,257 с | 26,789 с |

У 10 неуспешных decode не было network/timeout failure: все десять завершили полную цепочку с `VIN_NOT_RESOLVED`, то есть провайдер не нашёл данные.

### LocalProduct на корректном Top-1 D

Для 52 корректно выбранных автомобилей получено 125 MANN article occurrences:

| Local status | Occurrences | Доля |
|---|---:|---:|
| Ровно один валидный LocalProduct | 24 | 19,2% |
| Несколько валидных аналогов | 80 | 64,0% |
| Только слабое review-evidence, не покрыто | 2 | 1,6% |
| Evidence отсутствует, не покрыто | 19 | 15,2% |
| OEM covered (`single + multiple`) | 104 | 83,2% |

Это 95 уникальных MANN-артикулов: 19 имеют один вариант, 57 — несколько валидных аналогов, 2 — только review-evidence, 17 полностью отсутствуют. Несколько OEM-подтверждённых товаров являются корректным ассортиментом, а не ambiguity. У 37 из 52 правильно сопоставленных автомобилей все ожидаемые MANN references покрыты минимум одним LocalProduct; у 15 покрытие неполное. Полный downstream-аудит: `docs/mann-oem-local-layer-audit-2026-08-19.md`.

Главный пробел по типу — топливные фильтры: 12/21 occurrences отсутствуют. Масляные покрыты лучше всего: только 1/50 missing, но 41/50 неоднозначны из-за нескольких аналогов.

## Dataset D freeze

- 100 уникальных исторических госномеров;
- исключены manifests A/B/C и прежние golden profiles;
- manifest создан до обращения к TRONK;
- manifest digest: `0502d13b2cea8994dbe07204de05a996518777acd5342a154b3794e8bb0eb35b`;
- frozen algorithm: `mann-a0f948870728`;
- algorithm digest: `a0f94887072877bfca9e25c4e394f5fefa98e0fd5e99bb7be772803758073a31`.

Make distribution ограничена максимум шестью автомобилями на крупную марку; 25 make groups. Year distribution manifest: ≤2005 — 16, 2006–2010 — 28, 2011–2015 — 29, 2016–2020 — 21, 2021+ — 6. Среди 90 decoded TRONK вернул 44 gasoline, 20 diesel и 26 без достаточных данных о топливе. Гибридные/газовые классы в D не встретились как явно декодированные.

Официальный raw result сохранён до разметки. Blind result digest: `8481bb2acbd78143135da7bb2bb3ff44d41c62be9416bda20e8922853e8d8b10`; provider trace digest: `9bd04dc378dd9ecae3654e075b460e1a89891ce8057897d82c67b80df20ec8d5`. Госномера, VIN и raw provider payload не включены в отчёт и остаются в игнорируемой приватной папке.

## Ограничения и решение

1. D даёт 90% usable decode; оставшиеся 10% — чистый provider no-data, а не matcher и не network failure.
2. Top-1 86,7% заметно ниже development C = 100%, поэтому C нельзя использовать как доказательство обобщаемости. D показал шесть ranking errors и два normalization/retrieval gaps.
3. Safety target выполнен: 0/12 dangerous automatic errors. Однако auto coverage равно лишь 12/60 exact matches, поэтому расширять HIGH пороги по D без Dataset E нельзя.
4. 16/90 decoded cases имеют подтверждённый MANN data gap. Это отдельная задача по полноте каталога, а не scoring.
5. После исправления бизнес-семантики strict end-to-end равен 37/100: несколько подтверждённых аналогов считаются успехом. На правильном Top-1 scope OEM coverage составляет 104/125 occurrences и 76/95 unique references.
6. Решение для production: сохранить HIGH как безопасное предложение для автомобиля, не включать безусловное auto-apply, показывать все OEM-подтверждённые LocalProduct и оставить отдельный status только для реального отсутствия покрытия.
