import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
process.env.AUTH_USERS = "vadim:test:Вадим:admin,maksim:test:Максим:master,ilya:test:Илья:owner,denis:test:Денис:owner";
let scheduledCalls = 0;
const memberships = [
  { roleId: "administrator", user: { login: "vadim", name: "Вадим" } },
  { roleId: "master", user: { login: "maksim", name: "Максим" } },
  { roleId: "branch_owner", user: { login: "ilya", name: "Илья" } },
];
const rules = [
  { employeeLogin: "maksim", targetType: "service", targetId: "svc", role: "master", mode: "fixed", fixedCents: 1000 },
  { employeeLogin: "ilya", targetType: "service", targetId: "svc", role: "master", mode: "fixed", fixedCents: 2000 },
  { employeeLogin: "denis", targetType: "service", targetId: "svc", role: "master", mode: "fixed", fixedCents: 9999 },
  { employeeLogin: "vadim", targetType: "product_group", targetId: "grp", role: "admin", mode: "percent", percentBasisPoints: 1000 },
];
const read = async () => [];
globalThis.prisma = {
  branchSalesPlan: { findMany: async () => [] },
  user: { findMany: read }, authPassword: { findMany: read },
  branchMembership: { findMany: async ({ where }) => { assert.equal(where.branchId, "test-branch"); return memberships.map((member) => ({...member,status:"active",user:{...member.user,authRole:member.user.login === "ilya" ? "owner" : member.user.login === "vadim" ? "admin" : "master"},paySettingsJson:{individualPiecework:true,pieceworkRules:rules.filter((rule)=>rule.employeeLogin===member.user.login)}})); } },
  bonusPenalty: { findMany: read },
  scheduledWorkingDay: { findMany: async () => ++scheduledCalls % 2 ? [] : ["vadim", "maksim", "ilya", "denis"].map((userLogin) => ({ userLogin, date: "2026-11-02" })) },
  pieceworkRule: { findMany: async () => rules },
  localProduct: { findMany: async () => [{ id: "svc", name: "Услуга" }] },
  localCatalogGroup: { findMany: async () => [{ id: "grp", name: "Товары" }] },
  localDemand: { findMany: async () => [{ id: "demand", name: "1", documentDate: "2026-11-02", momentAt: new Date("2026-11-02T12:00:00Z"), sumCents: 20000, positions: [
    { id: "service-line", productId: "svc", assortmentType: "service", name: "Услуга", quantity: { toNumber: () => 1 }, priceCentsPerUnit: 10000, buyPriceCentsPerUnit: null, discount: { toNumber: () => 0 }, product: { id: "svc", entityType: "service", groupId: "service-group" } },
    { id: "product-line", productId: "product", assortmentType: "product", name: "Товар", groupIdSnapshot: "grp", groupSnapshot: { name: "Товары" }, quantity: { toNumber: () => 1 }, priceCentsPerUnit: 10000, buyPriceCentsPerUnit: 4000, discount: { toNumber: () => 0 }, product: { id: "product", entityType: "product", groupId: "grp" } },
  ] }] },
  $queryRaw: read,
};
const { computePayroll } = await jiti.import("../src/lib/payroll.ts");
const { runWithRequestTenant } = await jiti.import("../src/lib/request-tenant-store.ts");
const result = await runWithRequestTenant({ mode: "branch", branchId: "test-branch", organizationId: null, allowedBranchIds: ["test-branch"] }, () => computePayroll({ dateFrom: "2026-11-01", dateTo: "2026-11-30" }));
assert.equal(result.byLogin.maksim.pieceworkCents, 1000);
assert.equal(result.vehicleHistory[0].pieceworkBreakdownByLogin.maksim[0].positionId, "service-line", "earnings retain the immutable shipment position ID for sales-plan attribution");
assert.equal(result.byLogin.ilya.pieceworkCents, 2000, "owner role can receive an individual service rule");
assert.equal(result.byLogin.vadim.pieceworkCents, 600, "product percent is based on snapshot profit");
assert.equal(result.byLogin.denis, undefined, "disabled employee earns nothing even when an old shift and rule remain");
assert.equal(result.vehicleHistory[0].unallocatedPiecework.length, 0);
console.log("Individual payroll: employee isolation, owner role, active membership and snapshot-profit checks passed.");
