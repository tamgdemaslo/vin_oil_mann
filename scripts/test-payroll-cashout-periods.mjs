import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") } });
const { resolvePayrollCashoutPeriod, payrollCashoutPeriodOverlaps } = await jiti.import("../src/lib/payroll-cashout-period.ts");
const august = { periodFrom: "2026-08-01", periodTo: "2026-08-31" };
const september = { periodFrom: "2026-09-01", periodTo: "2026-09-30" };
const cashDate = "2026-09-03";

assert.deepEqual(resolvePayrollCashoutPeriod({ expenseDate: cashDate, paymentPurpose: "Зарплата (август)" }), august);
assert.deepEqual(resolvePayrollCashoutPeriod({ expenseDate: cashDate, expenseItemName: "Зарплата (август)" }), august);
assert.deepEqual(resolvePayrollCashoutPeriod({ expenseDate: cashDate, paymentPurpose: "Зарплата за август 2026 г." }), august);
assert.deepEqual(resolvePayrollCashoutPeriod({ expenseDate: cashDate, paymentPurpose: "Зарплата (АВГУСТ)" }), august);
assert.deepEqual(resolvePayrollCashoutPeriod({
  expenseDate: cashDate, paymentPurpose: "Зарплата (август)",
  payrollPeriodFrom: september.periodFrom, payrollPeriodTo: september.periodTo,
}), september, "saved period takes precedence over legacy text");
assert.deepEqual(resolvePayrollCashoutPeriod({
  expenseDate: cashDate, paymentPurpose: "Зарплата: Вадим, период 2026-08-01 - 2026-08-31",
}), august);
assert.deepEqual(resolvePayrollCashoutPeriod({ expenseDate: "2027-01-03", paymentPurpose: "Зарплата (декабрь)" }), {
  periodFrom: "2026-12-01", periodTo: "2026-12-31",
});
assert.deepEqual(resolvePayrollCashoutPeriod({ expenseDate: "2026-03-03", paymentPurpose: "Зарплата (февраль 2024)" }), {
  periodFrom: "2024-02-01", periodTo: "2024-02-29",
});
for (const paymentPurpose of ["Аванс сотруднику", "Зарплата", "Зарплата (проверить август)", "Зарплата (мартин)"]) {
  assert.deepEqual(resolvePayrollCashoutPeriod({ expenseDate: cashDate, paymentPurpose }), {
    periodFrom: cashDate, periodTo: cashDate,
  }, "unrecognized text must not move a payment to another period");
}
assert.deepEqual(resolvePayrollCashoutPeriod({
  expenseDate: cashDate, payrollPeriodFrom: "2026-02-30", payrollPeriodTo: "2026-02-31",
}), { periodFrom: cashDate, periodTo: cashDate }, "invalid dates are not treated as an explicit period");
assert.equal(payrollCashoutPeriodOverlaps(august, september.periodFrom, september.periodTo), false);
assert.equal(payrollCashoutPeriodOverlaps(august, august.periodFrom, august.periodTo), true);
assert.equal(payrollCashoutPeriodOverlaps(august, "2026-08-31", "2026-09-01"), true);

// Run the real payroll calculation against isolated database fixtures. No database connection is created.
process.env.AUTH_USERS = "vadim:fixture-only:Вадим:admin,maksim:fixture-only:Максим:master";
const cashouts = [
  { id: "salary-august", number: "РКО-20260903-0001", expenseDate: cashDate, amountCents: 6_700_000, paymentPurpose: "Зарплата (август)" },
  { id: "advance-september", number: "РКО-20260916-0002", expenseDate: "2026-09-16", amountCents: 3_000_000, paymentPurpose: "Аванс сотруднику" },
].map((row) => ({
  status: "posted", article: null, comment: null,
  counterpartyName: "Бигожин Вадим Андреевич", counterpartyRelationName: null,
  expenseItemName: "Зарплата", expenseItemRelationName: null,
  employeeId: null, payrollPeriodFrom: null, payrollPeriodTo: null,
  ...row,
}));
let useLegacySchema = false;
let selectedBranch = "branch-main";
globalThis.prisma = {
  branchSalesPlan: { findMany: async () => [] },
  branchMembership: { findMany: async () => [{ roleId: "administrator", user: { login: "vadim", name: "Вадим" } }, { roleId: "master", user: { login: "maksim", name: "Максим" } }] },
  user: { findMany: async () => [] },
  authPassword: { findMany: async () => [] },
  bonusPenalty: { findMany: async ({ where }) => selectedBranch === "branch-main"
    && where.date.gte === september.periodFrom
    && (!where.userLogin || where.userLogin.in.includes("vadim"))
    ? [{ userLogin: "vadim", type: "bonus", amountCents: 8_295_810 }]
    : [] },
  scheduledWorkingDay: { findMany: async () => [] },
  pieceworkRule: { findMany: async () => [] },
  localProduct: { findMany: async () => [] },
  localCatalogGroup: { findMany: async () => [] },
  localDemand: { findMany: async () => [] },
  cashExpenseOrder: { findMany: async ({ where, select }) => {
    assert.equal(where.branchId, selectedBranch);
    assert.equal(select.sourceType, undefined, "legacy fallback must not read unavailable columns");
    return selectedBranch === "branch-main" ? cashouts : [];
  } },
  $queryRaw: async (strings, ...values) => {
    const sql = strings.join("?");
    if (!sql.includes("FROM cash_expense_orders ceo")) return [];
    if (useLegacySchema) throw new Error("undefined_column: source_type");
    assert.ok(sql.includes("ceo.branch_id ="));
    assert.ok(values.includes(selectedBranch));
    assert.ok(sql.includes("ceo.status = 'posted'"));
    assert.ok(sql.includes("ceo.source_type <> 'PAYROLL_PAYMENT'"), "linked payroll payments are counted only by their own ledger");
    const rows = selectedBranch === "branch-main" ? cashouts : [];
    // Model the old date predicate as well, so the original bug fails this regression.
    return sql.includes("ceo.expense_date >=")
      ? rows.filter((row) => row.expenseDate >= values[0] && row.expenseDate <= values[1])
      : rows;
  },
};
const { computePayroll } = await jiti.import("../src/lib/payroll.ts");
const { runWithRequestTenant } = await jiti.import("../src/lib/request-tenant-store.ts");
function payroll(period, targetLogin) {
  return runWithRequestTenant({
    mode: "branch", branchId: selectedBranch, organizationId: null, allowedBranchIds: [selectedBranch],
  }, () => computePayroll({ dateFrom: period.periodFrom, dateTo: period.periodTo, targetLogin }));
}

for (const legacySchema of [false, true]) {
  useLegacySchema = legacySchema;
  for (const targetLogin of [undefined, "vadim"]) {
    const current = await payroll(september, targetLogin);
    assert.equal(current.byLogin.vadim.totalCents, 8_295_810);
    assert.equal(current.byLogin.vadim.paidOutCents, 3_000_000);
    assert.equal(current.byLogin.vadim.remainingCents, 5_295_810);
    assert.deepEqual(current.cashoutHistory.map((item) => item.cashoutId), ["advance-september"]);
    assert.equal(current.cashoutHistory[0].operationType, "ADVANCE");
    const previous = await payroll(august, targetLogin);
    assert.equal(previous.byLogin.vadim.paidOutCents, 6_700_000, "August receives the payment made in September");
    assert.equal(previous.cashoutHistory[0].date, cashDate, "actual cash date stays unchanged");
    assert.equal(previous.cashoutHistory[0].periodFrom, august.periodFrom);
    assert.equal(previous.cashoutHistory[0].periodTo, august.periodTo);
  }
}
useLegacySchema = false;
cashouts.push({
  ...cashouts[0], id: "explicit-september", expenseDate: "2026-10-03", amountCents: 500_000,
  employeeId: "alexandr", counterpartyName: "Получатель с другим именем",
  payrollPeriodFrom: september.periodFrom, payrollPeriodTo: september.periodTo,
});
const explicitPeriod = await payroll(september);
assert.equal(explicitPeriod.byLogin.vadim.paidOutCents, 3_500_000, "stored September period overrides both October cash date and August text");
assert.equal(explicitPeriod.cashoutHistory.find((item) => item.cashoutId === "explicit-september")?.date, "2026-10-03");
cashouts.pop();
const otherEmployee = await payroll(september, "maksim");
assert.equal(otherEmployee.cashoutHistory.length, 0);
assert.equal(otherEmployee.byLogin.vadim, undefined);
selectedBranch = "branch-other";
const otherBranch = await payroll(august);
assert.equal(otherBranch.cashoutHistory.length, 0);
assert.equal(otherBranch.byLogin.vadim, undefined);
console.log("Payroll cashout period regressions passed (September balance: 52 958,10 ₽).");
