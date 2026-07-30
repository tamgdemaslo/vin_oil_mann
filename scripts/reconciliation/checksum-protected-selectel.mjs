#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPkIndex, fetchRow, loadConfig, loadHasher, loadManifest, loadSchema, stable } from "./reconciliation-runtime.mjs";

function parseArgs(argv) {
  const options = { denylist: resolve("docs/reconciliation/selectel-only-denylist.json"), output: null, phase: "unspecified" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--denylist") options.denylist = resolve(argv[++index]);
    else if (argv[index] === "--output") options.output = resolve(argv[++index]);
    else if (argv[index] === "--phase") options.phase = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.output) throw new Error("--output is required.");
  return options;
}

const options = parseArgs(process.argv.slice(2));
const config = loadConfig();
const hasher = loadHasher(config);
const denylist = loadManifest(options.denylist);
const schema = loadSchema(config, config.targetDb);
if (denylist.hashKeyId !== hasher.keyId) throw new Error("Denylist hash key mismatch.");

const tableResults = [];
let checkedRows = 0;
for (const entry of denylist.tables || []) {
  const table = schema.byName.get(entry.tableName);
  if (!table) throw new Error(`Protected table missing: ${entry.tableName}`);
  const index = buildPkIndex(config, config.targetDb, table, hasher);
  const rowHashes = [];
  for (const pkHash of entry.primaryKeyHashes) {
    const tuple = index.get(pkHash);
    if (!tuple) throw new Error(`Protected row missing from ${entry.tableName}.`);
    const row = fetchRow(config, config.targetDb, table, tuple);
    rowHashes.push(hasher.hash(`protected-row:${entry.tableName}`, row));
  }
  rowHashes.sort();
  tableResults.push({
    tableName: entry.tableName,
    count: rowHashes.length,
    checksum: createHash("sha256").update(JSON.stringify(stable(rowHashes))).digest("hex"),
  });
  checkedRows += rowHashes.length;
}

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  phase: options.phase,
  targetDatabase: config.targetDb,
  contractProtectedTotal: denylist.total,
  explicitPkRowsChecked: checkedRows,
  legacyAuditGapCount: denylist.legacyAuditGapCount ?? 0,
  tables: tableResults,
  globalChecksum: createHash("sha256").update(JSON.stringify(stable(tableResults))).digest("hex"),
};
writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ status: "PROTECTED_CHECKSUM_COMPLETE", phase: options.phase, explicitPkRowsChecked: checkedRows, contractProtectedTotal: denylist.total, globalChecksum: result.globalChecksum }, null, 2));
