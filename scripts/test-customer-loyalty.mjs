import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } });
const { calculateLoyalty, loyaltyLineCents, returnLineDelta, loyaltyExpiration, LOYALTY_DEFAULTS } = await jiti.import("../src/lib/loyalty/calculation.ts");
const { priceAqsiLoyaltyLine } = await jiti.import("../src/lib/loyalty/fiscal-price.ts");
const { loyaltyPermissions } = await jiti.import("../src/lib/loyalty/accounts.ts");
const line = (beforeCents, rate, quantityMilli = 1000) => ({ beforeCents, rate, quantityMilli });
const calculate = (lines, balance, spend) => calculateLoyalty(lines, LOYALTY_DEFAULTS, balance, spend);

const before = calculate([line(1_000_000, 500)], 4_000, 0);
assert.equal(before.cashCents, 1_000_000);
assert.equal(before.maximum, 3000);
const uniform = calculate([line(1_000_000, 500)], 4_000, 3_000);
assert.deepEqual([uniform.spent, uniform.cashCents, uniform.earned], [3000, 700_000, 350]);
assert.equal(4000 - uniform.spent + uniform.earned, 1350);

const byGroup = calculate([line(600_000, 300), line(200_000, 700), line(200_000, 500)], 4_000, 3000);
assert.deepEqual(byGroup.lines.map(({ cashCents, earned }) => [cashCents, earned]), [[420_000, 126], [140_000, 98], [140_000, 70]]);
assert.equal(byGroup.earned, 294);
const zero = calculate([line(600, 0), line(400, 500)], 100, 3);
assert.equal(zero.lines[0].earned, 0);
assert.ok(zero.lines[0].spendCents > 0);
const tie = calculate([line(1200, 500), line(1200, 500), line(1200, 500)], 0, 0);
assert.deepEqual(tie.lines.map(({ earned }) => earned), [1, 0, 0]);
assert.equal(loyaltyLineCents(0.345, 12345, 7.125), 3956);
assert.equal(calculate([line(100, 500)], -100, 50).maximum, 0);
assert.equal(calculateLoyalty([line(100_000, 500)], { centsPerPoint: 200, spendRate: 3000 }, 1000, 150).earned, 17);

const source = calculate([line(24_521, 501, 2587)], 100, 73).lines[0];
const returns = [[0, 412], [412, 1333], [1333, 2587]].map(([from, to]) => returnLineDelta(source, from, to));
const full = returnLineDelta(source, 0, 2587);
for (const key of Object.keys(full)) assert.equal(returns.reduce((sum, row) => sum + row[key], 0), full[key]);
assert.throws(() => returnLineDelta(source, 0, 2588));
assert.equal(loyaltyExpiration("2026-12-31").toISOString(), "2026-12-31T22:00:00.000Z");
assert.throws(() => loyaltyExpiration("2027-02-29"));

for (const [items, cents] of [
  [[{ name: "Filter", quantity: 3, unitPrice: 1 }], 200],
  [[{ name: "Oil", quantity: 3.271, unitPrice: 1, measuredPour: true, markingCode: "mock" }], 213_427],
  [[{ name: "Bottle", quantity: 1, unitPrice: 1, markingCode: "A" }, { name: "Bottle", quantity: 1, unitPrice: 1, markingCode: "B" }], 125],
]) {
  const priced = priceAqsiLoyaltyLine(items, cents);
  assert.equal(priced.reduce((sum, item) => sum + Math.round(item.exactUnitPrice * item.quantity * 100), 0), cents);
  assert.deepEqual(priced.flatMap((item) => item.markingCode ?? []), items.flatMap((item) => item.markingCode ?? []));
}
const permissions = (role, groupRole = null, branchRole = null) =>
  loyaltyPermissions({ user: { role }, groupRole, branchRole, isGroupOwner: groupRole === "group_owner" });
assert.equal(permissions("owner", "group_owner").owner, true);
assert.equal(permissions("admin", null, "administrator").manager, true);
assert.equal(permissions("master", null, "master").master, true);
assert.equal(permissions("master", null, "master").owner, false);
assert.equal(permissions("owner", "group_analyst", "branch_owner").employee, false);
const { applyBranchQueryPolicy } = await jiti.import("../src/lib/db.ts");
const branchTenant = { mode: "branch", branchId: "a", businessGroupId: "network", allowedBranchIds: ["a"] };
assert.throws(() => applyBranchQueryPolicy("LoyaltyLink", "findMany", { where: { branchId: "b" } }, branchTenant));
assert.throws(() => applyBranchQueryPolicy("LoyaltyAccount", "findMany", { where: { businessGroupId: "other" } }, branchTenant));
assert.deepEqual(applyBranchQueryPolicy("LoyaltyLot", "findMany", { where: { accountId: "shared" } }, branchTenant).where,
  { accountId: "shared", account: { is: { businessGroupId: "network" } } });
assert.throws(() => applyBranchQueryPolicy("LoyaltyCampaignRecipient", "findMany", {}, branchTenant));
const { requiresPostingForLoyaltyPrecheck } = await jiti.import("../src/components/loyalty/client.ts");
for (const status of [undefined, "disabled", "ineligible", "unknown"]) assert.equal(requiresPostingForLoyaltyPrecheck(status), false);
for (const status of ["linked", "new", "review", "skip"]) assert.equal(requiresPostingForLoyaltyPrecheck(status), true);
console.log("Loyalty calculation, allocation, partial returns, local expiry, fiscal prices and roles: PASS");
