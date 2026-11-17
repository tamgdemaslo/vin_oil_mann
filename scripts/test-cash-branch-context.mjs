import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function load(file, dependencies) {
  const exports = {};
  const source = readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

const tenant = load("src/lib/request-tenant-store.ts", {
  "node:async_hooks": { AsyncLocalStorage },
});
const next = { NextResponse: { json: (body, { status = 200 } = {}) => ({ body, status }) } };
let branchActive = true;
const branchApi = load("src/lib/branch-api.ts", {
  "next/server": next,
  "@/lib/request-tenant-store": tenant,
  "@/lib/branch-context": {
    async requireBranchContext({ allowAll, requireActive }) {
      assert.equal(allowAll, false);
      assert.equal(requireActive, true);
      if (!branchActive) throw new Error("branch inactive");
      return { mode: "branch", branchId: "branch-a", organizationId: "org-a", businessGroupId: "group-a" };
    },
    branchErrorResponse: () => ({ error: "branch inactive", code: "branch_read_only", status: 423 }),
  },
});

let withdrawals = 0;
const route = load("src/app/api/cash/route.ts", {
  "next/server": next,
  "@/lib/branch-api": branchApi,
  "@/lib/cashbox": {
    async addWithdrawal() {
      await Promise.resolve();
      assert.equal(tenant.getScopedBranchId(), "branch-a");
      assert.equal(tenant.getRequestTenant()?.organizationId, "org-a");
      assert.equal(tenant.getRequestTenant()?.businessGroupId, "group-a");
      withdrawals++;
      return { type: "withdrawal" };
    },
  },
});

const request = {
  json: async () => ({ action: "addWithdrawal", shiftId: "shift-a", amount: 10, reason: "Инкассация" }),
};
const result = await route.POST(request);
assert.equal(result.status, 200);
assert.equal(result.body.operation.type, "withdrawal");
assert.equal(tenant.getRequestTenant(), null);

branchActive = false;
assert.equal((await route.POST(request)).status, 423);
assert.equal(withdrawals, 1);
console.log("Cash withdrawal inherits the authorized branch across awaits and rejects inactive branches");

const requestId = "f07f619f-3b78-478a-bfd1-70862b0753bf";
branchActive = true;
const invalid = { json: async () => ({ ...(await request.json()), requestId: "invalid" }) };
assert.equal((await route.POST(invalid)).status, 400);
assert.equal(withdrawals, 1);

const cashbox = readFileSync("src/lib/cashbox.ts", "utf8");
const withdrawalCode = cashbox.slice(
  cashbox.indexOf("export async function addWithdrawal"),
  cashbox.indexOf("export async function addExpense"),
);
const { outputText } = ts.transpileModule(withdrawalCode, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const withdrawalExports = {};
const shift = { id: "shift-a", branchId: "branch-a", status: "open" };
const records = new Map();
let balanceChecks = 0;
runInNewContext(outputText, {
  exports: withdrawalExports,
  requireSessionUser: async () => ({ login: "owner", role: "owner" }),
  assertOwner: (user) => assert.equal(user.role, "owner"),
  findShiftRowById: async () => shift,
  generateId: () => "legacy-op",
  centsFromRub: (amount) => Math.round(amount * 100),
  withdrawalRowToOperation: (row) => row,
  assertCashAvailable: async () => { balanceChecks++; },
  prisma: {
    cashWithdrawal: {
      findFirst: async ({ where }) => {
        assert.equal(where.branchId, "branch-a");
        assert.equal(where.shiftId, "shift-a");
        assert.equal(where.createdBy, "owner");
        return records.get(where.id) ?? null;
      },
    },
    $transaction: (run) => run({
      cashWithdrawal: {
        create: async ({ data }) => {
          if (records.has(data.id)) throw new Error("primary key conflict");
          records.set(data.id, data);
          return data;
        },
      },
    }),
  },
});

const params = { shiftId: shift.id, amount: 50_000, reason: "Инкассация", requestId };
const [first, concurrent] = await Promise.all([
  withdrawalExports.addWithdrawal(params),
  withdrawalExports.addWithdrawal(params),
]);
assert.equal(first.id, concurrent.id);
assert.equal(records.size, 1);
assert.equal(first.amountCents, 5_000_000);
shift.status = "closed";
assert.equal((await withdrawalExports.addWithdrawal(params)).id, first.id);
assert.equal(balanceChecks, 2);
await assert.rejects(withdrawalExports.addWithdrawal({ ...params, amount: 49_000 }), /с изменёнными данными/);
console.log("Withdrawal retries return the same operation after concurrent submissions or a lost response");

const cashPage = readFileSync("src/app/cash/page.tsx", "utf8");
const retryCode = cashPage.slice(cashPage.indexOf("async function fetchCashWithRetry"), cashPage.indexOf("function errorFromJson"));
const retryExports = {};
const attempts = [];
const networkResults = [new TypeError("Load failed"), { status: 200 }, { status: 400 }];
runInNewContext(ts.transpileModule(`export ${retryCode}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: retryExports,
  setTimeout: (callback) => callback(),
  fetch: async (_url, options) => {
    attempts.push(options.body);
    const result = networkResults.shift();
    if (result instanceof Error) throw result;
    return result;
  },
});
const options = { method: "POST", body: JSON.stringify(params) };
assert.equal((await retryExports.fetchCashWithRetry("/api/cash", options)).status, 200);
assert.deepEqual(attempts, [options.body, options.body]);
assert.equal((await retryExports.fetchCashWithRetry("/api/cash", options)).status, 400);
assert.equal(attempts.length, 3, "Business errors must not trigger a retry");
console.log("The cash client retries a broken connection with the original request and preserves business errors");
