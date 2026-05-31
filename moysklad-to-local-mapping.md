# MoySklad To Local Mapping

Generated: 2026-05-28

Legacy MoySklad identifiers are nullable and must not block creation of new local documents. New runtime writes should prefer local ids and `local://...` meta hrefs.

## Organization

| MoySklad | Local |
| --- | --- |
| `organization.id` | `LocalOrganization.moyskladId` |
| `organization.meta.href` | `LocalOrganization.moyskladHref` |
| `organization.name` | `LocalOrganization.name` |
| `organization.archived` | `LocalOrganization.isActive = !archived` |
| full row | `LocalOrganization.raw` |
| import time | `LocalOrganization.syncedAt` |

## Store

| MoySklad | Local |
| --- | --- |
| `store.id` | `LocalStore.moyskladId` |
| `store.meta.href` | `LocalStore.moyskladHref` |
| `store.name` | `LocalStore.name` |
| `store.archived` | `LocalStore.archived` |
| main/default decision | `LocalStore.isMain` |
| full row | `LocalStore.raw` |
| import time | `LocalStore.syncedAt` |

## Counterparty / Client / Supplier

| MoySklad | Local |
| --- | --- |
| `counterparty.id` | `LocalCounterparty.moyskladId` |
| `counterparty.meta.href` | `LocalCounterparty.moyskladHref` |
| `counterparty.name` | `LocalCounterparty.name` |
| `counterparty.phone` / `phones[]` | `LocalCounterparty.phone`, `phonesRaw`, `normalizedPhone` |
| `counterparty.email` | `LocalCounterparty.email` |
| `companyType` | `LocalCounterparty.companyType`, `counterpartyTypeName` |
| legal fields | `legalTitle`, `legalLastName`, `legalFirstName`, `legalMiddleName`, `legalAddress` |
| tax/bank fields | `inn`, `kpp`, `okpo`, `ogrn`, `ogrnip`, `bik`, `bankName`, `checkingAccount`, `correspondentAccount` |
| `archived` | `LocalCounterparty.archived` |
| searchable text | `LocalCounterparty.searchText` |
| full row | `LocalCounterparty.raw` |
| import time | `LocalCounterparty.syncedAt` |

## Product / Service

| MoySklad | Local |
| --- | --- |
| `product.id` / `service.id` | `LocalProduct.moyskladId` |
| `meta.href` | `LocalProduct.moyskladHref` |
| `meta.type` | `LocalProduct.entityType` |
| `name` | `LocalProduct.name` |
| `article` | `LocalProduct.article` |
| `code` | `LocalProduct.code` |
| `externalCode` | `LocalProduct.externalCode` |
| `pathName` / group | `LocalProduct.groupPath` |
| `uom.name` | `LocalProduct.uomName` |
| `salePrices[0].value` | `LocalProduct.salePriceCents` |
| `buyPrice.value` | `LocalProduct.buyPriceCents` |
| `minimumBalance` | `LocalProduct.minimumBalance` |
| barcodes | `barcodeEan13`, `barcodeEan8`, `barcodeCode128` |
| `vat`, `vatEnabled` | `LocalProduct.vatLabel` |
| `supplier.name` | `LocalProduct.supplierName` |
| oil attributes `SAE`, `OEM`, `ACEA`, `API`, `ILSAC`, volume | `sae`, `oem`, `acea`, `apiSpec`, `ilsac`, `packageVolume` |
| product attributes | `LocalProduct.attributes`, typed convenience columns |
| image refs | `LocalProduct.imageHref`, `LocalProductPhoto` after photo import |
| `archived` | `LocalProduct.archived` |
| full row | `LocalProduct.raw` |
| import time | `LocalProduct.syncedAt` |

## Stock Balance

| MoySklad | Local |
| --- | --- |
| `/report/stock/bystore` row assortment id | `LocalStockBalance.productId` via `LocalProduct.moyskladId` |
| `stockByStore[].name` | `LocalStockBalance.storeId` via `LocalStore.name` |
| `stockByStore[].stock` | `LocalStockBalance.quantity` |
| `stockByStore[].reserve` | `LocalStockBalance.reserve` |
| `stock - reserve` | `LocalStockBalance.available` |
| product buy price | `LocalStockBalance.buyPriceCents` |
| product cell / slot | `LocalStockBalance.slotName` |
| import time | `LocalStockBalance.syncedAt` |

## Demand / Shipment

| MoySklad | Local |
| --- | --- |
| `demand.id` | `LocalDemand.moyskladId` |
| `demand.meta.href` | `LocalDemand.moyskladHref` |
| `demand.name` | `LocalDemand.name` |
| `demand.moment` | `LocalDemand.momentAt`, `documentDate` |
| `demand.applicable` | `LocalDemand.applicable` |
| `demand.sum` | `LocalDemand.sumCents` |
| `demand.description` | `LocalDemand.description` |
| `demand.agent.meta.href` | `LocalDemand.agentMoyskladId`, `counterpartyId` via `LocalCounterparty.moyskladId` |
| `demand.agent.name` | `LocalDemand.agentNameSnapshot` |
| `demand.store.meta.href` | `LocalDemand.storeMoyskladId`, `storeId` via `LocalStore.moyskladId` |
| `demand.store.name` | `LocalDemand.storeNameSnapshot` |
| `demand.organization.meta.href` | `LocalDemand.organizationId` via `LocalOrganization.moyskladId` |
| `demand.organization.name` | `LocalDemand.organizationName` |
| `demand.attributes` | `LocalDemand.attributes` |
| full row | `LocalDemand.raw` |
| import time | `LocalDemand.syncedAt` |

## Demand Position

| MoySklad | Local |
| --- | --- |
| `position.id` | `LocalDemandPosition.moyskladPositionId` |
| parent demand | `LocalDemandPosition.demandId` |
| `position.assortment.meta.href` | `assortmentMoyskladId`, `productId` via `LocalProduct.moyskladId` |
| `position.assortment.meta.type` | `assortmentType` |
| `position.assortment.name` | `name` |
| `quantity` | `quantity` |
| `price` | `priceCentsPerUnit` |
| `discount` | `discount` |
| `vat`, `vatEnabled` | `vat`, `vatEnabled` |
| `cost` / assortment `buyPrice.value` | `buyPriceCentsPerUnit` |
| `slot.name` | `slotName` |
| full row | `raw` |

## Supply / Receipt

| MoySklad | Local |
| --- | --- |
| `supply.id` | Recommended: `LocalInventoryDocument.moyskladId` nullable |
| `supply.meta.href` | Recommended: `LocalInventoryDocument.moyskladHref` nullable |
| `supply.name` | `LocalInventoryDocument.name` |
| type | `LocalInventoryDocument.type = receipt` |
| `supply.moment` | `momentAt`, `documentDate` |
| `supply.applicable` | `applicable` |
| `supply.sum` | `sumCents` |
| `supply.description` | `description` |
| `supply.agent` | `counterpartyId`, `counterpartyNameSnapshot` |
| `supply.store` | `storeId`, `storeNameSnapshot` |
| positions | `LocalInventoryDocumentPosition` |
| incoming invoice fields | `LocalSupplierInvoice.number`, `invoiceDate`, `sumCents` |

## Writeoff / Loss

| MoySklad | Local |
| --- | --- |
| `loss.id` | Recommended: `LocalInventoryDocument.moyskladId` nullable |
| `loss.meta.href` | Recommended: `LocalInventoryDocument.moyskladHref` nullable |
| type | `LocalInventoryDocument.type = writeoff` |
| `moment`, `applicable`, `sum`, `description` | `momentAt`, `applicable`, `sumCents`, `description` |
| `store` | `storeId`, `storeNameSnapshot` |
| positions | `LocalInventoryDocumentPosition` |

## Cashout / Cash Expense Order

| MoySklad | Local |
| --- | --- |
| `cashout.id` | Recommended: `CashExpenseOrder.moyskladCashoutId` nullable |
| `cashout.meta.href` | `CashExpenseOrder.moyskladCashoutHref` |
| `cashout.name` | `CashExpenseOrder.number` |
| `cashout.applicable` | `status = posted/draft` |
| `cashout.sum` | `amountCents` |
| `cashout.moment` | `expenseDate` |
| `cashout.expenseItem.meta.href` | `CashExpenseOrder.moyskladExpenseItemHref`, `expenseItemId` |
| `cashout.expenseItem.name` | `expenseItemName` |
| `cashout.agent.meta.href` | `moyskladCounterpartyHref`, `counterpartyId` |
| `cashout.agent.name` | `counterpartyName` |
| `cashout.paymentPurpose` | `paymentPurpose`, fallback `article` |
| full row | `raw` if future field is added; current model stores structured fields |

## Supplier Invoice / Payment

| MoySklad | Local |
| --- | --- |
| supplier invoice id/href | Recommended nullable legacy fields if remote import is required |
| local receipt document | `LocalSupplierInvoice.documentId` |
| invoice number/date/due/status | `number`, `invoiceDate`, `dueDate`, `status` |
| amount paid | `paidAmountCents` |
| payment history | `LocalSupplierInvoicePayment` |
| cash payment | `LocalSupplierInvoicePayment.cashExpenseOrderId` -> `CashExpenseOrder` |

## Rule

All local create/edit flows must work when every MoySklad legacy field above is `null`. Legacy ids are for import, lookup, debug links, and one-time verification only.
