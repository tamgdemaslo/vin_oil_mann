# «Продажи и план»: Stage 1 manifest

Дата аудита: 2 сентября 2026 года.

Статус: аудит текущей реализации и данных завершён. Реализация, Prisma migration и backfill в этом этапе не выполнялись.

## Короткий вывод

Фактическую аналитику можно строить на текущих проведённых `LocalDemand` и `LocalDemandPosition`: у строк уже есть исторический snapshot себестоимости, услуги имеют устойчивый `LocalProduct.id`, а новая модель `LocalCatalogGroup` даёт устойчивый ID товарной/сервисной группы. Не хватает отдельного канонического слоя `PRODUCT_CATEGORY` / `SERVICE_OPERATION`, versioned mappings, snapshot аналитической классификации в проведённой строке, структурированных атрибутов разовой услуги и месячных планов.

До Stage 2 нельзя считать количество масла в литрах из текущего `quantity`: в одной категории смешаны штуки канистр и литры разлива. Для достоверных литров нужен нормализованный base quantity/unit snapshot. Также новый analytics cache обязан включать branch scope: текущий cache товарной аналитики этого не делает.

## Источник и границы проверки данных

- Код проверен в репозитории `vin_oil_mann`, commit `f6a551f` (`Add one-off products and stable cost accounting`).
- Production не изменялся и напрямую не запрашивался.
- Числа ниже получены строго read-only из временно восстановленной локальной копии проверенного замороженного офлайн-бэкапа от 2 августа 2026 года.
- В копии данные идут с 22 ноября 2023 года по 24 июля 2026 года: 6 110 документов, из них 6 091 проведённый; 18 389 строк; 1 321 revision event.
- Этот архив предшествует текущей branch-архитектуре и содержит одну legacy-область данных. Он подтверждает формулы и legacy-покрытие, но не подтверждает актуальные значения production и сумму двух нынешних филиалов.

## 1. Какие позиции сейчас попадают в товарную аналитику

Текущий `getWarehouseProductAnalytics()` сначала выбирает карточки `LocalProduct` с `entityType != "service"` (по умолчанию также `archived = false`), затем берёт только строки продаж, у которых:

- `LocalDemand.applicable = true`;
- `documentDate` входит в выбранный период;
- `LocalDemandPosition.assortmentType != "service"`;
- `productId` присутствует и входит в набор выбранных карточек товара;
- проходят фильтры организации, склада, категории, бренда и поставщика.

Следствия:

- разовые товары с `assortmentType = "nonstock_product"` и `productId = null` сейчас не входят в товарную аналитику, хотя имеют структурированный `raw.oneOffProduct`;
- legacy-строки без `productId` не входят;
- строки, привязанные к исключённой/архивной карточке, по умолчанию не входят;
- `groupIdSnapshot` в текущем отчёте ещё не используется.

В офлайн-истории найдено 12 019 проведённых товарных строк: 8 816 со стабильным `productId`, из них 8 588 с непустым `groupPath` и 228 без группы; ещё 3 203 строки без `productId`. Это оценка покрытия legacy-данных, а не текущей production.

## 2. Почему услуги сейчас исключены

Исключение сделано явно и правильно для складского отчёта:

- запрос карточек использует `entityType: { not: "service" }`;
- запрос строк продаж использует `assortmentType: { not: "service" }`;
- цикл агрегации повторно отбрасывает строку, если услуга определилась по типу позиции или карточки.

Причина архитектурно корректна: существующий экран считает остатки, доступность, дефицит, оборачиваемость, приходы, списания, ABC/XYZ и пополнение. Услуга не является складским остатком. Новый раздел должен переиспользовать источник продаж и финансовые функции, но иметь отдельную агрегацию операций.

## 3. Как сейчас определяется товарная категория через `groupPath`

В текущем отчёте категория — это последний непустой сегмент строки `LocalProduct.groupPath`. Фильтрация выполняется как case-insensitive `contains` по `groupPath`. Канонического кода категории нет.

Последняя migration `20260902100000_payroll_catalog_group_ids` уже улучшает основу:

- создаёт `LocalCatalogGroup` с устойчивым `id`, `branchId`, `kind` и нормализованным именем;
- записывает `LocalProduct.groupId`;
- сохраняет `LocalDemandPosition.groupIdSnapshot`;
- использует сравнение текста только в контролируемом legacy-backfill/trigger, а не в runtime-расчёте.

Рекомендация: не заменять этот слой. Использовать `groupIdSnapshot -> SalesAnalyticsMapping -> SalesAnalyticsMetric.code`. Для старых строк без snapshot разрешить versioned backfill. `groupPath` оставить подписью и источником первоначального контролируемого mapping, но не runtime-классификатором.

Нужны начальные mappings, включая legacy-опечатки (`трансмисионное`, `проклдаки`) и вложенный путь моторного масла. Исправление подписи не должно менять старый отчёт задним числом.

## 4. Какие стабильные service ID существуют

В `LocalDemandPosition.productId` хранится устойчивый `LocalProduct.id` услуги. `PieceworkRule` для аналитики использовать нельзя: это отдельная payroll-модель.

Все 26 service ID, найденные в проведённой офлайн-истории:

| Service ID | Историческая подпись | Строк | Предлагаемый статус |
|---|---|---:|---|
| `cmphdnx1z01sm8zksgngu23b7` | Замена моторного масла в двигателе и масляного фильтра | 4 082 | `ENGINE_OIL_CHANGE` |
| `cmphdo2mc01t48zksevroqafy` | Замена воздушного фильтра | 649 | `AIR_FILTER_REPLACEMENT` |
| `cmphdnwh201sk8zksfqm75ji8` | Замена трансмиссионного масла, частичная | 515 | `TRANSMISSION_FLUID_SERVICE`, `procedure=PARTIAL` |
| `cmphdo00h01sw8zkszvuoqkrd` | Замена салонного фильтра | 371 | `CABIN_FILTER_REPLACEMENT` |
| `cmphdnvw601si8zkssrecv1st` | Замена трансмиссионного масла, полная/аппаратная | 166 | `TRANSMISSION_FLUID_SERVICE`, `procedure=MACHINE` |
| `cmphdo0vn01sy8zksk93r3s86` | Замена топливного фильтра | 116 | `FUEL_FILTER_REPLACEMENT` |
| `cmphdnvbh01sg8zksw77y6k78` | Замена масла в заднем редукторе | 76 | `REAR_DIFFERENTIAL_FLUID_CHANGE` |
| `cmphdnyti01ss8zkst25ozud4` | Замена масла в раздаточной коробке | 58 | `TRANSFER_CASE_FLUID_CHANGE` |
| `cmphdo1gl01t08zkskn4tsbpd` | Замена масла в механической коробке передач | 47 | `TRANSMISSION_FLUID_SERVICE`, `aggregateType=MANUAL`, `procedure=STANDARD` |
| `cmphdo3s901t88zksj9bc309u` | Замена масла в переднем редукторе | 35 | `FRONT_DIFFERENTIAL_FLUID_CHANGE` |
| `cmphdnxcg01sn8zksg2n07r54` | Работа по выставлению уровня масла в АКПП | 24 | review; не считать заменой, вероятно `DIAGNOSTIC` |
| `cmphdo0b001sx8zksxb1j987a` | Компьютерный сброс сервисного интервала | 19 | review |
| `cmphdo2wv01t58zksjus1twbp` | Замена свечей зажигания | 13 | review |
| `cmphdnxmy01so8zksj2uvuale` | Проверка состояния и уровня рабочих жидкостей в моторном отсеке | 11 | review, вероятно `DIAGNOSTIC` |
| `cmphdo21d01t28zks65q9lwmf` | Проверка состояния ГРМ | 10 | review, вероятно `DIAGNOSTIC` |
| `cmphdo2bw01t38zksr8sllkxn` | Замена тормозной жидкости, аппаратная | 10 | `BRAKE_FLUID_CHANGE` |
| `cmphdnz5d01st8zks95drmwkv` | Работа по замене масла в муфте Haldex | 7 | review |
| `cmphdnzq701sv8zksiqbxzqi4` | Слесарные работы | 6 | review, вероятно `OTHER_SERVICE` |
| `cmphdny7v01sq8zks4on3g08f` | Диагностика АКПП | 5 | review, вероятно `DIAGNOSTIC` |
| `cmphdnxxc01sp8zksrwl0nrm1` | Проверка уровня и состояния охлаждающей жидкости | 3 | review, вероятно `DIAGNOSTIC` |
| `cmphdnyib01sr8zkspydg3aaa` | Проверка уровня ГУР (ЭУР) | 3 | review, вероятно `DIAGNOSTIC` |
| `cmphdo1qy01t18zks0bfihpar` | Проверка уровня и состояния тормозной жидкости | 3 | review, вероятно `DIAGNOSTIC` |
| `cmphdnw6q01sj8zkseimml5i6` | Компьютерная диагностика | 2 | review, вероятно `DIAGNOSTIC` |
| `cmphdnzfu01su8zkszreeudhf` | Выставление уровня АКПП | 1 | review; не считать заменой, вероятно `DIAGNOSTIC` |
| `cmphdo37c01t68zksz648f7kp` | Замена масла в ГУР | 1 | review |
| `cmphdo3ht01t78zksrf1uwkji` | Масляный душ (промывка) | 1 | review |

11 ID, отмеченных в таблице финальным кодом без `review`, дают прямое соответствие требуемой начальной таксономии. Остальные должны пройти один ручной review; после сохранения mapping имя больше не участвует в runtime-классификации.

## 5. Как создаются разовые услуги

В `NewShipmentPageClient.tsx` команда добавления разовой услуги сейчас:

1. спрашивает название;
2. спрашивает цену;
3. опционально спрашивает комментарий;
4. создаёт строку `assortmentType = "service"` со временным `local://manual-service/<timestamp>`;
5. отправляет обычный payload позиции и сохраняет свободный текст/meta в `raw`.

Каталожная карточка `LocalProduct` не создаётся, поэтому стабильного `productId` у такой строки нет.

## 6. Есть ли у разовой услуги структурированная категория

Нет. В отличие от разового товара (`raw.oneOffProduct` уже содержит `groupCode`, `brand`, `article`, `uom`, закупочную цену и `analyticsKey`), разовая услуга хранит только свободное название, цену, комментарий и техническую ссылку.

Нужно добавить `raw.oneOffService` и серверную валидацию минимум для:

- `analyticsMetricCode`;
- `aggregateType`;
- `procedure`;
- `configuration`;
- `classificationVersion`.

Для нетрансмиссионных услуг три характеристики могут быть `null`; для `TRANSMISSION_FLUID_SERVICE` они обязательны с допустимым `UNKNOWN`. UI должен показывать понятные русские варианты, backend — сохранять канонические значения.

## 7. Какие сервисы АКПП/трансмиссии есть в фактических данных

Подтверждённые отдельные каталожные операции:

- частичная замена трансмиссионного масла — 515 строк / 515 посещений;
- полная/аппаратная — 166 / 166;
- механическая коробка, стандартная замена — 47 / 47;
- раздаточная коробка — 58 / 58;
- передний редуктор — 35 / 35;
- задний редуктор — 76 / 76;
- Haldex — 7 / 7, требует решения по таксономии;
- диагностика АКПП — 5 / 5;
- выставление уровня АКПП — два ID, суммарно 25 / 25; это не замена жидкости.

В legacy-данных нет надёжного структурированного `aggregateType` для частичной и аппаратной операции и нет `configuration`. Поэтому безопасный backfill: код операции + известный `procedure`, а `aggregateType=UNKNOWN`, `configuration=UNKNOWN` до подтверждённого mapping/ручной классификации. Нельзя выводить CVT/DSG, поддон или два фильтра только по соседним товарам или свободному тексту.

## 8–10. Покрытие исторических service lines

Проверялись только строки `assortmentType = "service"` в текущем состоянии проведённых документов. Revision events не включались.

| Корзина | Строк | Уникальных demand в корзине | Пояснение |
|---|---:|---:|---|
| Есть стабильный service ID | 6 234 | 4 708 | 99,05% всех service lines |
| Из них сразу маппятся в начальную таксономию по 11 подтверждённым ID | 6 125 | 4 678 | без сравнения имени |
| Из них стабильный ID, но нужен один ручной review назначения | 109 | 92 | идентичность надёжна, целевой код ещё не утверждён |
| Только exact verified legacy-name mapping | 43 | 42 | 8 фиксированных алиасов, не `includes` |
| Остаётся `UNCLASSIFIED` | 17 | 17 | все — «замена масла в редукторе», неясно передний или задний; суммарный raw quantity 19 |
| Всего | 6 294 | 4 726 | distinct demand по строкам; числа demand в корзинах не обязаны складываться |

60 строк не имеют `productId`: 43 можно перенести через отдельно утверждённые exact aliases, 17 нельзя классифицировать без ручного решения. Конкретные clear aliases: варианты работ по замене моторного масла (19 строк), проверки уровня АКПП/трансмиссии (18), legacy-опечатка замены топливного фильтра (3), антифриз (2), замена клапана ТНВД (1).

## 11. Как корректно считать количество операций

Товары:

- `soldQuantity = SUM(position.quantity)`;
- `salesDocuments = COUNT(DISTINCT demandId)`;
- `clients = COUNT(DISTINCT counterpartyId)` без пустых ID.

Услуги:

- одна операция = `COUNT(DISTINCT demandId, analyticsMetricCode, procedure, configuration)`;
- в ключ также следует включить `aggregateType`, иначе подтверждённые AUTOMATIC/CVT/DCT_DSG/MANUAL внутри одного документа могут склеиться;
- повторяющиеся строки одного и того же кода и конфигурации в одной отгрузке дают одну операцию;
- `SUM(quantity)` по услуге можно показывать только как диагностическое качество данных, не как KPI операций.

Источник — текущее состояние `LocalDemand` + `LocalDemandPosition` с `applicable=true`. Таблицу `ShipmentRevision` в факт не объединять: это журнал событий, иначе будут дубли. В архиве есть 1 321 revision event, включая 7 `REOPENED` и 6 `REPOSTED`; текущий запрос их не дублирует.

Прямая выручка услуги считается только из строк услуги. Материалы, проданные в том же `demandId`, считаются отдельно как linked material revenue/cost/profit.

## 12. Какие поля себестоимости доступны

- `LocalProduct.buyPriceCents` — последняя закупочная цена карточки, не историческая себестоимость продажи.
- `LocalStockBalance.buyPriceCents` — текущая средневзвешенная себестоимость остатка.
- `LocalDemandPosition.buyPriceCentsPerUnit` — снимок себестоимости единицы при проведении; это источник COGS отчёта.
- `InventoryLedgerEntry.unitCostSnapshot` — снимок себестоимости движения склада.
- `raw.oneOffProduct.purchasePriceCents` и тот же `LocalDemandPosition.buyPriceCentsPerUnit` — себестоимость разового товара.
- Для `assortmentType="service"` себестоимость по действующему контракту равна 0; материалы не включаются в неё автоматически.

Формулы уже централизованы в `inventory-costing.ts`: скидка применяется к выручке, деньги округляются в копейках на строке, COGS = `quantity * posted snapshot`.

Если snapshot товарной строки отсутствует или неположителен, `cost`, `grossProfit` и `margin` должны быть `null/incomplete`, а не нулём. Fallback к текущей цене карточки запрещён.

## 13. Внедрён ли канонический COGS snapshot

Да. После изменения `Add one-off products and stable cost accounting` канонический источник для продажи — `LocalDemandPosition.buyPriceCentsPerUnit`:

- при первом проведении он берётся из текущего WAC остатка;
- при reopen/repost уже сохранённый snapshot не пересчитывается;
- для разового товара сохраняется введённая закупочная цена;
- для услуги разрешён подтверждённый cost 0;
- неизвестная себестоимость товара остаётся неизвестной.

Новая денежная колонка для Stage 2 не нужна. В полном июне все строки строго сопоставленных товарных категорий в офлайн-копии имели COGS snapshot; это не отменяет обязательный incomplete-state для других периодов и production.

## 14. Нужна ли Prisma migration для планов

Да. Надёжной существующей модели с историей плана по филиалу, месяцу и metric code нет. `BranchSalesPlan` нужен отдельной migration с уникальностью `(branchId, month, metricCode)`, audit через существующий `BranchAuditLog`, optimistic version и запретом all-branches write.

Месяц хранить нормализованным на первое число в бизнес-таймзоне. All-branches — только вычисляемая сумма доступных филиалов, не отдельная строка плана.

## 15. Нужна ли migration для analytics mappings

Да. `LocalCatalogGroup` решает устойчивую идентичность группы, но не хранит канонический analytics code, match method, подтверждение и версию. Нужны `SalesAnalyticsMetric`, `SalesAnalyticsMapping` и snapshot-поля позиции.

Backfill должен быть отдельной контролируемой командой после migration и backup, с dry-run отчётом:

- classified / unclassified / total;
- by ID / by verified mapping / manual review;
- conflicts;
- версия mapping;
- неизменённые исходные документы.

## 16. Файлы, которые планируется изменить

Точный минимальный набор; имена новых файлов могут быть объединены, но ответственность должна сохраниться:

- `prisma/schema.prisma`;
- `prisma/migrations/<timestamp>_sales_analytics_taxonomy_and_plans/migration.sql`;
- `src/lib/db.ts` — branch-scoped модели;
- `src/lib/sales-analytics-taxonomy.ts` — коды, enums, seed/validation;
- `src/lib/sales-performance-analytics.ts` — единственный analytics service для fact/comparison/drill-down;
- `src/lib/sales-plans.ts` — CRUD/copy/forecast;
- `src/lib/local-demand-write.ts` — snapshot аналитики и base quantity при проведении;
- `src/lib/one-off-service.ts` — нормализация и серверная валидация;
- `src/app/inventory/shipments/new/NewShipmentPageClient.tsx` — поля разовой услуги;
- `src/app/api/warehouse/analytics/sales-performance/route.ts`;
- `src/app/api/warehouse/analytics/sales-performance/details/route.ts`;
- `src/app/api/warehouse/analytics/sales-classification/route.ts`;
- `src/app/api/warehouse/analytics/sales-plans/route.ts` и `copy/route.ts`;
- `src/app/warehouse/product-analytics/ProductAnalyticsClient.tsx` — новая верхняя вкладка без изменения существующих;
- `src/app/warehouse/product-analytics/SalesPerformancePanel.tsx` — внутренние разделы;
- `src/app/globals.css` — только недостающие стили в существующем спокойном workbench-языке;
- существующий CSV builder или небольшой adapter для новых таблиц; новый export engine не нужен;
- `scripts/audit-sales-performance.mjs` и `scripts/backfill-sales-analytics.mjs` с обязательным dry-run;
- unit/integration/API/UI tests для taxonomy, операций, COGS, branch scope, all-branches, plan, forecast, attach rate и invalidation.

Отдельно: invalidation нового cache должен вызываться после проведения/reopen/repost, изменений mappings и plan. Cache key обязан включать business group, branch scope (`branchId` или отсортированный список разрешённых филиалов), период и фильтры. Текущий module-level cache `warehouse-product-analytics.ts` не включает branch scope и не должен переиспользоваться в таком виде.

## 17. Предлагаемая конечная схема

### Канонический справочник

`SalesAnalyticsMetric`

- `code String @id`;
- `type PRODUCT_CATEGORY | SERVICE_OPERATION`;
- `title String`;
- `unit PCS | LITER | OPERATION`;
- `active Boolean`;
- `sortOrder Int`;
- `parentCode String?`;
- `settingsJson Json?`;
- timestamps.

Начальные коды — ровно из требования. Расширение выполняется добавлением записи, не новой веткой в analytics service.

### Versioned mapping источников

`SalesAnalyticsMapping`

- `id`;
- `businessGroupId`;
- `branchId?` и ненулевой `scopeKey` (`branch:<id>` или `group`) для корректной уникальности;
- `sourceType = CATALOG_GROUP | CATALOG_ITEM | LEGACY_EXTERNAL_ID | ONE_OFF_ALIAS`;
- `sourceId`;
- `metricCode`;
- `matchMethod = ID | SAVED_CODE | GROUP | VERIFIED_LEGACY | MANUAL`;
- `aggregateType?`, `procedure?`, `configuration?`;
- `version`, `active`;
- `confirmedById?`, `confirmedAt?`;
- timestamps;
- unique active identity по `(businessGroupId, scopeKey, sourceType, sourceId)`.

Приоритет классификации: position snapshot / сохранённый analytics code → явный mapping catalog item ID → mapping `groupIdSnapshot`/service category → структурированный `position.raw` разовой позиции → verified legacy mapping → manual → `UNCLASSIFIED`. Свободный `name.includes()` в runtime запрещён.

### Snapshot в проведённой строке

Добавить в `LocalDemandPosition`:

- `analyticsMetricCode?`;
- `analyticsCategoryLabel?`;
- `analyticsMatchMethod?`;
- `analyticsMappingVersion?`;
- `serviceAggregateType?`;
- `serviceProcedure?`;
- `serviceConfiguration?`;
- `analyticsBaseQuantity Decimal?`;
- `analyticsBaseUnit?`;
- индексы `(branchId, analyticsMetricCode)` и `(branchId, demandId, analyticsMetricCode)`.

`analyticsBaseQuantity/baseUnit` необходимы для масла: `quantity` сейчас смешивает `шт` и `л`, а `packageVolume` — текст и местами не соответствует названию. Для новых строк нормализованное количество вычисляется при проведении из подтверждённых структурированных данных. Неуверенная конверсия остаётся `null`, а UI показывает «объём не классифицирован».

### План

`BranchSalesPlan`

- `id`, `branchId`, `month`, `metricCode`;
- `targetCount Decimal?`;
- `targetRevenueCents Int?`;
- `targetGrossProfitCents Int?`;
- `targetAttachRateBasisPoints Int?`;
- `expectedRevenuePerUnitCents Int?`;
- `expectedGrossProfitPerUnitCents Int?`;
- `note?`;
- `version Int`;
- `createdById`, `updatedById`, timestamps;
- unique `(branchId, month, metricCode)`.

Новый audit model не нужен. Использовать `BranchAuditLog` для create/update/copy plan, mapping changes, manual classification и backfill. Открытие отчёта не логировать.

### Branch scope и рабочие дни

- API читать через `requireBranchApi({ allowAll: true })` и `runWithBranchApiContext`.
- В all-branches режиме каждый запрос получает явный `branchId IN readableBranchIds`; итог равен сумме тех же филиальных строк.
- План редактируется только для конкретного филиала.
- Рабочие дни брать из `BranchBookingWorkingHour` + `BookingScheduleException`; fallback календаря должен быть явным и видимым в ответе.

## 18. Пример результата: полный июнь 2026, read-only

Источник — описанная выше односоставная офлайн-копия. За 1–30 июня: 168 проведённых документов, ещё 2 непроведённых исключены; общая сумма проведённых документов — 1 398 659,67 ₽. Таблицы ниже используют только строгие group/ID mappings и текущий COGS snapshot.

### Товары

| Код | Raw quantity | Документов | Клиентов | Выручка | Валовая прибыль | Missing cost |
|---|---:|---:|---:|---:|---:|---:|
| `ENGINE_OIL` | 2 435,510 | 122 | 108 | 788 371,97 ₽ | 362 699,11 ₽ | 0 |
| `TRANSMISSION_FLUID` | 79,140 | 16 | 14 | 161 338,60 ₽ | 78 829,28 ₽ | 0 |
| `OIL_FILTER` | 99 | 99 | 96 | 97 329,10 ₽ | 48 346,37 ₽ | 0 |
| `AIR_FILTER` | 13 | 13 | 13 | 19 161,00 ₽ | 8 119,00 ₽ | 0 |
| `CABIN_FILTER` | 8 | 8 | 8 | 8 392,00 ₽ | 4 215,00 ₽ | 0 |
| `FUEL_FILTER` | 1 | 1 | 1 | 1 290,00 ₽ | 731,00 ₽ | 0 |
| `TRANSMISSION_FILTER` | 7 | 7 | 7 | 48 151,20 ₽ | 20 175,20 ₽ | 0 |
| `SEALS_GASKETS` | 21 | 21 | 21 | 1 359,00 ₽ | 1 060,90 ₽ | 0 |

`Raw quantity` у масел намеренно не подписано «л»: оно смешивает литры разлива и штуки канистр. Денежные показатели валидны, литровый KPI до snapshot-нормализации — нет.

### Услуги: distinct operations и прямая выручка

| Операция | Операций | Прямая выручка услуги |
|---|---:|---:|
| `ENGINE_OIL_CHANGE` | 123 | 35 760,00 ₽ |
| `AIR_FILTER_REPLACEMENT` | 27 | 8 125,50 ₽ |
| `CABIN_FILTER_REPLACEMENT` | 16 | 4 750,00 ₽ |
| `FUEL_FILTER_REPLACEMENT` | 4 | 5 960,00 ₽ |
| `TRANSMISSION_FLUID_SERVICE · PARTIAL` | 11 | 56 360,00 ₽ |
| `TRANSMISSION_FLUID_SERVICE · MACHINE` | 6 | 44 051,00 ₽ |
| `TRANSMISSION_FLUID_SERVICE · MANUAL/STANDARD` | 2 | 2 980,00 ₽ |
| `TRANSFER_CASE_FLUID_CHANGE` | 1 | 2 990,00 ₽ |
| `FRONT_DIFFERENTIAL_FLUID_CHANGE` | 1 | 1 490,00 ₽ |
| `REAR_DIFFERENTIAL_FLUID_CHANGE` | 2 | 2 041,30 ₽ |

Прямая COGS услуги по действующему контракту равна 0. Материалы показаны отдельно:

| Процедура | Всего операций | Операций со связанными материалами | Выручка материалов | COGS материалов | Валовая прибыль материалов |
|---|---:|---:|---:|---:|---:|
| `PARTIAL` | 11 | 10 | 84 196,90 ₽ | 45 121,84 ₽ | 39 075,06 ₽ |
| `MACHINE` | 6 | 5 | 105 506,90 ₽ | 48 784,28 ₽ | 56 722,62 ₽ |

### Attach rate

Знаменатель — 123 distinct visits с `ENGINE_OIL_CHANGE`:

- воздушный фильтр в том же `demandId`: 12 посещений, attach rate 9,8%; отдельно от замены масла продан в 1 посещении;
- салонный фильтр: 7 посещений, attach rate 5,7%; отдельно — 1 посещение.

Это демонстрация строгой формулы. Строки без подтверждённой группы намеренно не угадывались по названию, поэтому после контролируемого mapping/backfill числа могут только объяснимо измениться с записью версии.

## Решение о переходе к Stage 2

Технически Stage 2 готов к началу после утверждения трёх правил:

1. принять 11 mappings стабильных service ID из таблицы выше и 8 exact legacy aliases;
2. неизвестные `aggregateType/configuration` не угадывать, а показывать как `UNKNOWN` и очередь классификации;
3. литровый KPI публиковать только для строк с подтверждённым `analyticsBaseQuantity/baseUnit`, рядом показывая coverage и unclassified volume.

Prisma migration, backfill и production-deploy должны выполняться отдельным этапом после подтверждённого Timeweb backup и проверки `npm run check:timeweb-only`.
