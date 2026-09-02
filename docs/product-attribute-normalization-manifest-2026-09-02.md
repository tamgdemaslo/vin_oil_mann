# Manifest: нормализованные характеристики масел

Дата аудита: 2026-09-02. Рабочая копия: `vin_oil_mann` (актуальная ветка `main`).

Ниже сохранён предварительный manifest, сформированный до реализации и до повторной передачи XML. Итоговый статус source-набора приведён после него.

1. **Приложенные XML.** В каталоге вложения `c073c5b6-dfb6-4887-9bcf-67b9eeaeb935` присутствует только `pasted-text.txt`. XML-файлы к сообщению фактически не приложены; поиск по всем локальным вложениям также не нашёл XML.
2. **Старые XML.** В репозитории есть четыре файла: `data/values-xml.xml` (ACEA), `data/values-xml-2.xml` (API двигателя), `data/values-xml-3.xml` (OEM двигателя), `data/values-xml-4.xml` (SAE двигателя). Их root/item-теги совпадают с заявленным назначением файлов `values-4.xml`, `values-5.xml`, `values-6.xml`, `values-2.xml` соответственно.
3. **Сравнение с новыми файлами.** Побайтовое сравнение невозможно, потому что новые XML отсутствуют. SHA-256 старых файлов: ACEA `b62f119ee1d52a50bb00ea168def3506389b5d984861ea2b08ba9fb9d30b30a4`; API `5823ab11038112a13f60a9fc87cfbec542e6fafe76296273fcf898e61a4b07de`; OEM `f294e3660b45ede71b4a798bf2c7d915d605881faac27e40192f971a369f46b8`; SAE `69453b7858fee9b6cea5653dbd81eab4df2d0a880f616766f96f5deb7209386b`.
4. **Текущая загрузка.** `src/lib/oil-dictionaries.ts` синхронно читает XML через `readFileSync` в runtime и кеширует четыре массива в памяти. Клиентская форма словари не загружает.
5. **Текущая нормализация.** `normalizeSAE/ACEA/API/ILSAC/OEM` расположены в `src/lib/oil-normalizer.ts`; matching helpers — в `src/lib/oil-dictionaries.ts`. Подбор масла импортирует этот слой.
6. **Редактор товара.** Поля находятся в `src/app/inventory/products/ProductsClient.tsx`, секции «Главное» и «Характеристики масла».
7. **Текущие controls.** Brand, SAE, packageVolume, API, ACEA, ILSAC и ATF — обычные текстовые input; OEM жидкости — textarea. Searchable/creatable UI и chips отсутствуют.
8. **Multiple values.** Структурной сериализации нет: форма сохраняет введённую строку как есть. Facets считают всю строку `C3; A3/B4` одним значением.
9. **Ошибочное использование `/`.** `src/lib/oil-dictionaries.ts` и `src/lib/oil-normalizer.ts` делят SAE/ACEA/API/OEM/ILSAC по `/`; `findCanonical` дополнительно использует небезопасный first-contains. Это ломает `A3/B4`, `SN/CF`, `VW 504.00/507.00`.
10. **Аномалии старых source.** ACEA содержит кириллическое `А4`; API содержит ILSAC-кандидаты `GF-4`, `GF-5` и transmission-кандидаты `GL-3`, `GL-4`, `GL-5`; OEM содержит 11 ILSAC, `ACEA E4/E7`, `API CI-4/CH-4` и `SN Plus`. SAE содержит спорное составное `15W/40-50` и placeholder `Не подлежит классификации по SAE`; они не будут удалены молча.
11. **ILSAC.** Из старого OEM source извлекается 11 значений GF-1…GF-7B; GF-4/GF-5 из API дают те же canonical values и отдельный provenance.
12. **GF/GL reclassification.** `GF-4`, `GF-5` переходят из engine API в ILSAC. `GL-3`, `GL-4`, `GL-5` переходят в transmission API. Перемещения отражаются в generated audit и покрываются тестами.
13. **Коллизии.** В исходных четырёх XML нет exact-дублей. По безопасному ключу case/whitespace/dash/confusable коллизий до derived reclassification не найдено; генератор дополнительно построит collision map для более широких field-specific lookup keys и запретит автоподстановку неоднозначных ключей.
14. **Определение типа товара.** Сейчас один локальный `productGroupKindFromGroup()` объединяет моторные, трансмиссионные и прочие жидкости в тип `oil`. Нужен единый resolver `ENGINE_OIL | TRANSMISSION_FLUID | OTHER` по `groupPath`, `group/category code`, `entityType`, с сохранением заполненных legacy-полей.
15. **Prisma migration.** Не нужна: `LocalProduct.brand`, `sae`, `packageVolume`, `acea`, `apiSpec`, `ilsac`, `atf`, `oem`, `oemAtf` уже существуют и подходят для `; ` serialization. Dirty-state формы уже есть; update API сохраняет отсутствующие в payload поля без изменений.
16. **Generated files.** `scripts/generate-product-attribute-dictionaries.mjs`, `src/generated/product-attribute-dictionaries.json`, JSON/Markdown data-quality report. Генератор поддержит строгий режим для всех десяти semantic source и явный bootstrap-режим для четырёх найденных legacy source.
17. **UI components.** `src/components/products/CreatableSearchCombobox.tsx` и `CreatableMultiCombobox.tsx`, общий API-клиент/типы, portal popup, keyboard/ARIA, loading/empty/error/retry, canonical suggestion, custom status, максимум 40 результатов.
18. **Планируемые изменения.** `package.json`; четыре source/generator/report файла; `src/generated/*`; `src/lib/product-attribute-values.ts`; `src/lib/product-fluid-profile.ts`; `src/lib/oil-dictionaries.ts`; `src/lib/oil-normalizer.ts`; `src/lib/local-inventory-admin.ts`; `src/lib/product-import-export.ts`; options API route; оба combobox; `ProductsClient.tsx`; `globals.css`; audit/dry-run/test scripts. Копирование между филиалами останется lossless и не будет повторно нормализовать данные.

## Итоговый статус source-набора

Все десять XML повторно переданы 2026-09-02 и сохранены под семантическими именами в `data/product-attributes/source/`. Проверка подтвердила ожидаемые root/item-теги. `values-2.xml`, `values-4.xml`, `values-5.xml`, `values-6.xml` побайтово совпадают с четырьмя прежними файлами; остальные шесть являются новыми для репозитория.

Строгая генерация завершена без missing source: версия `52a1a8b775c4ff10`, 10/10 source, 0 collision. Итоговые размеры: Brand 690, engine SAE 42, transmission SAE 53, package volume 443, ACEA 34, engine API 49, transmission API 22, ILSAC 11, ATF 63, engine OEM 509, transmission OEM 870. Полные SHA-256, reclassification и anomalies находятся в `docs/product-attribute-data-quality-report.md`.

## Аудит локальной восстановленной БД

Read-only audit выполнен на локальной базе `eco_sales_manifest_20260802`: 1 752 товара, 14 групп. Копия имеет legacy-схему без `branch_id`, поэтому в отчёте она явно помечена `LEGACY_UNSCOPED`; production не запрашивался. Полный отчёт сохранён в `docs/product-fluid-attribute-db-audit-2026-09-02.json`.

Dry-run сформировал 169 предложений: 105 безопасны для автоматического применения, 64 содержат custom fragments и оставлены для ручной проверки. Записи не выполнялись, `--apply` не запускался. Детализация `productId/name/field/before/after/method/confidence/warnings` сохранена в `docs/product-fluid-attribute-normalization-dry-run-2026-09-02.json`.
