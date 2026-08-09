import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const schema = read("prisma/schema.prisma");
const management = read("src/lib/local-store-management.ts");
const stores = read("src/lib/local-inventory-admin.ts");
const branchesUi = read("src/app/cabinet/branches/page.tsx");
const receiptsUi = read("src/app/inventory/StockDocumentClient.tsx");

assert.match(schema, /model LocalStore[\s\S]*?branchId\s+String[\s\S]*?isMain\s+Boolean[\s\S]*?archived\s+Boolean/, "warehouse model must remain branch-scoped and retain main/archive flags");
assert.match(management, /runWithRequestTenant\(\{[\s\S]*?mode: "branch",[\s\S]*?branchId: branch\.id/, "warehouse operations must bind the target branch tenant server-side");
assert.match(management, /createManagedWarehouse[\s\S]*?activeCount === 0 \|\| boolean\(input\.isMain\)/, "the first active warehouse must become main automatically");
assert.match(management, /setManagedWarehouseMain[\s\S]*?updateMany\([\s\S]*?isMain: false/, "assigning a main warehouse must clear the previous main warehouse transactionally");
assert.match(management, /archiveManagedWarehouse[\s\S]*?archived: true, isMain: false[\s\S]*?normalizeMainWarehouse/, "archiving a warehouse must preserve the main-warehouse invariant");
assert.match(stores, /orderBy: \[\{ isMain: "desc" \}, \{ name: "asc" \}\]/, "receipt store list must prefer the main warehouse");
assert.match(branchesUi, /Склады/, "branch management must expose a warehouses tab");
assert.match(branchesUi, /Остатки и движения других филиалов не копировались/, "warehouse creation must communicate that no cross-branch stock is copied");
assert.match(receiptsUi, /stores\.length === 0/, "receipt UI must distinguish an empty warehouse list from a loading error");
assert.match(receiptsUi, /tab=warehouses/, "receipt UI must lead the owner to warehouse management when the branch has no warehouses");

console.log("Warehouse branch management checks: PASS");
