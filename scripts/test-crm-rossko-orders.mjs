import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve("src") } });
const { describeCrmRosskoOrder } = await jiti.import("../src/lib/crm-rossko-orders.ts");
const { caseRosskoOrder, parseRosskoOrderNumber } = await jiti.import("../src/lib/client-case-parts.ts");
const { normalizeRosskoOrder } = await jiti.import("../src/lib/rossko-receipt.ts");

const order = normalizeRosskoOrder({
  OrdersList: {
    Order: [{
      id: 123456,
      delivery_date: "09.11.2026",
      parts: { part: [
        { guid: "first", count: 2, status: 6, delivery_date: "09.11.2026" },
        { guid: "second", count: 1, status: 2, delivery_date: "11.11.2026" },
      ] },
    }],
  },
}, "123456");

function describe(firstQty, secondQty) {
  return describeCrmRosskoOrder(
    order.parts.map((part, index) => ({ part, postedQty: index === 0 ? firstQty : secondQty })),
    order.deliveryDate,
  );
}

assert.deepEqual(describe(0, 0), {
  arrived: false,
  expectedAt: new Date("2026-11-11"),
  label: "На складе ROSSKO · Отгружено",
});
assert.equal(describe(1, 1).label, "Принято частично · На складе ROSSKO");
assert.equal(describe(1, 1).arrived, false);
assert.equal(describe(1, 1).expectedAt.toISOString(), "2026-11-09T00:00:00.000Z");
assert.equal(describe(2, 1).arrived, true);
assert.equal(describe(2, 1).label, "Запчасти пришли");
assert.equal(describeCrmRosskoOrder([], order.deliveryDate).arrived, false);
assert.equal(describeCrmRosskoOrder([{ part: { ...order.parts[0], status: 8 }, postedQty: 0 }], null).label, "Отменён клиентом");

assert.equal(parseRosskoOrderNumber(" 00123456 "), "123456");
assert.equal(parseRosskoOrderNumber("1e6"), null);
assert.equal(parseRosskoOrderNumber("9007199254740993"), null);
assert.equal(parseRosskoOrderNumber(caseRosskoOrder("Заказ РОССКО № 123456")), "123456");

console.log("CRM ROSSKO order tracking — passed");
