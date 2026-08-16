#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];

function expect(file, patterns) {
  const source = read(file);
  for (const pattern of patterns) {
    if (!pattern.test(source)) failures.push(`${file}: отсутствует ${pattern}`);
  }
}

for (const route of [
  "src/app/api/shipments/[id]/reopen-check/route.ts",
  "src/app/api/shipments/[id]/reopen/route.ts",
]) {
  expect(route, [
    /requireBranchApi\(\{ allowAll: false, requireActive: true \}\)/,
    /runWithBranchApiContext\(branchAccess\.context/,
    /branchAccess\.context\.branchId/,
  ]);
}

expect("src/lib/local-demand-write.ts", [
  /type StockMovementContext = \{\s*branchId: string;/,
  /localStockBalance\.create\(\{[\s\S]*?data: \{\s*branchId: context\.branchId,/,
  /inventoryLedgerEntry\.create\(\{[\s\S]*?data: \{\s*branchId: context\.branchId,/,
  /loadReopenRelations\(current\.id, current\.branchId\)/,
  /assertNoActiveInventoryLocks\(prisma, \{[\s\S]*?warehouseId: current\.storeId,[\s\S]*?trackedPositions\.map/,
  /scope = await resolveDemandBranchScope\(branchId, organizationId\)/,
  /where: \{ branchId: scope\.branchId, OR: \[\{ id \}, \{ id: id \}\] \}/,
  /movementType: "SHIPMENT_REOPEN_REVERSAL"/,
]);

expect("src/app/shipment/[id]/page.tsx", [
  /const \[reopenError, setReopenError\] = useState<string \| null>\(null\)/,
  /const reopenRequestInFlight = useRef\(false\)/,
  /if \(!id \|\| !reopenCheck \|\| reopenRequestInFlight\.current\) return/,
  /<section className="is-danger" role="alert">[\s\S]*?\{reopenError\}/,
]);

if (failures.length) {
  console.error(`Shipment reopen checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Shipment reopen checks passed (branch scope, inventory precheck, ledger branch, visible errors, duplicate guard).");
