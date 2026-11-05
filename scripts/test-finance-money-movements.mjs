import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exports = {};
const source = readFileSync("src/lib/finance-money-movements.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const amount = (amountCents, fields = {}) => ({ amountCents, direction: "expense", ...fields });
let bankCalls = 0;
const prisma = {
  cashExpenseOrder: { findMany: async ({ where }) => {
    assert.equal(where.paymentType, "cash");
    assert.equal(where.status, "posted");
    return [{ amountCents: 8_000_000, expenseItemName: "Зарплата" }];
  } },
  cashShift: { findMany: async () => [{ status: "closed", cashOrdersTotalCents: 500_000 }] },
  bankCashTransfer: { aggregate: async () => ({ _sum: { amountCents: 10_000_000 } }) },
  cashWithdrawal: { aggregate: async () => ({ _sum: { amountCents: null } }) },
  tBankSettlementAccount: { findMany: async () => [
    { id: "primary", accountNumberHash: "same-account" },
    { id: "duplicate", accountNumberHash: "same-account" },
  ] },
};
const imports = {
  "@/lib/db": { prisma },
  "@/lib/bank-operation-category-domain": { bankCategoryNameKey: name => name.toLowerCase() },
  "@/lib/request-tenant-store": { getScopedBranchId: () => "test" },
  "@/lib/messenger/messenger-tenant": { getMessengerOrganizationId: () => "test" },
  "@/lib/cash-available": {},
  "@/lib/tbank": { getTBankStatement: async () => {
    bankCalls++;
    return { ok: true, statement: {
      currency: "RUB",
      categories: [
        { id: "purchase", name: "Закупки", kind: "operating" },
        { id: "pending", code: "cash_withdrawal", kind: "transfer" },
      ],
      operations: [
        amount(10_000_000, { cashTransferDate: "2026-11-05", categoryId: "purchase" }),
        amount(1_200_000, { categoryId: "purchase" }),
        amount(2_000_000, { direction: "income" }),
        amount(500_000, { categoryId: "pending" }),
      ],
    } };
  } },
};
vm.runInNewContext(compiled, { exports, require: name => imports[name] });
const report = await exports.readFinanceMoneyMovements("2026-11-01", "2026-11-05", { role: "owner" }, new Set());
assert.equal(report.categories.reduce((sum, row) => sum + row.cashOut + row.bankOut, 0), 9_200_000);
assert.equal(report.categories.reduce((sum, row) => sum + row.cashIn + row.bankIn, 0), 2_500_000);
assert.equal(report.matchedBankOut, 10_000_000);
assert.equal(report.depositedCash, 10_000_000);
assert.equal(report.unlinkedTransferOut, 500_000);
assert.equal(bankCalls, 1);
assert.equal(report.bankIncomplete, true, "duplicate account configuration is surfaced");
console.log("Finance movements: bank-to-cash reconciliation, payroll counted once, pending transfers and duplicate accounts passed");
