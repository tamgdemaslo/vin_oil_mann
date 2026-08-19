# TRONK → MANN → локальные товары: итоговый аудит

Дата: 19 августа 2026 г.

Объём: 140 уникальных госномеров из истории отгрузок: A=20, B=20, C=100.

Приватные manifests, raw TRONK, госномера, VIN и labels хранятся только в `outputs/mann-matching-private/`, который исключён из Git.

## Результат

Система стала значительно лучше и безопаснее, но целевое качество на честном random unseen-наборе **не достигнуто**. На наборе C Top-1 равен 83,7%, Top-3 — 85,7%, есть одно опасное автоматическое ложное совпадение. Цели Top-1 ≥90%, Top-3 ≥97% и dangerous false-positive около 0 не выполнены.

| Прогон | Роль | TRONK decode | Exact labels | Top-1 | Top-3 | False auto | Корректная ambiguity | Корректный no-match |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| A baseline | До системной оптимизации | 12/20 | 14 | 5/14 = 35,7% | 6/14 = 42,9% | 0/2 | 0/1 | 1/3 |
| A final | Development | 18/20 | 14 | 14/14 = 100% | 14/14 = 100% | 0/4 | 1/1 | 3/3 |
| B frozen blind | Первый запуск после freeze | 17/20 | 13 | 11/13 = 84,6% | 11/13 = 84,6% | 0/4 | 3/3 | 1/1 |
| B after systemic fixes | Regression, не blind | 17/20 | 13 | 13/13 = 100% | 13/13 = 100% | 0/4 | 3/3 | 1/1 |
| **C frozen unseen** | **Главный generalization test** | **70/100** | **49** | **41/49 = 83,7%** | **42/49 = 85,7%** | **1/11 = 9,1%** | **9/12 = 75%** | **7/9** |

По набору C:

- 30/100 госномеров не дали пригодного decode в TRONK;
- 49 decoded-автомобилей имели определяемую точную MANN-модификацию;
- 12 случаев объективно неоднозначны без двигателя, топлива, точной даты или опции;
- 9 корректно decoded-автомобилей не имели нужной модификации в локальном MANN snapshot;
- алгоритм выдал 11 automatic, 20 ambiguous, 24 confirmation-required и 15 no-match среди 70 decoded;
- медиана самого scoring в offline harness составила 146 мс.

## Методика и защита от overfitting

1. Из 2 400 уникальных валидных госномеров истории сформированы детерминированные непересекающиеся A/B/C.
2. Выборка стратифицирована по реальным маркам и дедуплицирована по нормализованному госномеру.
3. Исключены 40 прежних hardcoded-профилей, а B и C дополнительно исключали все более ранние manifests.
4. Перед B заморожен алгоритм `mann-bba00d9b6989`; labels B созданы только после blind-прогона.
5. Перед C заморожен алгоритм `mann-a1fb1cc0a362`; manifest C имеет digest `e960c68aa13e…`, а алгоритм — `a1fb1cc0a362…`.
6. После прогона C production matcher не изменялся. Ошибки C не «починены поштучно».
7. В production diff нет условий по VIN/госномеру и нет testcase → MANN ID mappings.

Историческое текстовое поле модели из отгрузки не считалось ground truth: госномера могут переходить на другой автомобиль. Разметка опиралась на текущий TRONK decode и фактический MANN snapshot. Это не заменяет независимую TecDoc/дилерскую валидацию.

## Что изменено в алгоритме

### 1. Единая нормализация

Создан `src/lib/vehicle-normalization.ts`. Он централизует:

- canonical make;
- model text, generation и body/platform codes;
- Unicode/case/space/dash normalization;
- транслитерацию модели и engine code;
- разбор объединённых fallback-строк TRONK в make/model.

`vehicle-identity.ts` и MANN resolver больше не имеют независимых копий этих базовых функций.

### 2. Broad retrieval отделён от scoring

Резолвер сначала извлекает пул по марке и сходству модели, а затем отдельно оценивает каждую модификацию. Неполные поля больше не вызывают мгновенный no-match, а противоречия учитываются как negative evidence.

Общие MANN-строки с `+`, `/`, `;`, `,` и числовыми aliases в скобках разбираются как группы моделей. Учитываются prefix/suffix, короткие platform codes, family body codes и ограниченное edit/phonetic similarity.

### 3. Evidence-based scoring и confidence

- score ограничен 0–100;
- exact engine, engine family, model, generation/body, year, displacement, power, fuel и другие признаки имеют разный вес;
- mismatch по сильным полям снижает score;
- Top-1/Top-2 gap участвует в confidence;
- только Top-1 может получить `high`;
- введены `MATCH`, `AMBIGUOUS`, `NO_MATCH` и `high/medium/low/none`;
- кандидаты ниже 30 баллов не показываются как пригодная модификация;
- каждый Top-5 кандидат имеет matched/mismatched/missing fields и список feature contributions.

### 4. Дедупликация и фильтры

Семантически одинаковые MANN-модификации схлопываются в один candidate с набором `variantIds`. После выбора фильтры собираются по всем этим ID и дедуплицируются по артикулу/типу. Служебные PDF-строки не показываются как модификации.

### 5. Удалён опасный feedback loop

Ручное подтверждение теперь создаёт scoped `VehicleMannMapping`, но не создаёт глобальный `VehicleModelAlias`. Один ручно выбранный автомобиль больше не изменяет поведение matcher для всей модели.

### 6. Диагностика

Harness сохраняет raw provider trace, normalized vehicle, Top-5, scores, reasons, filters, local product matches и timings. Production trace не содержит VIN/госномер; он opt-in через `MANN_RESOLVER_TRACE=true` и пишет только decision, confidence, размеры пула, top score/gap и timings.

## Failure matrix на frozen unseen C

### Точные MANN-модификации

Из 49 exact-label автомобилей 8 не были выбраны Top-1:

| Класс | Кол-во | Что произошло |
|---|---:|---|
| `MODEL_NORMALIZATION` | 3 | Слишком общее, искажённое или локализованное название не связалось с MANN heading |
| `MAKE_NORMALIZATION` | 2 | Смешанный Latin/Cyrillic homoglyph и MANN aggregate make не попали в canonical make |
| `SCORING_ERROR` | 2 | В одном случае неверно расставлены generation/engine/power; в другом `BiFuel` не распознан как противоречие gasoline |
| `MANN_CANDIDATE_RETRIEVAL` | 1 | Правильная sedan-модификация не попала даже в Top-5 |

Один из двух scoring-сбоев — dangerous false positive: gasoline-автомобиль был автоматически связан с `BiFuel`-вариантом из-за exact engine-family match. Артикулы фильтров в этих двух MANN-вариантах совпали, но это не делает выбор модификации правильным.

### Upstream и data quality

| Класс | Кол-во | Интерпретация |
|---|---:|---|
| `TRONK_MISSING_DATA`, нет decode | 30 | Нельзя оценить MANN matcher; это upstream failure |
| Неполные/ambiguous decoded | 12 | Нет engine/fuel/date/опции или сам provider даёт несколько несовместимых отчётов |
| `MANN_DATA_MISSING` | 9 | Автомобиль decoded, но нужной модификации нет в локальном MANN snapshot |

Независимо доказать «TRONK decode correct/wrong» по одной истории отгрузок нельзя. Для точной метрики wrong-decode нужен второй authoritative VIN/TecDoc/дилерский источник. В этом аудите измерены наблюдаемые `no data`, `incomplete/ambiguous` и внутренние противоречия, но не выдумана accuracy TRONK.

## Фильтры и локальная база

Это три разные метрики:

1. выбрана ли верная MANN-модификация;
2. возвращены ли привязанные к ней MANN-артикулы;
3. нашлись ли эти артикулы в локальной товарной базе.

Для корректных Top-1 на C набор MANN-артикулов совпал с артикулами эталонной модификации: precision/recall/F1 = 100%. Это **внутренняя согласованность с MANN snapshot**, а не независимая проверка физической применяемости фильтра.

| Прогон | Артикулов при correct Top-1 | Один локальный товар | Несколько сильных товаров | Не найдено | Покрытие ≥1 candidate |
|---|---:|---:|---:|---:|---:|
| A final | 35 | 7 | 15 | 13 | 62,9% |
| B final | 29 | 6 | 21 | 2 | 93,1% |
| **C unseen** | **95** | **20** | **44** | **31** | **67,4%** |

Для C лишь 20/95 = 21,1% артикулов имеют один однозначный локальный товар. 44/95 имеют несколько сильных совпадений, поэтому безопасное автодобавление невозможно без дополнительного ranking/правила выбора. 31/95 артикулов в локальной базе не найден.

Глобальный аудит подтверждает проблему: из 2 066 уникальных MANN-артикулов хотя бы один локальный candidate имеют только 602 = 29,1%; 316 из них неоднозначны.

## Регрессии

- A baseline → A final: исправлено 9 exact Top-1, регрессий на размеченных A нет.
- B frozen blind → B final: два сбоя объяснялись общими классами «platform code перед model» и «numeric alias в скобках»; после общих изменений исправлено 2, регрессий A/B нет.
- Сам C не перепрогонялся на изменённом matcher, поэтому его 83,7% остаются честной final generalization-метрикой.

## Слабые зоны

Статистика по отдельным маркам на C слишком мала для надёжного рейтинга. Наблюдаемые сигналы:

- BMW: 1/3 Top-1; сбои на generic `GT` и локализованном названии серии;
- Volkswagen: 2/3; sedan-вариант не вошёл в Top-5;
- Hyundai: 1/2; неверный приоритет между поколением и engine/power;
- Porsche: 1/2; искажённая fallback-строка модели;
- Subaru: 0/1 Top-1, 1/1 Top-3; опасная ошибка fuel/BiFuel;
- Chevrolet и mixed-script Citroën: по 0/1 из-за make normalization.

По наличию engine code:

| Группа | Exact labels | Top-1 | Top-3 |
|---|---:|---:|---:|
| Engine code есть | 22 | 19/22 = 86,4% | 20/22 = 90,9% |
| Engine code нет | 27 | 22/27 = 81,5% | 22/27 = 81,5% |

Engine code помогает, но не гарантирует успех: нужно учитывать exact code, family, fuel, generation и диапазон лет вместе.

## Ограничения

1. MANN snapshot построен из PDF и не имеет отдельных structured generation/chassis/fuel/displacement/TecDoc ID. Около 19,1% строк имеют признаки загрязнённого/сдвинутого parsing.
2. Правильной модификации иногда физически нет в локальном MANN snapshot.
3. TRONK не дал usable decode для 30% C и нередко не возвращает engine/fuel/date.
4. Production SQL по-прежнему может читать большой пул строк одной марки; отдельный persisted structured index не построен.
5. Отсутствует внешняя эталонная база для независимой проверки TRONK и физической применяемости фильтра.

## Оставшиеся системные улучшения

Их нельзя внедрять и объявлять проверенными на C: после разметки C это стало бы tuning по test set. Нужен новый freeze и новая непересекающая unseen-выборка:

1. Unicode skeleton для make до alias lookup, чтобы Latin/Cyrillic homoglyphs не создавали новую марку.
2. Data-driven make-group graph для MANN headings вида `CHEVROLET EUROPE / DAEWOO (GM)`, а не vehicle-specific alias.
3. Удаление provider noise tokens (`BEZ MODELI` и аналоги) по общему словарю provenance, только если этот класс подтвердится на нескольких новых кейсах.
4. Структурный fuel parser для `BiFuel`, LPG/CNG, `DDiS`, hybrid/PHEV/MHEV и других терминов; противоречие fuel должно блокировать `high` даже при engine-family match.
5. Калибровка confidence на большем наборе: один false auto из 11 доказывает, что текущий high threshold недостаточен.
6. Persisted MANN feature index и SQL shortlist по make/model tokens, году и engine family вместо большого in-memory pool по марке.
7. Отдельная курация 1 464 непокрытых MANN-артикулов и 316 неоднозначных local matches. Это не задача vehicle matcher.
8. После этих изменений — новый blind/unseen-набор, не переоценка на C.

## Автоматизация и тесты

Добавлены:

- `npm run test:mann-vehicle-matching` — live/replay end-to-end harness;
- `npm run score:mann-vehicle-matching` — Top-1/Top-3, false auto, ambiguity, no-match, filter metrics, local coverage, срез по маркам и наличию engine code;
- deterministic dataset builder с seed, exclusions, manifests и digest;
- unit/regression/property checks для normalization, scoring, confidence, shuffle stability, irrelevant candidates, score bounds, exact-vs-conflicting evidence, duplicate consolidation, LPG, platform-prefix, numeric aliases в скобках и Cyrillic engine code.

Прогоны A/B/C и raw provider traces не включены в Git и не должны публиковаться в CI-артефактах без отдельной очистки.

## Итоговое решение

Алгоритм нельзя объявить готовым к безусловному автоподбору фильтров. До production-включения automatic mode нужно как минимум устранить systemic fuel/confidence risk, построить новый holdout и подтвердить целевые метрики. До этого безопасный режим — `AMBIGUOUS`/confirmation/no-match, а не принудительный первый кандидат.
