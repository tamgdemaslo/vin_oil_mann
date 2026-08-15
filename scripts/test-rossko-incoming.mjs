#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const {
  calculateRosskoIncomingQuantities,
  classifyRosskoDelivery,
  normalizeRosskoOrderPartStatus,
} = await jiti.import("../src/lib/rossko-order-status.ts");
const { normalizeRosskoOrder } = await jiti.import("../src/lib/rossko-receipt.ts");

for (const status of [0, 1, 2, 3, 5, 6, 31]) {
  assert.equal(normalizeRosskoOrderPartStatus(status).activeIncoming, true, `status=${status} remains active incoming`);
}
assert.equal(normalizeRosskoOrderPartStatus(0).state, "PENDING");
assert.equal(normalizeRosskoOrderPartStatus(1).state, "ASSEMBLING");
assert.equal(normalizeRosskoOrderPartStatus(2).state, "IN_TRANSIT");
assert.equal(normalizeRosskoOrderPartStatus(3).state, "READY");
assert.equal(normalizeRosskoOrderPartStatus(6).state, "AT_BRANCH");
assert.equal(normalizeRosskoOrderPartStatus(7).state, "UNAVAILABLE");
assert.equal(normalizeRosskoOrderPartStatus(8).state, "CANCELLED");
assert.equal(normalizeRosskoOrderPartStatus(9).state, "EXPIRED");
assert.equal(normalizeRosskoOrderPartStatus(32).state, "RETURN");
assert.equal(normalizeRosskoOrderPartStatus(44).state, "RETURN");

for (const status of [7, 8, 9]) {
  const quantities = calculateRosskoIncomingQuantities({ orderedQty: 10, postedReceivedQty: 0, manualClosedQty: 0, sourceStatus: status });
  assert.equal(quantities.activeIncomingQty, 0, `terminal status=${status} is excluded from incoming`);
  assert.equal(quantities.providerClosedQty, 10);
}

const active = calculateRosskoIncomingQuantities({ orderedQty: 10, postedReceivedQty: 0, manualClosedQty: 0, sourceStatus: 1 });
assert.equal(active.activeIncomingQty, 10, "active order is in transit");

const partial = calculateRosskoIncomingQuantities({ orderedQty: 20, postedReceivedQty: 12, manualClosedQty: 0, sourceStatus: 2 });
assert.equal(partial.activeIncomingQty, 8, "partial receipt leaves the remainder incoming");
assert.equal(partial.postedReceivedQty, 12);

const providerCancelledRemainder = calculateRosskoIncomingQuantities({ orderedQty: 20, postedReceivedQty: 12, manualClosedQty: 0, sourceStatus: 8 });
assert.equal(providerCancelledRemainder.activeIncomingQty, 0);
assert.equal(providerCancelledRemainder.providerClosedQty, 8, "provider closes only the unreceived remainder");

const partialManualClose = calculateRosskoIncomingQuantities({ orderedQty: 10, postedReceivedQty: 0, manualClosedQty: 6, sourceStatus: 1 });
assert.equal(partialManualClose.manualClosedQty, 6);
assert.equal(partialManualClose.activeIncomingQty, 4, "manual close can leave an active remainder");

const fullManualClose = calculateRosskoIncomingQuantities({ orderedQty: 10, postedReceivedQty: 0, manualClosedQty: 10, sourceStatus: 1 });
assert.equal(fullManualClose.activeIncomingQty, 0);
assert.equal(fullManualClose.closedQty, 10);

const clampedManualClose = calculateRosskoIncomingQuantities({ orderedQty: 10, postedReceivedQty: 4, manualClosedQty: 20, sourceStatus: 1 });
assert.equal(clampedManualClose.manualClosedQty, 6, "pure calculation never closes beyond unresolved quantity");
assert.equal(clampedManualClose.activeIncomingQty, 0);

const movedDelivery = classifyRosskoDelivery({
  expectedDate: "2026-08-19",
  previousExpectedDate: "2026-08-16",
  today: "2026-08-15",
  activeIncomingQty: 4,
  providerClosed: false,
});
assert.equal(movedDelivery.moved, true);
assert.equal(movedDelivery.delayed, true, "changed delivery date is presented as delayed, not cancelled");

const overdueActive = classifyRosskoDelivery({
  expectedDate: "2026-08-12",
  today: "2026-08-15",
  activeIncomingQty: 4,
  providerClosed: false,
});
assert.equal(overdueActive.delayed, true);
assert.equal(overdueActive.delayDays, 3);

const overdueTerminal = classifyRosskoDelivery({
  expectedDate: "2026-08-12",
  today: "2026-08-15",
  activeIncomingQty: 0,
  providerClosed: true,
});
assert.equal(overdueTerminal.delayed, false, "provider-expired line is closed rather than merely delayed");

const deliveryPayload = {
  OrdersList: {
    Order: [{
      id: 185487006,
      created_date: "2026-08-10",
      delivery_date: "2026-08-19",
      detail: { delivery_type: "Самовывоз" },
      parts: { part: [{ guid: "line-1", partnumber: "H97W16", brand: "MANN", name: "Фильтр", count: 10, price: 600, status: 1 }] },
    }],
  },
};
const normalizedOrder = normalizeRosskoOrder(deliveryPayload, "185487006");
assert.equal(normalizedOrder.deliveryDate?.toISOString().slice(0, 10), "2026-08-19");
assert.equal(normalizedOrder.deliveryType, "Самовывоз");
assert.equal(normalizedOrder.parts[0].deliveryDate?.toISOString().slice(0, 10), "2026-08-19");

const [service, receipt, workspace, restock, closeRoute, listRoute, schema] = await Promise.all([
  readFile("src/lib/rossko-incoming.ts", "utf8"),
  readFile("src/lib/rossko-receipt.ts", "utf8"),
  readFile("src/components/receipts/RosskoReceiptWorkspace.tsx", "utf8"),
  readFile("src/app/operations/restock/RestockClient.tsx", "utf8"),
  readFile("src/app/api/rossko/incoming-orders/[orderId]/close/route.ts", "utf8"),
  readFile("src/app/api/rossko/incoming-orders/route.ts", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
]);

assert.match(service, /ROSSKO_ORDER_SYNCED/);
assert.match(service, /ROSSKO_ORDER_DELIVERY_DATE_CHANGED/);
assert.match(service, /ROSSKO_ORDER_LINE_STATUS_CHANGED/);
assert.match(service, /ROSSKO_ORDER_LINE_AUTO_CLOSED/);
assert.match(service, /ROSSKO_ORDER_LINES_CLOSED_MANUALLY/);
assert.match(service, /pg_advisory_xact_lock/);
assert.match(service, /idempotencyKey/);
assert.match(service, /ROSSKO_OVER_CLOSE/);
assert.match(service, /branchId/);
assert.doesNotMatch(service, /localStockBalance\.(create|update|upsert)/i, "manual close must not change stock");
assert.doesNotMatch(service, /createLocalStockDocument/, "manual close must not create a receipt");
assert.match(receipt, /ROSSKO_LINE_NOT_RECEIVABLE/);
assert.match(receipt, /providerClosedQty/);
assert.match(receipt, /manualClosedQty/);
assert.match(workspace, /Обновить статусы/);
assert.match(workspace, /Закрыть оставшиеся позиции/);
assert.match(workspace, /Это действие не отменяет заказ в ROSSKO|Заказ в ROSSKO не отменяется/);
assert.match(workspace, /Активные/);
assert.match(workspace, /Закрытые/);
assert.match(workspace, /Показать историю/);
assert.match(restock, /supplierOrdersFromServer/);
assert.match(restock, /activeIncomingQty/);
assert.match(closeRoute, /requireBranchApi\(\{ allowAll: false, requireActive: true \}\)/);
assert.match(listRoute, /sync/);
assert.match(schema, /model BranchAuditLog/);

console.log("ROSSKO incoming order lifecycle — passed");
