#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": resolve(process.cwd(), "src") } });
const {
  calculateRosskoIncomingQuantities,
  classifyRosskoDelivery,
  normalizeRosskoOrderPartStatus,
} = await jiti.import("../src/lib/rossko-order-status.ts");
const { normalizeRosskoOrder, rosskoSourceLineKey } = await jiti.import("../src/lib/rossko-receipt.ts");

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
  const quantities = calculateRosskoIncomingQuantities({ orderedQty: 10, postedReceivedQty: 0, sourceStatus: status });
  assert.equal(quantities.activeIncomingQty, 0, `terminal status=${status} is excluded from incoming`);
  assert.equal(quantities.providerClosedQty, 10);
}

const active = calculateRosskoIncomingQuantities({ orderedQty: 10, postedReceivedQty: 0, sourceStatus: 1 });
assert.equal(active.activeIncomingQty, 10, "active order is in transit");

const partial = calculateRosskoIncomingQuantities({ orderedQty: 20, postedReceivedQty: 12, sourceStatus: 2 });
assert.equal(partial.activeIncomingQty, 8, "partial receipt leaves the remainder incoming");
assert.equal(partial.postedReceivedQty, 12);

const providerCancelledRemainder = calculateRosskoIncomingQuantities({ orderedQty: 20, postedReceivedQty: 12, sourceStatus: 8 });
assert.equal(providerCancelledRemainder.activeIncomingQty, 0);
assert.equal(providerCancelledRemainder.providerClosedQty, 8, "provider closes only the unreceived remainder");

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

const [service, receipt, workspace, restock, listRoute, schema] = await Promise.all([
  readFile("src/lib/rossko-incoming.ts", "utf8"),
  readFile("src/lib/rossko-receipt.ts", "utf8"),
  readFile("src/components/receipts/RosskoReceiptWorkspace.tsx", "utf8"),
  readFile("src/app/operations/restock/RestockClient.tsx", "utf8"),
  readFile("src/app/api/rossko/incoming-orders/route.ts", "utf8"),
  readFile("prisma/schema.prisma", "utf8"),
]);

assert.match(service, /ROSSKO_ORDER_SYNCED/);
assert.match(service, /ROSSKO_ORDER_DELIVERY_DATE_CHANGED/);
assert.match(service, /ROSSKO_ORDER_LINE_STATUS_CHANGED/);
assert.match(service, /ROSSKO_ORDER_LINE_AUTO_CLOSED/);
assert.match(service, /ROSSKO_ORDER_LINES_CLOSED_MANUALLY/);
assert.match(service, /pg_advisory_xact_lock/);
assert.match(service, /branchId/);
assert.doesNotMatch(service, /localStockBalance\.(create|update|upsert)/i, "manual close must not change stock");
assert.doesNotMatch(service, /createLocalStockDocument/, "manual close must not create a receipt");
assert.match(receipt, /ROSSKO_LINE_NOT_RECEIVABLE/);
assert.match(receipt, /providerClosedQty/);
assert.match(workspace, /Обновить статусы/);
assert.doesNotMatch(workspace, /Закрыть остаток|Закрыть оставшиеся позиции/);
assert.match(workspace, /Активные/);
assert.match(workspace, /Показать историю/);
assert.match(restock, /supplierOrdersFromServer/);
assert.match(restock, /activeIncomingQty/);
assert.match(listRoute, /sync/);
assert.match(schema, /model BranchAuditLog/);

// Run the receipt entry point with a full history and a provider that can
// return either the requested order or only an unrelated old order.
const stubDir = await mkdtemp(join(tmpdir(), "rossko-incoming-"));
try {
  const alias = { "@": resolve("src") };
  const stubs = {
    auth: 'exports.getSession = async () => ({ user: { login: "tester" } });',
    "branch-api": `
      exports.requireBranchApi = async () => ({ ok: true, context: { branchId: "test" } });
      exports.runWithBranchApiContext = (_, run) => run();
    `,
    db: `
      const events = Array.from({ length: 51 }, (_, i) => ({
        entityId: String(i + 1), branchId: "test", action: "ROSSKO_ORDER_TRACKED",
        createdAt: new Date(2025, 0, 1, 0, i),
        metadata: { seed: { externalOrderId: String(i + 1), lines: [{ article: "X", brand: "MANN", orderedQty: 1 }] } },
      }));
      function insert(event) { events.push({ ...event, id: String(events.length), createdAt: new Date() }); }
      const lineKey = ${JSON.stringify(rosskoSourceLineKey("100", "part-1"))};
      const tx = {
        branchAuditLog: {
          findMany: async ({ where }) => events.filter((event) => event.branchId === where.branchId &&
            (!where.entityId?.in || where.entityId.in.includes(event.entityId)) &&
            (typeof where.action === "string" ? where.action === event.action : where.action.in.includes(event.action))),
          createMany: async ({ data }) => data.forEach(insert),
          create: async ({ data }) => insert(data),
        },
        localInventoryDocument: { findMany: async () => [{
          id: "posted", externalCode: "100", name: "Приёмка 1", status: "posted", applicable: true,
          createdAt: new Date(), auditLogs: [], positions: [{ externalCode: lineKey, quantity: { toNumber: () => 1 } }],
        }] },
        localProduct: { findMany: async () => [] },
        $queryRaw: async () => [],
      };
      exports.prisma = { ...tx, $transaction: (run) => run(tx) };
    `,
    rossko: `
      exports.calls = [];
      let status = 6;
      exports.ship = () => { status = 2; };
      exports.rosskoConfig = async () => ({});
      exports.rosskoOrders = async (_, ids) => {
        exports.calls.push(ids);
        const id = ids.includes(100) ? 100 : 1;
        return { OrdersList: { Order: { id, parts: { part: {
          guid: "part-1", partnumber: "X", brand: "MANN", count: 2, price: 500, status
        } } } } };
      };
    `,
    "rossko-integration": 'exports.rosskoIntegrationError = (error) => ({ error: error.message });',
  };
  for (const [name, source] of Object.entries(stubs)) {
    const file = join(stubDir, name + ".cjs");
    await writeFile(file, source);
    alias[`@/lib/${name}`] = file;
  }
  const isolated = createJiti(import.meta.url, { alias });
  const provider = await isolated.import(alias["@/lib/rossko"]);
  const db = await isolated.import(alias["@/lib/db"]);
  const { GET, POST } = await isolated.import("../src/app/api/rossko/incoming-orders/route.ts");
  const url = "http://test/api/rossko/incoming-orders";
  const add = (id) => POST(new Request(url, { method: "POST", body: JSON.stringify({ orderIds: [id] }) }));

  const cached = await GET({ nextUrl: new URL(url + "?sync=0") });
  assert.equal((await cached.json()).orders.length, 51);
  assert.deepEqual(provider.calls, [], "opening the saved list does not wait for the provider");

  const found = await (await add("100")).json();
  assert.deepEqual(provider.calls, [[100]], "look up the entered order even when history exceeds the sync limit");
  const waitingOrder = found.orders.find((order) => order.externalOrderId === "100");
  assert.equal(waitingOrder?.statusLabel, "Принято частично");
  assert.equal(waitingOrder?.readyToReceive, false, "at supplier warehouse is not yet shipped");
  await db.prisma.branchAuditLog.create({ data: {
    branchId: "test", entityId: "100", action: "ROSSKO_ORDER_LINES_CLOSED_MANUALLY",
    metadata: { reason: "OTHER", lines: [{ sourceLineKey: rosskoSourceLineKey("100", "part-1"), quantity: 1 }] },
  } });
  provider.ship();
  const updated = (await (await add("100")).json()).orders.find((order) => order.externalOrderId === "100");
  assert.equal(updated?.statusLabel, "Принято частично");
  assert.equal(updated?.summary.postedReceivedQty, 1);
  assert.equal(updated?.summary.receivableQty, 1, "newly shipped remainder ignores old manual closure and excludes posted units");
  assert.ok(updated?.history.some((item) => item.action === "ROSSKO_ORDER_LINES_CLOSED_MANUALLY"));

  const missing = await (await add("101")).json();
  assert.deepEqual(provider.calls, [[100], [100], [101]]);
  assert.match(missing.syncErrors["101"], /101.*не найден/);
  assert.ok(!missing.orders.some((order) => order.externalOrderId === "101"), "an unverified number does not become an empty order");
} finally {
  await rm(stubDir, { recursive: true, force: true });
}

console.log("ROSSKO incoming order lifecycle — passed");
