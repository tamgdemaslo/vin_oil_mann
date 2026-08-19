# Implementation manifest: MANN reference → OEM Parts → LocalProduct

Дата: 19 августа 2026 года.

Этот manifest зафиксирован до изменения production matcher. Vehicle resolver, TRONK и Dataset D vehicle predictions не менялись.

## 1. Текущий parser `LocalProduct.oemParts`

`oemParts` хранится как `TEXT`. Текущий MANN parser:

1. делит строку на сегменты;
2. добавляет целый сегмент;
3. добавляет отдельные слова;
4. пытается собрать последовательности `letters + digits + optional X/Z`;
5. сравнивает полученные токены по destructive compact key без `/`.

Общий product cross-reference helper использует другой parser, поэтому на 74 активных карточках два parser дают разное число токенов.

## 2. Реальные delimiters

В 1 098 активных карточках с OEM Parts получен 43 571 сегмент.

| Delimiter/формат | Факт |
|---|---:|
| `;` | 1 076 карточек |
| перенос строки | 4 карточки |
| `,` | 0 карточек в снимке |
| `|` | 0 карточек в снимке |
| значение заканчивается `;` | 603 карточки |
| сегменты с пробелами | 3 378 |
| с дефисом | 940 |
| с точкой | 219 |
| со слешем | 148 |

Parser всё равно должен поддерживать `;`, запятую, перенос и `|`, поскольку эти delimiters уже заявлены существующим контрактом и могут появиться при ручном вводе.

## 3. Текущая normalization

`normalizePartArticle()` возвращает:

- `structural`: uppercase/NFKD, унифицированные тире и slash, удалены пробелы, точки и дефисы, `/` сохранён;
- `compact`: тот же ключ, но `/` также удалён.

Отдельно существуют несовместимые `productCrossReferenceKey()`, `normalizeRosskoArticle()` и SQL `regexp_replace(..., '[^A-Z0-9]', '')`.

## 4. Где destructive compact используется как доказательство

- `mann-catalog.ts`: OEM token сравнивается по `compact` и становится strong match;
- `mann-catalog.ts`: собственный MANN article/code formatting match использует `compact`;
- SQL candidate retrieval удаляет все разделители в `oem_parts`, `name`, `article`, `code`;
- `product-cross-references.ts` и ROSSKO import имеют отдельные strip-all normalizers.

SQL substring используется только для retrieval, но финальный OEM evaluator также принимает compact equality. Именно финальный этап требует collision protection.

## 5. Compact collisions во всём доступном каталоге

Найдены пять distinct compact keys с несколькими structural forms:

- MANN namespace: 1;
- OEM raw segments: 4;
- собственные LocalProduct article/code: 0.

Ключи: `C27161`, `W71295`, `OE6724`, `W6109`, `W81180`.

## 6. Сколько collisions являются разными SKU

Одна collision доказанно соединяет разные MANN SKU:

- `C27161` — фильтр для FORD Transit;
- `C2716/1` — фильтр для SMART Fortwo;
- общий destructive compact key: `C27161`.

Четыре OEM collisions выглядят как formatting variants со слешем/пробелом, но не будут автоматически объявлены эквивалентными. Они требуют safe-key/namespace evidence.

## 7. Причины 19 uncovered Dataset D references

| Причина | References | Количество |
|---|---|---:|
| `PRODUCT_REALLY_MISSING` / provisional `LOCAL_ASSORTMENT_GAP` | остальные references без следов в active/archived article, code, name, mannName или OEM Parts | 17 |
| `MANN_REFERENCE_NOT_PRESENT_IN_OEM` + отсутствует structured brand/article | `WK820/1` | 1 |
| `OEM_NOT_FILLED` + отсутствует structured brand/article | `WK9023Z` | 1 |

Для `WK820/1` существует активная карточка с названием `MANN-FILTER WK8201`, но reference отсутствует в OEM Parts, а `brand/article` не заполнены. Для `WK9023Z` существует активная карточка с соответствующим названием, но OEM Parts, `brand` и `article` пусты. Название не используется как automatic compatibility evidence.

Архивных exact matches, wrong-branch evidence и безопасных parser-only matches для этих 19 references в доступном снимке не найдено.

## 8. Сколько закрывается parser/normalization

Автоматически: **0 из 19**.

Текущий parser уже использует более агрессивный compact, чем разрешает новая safety policy. Усиление parser не даёт новых безопасных exact matches. Два name-only случая нельзя превращать в compatibility без исправления структурированных данных.

## 9. Сколько закрывается существующим ROSSKO enrichment

В текущем виде автоматически: **0 из 19**.

- `WK820/1`: enrichment возвращает `SKIPPED_ALREADY_FILLED`, потому что OEM Parts уже непусты;
- `WK9023Z`: enrichment не имеет source brand/article и возвращает `MISSING_SOURCE_DATA`;
- для остальных 17 нет LocalProduct, а enrichment по контракту не создаёт товары.

После исправления structured brand/article и разрешения безопасного merge неполного OEM потенциально можно закрыть **до 2 references**, но результат должен подтвердить ROSSKO, а не название товара.

## 10. Настоящий assortment gap

По доступному branch snapshot provisional assortment gap равен **17 из 19 references**. Они не обнаружены ни в active, ни в archived LocalProduct по собственным полям, legacy MANN field или OEM Parts.

Окончательно переводить их в `LOCAL_ASSORTMENT_GAP` следует после supplier cross-check. Это не повод создавать 17 MANN-карточек автоматически.

## Реализация после manifest

1. Ввести единый multi-level part-number parser с `rawNormalized`, `canonical`, `compactCandidate`.
2. Ввести единый `parseOemParts()` с brand-aware entries.
3. Строить collision index и запрещать compact auto-match для collision keys.
4. Убрать `name` из compatibility evidence.
5. Возвращать все `compatibleProducts` с четырьмя явными match types.
6. Сортировать только после compatibility: in-stock → exact MANN → orderable → остальные.
7. Пересчитать отдельные `TECHNICAL_COVERAGE` и `IN_STOCK_COVERAGE`.
