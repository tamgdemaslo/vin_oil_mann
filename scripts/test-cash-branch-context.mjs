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
