#!/usr/bin/env node

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALLOWED_ACTIONS,
  buildPkIndex,
  fetchRow,
  loadConfig,
  loadHasher,
  loadManifest,
  loadSchema,
  loadSupplement,
  loadUniqueIndexes,
  query,
  quoteIdent,
  quoteLiteral,
  stable,
} from "./reconciliation-runtime.mjs";

function parseArgs(argv) {
  const options = {
    manifest: resolve("docs/reconciliation/railway-to-selectel-migration-manifest.json"),
    output: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") options.manifest = resolve(argv[++index]);
    else if (arg === "--output") options.output = resolve(argv[++index]);
    else if (arg === "--help") {
      console.log("Usage: dry-run-railway-import.mjs [--manifest path] [--output path]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function canonicalChecksum(record) {
  const payload = { ...record };
  delete payload.checksum;
  return createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex");
}

const options = parseArgs(process.argv.slice(2));
const config = loadConfig();
const hasher = loadHasher(config);
const manifest = loadManifest(options.manifest);
const sourceSchema = loadSchema(config, config.sourceDb);
const targetSchema = loadSchema(config, config.targetDb);
const supplement = loadSupplement(config, hasher);
const errors = [];
const warnings = [];
const pkCache = new Map();
const plannedInsertKeys = new Set(manifest.records
  .filter((record) => record.action === "INSERT_MISSING")
  .map((record) => `${record.targetTable}\u0000${record.sourcePrimaryKey.hash}`));

function pkIndex(db, tableName) {
  const key = `${db}\u0000${tableName}`;
  if (!pkCache.has(key)) {
    const schema = db === config.sourceDb ? sourceSchema : targetSchema;
    const table = schema.byName.get(tableName);
    if (!table) throw new Error(`Table missing from ${db}: ${tableName}`);
    pkCache.set(key, buildPkIndex(config, db, table, hasher));
  }
  return pkCache.get(key);
}

function sourceRow(record) {
  const table = sourceSchema.byName.get(record.sourceTable);
  const tuple = pkIndex(config.sourceDb, record.sourceTable).get(record.sourcePrimaryKey.hash);
  if (tuple) return fetchRow(config, config.sourceDb, table, tuple);
  return supplement.get(`${record.sourceTable}\u0000${record.sourcePrimaryKey.hash}`) || null;
}

if (manifest.hashKeyId !== hasher.keyId) errors.push({ type: "HASH_KEY_MISMATCH" });
if (manifest.schemaHash !== sourceSchema.hash || manifest.schemaHash !== targetSchema.hash) {
  errors.push({ type: "UNEXPECTED_SCHEMA_DIFFERENCE", sourceMatches: manifest.schemaHash === sourceSchema.hash, targetMatches: manifest.schemaHash === targetSchema.hash });
}
if (sourceSchema.tables.length !== manifest.expectedPublicTableCount || targetSchema.tables.length !== manifest.expectedPublicTableCount) {
  errors.push({ type: "TABLE_COUNT_MISMATCH", source: sourceSchema.tables.length, target: targetSchema.tables.length });
}
const sourceMigrationRows = Number(query(config, config.sourceDb, `SELECT count(*) FROM public."_prisma_migrations"`));
const targetMigrationRows = Number(query(config, config.targetDb, `SELECT count(*) FROM public."_prisma_migrations"`));
const sourceMigrations = Number(query(config, config.sourceDb, `SELECT count(*) FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`));
const targetMigrations = Number(query(config, config.targetDb, `SELECT count(*) FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`));
const sourceRolledBackMigrations = Number(query(config, config.sourceDb, `SELECT count(*) FROM public."_prisma_migrations" WHERE rolled_back_at IS NOT NULL`));
const targetRolledBackMigrations = Number(query(config, config.targetDb, `SELECT count(*) FROM public."_prisma_migrations" WHERE rolled_back_at IS NOT NULL`));
const sourceFailedMigrations = Number(query(config, config.sourceDb, `SELECT count(*) FROM public."_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`));
if (targetMigrationRows !== manifest.expectedPrismaMigrationRows || sourceMigrationRows !== manifest.expectedPrismaMigrationRows + (manifest.observedFailedPrismaMigrationRowsInRailway ?? 0)) {
  errors.push({ type: "MIGRATION_JOURNAL_COUNT_MISMATCH", source: sourceMigrationRows, target: targetMigrationRows });
}
if (sourceMigrations !== manifest.expectedActivePrismaMigrationRows || targetMigrations !== manifest.expectedActivePrismaMigrationRows) {
  errors.push({ type: "ACTIVE_MIGRATION_COUNT_MISMATCH", source: sourceMigrations, target: targetMigrations });
}
if (sourceRolledBackMigrations !== manifest.expectedRolledBackPrismaMigrationRows || targetRolledBackMigrations !== manifest.expectedRolledBackPrismaMigrationRows) {
  errors.push({ type: "ROLLED_BACK_MIGRATION_COUNT_MISMATCH", source: sourceRolledBackMigrations, target: targetRolledBackMigrations });
}
if (sourceFailedMigrations !== (manifest.observedFailedPrismaMigrationRowsInRailway ?? 0)) {
  errors.push({ type: "FAILED_MIGRATION_JOURNAL_MISMATCH", source: sourceFailedMigrations, expected: manifest.observedFailedPrismaMigrationRowsInRailway ?? 0 });
}
if (manifest.records.length !== manifest.recordCount) errors.push({ type: "MANIFEST_RECORD_COUNT_MISMATCH" });

const summary = {
  plannedInserts: 0,
  mappings: 0,
  skips: 0,
  recreations: 0,
  recomputations: 0,
  manualReview: 0,
  rejected: 0,
  conflicts: 0,
};

for (const record of manifest.records) {
  if (!ALLOWED_ACTIONS.has(record.action)) {
    errors.push({ type: "UNKNOWN_ACTION", table: record.sourceTable, action: record.action });
    continue;
  }
  if (canonicalChecksum(record) !== record.checksum) {
    errors.push({ type: "MANIFEST_CHECKSUM_MISMATCH", table: record.sourceTable });
    continue;
  }
  const source = sourceRow(record);
  if (!source) {
    errors.push({ type: "SOURCE_RECORD_NOT_FOUND", table: record.sourceTable });
    continue;
  }
  const targetIndex = pkIndex(config.targetDb, record.targetTable);
  if (record.action === "MAP_TO_EXISTING" || record.action === "SKIP_DUPLICATE") {
    if (!record.targetPrimaryKey?.hash || !targetIndex.has(record.targetPrimaryKey.hash)) {
      errors.push({ type: "INCOMPLETE_MAPPING", table: record.sourceTable, action: record.action });
    }
  }
  if (record.action === "INSERT_MISSING") {
    summary.plannedInserts += 1;
    if (targetIndex.has(record.sourcePrimaryKey.hash)) {
      errors.push({ type: "PRIMARY_KEY_CONFLICT", table: record.sourceTable });
    }
    for (const parent of record.parentMappings || []) {
      if (!parent.required) continue;
      if (!parent.targetPrimaryKey?.hash) {
        errors.push({ type: "MISSING_PARENT_MAPPING", table: record.sourceTable, parentTable: parent.tableName });
        continue;
      }
      if (!pkIndex(config.targetDb, parent.tableName).has(parent.targetPrimaryKey.hash)
          && !plannedInsertKeys.has(`${parent.tableName}\u0000${parent.targetPrimaryKey.hash}`)) {
        errors.push({ type: "ORPHAN_PARENT", table: record.sourceTable, parentTable: parent.tableName });
      }
    }
    for (const index of loadUniqueIndexes(config, config.targetDb, record.targetTable).filter((item) => !item.primary && item.columns.length > 0)) {
      const values = index.columns.map((column) => source[column]);
      if (values.some((value) => value === null || value === undefined)) continue;
      const predicate = index.columns.map((column, position) => `${quoteIdent(column)} IS NOT DISTINCT FROM ${quoteLiteral(values[position])}`).join(" AND ");
      const count = Number(query(config, config.targetDb, `SELECT count(*) FROM public.${quoteIdent(record.targetTable)} WHERE ${predicate}`));
      if (count > 0) errors.push({ type: "UNIQUE_CONFLICT", table: record.targetTable, index: index.name });
    }
  } else if (record.action === "MAP_TO_EXISTING") summary.mappings += 1;
  else if (["RECREATE_JOB", "RECREATE_BUSINESS_EVENT"].includes(record.action)) summary.recreations += 1;
  else if (record.action === "RECOMPUTE") summary.recomputations += 1;
  else if (record.action === "MANUAL_REVIEW") summary.manualReview += 1;
  else if (record.action === "REJECT_INVALID") summary.rejected += 1;
  else summary.skips += 1;
}

summary.conflicts = errors.length;
const result = {
  dryRunVersion: 1,
  status: errors.length === 0 ? "PASS" : "FAIL",
  productionMutationAttempted: false,
  sourceDatabase: config.sourceDb,
  targetDatabase: config.targetDb,
  localUnixSocketOnly: true,
  manifestRecords: manifest.recordCount,
  schemaHash: manifest.schemaHash,
  publicTables: { source: sourceSchema.tables.length, target: targetSchema.tables.length },
  prismaMigrationRows: { sourceTotal: sourceMigrationRows, targetTotal: targetMigrationRows, sourceActive: sourceMigrations, targetActive: targetMigrations, sourceRolledBack: sourceRolledBackMigrations, targetRolledBack: targetRolledBackMigrations },
  failedPrismaMigrationRows: { source: sourceFailedMigrations },
  summary,
  errors,
  warnings,
};
if (options.output) writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exitCode = errors.length === 0 ? 0 : 1;
