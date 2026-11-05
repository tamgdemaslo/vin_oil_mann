import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("src/lib/cash-available.ts", "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
let providerFailed = false;
const exports = {};
vm.runInNewContext(outputText, {
  exports, Intl, Date, URLSearchParams, AbortSignal,
  require(name) {
    if (name === "@/lib/aqsi-integration") return { resolveAqsiCashRegister: async () => ({ deviceId: "42" }) };
    if (name === "@/lib/aqsi") return {
      aqsiFetchJson: async (_config, path) => {
        assert.match(path, /filtered.devices=42/);
        if (providerFailed) throw new Error("offline");
        return { rows: [], pages: 0, noData: true };
      },
    };
    throw new Error(name);
  },
});

let open = true;
let expenses = 2_000;
let deposits = 0;
const tx = {
  cashShift: {
    updateMany: async ({ where }) => {
      assert.equal(where.branchId, "branch-test");
      assert.equal(where.status, "open");
      return { count: open ? 1 : 0 };
    },
    findFirstOrThrow: async () => ({ openingCashCents: 10_000, timezone: "Europe/Kaliningrad", openedAt: new Date(), aqsiRegisterId: "register" }),
  },
  bankCashTransfer: { aggregate: async () => ({ _sum: { amountCents: deposits } }) },
  cashWithdrawal: { aggregate: async () => ({ _sum: { amountCents: 1_000 } }) },
  cashExpenseOrder: { aggregate: async ({ where }) => {
    assert.equal(where.status, "posted");
    assert.equal(where.paymentType, "cash");
    return { _sum: { amountCents: expenses } };
  } },
};
const check = (amount) => exports.assertCashAvailable(tx, "branch-test", "shift-test", amount);
await check(7_000);
await assert.rejects(check(7_001), /не хватает наличных/);
deposits = 3_000;
await check(10_000);
await assert.rejects(check(10_001), /не хватает наличных/);
deposits = 0;
expenses += 7_000;
await assert.rejects(check(1), /не хватает наличных/);
providerFailed = true;
await assert.rejects(check(1), /Не удалось проверить наличные/);
open = false;
await assert.rejects(check(1), /смена не открыта/);
console.log("Cash guard: exact balance, overspend, depleted cash, unavailable receipts and closed shift passed");

const inventory = fs.readFileSync("src/lib/local-inventory-admin.ts", "utf8");
const correction = inventory.slice(
  inventory.indexOf("export async function correctSupplierCashPayment"),
  inventory.indexOf("export async function updateLocalSupplierInvoiceStatus"),
);
const correctionExports = {};
let payment = { id: "payment", paymentType: "cash", amountCents: 8_800_000 };
let order = { id: "order", branchId: "branch-test", shiftId: "shift", status: "posted", paymentType: "cash", amountCents: 8_800_000 };
let historicalShift = { status: "closed", cashExpensesTotalCents: 8_800_000, expectedCashCents: -8_700_000, actualCashCents: 100_000 };
const correctionTx = {
  localSupplierInvoicePayment: {
    findFirst: async ({ where }) => {
      assert.deepEqual({ ...where }, { id: "payment", invoiceId: "invoice", branchId: "branch-test" });
      return { ...payment, cashExpenseOrder: { ...order } };
    },
    updateMany: async ({ data }) => { payment = { ...payment, ...data }; return { count: 1 }; },
  },
  cashExpenseOrder: { updateMany: async ({ data }) => { order = { ...order, ...data }; return { count: 1 }; } },
  cashShift: {
    updateMany: async () => ({ count: 1 }),
    findFirst: async () => historicalShift,
    update: async ({ data }) => { historicalShift = { ...historicalShift, ...data }; },
  },
  localSupplierInvoice: { findUniqueOrThrow: async () => ({ paidAmountCents: payment.amountCents }) },
};
vm.runInNewContext(ts.transpileModule(correction, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: correctionExports,
  prisma: { $transaction: (fn) => fn(correctionTx) },
  getScopedBranchId: () => "branch-test",
  invalidateSupplierInvoiceLists() {},
  mapSupplierInvoice: (invoice) => invoice,
  supplierInvoiceInclude: {},
});
const correct = (role) => correctionExports.correctSupplierCashPayment("invoice", "payment", "bank_transfer", { role, login: "test", name: "Test" });
await assert.rejects(correct("master"), /Недостаточно прав/);
assert.equal((await correct("owner")).paidAmountCents, 8_800_000);
assert.equal(payment.paymentType, "bank_transfer");
assert.equal(order.status, "cancelled");
assert.equal(historicalShift.expectedCashCents, 100_000);
assert.equal(historicalShift.actualCashCents, 100_000);
assert.equal(historicalShift.discrepancyCents, 0);
await correct("owner");
assert.equal(historicalShift.expectedCashCents, 100_000, "retry must not credit the same order twice");
console.log("Cash correction: permissions, order cancellation, unchanged invoice payment, closed shift recalculation and safe retry passed");
