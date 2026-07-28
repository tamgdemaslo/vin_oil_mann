import assert from "node:assert/strict";
import path from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });
const { applyBranchQueryPolicy } = await jiti.import(path.join(process.cwd(), "src/lib/db.ts"));

const branchOne = {
  mode: "branch",
  branchId: "branch-1",
  organizationId: "org-1",
  allowedBranchIds: ["branch-1"],
};
const all = {
  mode: "all",
  branchId: null,
  organizationId: null,
  allowedBranchIds: ["branch-1", "branch-2"],
};

assert.deepEqual(
  applyBranchQueryPolicy("LocalProduct", "findMany", { where: { archived: false } }, branchOne),
  { where: { archived: false, branchId: "branch-1" } }
);
assert.deepEqual(
  applyBranchQueryPolicy("LocalDemand", "create", { data: { name: "ДЧ-1" } }, branchOne),
  { data: { name: "ДЧ-1", branchId: "branch-1" } }
);
assert.throws(
  () => applyBranchQueryPolicy("LocalCounterparty", "findUnique", { where: { id: "client-2", branchId: "branch-2" } }, branchOne),
  /другого филиала/
);
assert.throws(
  () => applyBranchQueryPolicy("MessengerAttachment", "findUnique", { where: { id: "attachment-2" } }, all),
  /явный разрешённый branchId/
);
assert.deepEqual(
  applyBranchQueryPolicy("MessengerAttachment", "findUnique", { where: { id: "attachment-2", branchId: "branch-2" } }, all),
  { where: { id: "attachment-2", branchId: "branch-2" } }
);
assert.throws(
  () => applyBranchQueryPolicy("LocalDemand", "create", { data: { name: "X" } }, all),
  /операции изменения запрещены/
);
assert.deepEqual(
  applyBranchQueryPolicy("User", "findMany", { where: { status: "active" } }, branchOne),
  { where: { status: "active" } }
);

console.log("Branch scope policy tests passed.");
