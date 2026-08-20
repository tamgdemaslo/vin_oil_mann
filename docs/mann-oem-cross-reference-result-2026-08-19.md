# MANN → OEM Parts → LocalProduct: результат оптимизации

Дата: 19 августа 2026 года.

## Итог

Реализован downstream cross-reference engine, который возвращает все технически подтверждённые `LocalProduct` для одного MANN reference. Несколько корректных аналогов теперь являются успешным техническим покрытием, а не ambiguity.

TRONK, vehicle normalization, scoring, Top-N retrieval и frozen vehicle predictions Dataset D не менялись.

## Safety policy

- canonical article сохраняет `/`;
- `compactCandidate` используется только после проверки collision index;
- final compatibility не использует substring, fuzzy или название товара;
- `C27161` и `C2716/1` остаются разными SKU;
- authoritative collision namespace состоит из MANN references и собственных MANN product identities;
- варианты представления в OEM Parts входят в diagnostics, но не объявляются отдельным MANN SKU только из-за отсутствующего слеша;
- stock, цена и поставщик влияют только на порядок показа, а не на совместимость.

Возвращаемые причины: `EXACT_PRODUCT_BRAND_ARTICLE`, `OEM_EXACT_BRAND_ARTICLE`, `OEM_EXACT_ARTICLE`, `OEM_SAFE_COMPACT`, а также существующая ручная связь `PRODUCT_MANN_LINK`.

## Dataset D downstream: before / after

| Метрика | До | После |
|---|---:|---:|
| Уникальные MANN references | 95 | 95 |
| Technical coverage | 76/95 = 80% | 76/95 = 80% |
| References с несколькими корректными товарами | 57/95 | 57/95 |
| Подтверждённые product↔reference links | 186 | 186 |
| In-stock reference coverage | 52/95 | 52/95 |
| Strict end-to-end | 37/100 | 37/100 |
| False analog | 0 | 0 |

Coverage не выросла: у 19 gaps не найдено новых структурированных доказательств. Это ожидаемый safety result — parser не подменяет отсутствующие данные совпадением по названию или опасным compact/substring.

## Breakdown 19 uncovered references

| Категория | Кол-во | References / действие |
|---|---:|---|
| `PRODUCT_REALLY_MISSING` → provisional `LOCAL_ASSORTMENT_GAP` | 17 | `C3434`, `C2136/1`, `WK6002`, `WK6031`, `C4371/1`, `PU8007`, `WK822/1`, `C3282`, `WK939/2Z`, `WK5010`, `WK8052Z`, `WK8053Z`, `C2672/1`, `WK8019/1`, `C1652`, `HU7005X`, `WK841/1`; нужен supplier cross-check/наполнение ассортимента |
| `MANN_REFERENCE_NOT_PRESENT_IN_OEM` | 1 | `WK820/1`: карточка существует, но reference отсутствует в OEM Parts, structured brand/article не заполнены; текущий enrichment пропускает непустое OEM поле |
| `OEM_NOT_FILLED` / `ROSSKO_ENRICHMENT_FAILED` | 1 | `WK9023Z`: карточка существует только по названию, OEM/brand/article пусты; ROSSKO enrichment не имеет исходных brand/article |
| `OEM_FORMAT_NOT_PARSED`, `BRAND_ALIAS_MISSING`, `ARTICLE_NORMALIZATION_GAP`, `ARCHIVED_PRODUCT`, `WRONG_BRANCH`, `UNKNOWN` | 0 | безопасных скрытых связей в branch snapshot не найдено |

Ни одна из 19 карточек не создавалась автоматически. Подтверждённых дублей по-прежнему 0; merge/delete не выполнялись.

## Постоянный OEM benchmark

Создан frozen benchmark на 100 MANN references: 95 Dataset D references, safety pair `C27161`/`C2716/1` и три детерминированно выбранных catalog references.

Результат повторного запуска:

- expected links: 188;
- actual links: 188;
- precision: 100%;
- recall: 100%;
- false analog: 0;
- missed analog: 0;
- collision safety pair: обе ссылки не создаются автоматически.

Это regression benchmark на frozen expected sets, а не оценка неизвестных будущих cross-reference данных.

## Performance

Offline worst-case benchmark намеренно просканировал все 1 571 активных товаров для каждого reference:

- average: около 77 ms/reference;
- p95: около 82 ms/reference;
- 100 references: около 7,7 s.

Production path не загружает весь каталог: сначала выполняется branch-scoped DB candidate retrieval, затем parser и final evaluator применяются только к найденным кандидатам. API diagnostics отдельно возвращает `localProductScanMs`, `parsingMs` и `totalMs`. Cache или Prisma migration не добавлялись: измерения не доказали необходимость менять `oemParts TEXT`.

## UI

Для каждого MANN reference показываются все совместимые товары двумя группами:

- «В наличии»;
- «Под заказ / без остатка».

Каждый вариант можно добавить отдельно. Глобальное действие, молча выбиравшее один `bestMatch`, убрано. В technical diagnostics доступны canonical article, число DB candidates, число compatible products, timing и признак блокировки compact collision.

## Защита от новых дублей

Canonical product identity учитывает brand, slash-preserving own article, единицу, фасовку, volume, weight и modification code. OEM Parts не используются как identity.

Проверка включена в ручное создание, ROSSKO import, Excel import и copy between branches. Форматные варианты одного SKU распознаются, а `C27161` и `C2716/1` не объединяются. DB unique по destructive compact article не создавался.

## Артефакты

- `src/lib/part-number-cross-reference.ts` — normalization, parser, collision helpers;
- `src/lib/product-identity.ts` — безопасная product identity;
- `benchmarks/mann-oem-cross-reference-v1.json` — frozen expected sets;
- `scripts/run-mann-oem-benchmark.mjs` — постоянный benchmark runner;
- `scripts/test-product-oem-catalog.mjs` — 20 обязательных matcher/creation contracts;
- private reports в `outputs/mann-matching-private/` — Dataset D re-evaluation и benchmark run.
