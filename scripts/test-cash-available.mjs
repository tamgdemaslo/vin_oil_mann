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
  inventory.indexOf("function isSupplierInvoicePaymentType"),
  inventory.indexOf("export async function updateLocalSupplierInvoiceStatus"),
);
const correctionExports = {};
let payment = { id: "payment", paymentType: "cash", amountCents: 8_800_000 };
let order = { id: "order", branchId: "branch-test", shiftId: "shift", status: "posted", paymentType: "cash", amountCents: 8_800_000 };
let paymentRows = [payment];
let hasOpenShift = true;
let createdOrders = 0;
const baseInvoice = {
  id: "invoice", branchId: "branch-test", source: "receipt", number: "СЧ-ТЕСТ",
  status: "paid", sumCents: 940_000, paidAmountCents: 940_000, tbankPayments: [],
  document: { name: "ПР-ТЕСТ", counterpartyNameSnapshot: "Поставщик" },
};
let historicalShift = { status: "closed", cashExpensesTotalCents: 8_800_000, expectedCashCents: -8_700_000, actualCashCents: 100_000 };
const correctionTx = {
  localSupplierInvoicePayment: {
    findFirst: async ({ where }) => {
      assert.deepEqual({ ...where }, { id: "payment", invoiceId: "invoice", branchId: "branch-test" });
      return { ...payment, cashExpenseOrder: { ...order } };
    },
    updateMany: async ({ data }) => { payment = { ...payment, ...data }; return { count: 1 }; },
    create: async ({ data }) => {
      assert.equal(data.invoiceId, "invoice");
      assert.equal(data.branchId, "branch-test");
      paymentRows.push({ ...data });
      return data;
    },
  },
  cashExpenseOrder: { updateMany: async ({ data }) => { order = { ...order, ...data }; return { count: 1 }; } },
  cashShift: {
    updateMany: async () => ({ count: 1 }),
    findFirst: async () => historicalShift,
    update: async ({ data }) => { historicalShift = { ...historicalShift, ...data }; },
  },
  localSupplierInvoice: {
    findUniqueOrThrow: async ({ where }) => {
      assert.equal(where.branchId, "branch-test");
      return { ...baseInvoice, payments: paymentRows };
    },
    update: async ({ where, data }) => {
      assert.equal(where.branchId, "branch-test");
      return { ...baseInvoice, ...data, payments: paymentRows };
    },
    delete: async ({ where }) => {
      assert.equal(where.branchId, "branch-test");
      paymentRows = [];
    },
  },
};
vm.runInNewContext(ts.transpileModule(correction + "\nexports.recordInitialSupplierInvoicePayment = recordInitialSupplierInvoicePayment;", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: correctionExports,
  prisma: { $transaction: (fn) => fn(correctionTx) },
  getScopedBranchId: () => "branch-test",
  invalidateSupplierInvoiceLists() {},
  invalidateStockDocumentLists() {},
  optionalDocumentDateFromInput: (value) => value,
  toServiceDateInput: () => "2026-11-17",
  toJson: (value) => value,
  effectivePaidCents: (invoice) => invoice.paidAmountCents,
  getCurrentShift: async () => hasOpenShift ? { id: "open-shift" } : null,
  addExpense: async (params, tx) => {
    assert.equal(tx, correctionTx);
    assert.equal(params.shiftId, "open-shift");
    assert.equal(params.expenseDate, "2026-11-17");
    assert.equal(params.status, "posted");
    createdOrders += 1;
    order = { id: `new-order-${createdOrders}`, branchId: "branch-test", shiftId: "open-shift",
      status: "posted", paymentType: "cash", amountCents: Math.round(params.amount * 100) };
    return { orderId: order.id };
  },
  mapSupplierInvoice: (invoice) => invoice,
  supplierInvoiceInclude: {},
});
const correct = (role) => correctionExports.correctSupplierCashPayment("invoice", "payment", "bank_transfer", { role, login: "test", name: "Test" });
await assert.rejects(correct("master"), /Недостаточно прав/);
assert.equal((await correct("owner")).paidAmountCents, baseInvoice.paidAmountCents);
assert.equal(payment.paymentType, "bank_transfer");
assert.equal(order.status, "cancelled");
assert.equal(historicalShift.expectedCashCents, 100_000);
assert.equal(historicalShift.actualCashCents, 100_000);
assert.equal(historicalShift.discrepancyCents, 0);
await correct("owner");
assert.equal(historicalShift.expectedCashCents, 100_000, "retry must not credit the same order twice");
console.log("Cash correction: permissions, order cancellation, unchanged invoice payment, closed shift recalculation and safe retry passed");

const owner = { role: "owner", login: "test", name: "Test" };
const changeMethod = (method, id = "payment") =>
  correctionExports.correctSupplierCashPayment("invoice", id, method, owner, "2026-11-17");
await changeMethod("card");
assert.equal(payment.paymentType, "card");
assert.equal(createdOrders, 0);
await changeMethod("cash");
assert.equal(payment.paymentType, "cash");
assert.equal(payment.cashExpenseOrderId, "new-order-1");
await changeMethod("cash");
assert.equal(createdOrders, 1, "repeating the same correction must not create another order");

paymentRows = [];
const recoverCash = () =>
  correctionExports.correctSupplierCashPayment("invoice", undefined, "cash", owner, "2026-11-17");
hasOpenShift = false;
await assert.rejects(recoverCash(), /смена не открыта/);
assert.equal(paymentRows.length, 0);
hasOpenShift = true;
const restored = await recoverCash();
assert.equal(restored.paidAmountCents, 940_000);
assert.equal(restored.payments.length, 1);
assert.equal(restored.payments[0].amountCents, 940_000);
assert.equal(restored.payments[0].paymentType, "cash");
assert.equal(restored.payments[0].cashExpenseOrderId, "new-order-2");
await assert.rejects(recoverCash(), /Состояние оплаты изменилось/);
assert.equal(createdOrders, 2);

paymentRows[0].cashExpenseOrder = order;
await correctionExports.deleteLocalSupplierInvoice("invoice", owner);
assert.equal(order.status, "cancelled");
assert.equal(paymentRows.length, 0);
console.log("Supplier invoice: method changes, legacy cash payment, closed shift, repeat submission and deletion passed");


const initialPayment = (method) =>
  correctionExports.recordInitialSupplierInvoicePayment(correctionTx, baseInvoice, method, owner);
await assert.rejects(initialPayment(undefined), /Выберите способ оплаты/);
assert.equal(paymentRows.length, 0);
for (const method of ["card", "bank_transfer", "cash"]) {
  await initialPayment(method);
  const captured = paymentRows.at(-1);
  assert.equal(captured.amountCents, baseInvoice.sumCents);
  assert.equal(captured.paymentType, method);
  assert.equal(Boolean(captured.cashExpenseOrderId), method === "cash");
}
assert.equal(createdOrders, 3);
console.log("Receipt invoice: explicit method required and only cash creates an expense order");
