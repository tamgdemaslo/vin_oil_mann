import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const inventory = read("src/lib/local-inventory-admin.ts");
assert.match(inventory, /function trustedReadableBranchIds\(/, "document lists must require server branch scope");
assert.match(inventory, /branchId: \{ in: branchIds \}/, "document and invoice lists must query explicit branch ids");
assert.match(inventory, /JSON\.stringify\(\{ type, search, limit, offset, branchIds \}\)/, "receipt cache key must include branch scope");
assert.match(inventory, /branchIds,\n\s*\}\);\n\s*const now = Date\.now\(\);\n\s*const cached = inventoryListsCache\.supplierInvoices/, "invoice cache key must include branch scope");
assert.match(inventory, /JSON\.stringify\(\{ branchId, mode, dateFrom, dateTo \}\)/, "restock cache key must include current branch");
assert.match(inventory, /getScopedBranchId\(\);\n\s*const type = body\.type/, "document creation must require a concrete branch context");

for (const file of [
  "src/app/api/local-inventory/movements/route.ts",
  "src/app/api/local-inventory/supplier-invoices/route.ts",
  "src/app/api/warehouse/receipts/[...path]/route.ts",
  "src/app/api/finance/[report]/route.ts",
]) {
  const body = read(file);
  assert.match(body, /requireBranchApi\(/, `${file} must resolve branch access server-side`);
  assert.match(body, /runWithBranchApiContext\(/, `${file} must bind the request tenant before database access`);
}

console.log("Inventory document branch isolation: PASS");
