# Госномер/VIN → TRONK → MANN → LocalProduct: поколение 2

Дата: 19 августа 2026 г.

Статус: алгоритм заморожен перед Dataset D. Dataset C после анализа является development evidence, а не новым blind holdout. Первый результат D ещё не получен.

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

Live TRONK и полный p50/p95 должны измеряться на первом D-run.

## Dataset D freeze

- 100 уникальных исторических госномеров;
- исключены manifests A/B/C и прежние golden profiles;
- manifest создан до обращения к TRONK;
- manifest digest: `0502d13b2cea8994dbe07204de05a996518777acd5342a154b3794e8bb0eb35b`;
- frozen algorithm: `mann-a0f948870728`;
- algorithm digest: `a0f94887072877bfca9e25c4e394f5fefa98e0fd5e99bb7be772803758073a31`.

Make distribution ограничена максимум шестью автомобилями на крупную марку; 25 make groups. Year distribution: ≤2005 — 16, 2006–2010 — 28, 2011–2015 — 29, 2016–2020 — 21, 2021+ — 6. Fuel distribution станет известна только после blind TRONK decode и до этого не просматривается.

После первого D-run официальный raw result должен быть сохранён до разметки и любых изменений алгоритма. После этого D станет development evidence; следующая итерация потребует Dataset E.

## Ограничения и решение

1. 22% C остаются недекодируемыми из-за отсутствия данных TRONK, а не matcher.
2. Девять C cases имеют подтверждённый MANN data gap и не считаются matcher errors.
3. 31/95 исходных MANN article occurrences реально отсутствуют в доступном локальном каталоге.
4. Strict end-to-end пока 2%: рост MANN accuracy сам по себе не устраняет товарный bottleneck.
5. Безусловный automatic selection не включать до официальной оценки Dataset D; целевая safety-метрика D — 0 dangerous false positives.
