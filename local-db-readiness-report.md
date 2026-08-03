# Local DB Readiness Report

Generated: 2026-05-28

Static schema readiness was checked against `prisma/schema.prisma` and current local service code. Data population must be verified in the target runtime with `pnpm sync:moysklad:last-days --days=14 --mode=audit`; this workspace could not safely count DB rows because Prisma engine loading failed in the local desktop runtime.

| Сущность | Есть локальная модель | Данные заполнены | Есть связи | Есть индексы | Готово к отключению МойСклад | Что нужно доделать |
| --- | --- | --- | --- | --- | --- | --- |
| Организации | Да: `LocalOrganization` | Проверить audit | Да, `LocalDemand`, `CashExpenseOrder` | `name`, `isActive`, unique `moyskladId` | Да | Заполнить минимум одну активную организацию |
| Склады | Да: `LocalStore` | Проверить audit | Да, остатки, отгрузки, документы | `name`, unique `moyskladId` | Да | Проверить главный склад и архивность |
| Пользователи / сотрудники | Да: env users + `Shift`, `ShiftRate` | Проверить auth env | Да, смены/зарплата | смены unique по login/date | Да | Убедиться, что зарплата не требует МойСклад cashout |
| Клиенты / контрагенты | Да: `LocalCounterparty` | Проверить audit | Да, отгрузки, документы, касса | `name`, `normalizedPhone`, `inn`, unique `moyskladId` | Да | Нормализовать телефоны для истории клиентов |
| Автомобили клиентов | Частично: CRM/diagnostic/records поля | Проверить UI | Частично | Есть по diagnostics VIN | Частично | Если нужна отдельная карточка авто, добавить модель |
| Товары | Да: `LocalProduct` | Проверить audit | Да, остатки, позиции | много индексов, unique `moyskladId` | Да | Проверить цены, атрибуты масла, фото |
| Услуги | Да: `LocalProduct.entityType=service` | Проверить audit | Да, позиции отгрузки | `entityType`, `name`, unique `moyskladId` | Да | Проверить сдельные правила по service id/name |
| Группы товаров | Частично: `LocalProduct.groupPath` | Проверить audit | Через product | `groupPath` | Да для текущих расчётов | Отдельная модель нужна только для редактируемого справочника групп |
| Поставщики | Да: `LocalCounterparty` | Проверить audit | Да, receipts/invoices/cash | `name`, `inn`, phone | Да | Разметить supplier type при необходимости |
| Статьи расходов | Да: `CashExpenseItem` | Проверить seed | Да, `CashExpenseOrder` | `isActive`, `source`, unique name, unique `moyskladId` | Да | Убедиться в default items |
| Цены | Да: `salePriceCents`, `buyPriceCents` | Проверить audit | Да | indexes on sale/buy price | Да | Проверить копейки и отображение рублей |
| Закупочные цены | Да: product/balance/document positions | Проверить audit | Да | `buyPriceCents` index | Да | Проверить обновление при receipt |
| Остатки | Да: `LocalStockBalance` | Проверить audit | Да, product/store | unique product+store, indexes product/store/available | Да | Не делать destructive refresh без verify |
| Минимальные остатки | Да: `LocalProduct.minimumBalance` | Проверить audit | Да | product indexes | Да | Проверить restock экран |
| Единицы измерения | Да: `LocalProduct.uomName` | Проверить audit | Нет отдельной модели | product field | Да | Отдельная модель не нужна для текущего UI |
| НДС / налоговые параметры | Частично: `vatLabel`, positions `vat`, `vatEnabled` | Проверить audit | Да на позициях | Нет отдельных | Частично | Если нужен налоговый учёт, добавить справочник ставок |
| Отгрузки | Да: `LocalDemand` | Проверить audit | Да, counterparty/store/org/positions | date/moment/applicable/counterparty/store/org/unique `moyskladId` | Да | Проверить проведение и остатки |
| Позиции отгрузки | Да: `LocalDemandPosition` | Проверить audit | Да, demand/product | demand/product/assortment, unique position id | Да | Проверить строки без productId |
| Приёмки / поступления | Да: `LocalInventoryDocument(type=receipt)` | Проверить audit | Да, positions/store/counterparty/invoice | type/date/moment/counterparty/store + legacy indexes | Частично | Nullable legacy-поля добавлены; automatic import supplies требует проверенного transformer/upsert |
| Позиции приёмки | Да: `LocalInventoryDocumentPosition` | Проверить audit | Да | document/product | Да для локальных документов | Legacy MoySklad position id отсутствует |
| Списания | Да: `LocalInventoryDocument(type=writeoff)` | Проверить local UI | Да | type/date/moment/store + legacy indexes | Частично | Nullable legacy-поля добавлены; automatic import losses требует проверенного transformer/upsert |
| Позиции списаний | Да: `LocalInventoryDocumentPosition` | Проверить local UI | Да | document/product | Да для локальных документов | Legacy MoySklad position id отсутствует |
| Расходные ордера | Да: `CashExpenseOrder` | Проверить audit | Да, shift/item/counterparty/org/store | shift/status/date/item/counterparty/payment/source + legacy indexes | Да | Nullable `moyskladId`/`moyskladHref` добавлены; специфичные href-поля сохранены для истории |
| Счета поставщиков | Да: `LocalSupplierInvoice` | Проверить UI | Да, receipt document/payments | date/due/status/source/counterparty snapshot + legacy indexes | Да | Nullable legacy-поля добавлены; remote supplier invoices import остаётся manual-review до проверки связей |
| Оплаты счетов поставщиков | Да: `LocalSupplierInvoicePayment` | Проверить UI | Да, invoice/cashExpenseOrder | invoice/date/type/cash order + legacy indexes | Да | Nullable legacy-поля добавлены; проверить cash payment creates cash order |
| Кассовые смены | Да: `Shift` + cashbox state | Проверить UI | Да | unique user/date | Да | `.data/cashbox.json` является runtime state |
| Кассовые операции | Да: `CashExpenseOrder` + AQSI helpers | Проверить UI | Да | cash order indexes | Да | Убедиться, что зарплатные выплаты локальные |
| Предчеки | Да: local demand payment route + AQSI | Проверить smoke | Да | local demand positions | Да | Live fallback blocked by read flag |
| CRM-дела | Да: `CrmDeal`, `CrmStage` | Проверить UI | Да | phone, stage, status, moysklad legacy | Да | Убрать UI-текст "создать в МойСклад" |
| Записи клиентов | Да: appointments/records routes | Проверить UI | Да | см. routes | Да | Нет MoySklad blocker |
| Клиентская аналитика | Да: local/snapshot models | Проверить UI | Да | analytics snapshot indexes | Да | Long-term migrate from `MoySkladDemandSync` naming to local-neutral |

## Legacy Fields

- Already nullable and non-blocking: `LocalOrganization.moyskladId/moyskladHref`, `LocalStore.moyskladId/moyskladHref`, `LocalProduct.moyskladId/moyskladHref/externalCode/syncedAt`, `LocalCounterparty.moyskladId/moyskladHref/syncedAt`, `LocalDemand.moyskladId/moyskladHref/syncedAt`, `LocalDemandPosition.moyskladPositionId`.
- Step 12 migration adds nullable and non-blocking legacy fields to `LocalInventoryDocument`, `LocalInventoryDocumentPosition`, `LocalSupplierInvoice`, `LocalSupplierInvoicePayment`, and `CashExpenseOrder`: `moyskladId` or position id, `moyskladHref`, `moyskladMetaHref`, `externalCode`, `source`, `syncedAt`, `syncStatus`, `syncError`.
- Existing local creates do not require these fields. `source` has a local default where needed; `syncedAt`, `syncStatus`, and `syncError` are nullable for new local-only records.
- `CashExpenseOrder` keeps older specific href fields (`moyskladCashoutHref`, `moyskladExpenseItemHref`, `moyskladCounterpartyHref`) for history and now also has generic nullable `moyskladId`/`moyskladHref`.

## Readiness Decision

Local runtime can be tested with MoySklad disabled after catalog, stock, counterparties, and demands pass audit/backfill/verify. Automatic import of supplies/writeoffs must stay manual-review until legacy keys are added to `LocalInventoryDocument`.

Step 9 update: ordinary read paths now use local DB sources by default. `MOYSKLAD_ENABLED`, `MOYSKLAD_READ_ENABLED`, `MOYSKLAD_WRITE_ENABLED`, and `MOYSKLAD_SYNC_ENABLED` are false in templates; live MoySklad reads are not required for shipment, warehouse, salary, cash, CRM, oil lookup, restock, or supplier receipt screens.

Step 12 update: legacy fields are retained and expanded as nullable audit metadata. They must not be removed until final verify/smoke passes and rollback risk is closed.

Step 13 update: rollback plan is documented in `moysklad-rollback-plan.md`. Backfill remains blocked until DB backup and env/config backup are confirmed; rollback uses read-only flags and keeps `MOYSKLAD_WRITE_ENABLED=false`.

Step 14 update: acceptance gate is documented in `moysklad-acceptance-report.md`. Full acceptance remains blocked until live audit/backfill/verify and smoke tests are completed in the target environment.
