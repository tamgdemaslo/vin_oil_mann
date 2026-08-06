#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", ".next", "node_modules", ".data", "coverage"]);
const immutableMigrationFiles = new Set([
  "prisma/migrations/20260202000000_add_diagnostic_module/migration.sql",
  "prisma/migrations/20260522000000_add_local_inventory/migration.sql",
  "prisma/migrations/20260522020000_add_local_inventory_extra_fields/migration.sql",
  "prisma/migrations/20260526000000_local_shipment_runtime/migration.sql",
  "prisma/migrations/20260527090000_add_local_cash_expense_orders/migration.sql",
  "prisma/migrations/20260528170000_keep_nullable_legacy_fields/migration.sql",
  "prisma/migrations/20260707120000_client_case_queue/migration.sql",
  "prisma/migrations/20260728120000_branch_architecture_foundation/migration.sql",
  "prisma/migrations/20260728160000_branch_aware_external_keys/migration.sql",
]);
const approvalGatedMigrationFile = "prisma/migrations/20260806130000_inventory_integration_decommission/migration.sql";

function isAllowedHistoricalReference(relativePath) {
  return (
    relativePath === "docs/MOYSKLAD_DECOMMISSIONED.md" ||
    relativePath.startsWith("docs/archive/moysklad-migration/") ||
    relativePath === "scripts/check-moysklad-removed.mjs" ||
    immutableMigrationFiles.has(relativePath) ||
    relativePath === approvalGatedMigrationFile
  );
}

function collectFiles(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store" || entry.name.startsWith("._")) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) collectFiles(absolutePath, result);
      continue;
    }
    if (entry.isFile()) result.push(absolutePath);
  }
  return result;
}

const forbiddenMarkers = [
  /м[оo]йсклад/iu,
  /moy[\s_-]*sklad/iu,
  /my[\s_-]*sklad/iu,
  /\bMS_TOKEN\b/u,
  /\b(?:MOYSKLAD|MY_SKLAD)[A-Z0-9_]*/u,
  /(?:api|online)\.moysklad\.ru/iu,
];

const findings = [];
for (const absolutePath of collectFiles(root)) {
  const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
  if (isAllowedHistoricalReference(relativePath)) continue;
  const stat = fs.statSync(absolutePath);
  if (stat.size > 2_000_000) continue;
  let content = fs.readFileSync(absolutePath, "utf8");
  if (relativePath === "package.json") {
    content = content.replace(/"check:moysklad-removed"\s*:\s*"node scripts\/check-moysklad-removed\.mjs",?/, "");
  }
  if (forbiddenMarkers.some((marker) => marker.test(content)) || forbiddenMarkers.some((marker) => marker.test(relativePath))) {
    findings.push(relativePath);
  }
}

const requiredAbsentPaths = [
  "src/lib/moysklad.ts",
  "src/lib/moysklad-flags.ts",
  "src/lib/moysklad-customer-analytics-sync.ts",
  "src/app/api/moysklad",
];
for (const relativePath of requiredAbsentPaths) {
  if (fs.existsSync(path.join(root, relativePath))) findings.push(relativePath);
}

const approvalMigrationPath = path.join(root, approvalGatedMigrationFile);
const approvalMigration = fs.existsSync(approvalMigrationPath) ? fs.readFileSync(approvalMigrationPath, "utf8") : "";
if (!approvalMigration.includes("migration_approval_required")) {
  findings.push(`${approvalGatedMigrationFile}: missing migration_approval_required gate`);
}

if (findings.length > 0) {
  console.error("MoySklad decommission guard failed:");
  for (const finding of [...new Set(findings)].sort()) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("MoySklad decommission guard passed.");
