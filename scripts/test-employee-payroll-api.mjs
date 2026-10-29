import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const helpers = await jiti.import("../src/lib/employee-pay-settings.ts");
const json = (body, init) => ({ status: init?.status ?? 200, body });
function loadRoute(path, dependencies) {
  const source = ts.transpileModule(fs.readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(id) { if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`); return dependencies[id]; }, Date, Number, Set, Map });
  return exports;
}
let member;
let actor = { role: "owner", login: "owner" };
let allowed = true;
let concurrent = false;
let writes = 0;
let audit = 0;
const branchId = "branch-a";
function reset() {
  member = { id: "member-a", userId: "user-a", branchId, roleId: "master", status: "disabled", updatedAt: "v1", employmentStart: new Date("2026-01-01"), paySettingsJson: { retainedSetting: 123 } };
  actor = { role: "owner", login: "owner" }; allowed = true; concurrent = false; writes = 0; audit = 0;
}
reset();
const prisma = {
  branchMembership: {
    async findFirst({ where }) { return where.branchId === branchId && (!where.id || where.id === member.id) && (!where.user || where.user.login.equals === "employee") ? member : null; },
    async updateMany({ where, data }) { if (concurrent || where.updatedAt !== member.updatedAt || where.branchId !== member.branchId) return { count: 0 }; member = { ...member, ...data, updatedAt: "v2" }; writes++; return { count: 1 }; },
    async update({ data }) { member = { ...member, ...data }; writes++; return member; },
  },
  user: { async findUnique() { return { login: "employee", authRole: "master" }; } },
  localProduct: { async findFirst({ where }) { return where.branchId === branchId && where.id === "service-a" ? { id: "service-a", name: "Oil service" } : null; } },
  localCatalogGroup: { async findFirst({ where }) { return where.branchId === branchId && where.id === "group-a" ? { id: "group-a", name: "Parts" } : null; } },
  changeLog: { async create() { audit++; } },
  async $transaction(callback) { return callback(prisma); },
};
const deps = {
  "next/server": { NextResponse: { json } },
  "@/lib/db": { prisma },
  "@/lib/auth": { getSession: async () => ({ user: actor }), canonicalizeLogin: (login) => login.trim().toLowerCase() },
  "@/lib/branch-api": { requireBranchApi: async () => ({ ok: true, context: { branchId } }) },
  "@/lib/branch-context": { requireBranchContext: async () => ({ canManageBranches: allowed, businessGroupId: "group-a", user: actor }), branchErrorResponse: (error) => ({ error: error.message, status: 500 }) },
  "@/lib/employee-pay-settings": helpers,
  "@/lib/payroll": { invalidatePayrollCache() {} },
  "@/lib/date-time": { toServiceDateInput: () => "2026-10-29" },
  "@/lib/piecework-rules": { isAllowedPieceworkRule: (type, role) => ["service", "product_group"].includes(type) && ["master", "admin"].includes(role) },
  "@/lib/payroll-employees": {},
  "@/lib/change-log": { logChange: async () => { audit++; } },
};
const rules = loadRoute("../src/app/api/piecework-rules/route.ts", deps);
const members = loadRoute("../src/app/api/branches/[branchId]/members/[membershipId]/route.ts", deps);
const request = (body) => ({ json: async () => body });
const patch = (body, branch = branchId) => members.PATCH(request(body), { params: Promise.resolve({ branchId: branch, membershipId: member.id }) });
const rule = { employeeLogin: "employee", targetType: "all_products", targetId: "*", role: "master", mode: "percent", percentBasisPoints: 500 };
assert.equal((await rules.POST(request(rule))).status, 200);
assert.equal(member.paySettingsJson.retainedSetting, 123);
assert.equal(member.paySettingsJson.individualPiecework, true);
assert.equal(member.paySettingsJson.pieceworkRules[0].targetType, "all_products");
assert.equal(audit, 1);
reset();
assert.equal((await rules.POST(request({ ...rule, targetType: "service", targetId: "foreign-service" }))).status, 400);
assert.equal(writes, 0);
assert.equal((await rules.POST(request({ ...rule, percentBasisPoints: 10001 }))).status, 400);
assert.equal(writes, 0);
actor.role = "master";
assert.equal((await rules.POST(request(rule))).status, 403);
assert.equal((await patch({ employmentEnd: "2026-10-20" })).status, 403);
reset(); concurrent = true;
assert.equal((await rules.POST(request(rule))).status, 409);
assert.equal(audit, 0);
reset();
assert.equal((await patch({ roleId: "mechanic" })).status, 200);
assert.equal(member.status, "disabled", "changing role must not reopen disabled access");
reset();
assert.equal((await patch({ employmentEnd: "2026-02-30" })).status, 400);
assert.equal((await patch({ employmentEnd: "2026-11-01" })).status, 400);
assert.equal((await patch({ employmentEnd: "2025-12-31" })).status, 400);
assert.equal((await patch({ employmentEnd: "2026-10-20" }, "foreign-branch")).status, 404);
assert.equal(writes, 0);
const result = await patch({ employmentEnd: "2026-10-20" });
assert.equal(result.status, 200);
assert.equal(member.paySettingsJson.retainedSetting, 123);
assert.equal(member.paySettingsJson.employmentEnd, "2026-10-20");
assert.equal(member.status, "disabled");
assert.equal(audit, 1);
assert.equal((await patch({ status: "active" })).status, 400);
assert.equal((await rules.POST(request(rule))).status, 400);
reset(); member.roleId = "branch_owner";
assert.equal((await patch({ employmentEnd: "2026-10-20" })).status, 400);
reset(); concurrent = true;
assert.equal((await patch({ employmentEnd: "2026-10-20" })).status, 409);
assert.equal(audit, 0);
console.log("Employee payroll API: owner permissions, branch isolation, preserved access state/settings, dismissal dates, archived rules and concurrent writes passed.");

// Exercise the full payroll calculation, with only database I/O replaced.
const costing = await jiti.import("../src/lib/inventory-costing.ts");
const pureRules = loadRoute("../src/lib/piecework-rules.ts", { "@/lib/db": { prisma }, "@/lib/branch-context": {} });
const decimal = (value) => ({ toNumber: () => value });
const position = (id, type, price, cost) => ({ id, productId: id, name: id, assortmentType: type, groupIdSnapshot: "group-a", groupSnapshot: { name: "Parts" }, product: { id, groupId: "group-a" }, quantity: decimal(1), discount: decimal(0), priceCentsPerUnit: price, buyPriceCentsPerUnit: cost });
const days = ["2026-10-20", "2026-10-21"];
const individual = (services, products) => ({ individualPiecework: true, pieceworkRules: [
  ...(services ? [{ targetType: "all_services", targetId: "*", targetName: "All services", mode: "percent", fixedCents: null, percentBasisPoints: services }] : []),
  ...(products ? [{ targetType: "all_products", targetId: "*", targetName: "All products", mode: "percent", fixedCents: null, percentBasisPoints: products }] : []),
] });
const employees = [
  { login: "one", name: "One", role: "master", employmentStart: null, settings: { ...individual(1000, 500), employmentEnd: "2026-10-20" } },
  { login: "two", name: "Two", role: "master", employmentStart: null, settings: individual(0, 1000) },
];
const payrollPrisma = {
  bonusPenalty: { findMany: async () => [] },
  scheduledWorkingDay: { findMany: async () => days.flatMap((date) => employees.map((employee) => ({ userLogin: employee.login, date }))) },
  localDemand: { findMany: async () => days.map((date) => ({ id: `demand-${date}`, name: date, momentAt: new Date(`${date}T12:00:00Z`), sumCents: 300000, positions: [position("service-a", "service", 100000, 0), position("product-a", "product", 200000, 100000)] })) },
  $queryRaw: async () => [],
};
const calc = loadRoute("../src/lib/payroll.ts", {
  "@/lib/db": { prisma: payrollPrisma },
  "@/lib/payroll-employees": { listPayrollEmployees: async () => employees },
  "@/lib/employee-pay-settings": helpers,
  "@/lib/shift-rates": { getShiftRateCents: async () => 10000 },
  "@/lib/auth": { canonicalizeLogin: (login) => login.toLowerCase(), getLoginVariants: (login) => [login] },
  "@/lib/payroll-settlements": { listPayrollAdjustments: async () => [], listPayrollPayments: async () => [] },
  "@/lib/request-tenant-store": { getScopedBranchId: () => branchId },
  "@/lib/inventory-costing": costing,
  "@/lib/piecework-rules": { ...pureRules, getPieceworkRuleMap: async () => new Map() },
});
const summary = await calc.computePayroll({ dateFrom: "2026-10-01", dateTo: "2026-10-31" });
assert.equal(summary.byLogin.one.shiftTotalCents, 10000, "only the last working day earns a fixed shift");
assert.equal(summary.byLogin.one.pieceworkCents, 15000, "master can earn 10% services and 5% product profit through dismissal date");
assert.equal(summary.byLogin.one.totalCents, 25000);
assert.equal(summary.byLogin.two.shiftTotalCents, 20000);
assert.equal(summary.byLogin.two.pieceworkCents, 20000, "second master earns only 10% product profit on both days");
assert.equal(summary.byLogin.two.totalCents, 40000);
assert.equal(summary.vehicleHistory.flatMap((vehicle) => vehicle.unallocatedPiecework).length, 0, "intentionally excluded services are not payroll conflicts");
const own = await calc.computePayroll({ dateFrom: "2026-10-01", dateTo: "2026-10-31", targetLogin: "one" });
assert.equal(Object.keys(own.byLogin).join(","), "one");
console.log("Full payroll calculation: two employees with independent categories, exact amounts, personal view and dismissal cutoff passed.");
