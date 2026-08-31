#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const {
  groupRosskoOrderParts,
  normalizeRosskoOrder,
  restoreRosskoReceiptSourceSnapshot,
  rosskoSourceLineKey,
  rosskoStatusPresentation,
  serializeRosskoReceiptSourceSnapshot,
} = await jiti.import("../src/lib/rossko-receipt.ts");

const officialPayload = {
  success: true,
  OrdersList: {
    Order: [{
      id: 182269117,
      created_date: "2026-08-10 11:35:00",
      delivery_date: "2026-08-11",
      total_price: "2632,40",
      payment_status: "Не оплачено",
      stock_address: "Калининград",
      detail: { delivery_type: "Самовывоз" },
      parts: {
        part: [
          { guid: "guid-1", partnumber: "W 811/80", name: "Фильтр масляный", brand: "MANN-FILTER", price: "612,40", count: 2, delivery: 1, status: 6, comment: "Коробка целая" },
          { guid: "guid-2", partnumber: "AP 139/2", name: "Фильтр воздушный", brand: "Filtron", price: 1407.6, count: 1, delivery: 2, status: 7 },
        ],
      },
    }],
  },
};

const order = normalizeRosskoOrder(officialPayload, "182269117");
assert.equal(order.id, "182269117", "parser extracts Order.id");
assert.equal(order.createdAt?.getFullYear(), 2026, "parser extracts created_date");
assert.equal(order.createdAt?.getMonth(), 7);
assert.equal(order.createdAt?.getDate(), 10);
assert.equal(order.totalPrice, 2632.4);
assert.equal(order.paymentStatus, "Не оплачено");
assert.equal(order.stockAddress, "Калининград");
assert.equal(order.parts.length, 2);
assert.equal(order.parts[0].guid, "guid-1", "parser extracts part.guid");
assert.equal(order.parts[0].status, 6, "parser extracts part.status");
assert.equal(order.parts[0].comment, "Коробка целая", "parser extracts part.comment");
assert.equal(order.parts[0].normalizedArticle, "W81180");
assert.equal(order.parts[0].orderedQty, 2);
assert.equal(order.parts[0].price, 612.4);
assert.equal(rosskoStatusPresentation(6).warning, false);
assert.equal(rosskoStatusPresentation(7).warning, true);
assert.equal(rosskoStatusPresentation(8).label, "Отменён клиентом");
assert.equal(rosskoStatusPresentation(36).warning, true);
assert.equal(rosskoStatusPresentation(999).warning, true, "unknown source status requires manual confirmation");

const immutableKey = rosskoSourceLineKey(order.id, order.parts[0].guid);
assert.equal(immutableKey, "rossko:182269117:guid-1");
const changedMutableFields = { ...order.parts[0], price: 999, status: 9, orderedQty: 1, name: "Новое имя" };
assert.equal(rosskoSourceLineKey(order.id, changedMutableFields.guid), immutableKey, "mutable fields do not affect source identity");

const identicalDuplicates = groupRosskoOrderParts([order.parts[0], { ...order.parts[0] }]);
assert.equal(identicalDuplicates.length, 1);
assert.equal(identicalDuplicates[0].duplicateCount, 2);
assert.equal(identicalDuplicates[0].ambiguous, false);

const conflictingDuplicates = groupRosskoOrderParts([
  order.parts[0],
  { ...order.parts[0], orderedQty: 3, raw: { ...order.parts[0].raw, count: 3 } },
]);
assert.equal(conflictingDuplicates.length, 1);
assert.equal(conflictingDuplicates[0].ambiguous, true, "different rows with duplicate GUID are ambiguous");

const persistedSnapshot = JSON.parse(JSON.stringify(serializeRosskoReceiptSourceSnapshot({
  ...order,
  parts: [
    order.parts[0],
    { ...order.parts[0] },
    order.parts[1],
  ],
})));
const restoredSnapshot = restoreRosskoReceiptSourceSnapshot(persistedSnapshot, order.id);
assert.ok(restoredSnapshot, "a JSON-persisted preview snapshot can be restored without ROSSKO");
assert.equal(restoredSnapshot.parts.length, 3);
assert.equal(restoredSnapshot.parts[0].article, order.parts[0].article);
assert.equal(restoredSnapshot.parts[0].price, order.parts[0].price);
assert.equal(groupRosskoOrderParts(restoredSnapshot.parts)[0].ambiguous, false, "identical provider duplicates stay identical after snapshot restore");
assert.equal(restoreRosskoReceiptSourceSnapshot(persistedSnapshot, "999"), null, "a snapshot cannot be used for another order");

assert.throws(
  () => normalizeRosskoOrder({ Orders: { Order: [{ id: 42, parts: { part: Array.from({ length: 241 }, (_, index) => ({ guid: `g-${index}` })) } }] } }, "42"),
  (error) => error?.code === "ROSSKO_ORDER_TOO_LARGE",
  "oversized orders must fail instead of being silently truncated",
);

const [service, inventory, importer, previewRoute, draftRoute, ui, restockUi, stockDocumentUi, schema] = await Promise.all([
  readFile("src/lib/rossko-receipt.ts", "utf8"),
  readFile("src/lib/local-inventory-admin.ts", "utf8"),
  readFile("src/lib/rossko-product-import.ts", "utf8"),
  readFile("src/app/api/rossko/orders/[orderId]/receipt-preview/route.ts", "utf8"),
  readFile("src/app/api/rossko/orders/[orderId]/receipt-draft/route.ts", "utf8"),
  readFile("src/components/receipts/RosskoReceiptWorkspace.tsx", "utf8"),
  readFile("src/app/operations/restock/RestockClient.tsx", "utf8"),
  readFile("src/app/inventory/StockDocumentClient.tsx", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
]);

assert.match(service, /type NormalizedRosskoOrderPart/);
assert.match(service, /AMBIGUOUS_SOURCE_LINE/);
assert.match(service, /AMBIGUOUS_PRODUCT/);
assert.match(service, /normalizeRosskoArticle/);
assert.match(service, /rosskoPartNumber/);
assert.match(service, /normalized_brand_article/);
assert.match(service, /resolveOrCreateRosskoLocalProduct/);
assert.match(service, /suggestedProductName:\s*buildRosskoProductName/);
assert.match(service, /newProductName:\s*line\.newProductName/);
assert.match(service, /NEW_PRODUCT_NAME_REQUIRED/);
assert.match(importer, /nameOverride\?:\s*string\s*\|\s*null/);
assert.match(service, /error instanceof RosskoProductImportError/);
assert.match(service, /ROSSKO_RECEIPT_PRODUCT_CREATE_FAILED/);
assert.match(importer, /export async function resolveOrCreateRosskoLocalProduct/);
assert.match(importer, /pg_advisory_xact_lock/);
assert.match(importer, /minimumBalance:\s*0/);
assert.match(service, /position\.document\.status === "posted"/);
assert.match(service, /position\.document\.applicable/);
assert.match(service, /cancelledAt:\s*null/);
assert.match(service, /isDeleted:\s*false/);
assert.match(service, /status:\s*"draft"[\s\S]*applicable:\s*false/);
assert.match(service, /pendingDraftQuantityByLine/);
assert.match(service, /OVER_RECEIPT/);
assert.match(service, /TOO_MANY_RECEIPT_LINES/);
assert.match(service, /INVALID_RECEIVE_QTY/);
assert.match(service, /rossko-receipt-draft:\$\{branchId\}:\$\{orderId\}:\$\{fingerprint\}/);
assert.match(service, /rossko-receipt:\$\{branchId\}:\$\{orderId\}/);
assert.match(service, /pg_advisory_xact_lock/);
assert.match(service, /source:\s*ROSSKO_SOURCE/);
assert.match(service, /externalCode:\s*orderId/);
assert.match(service, /externalCode:\s*sourceLine\.sourceLineKey/);
assert.match(service, /sourceOrderCreatedAt/);
assert.match(service, /alreadyReceivedAtImport/);
assert.match(service, /idempotencyKey/);
assert.match(service, /createLocalStockDocument/);
assert.doesNotMatch(service, /localStockBalance\.(create|update|upsert)/i, "draft service must not mutate stock");
assert.doesNotMatch(service, /inventoryLedgerEntry\.(create|update|upsert)/i, "no ROSSKO-specific stock engine");
assert.match(inventory, /export async function postLocalReceipt/);
assert.match(inventory, /source:\s*position\.sourcePosition\?\.source/);
assert.match(inventory, /externalCode:\s*position\.sourcePosition\?\.externalCode/);
assert.match(inventory, /uniqueRosskoProductPosition/);
assert.match(inventory, /currentPositionById\.get\(sourcePositionId\)\s*\?\?\s*uniqueRosskoProductPosition/);
assert.match(stockDocumentUi, /documentPositionId:\s*position\.id/);
assert.match(stockDocumentUi, /fillFormFromDocument\(persistedDocument, nextApplicable \? "view" : "edit"\)/);
assert.match(previewRoute, /getSession/);
assert.match(previewRoute, /requireBranchApi\(\{ allowAll: false, requireActive: true \}\)/);
assert.match(previewRoute, /runWithBranchApiContext/);
assert.match(draftRoute, /getSession/);
assert.match(draftRoute, /requireBranchApi\(\{ allowAll: false, requireActive: true \}\)/);
assert.match(draftRoute, /runWithBranchApiContext/);
assert.match(service, /FOREIGN_STORE/);
assert.match(service, /FOREIGN_PRODUCT/);
assert.match(service, /resolveRosskoSupplierCounterparty/);
assert.match(service, /sourceProvider:\s*ROSSKO_SOURCE/);
assert.match(service, /ROSSKO_RECEIPT_PREVIEWED/);
assert.match(service, /sourceSnapshot:\s*serializeRosskoReceiptSourceSnapshot\(order\)/);
assert.match(service, /loadPreviewedRosskoOrder\(tx, branchId, orderId\)/);
const draftService = service.slice(service.indexOf("export async function createRosskoReceiptDraft"));
assert.doesNotMatch(draftService, /loadNormalizedOrder\(/, "draft creation must not repeat the external ROSSKO request after preview");
assert.match(service, /ROSSKO_RECEIPT_DRAFT_CREATED/);
assert.match(service, /ROSSKO_RECEIPT_PARTIAL/);
assert.match(service, /ROSSKO_RECEIPT_PRICE_DEVIATION/);
assert.match(service, /ROSSKO_RECEIPT_SOURCE_STATUS_WARNING/);
assert.match(service, /ORDER_FULLY_RECEIVED/);
assert.match(ui, /Принять на склад/);
assert.match(ui, /Заказ ROSSKO №/);
assert.match(ui, /Создать черновик приёмки/);
assert.match(ui, /Название новой карточки/);
assert.match(ui, /newProductNames\[line\.sourceLineKey\]/);
assert.match(ui, /Открыть приёмку/);
assert.match(stockDocumentUi, /Заказы ROSSKO/);
assert.match(stockDocumentUi, /searchParams\.get\("rossko"\) !== "1"/);
assert.match(restockUi, /href="\/inventory\/receipts\?rossko=1"/);
assert.match(stockDocumentUi, /RosskoReceiptWorkspace/);
assert.doesNotMatch(restockUi, /onClick=\{\(\) => setIncomingOpen\(true\)\}/, "receipt workspace must not open from replenishment");
assert.doesNotMatch(restockUi, /<span>№ ROSSKO<\/span>/, "ROSSKO receipt order input belongs to inventory receipts");
assert.doesNotMatch(ui, /ООО\s*["«]?ГРИНЛАЙТ/i);
assert.match(schema, /source\s+String\s+@default\("local"\)/);
assert.match(schema, /externalCode\s+String\?/);

console.log("ROSSKO receipt flow contract — passed");
