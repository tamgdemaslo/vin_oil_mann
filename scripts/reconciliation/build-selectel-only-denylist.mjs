#!/usr/bin/env node

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPkIndex, loadConfig, loadHasher, loadSchema, stable } from "./reconciliation-runtime.mjs";

const output = resolve(process.argv[2] ?? "docs/reconciliation/selectel-only-denylist.json");
const sourceBaselineDb = process.env.RECONCILIATION_BASELINE_SOURCE_DB || "reconciliation_railway_dump";
const expectedAuditTotal = Number(process.env.RECONCILIATION_EXPECTED_PROTECTED_TOTAL || 3709);
const config = loadConfig();
const hasher = loadHasher(config);
const sourceSchema = loadSchema(config, sourceBaselineDb);
const targetSchema = loadSchema(config, config.targetDb);
if (sourceSchema.hash !== targetSchema.hash) throw new Error("Baseline Railway and Selectel schemas differ.");

const tables = [];
let total = 0;
for (const table of targetSchema.tables) {
  if (table.tableName === "_prisma_migrations") continue;
  const source = buildPkIndex(config, sourceBaselineDb, table, hasher);
  const target = buildPkIndex(config, config.targetDb, table, hasher);
  const primaryKeys = [...target.keys()].filter((hash) => !source.has(hash)).sort();
  if (!primaryKeys.length) continue;
  const checksum = createHash("sha256").update(JSON.stringify(stable(primaryKeys))).digest("hex");
  tables.push({ tableName: table.tableName, count: primaryKeys.length, primaryKeyColumns: table.primaryKey, primaryKeyHashes: primaryKeys, checksum });
  total += primaryKeys.length;
}

writeFileSync(output, `${JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceBaselineDatabase: sourceBaselineDb,
  canonicalTarget: "Selectel",
  hashKeyId: hasher.keyId,
  protectionRule: "NO_UPDATE_OR_DELETE_EXCEPT_EXPLICIT_FIELD_LEVEL_RESOLUTION",
  total: expectedAuditTotal,
  explicitPrimaryKeyCount: total,
  legacyAuditGapCount: Math.max(0, expectedAuditTotal - total),
  legacyAuditGapProtection: "Covered by global no-update guard and before/after table checksums; the earlier live Railway PK audit did not retain reversible PK values.",
  tables,
}, null, 2)}\n`, { mode: 0o600 });

console.log(JSON.stringify({ status: "DENYLIST_BUILT", expectedAuditTotal, explicitPrimaryKeyCount: total, legacyAuditGapCount: Math.max(0, expectedAuditTotal - total), tables: tables.length }, null, 2));
