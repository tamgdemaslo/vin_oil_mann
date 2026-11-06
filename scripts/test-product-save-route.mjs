import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { createJiti } from "jiti";

const dir = mkdtempSync(join(tmpdir(), "product-save-route-"));
try {
  const mock = join(dir, "mock.cjs");
  writeFileSync(mock, `
    const test = exports.test = { user: { role: "employee" }, calls: [], error: null };
    exports.requireBranchApi = async () => ({ ok: true, context: { branchId: "branch-a", user: test.user } });
    exports.runWithBranchApiContext = (context, save) => {
      test.scope = context.branchId;
      return save();
    };
    exports.productPayloadHasMarkingSettings = (body) => "markingMode" in body;
    exports.canManageWarehouseMarking = (user) => user.role === "admin";
    exports.updateLocalAdminProduct = async (id, body, actor, branchId) => {
      test.calls.push({ id, body, actor, branchId });
      if (test.error) throw test.error;
      return { ok: true, product: { id, ...body } };
    };
  `);
  const jiti = createJiti(import.meta.url, { alias: {
    "@/lib/auth": mock,
    "@/lib/branch-api": mock,
    "@/lib/local-inventory-admin": mock,
    "next/server": resolve("node_modules/next/server.js"),
  } });
  const { PUT } = await jiti.import("../src/app/api/local-inventory/products/[id]/route.ts");
  const { test } = await jiti.import(mock);
  const save = (body) => PUT(new Request("http://localhost/products/item-a", {
    method: "PUT",
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "item-a" }) });

  assert.equal((await save(null)).status, 400);
  assert.equal((await save({ markingMode: "NOT_MARKED" })).status, 403);
  assert.equal(test.calls.length, 0);
  const saved = await save({ article: "V182575122", code: "" });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { id: "item-a", article: "V182575122", code: "" });
  assert.equal(test.calls[0].branchId, "branch-a");
  assert.equal(test.scope, "branch-a");

  for (const [code, status] of [["P2028", 503], ["P2024", 503], ["P2002", 409]]) {
    test.error = new Prisma.PrismaClientKnownRequestError("internal database error", { code, clientVersion: "test" });
    const response = await save({ article: "V182575122" });
    assert.equal(response.status, status);
    assert.match((await response.json()).error, /[А-Яа-я]/u);
  }
  assert.equal(test.calls.length, 4, "failed writes are not silently repeated");
  console.log("Product save route: scoped update, marking permissions and database failure responses passed");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
