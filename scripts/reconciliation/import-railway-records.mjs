#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildPkIndex,
  fetchRow,
  loadConfig,
  loadHasher,
  loadManifest,
  loadSchema,
  loadSupplement,
  quoteIdent,
  quoteLiteral,
} from "./reconciliation-runtime.mjs";

function parseArgs(argv) {
  const options = {
    manifest: resolve("docs/reconciliation/railway-to-selectel-migration-manifest.json"),
    audit: process.env.RECONCILIATION_AUDIT_FILE ? resolve(process.env.RECONCILIATION_AUDIT_FILE) : null,
    batch: null,
    executeLocal: false,
    ownerApproved: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") options.manifest = resolve(argv[++index]);
    else if (arg === "--audit") options.audit = resolve(argv[++index]);
    else if (arg === "--batch") options.batch = argv[++index];
    else if (arg === "--execute-local") options.executeLocal = true;
    else if (arg === "--owner-approved") options.ownerApproved = true;
    else if (arg === "--help") {
      console.log("Usage: import-railway-records.mjs --batch id --audit /private/path.jsonl --execute-local [--owner-approved]");
      console.log("The script refuses TCP/remote databases and only permits reconciliation_railway -> reconciliation_selectel.");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function loadCompletedAudit(path) {
  if (!path || !existsSync(path)) return new Set();
  const completed = new Set();
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    try {
      const row = JSON.parse(line);
      if (["COMPLETED", "ALREADY_PRESENT", "MAPPED", "SKIPPED"].includes(row.status)) completed.add(row.checksum);
    } catch {
      throw new Error(`Invalid JSONL in migration audit: ${path}`);
    }
  }
  return completed;
}

function auditRow(record, batchId, status, targetPrimaryKey, notes, error = null) {
  return {
    batchId,
    sourceProvider: "Railway legacy hopper snapshot",
    sourceTable: record.sourceTable,
    sourcePrimaryKey: record.sourcePrimaryKey,
    targetPrimaryKey,
    action: record.action,
    status,
    checksum: record.checksum,
    importedAt: new Date().toISOString(),
    error,
    notes,
  };
}

const options = parseArgs(process.argv.slice(2));
if (!options.executeLocal || process.env.RECONCILIATION_ALLOW_LOCAL_IMPORT !== "1") {
  throw new Error("Import is disabled. Use --execute-local and RECONCILIATION_ALLOW_LOCAL_IMPORT=1 for an isolated local rehearsal only.");
}
if (!options.batch) throw new Error("--batch is required; all-batches execution is intentionally refused.");
if (!options.audit) throw new Error("--audit or RECONCILIATION_AUDIT_FILE is required and must point outside Git.");

const config = loadConfig();
const hasher = loadHasher(config);
const manifest = loadManifest(options.manifest);
const sourceSchema = loadSchema(config, config.sourceDb);
const targetSchema = loadSchema(config, config.targetDb);
if (manifest.schemaHash !== sourceSchema.hash || manifest.schemaHash !== targetSchema.hash) {
  throw new Error("Schema hash mismatch; import refused.");
}
const supplement = loadSupplement(config, hasher);
const completedAudit = loadCompletedAudit(options.audit);
const pkCache = new Map();

function pkIndex(db, tableName) {
  const cacheKey = `${db}\u0000${tableName}`;
  if (!pkCache.has(cacheKey)) {
    const schema = db === config.sourceDb ? sourceSchema : targetSchema;
    const table = schema.byName.get(tableName);
    if (!table) throw new Error(`Missing table: ${tableName}`);
    pkCache.set(cacheKey, buildPkIndex(config, db, table, hasher));
  }
  return pkCache.get(cacheKey);
}

function sourceRow(record) {
  const table = sourceSchema.byName.get(record.sourceTable);
  const tuple = pkIndex(config.sourceDb, record.sourceTable).get(record.sourcePrimaryKey.hash);
  if (tuple) return fetchRow(config, config.sourceDb, table, tuple);
  return supplement.get(`${record.sourceTable}\u0000${record.sourcePrimaryKey.hash}`) || null;
}

const batchRecords = manifest.records.filter((record) => record.dependencyBatch === options.batch);
if (batchRecords.length === 0) throw new Error(`No manifest records in batch ${options.batch}.`);
if (!options.ownerApproved && batchRecords.some((record) => record.requiresOwnerApproval && record.action === "INSERT_MISSING")) {
  throw new Error("Batch contains owner-approval-gated inserts; pass --owner-approved only after explicit approval.");
}

const sqlStatements = ["BEGIN;", "SET LOCAL statement_timeout = '60s';", "SET LOCAL lock_timeout = '3s';"];
const pendingAudit = [];
let plannedInsertCount = 0;

for (const record of batchRecords) {
  if (completedAudit.has(record.checksum)) continue;
  if (record.action === "RECREATE_JOB") {
    pendingAudit.push(auditRow(record, options.batch, "REQUIRES_WORKFLOW", null, "Job row was not copied; recreate through an approved Selectel workflow."));
    continue;
  }
  if (record.action === "MANUAL_REVIEW") {
    pendingAudit.push(auditRow(record, options.batch, "MANUAL_REVIEW", null, "No mutation attempted."));
    continue;
  }
  if (record.action === "RECOMPUTE") {
    pendingAudit.push(auditRow(record, options.batch, "REQUIRES_RECOMPUTE", null, "Derived data was not copied."));
    continue;
  }
  if (record.action === "REJECT_INVALID") {
    pendingAudit.push(auditRow(record, options.batch, "REJECTED", null, "Invalid/orphan record was not copied."));
    continue;
  }
  if (record.action.startsWith("SKIP_")) {
    pendingAudit.push(auditRow(record, options.batch, "SKIPPED", record.targetPrimaryKey, record.reason));
    continue;
  }
  if (record.action === "MAP_TO_EXISTING") {
    if (!record.targetPrimaryKey?.hash || !pkIndex(config.targetDb, record.targetTable).has(record.targetPrimaryKey.hash)) {
      throw new Error(`Mapped target is missing for ${record.sourceTable}.`);
    }
    pendingAudit.push(auditRow(record, options.batch, "MAPPED", record.targetPrimaryKey, "No target row changed."));
    continue;
  }
  if (record.action !== "INSERT_MISSING") throw new Error(`Unsupported action: ${record.action}`);

  const row = sourceRow(record);
  if (!row) throw new Error(`Source row missing for ${record.sourceTable}.`);
  const targetTable = targetSchema.byName.get(record.targetTable);
  if (pkIndex(config.targetDb, record.targetTable).has(record.sourcePrimaryKey.hash)) {
    pendingAudit.push(auditRow(record, options.batch, "ALREADY_PRESENT", record.sourcePrimaryKey, "Idempotent rerun: target PK already exists."));
    continue;
  }
  const transformed = { ...row };
  for (const parent of record.parentMappings || []) {
    if (parent.resolution !== "MAP_TO_EXISTING") continue;
    if (!parent.targetPrimaryKey?.hash || !parent.sourceColumns?.length) throw new Error(`Incomplete parent mapping for ${record.sourceTable}.`);
    const tuple = pkIndex(config.targetDb, parent.tableName).get(parent.targetPrimaryKey.hash);
    if (!tuple) throw new Error(`Mapped parent target missing for ${record.sourceTable}.`);
    parent.sourceColumns.forEach((column, index) => { transformed[column] = tuple[index]; });
  }
  const columns = targetTable.columns.map((column) => column.name).filter((column) => Object.hasOwn(transformed, column));
  const values = columns.map((column) => quoteLiteral(transformed[column]));
  sqlStatements.push(`INSERT INTO public.${quoteIdent(record.targetTable)} (${columns.map(quoteIdent).join(",")}) VALUES (${values.join(",")}) ON CONFLICT DO NOTHING;`);
  plannedInsertCount += 1;
  pendingAudit.push(auditRow(record, options.batch, "COMPLETED", record.sourcePrimaryKey, "Inserted in one local transaction; application processes were not connected."));
}
sqlStatements.push("COMMIT;");

if (plannedInsertCount > 0) {
  const result = spawnSync(
    config.psql,
    ["-X", "-v", "ON_ERROR_STOP=1", "-h", config.socket, "-p", config.port, "-d", config.targetDb, "-q"],
    { input: `${sqlStatements.join("\n")}\n`, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    for (const row of pendingAudit.filter((item) => item.status === "COMPLETED")) {
      row.status = "ERROR";
      row.error = "Transaction rolled back; inspect local stderr without copying sensitive values into reports.";
    }
    for (const row of pendingAudit) appendFileSync(options.audit, `${JSON.stringify(row)}\n`, { mode: 0o600 });
    throw new Error(`Local import transaction failed: ${result.stderr.trim()}`);
  }
}

for (const row of pendingAudit) appendFileSync(options.audit, `${JSON.stringify(row)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  status: "LOCAL_REHEARSAL_BATCH_COMPLETE",
  batchId: options.batch,
  manifestRecords: batchRecords.length,
  plannedInserts: plannedInsertCount,
  auditEntries: pendingAudit.length,
  productionMutationAttempted: false,
  externalSideEffectsEnabled: false,
}, null, 2));
