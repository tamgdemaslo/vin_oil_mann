import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const queries = [];
globalThis.prisma = {
  $executeRaw: async (strings, ...values) => { queries.push({ sql: strings.join("?"), values }); return 1; },
  $queryRaw: async (strings, ...values) => {
    const sql = strings.join("?");
    assert.ok(sql.includes("branch_id ="), "goal list must be scoped to the active branch");
    assert.ok(values.includes("test-branch"));
    return [{ id: "goal", organizationId: "default", employeeLogin: "vadim", metric: "SERVICE", targetId: "service-id", targetName: "Замена масла", targetValue: 10, startsAt: "2026-11-01", endsAt: "2026-11-07", status: "active", createdAt: new Date(), updatedAt: new Date() }];
  },
};
const { catalogGoalProgress } = await jiti.import("../src/lib/payroll-goal-progress.ts");
const { createPayrollGoal, listAllPayrollGoals } = await jiti.import("../src/lib/payroll-motivation.ts");
const { runWithRequestTenant } = await jiti.import("../src/lib/request-tenant-store.ts");
const service = { metric: "SERVICE", targetId: "same-id", startsAt: "2026-11-01", endsAt: "2026-11-07" };
const summary = { vehicleHistory: [
  { date: "2026-11-02", pieceworkBreakdownByLogin: {
    vadim: [{ targetId: "same-id", targetType: "service", quantity: 3, label: "Переименованная услуга" }, { targetId: "same-id", targetType: "product_group", quantity: 5 }, { targetId: "another-id", targetType: "service", quantity: 100 }],
    maksim: [{ targetId: "same-id", targetType: "service", quantity: 99 }],
  } },
  { date: "2026-11-08", pieceworkBreakdownByLogin: { vadim: [{ targetId: "same-id", targetType: "service", quantity: 100 }] } },
] };
assert.equal(catalogGoalProgress(service, summary, "alexandr"), 3, "canonical employee alias, ID and goal dates are respected");
assert.equal(catalogGoalProgress({ ...service, metric: "PRODUCT_CATEGORY" }, summary, "vadim"), 5);
assert.equal(catalogGoalProgress({ ...service, targetId: null }, summary, "vadim"), 0);
assert.equal(catalogGoalProgress(service, summary, "ilya"), 0, "another employee's work is not counted");
await runWithRequestTenant({ mode: "branch", branchId: "test-branch", allowedBranchIds: ["test-branch"], organizationId: null }, async () => {
  await createPayrollGoal({ employeeLogin: "vadim", periodType: "WEEK", metric: "SERVICE", targetId: "service-id", targetName: "Замена масла", targetValue: 10, startsAt: "2026-11-01", endsAt: "2026-11-07", createdByLogin: "ilya" });
  const [goal] = await listAllPayrollGoals();
  assert.equal(goal.targetId, "service-id");
  assert.equal(goal.targetName, "Замена масла");
});
assert.ok(queries[0].sql.includes("target_id"));
assert.ok(queries[0].values.includes("service-id"));
assert.ok(queries[0].values.includes("Замена масла"));
assert.ok(queries[0].values.includes("test-branch"));
console.log("Catalog goals: stable IDs, quantity, period, employee isolation, branch scope and persistence passed.");

const { payrollGoalPeriod } = await jiti.import("../src/lib/payroll-goal-period.ts");
assert.deepEqual(payrollGoalPeriod("2026-11-02", "WEEK"), { dateFrom: "2026-11-02", dateTo: "2026-11-08" });
assert.deepEqual(payrollGoalPeriod("2026-11-01", "WEEK"), { dateFrom: "2026-10-26", dateTo: "2026-11-01" });
assert.deepEqual(payrollGoalPeriod("2026-10-15", "MONTH"), { dateFrom: "2026-10-01", dateTo: "2026-10-31" });
assert.deepEqual(payrollGoalPeriod("2026-12-31", "WEEK"), { dateFrom: "2026-12-28", dateTo: "2027-01-03" });
assert.equal(payrollGoalPeriod("2026-02-30", "MONTH"), null);
