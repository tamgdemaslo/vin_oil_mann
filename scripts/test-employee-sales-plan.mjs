import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";
globalThis.prisma = {};
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const { employeePlanEarnings, employeePlanPositionIds } = await jiti.import("../src/lib/employee-sales-plan.ts");
const summary = { vehicleHistory: [{ pieceworkBreakdownByLogin: {
  vadim: [{ positionId: "filter-1", amountCents: 35000 }, { positionId: "filter-2", amountCents: 35000 }, { positionId: "service-1", amountCents: 15000 }, { positionId: "unplanned-1", amountCents: 9999 }],
  maksim: [{ positionId: "filter-other", amountCents: 90000 }],
} }] };
const mapping = [
  { positionId: "filter-1", rowKey: "product:AIR_FILTER" },
  { positionId: "filter-2", rowKey: "product:AIR_FILTER" },
  { positionId: "filter-other", rowKey: "product:AIR_FILTER" },
  { positionId: "service-1", rowKey: "service:OIL:-:-:-" },
];
const earnings = employeePlanEarnings(summary, "alexandr", mapping);
assert.equal(earnings.get("product:AIR_FILTER"), 70000, "two filters yield exactly 700 rubles in personal piecework earnings");
assert.equal(earnings.get("service:OIL:-:-:-"), 15000);
assert.equal(earnings.size, 2, "unplanned positions are excluded");
assert.deepEqual([...employeePlanPositionIds(summary, "vadim")], ["filter-1", "filter-2", "service-1", "unplanned-1"]);
assert.equal(employeePlanPositionIds(summary, "ilya").size, 0, "another employee receives no personal facts");
assert.equal(employeePlanEarnings(summary, "ilya", mapping).size, 0);
console.log("Employee sales plan: 700 ₽ filter earnings, service earnings, alias handling and employee isolation passed.");
