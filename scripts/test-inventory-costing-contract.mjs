import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const costingDb = read("src/lib/inventory-costing-db.ts");
const demand = read("src/lib/local-demand-write.ts");
const admin = read("src/lib/local-inventory-admin.ts");
const finance = read("src/lib/local-inventory-finance.ts");
const analytics = read("src/lib/warehouse-product-analytics.ts");
const payroll = read("src/lib/payroll.ts");
const customerProfit = read("src/lib/customer-analytics-profit.ts");
const customerAnalytics = read("src/lib/customer-analytics.ts");
const dashboard = read("src/app/api/dashboard/operations/route.ts");

assert.match(costingDb, /pg_advisory_xact_lock[\s\S]*?::text\s+AS\s+locked/);

assert.match(demand, /freezePostingCostSnapshots/);
assert.match(demand, /totalCostSnapshot:/);
assert.match(demand, /SHIPMENT_REPOST/);
assert.doesNotMatch(demand, /buyPriceCentsPerUnit:\s*product\?\.buyPriceCents/);

assert.match(admin, /calculateWeightedAverageCostCents/);
assert.match(admin, /movementType:\s*input\.type === "receipt" \? "RECEIPT_POST" : "WRITEOFF_POST"/);
assert.match(admin, /buyPriceCents:\s*position\.priceCents/);
assert.doesNotMatch(admin, /type === "writeoff"[^\n]+product\.buyPriceCents/);

assert.match(finance, /calculateLineFinancials/);
assert.match(analytics, /calculateLineFinancials/);
assert.match(payroll, /calculateLineFinancials/);
assert.match(customerProfit, /calculateLineFinancials/);
assert.match(customerAnalytics, /calculateLineFinancials/);
assert.match(dashboard, /calculateLineFinancials/);
assert.doesNotMatch(finance, /position\.buyPriceCentsPerUnit\s*\?\?\s*position\.product/);
assert.doesNotMatch(analytics, /position\.buyPriceCentsPerUnit\s*\?\?\s*position\.product/);
assert.doesNotMatch(payroll, /position\.buyPriceCentsPerUnit\s*\?\?\s*product\?\.buyPriceCents/);

console.log("inventory costing integration contract: ok");
