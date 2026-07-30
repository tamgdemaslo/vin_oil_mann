#!/usr/bin/env node

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
    resolutionManifest: resolve("docs/reconciliation/same-pk-resolution-manifest.json"),
    approvals: resolve("docs/reconciliation/approved-manual-decisions.json"),
    allowlists: resolve("docs/reconciliation/field-allowlists.json"),
    denylist: resolve("docs/reconciliation/selectel-only-denylist.json"),
    audit: process.env.RECONCILIATION_AUDIT_FILE ? resolve(process.env.RECONCILIATION_AUDIT_FILE) : null,
    batch: null,
    executeLocal: false,
    applyResolutions: false,
    resolutionOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") options.manifest = resolve(argv[++index]);
    else if (arg === "--resolution-manifest") options.resolutionManifest = resolve(argv[++index]);
    else if (arg === "--approvals") options.approvals = resolve(argv[++index]);
    else if (arg === "--allowlists") options.allowlists = resolve(argv[++index]);
    else if (arg === "--denylist") options.denylist = resolve(argv[++index]);
    else if (arg === "--audit") options.audit = resolve(argv[++index]);
    else if (arg === "--batch") options.batch = argv[++index];
    else if (arg === "--execute-local") options.executeLocal = true;
    else if (arg === "--apply-resolutions") options.applyResolutions = true;
    else if (arg === "--resolution-only") { options.applyResolutions = true; options.resolutionOnly = true; }
    else if (arg === "--help") {
      console.log("Usage: import-railway-records.mjs (--batch id | --resolution-only) --audit /private/path.jsonl --execute-local [--apply-resolutions]");
      console.log("The script refuses TCP/remote databases and only permits isolated local reconciliation databases.");
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

function resolutionAuditRow(resolution, status, notes, changedFields = [], error = null) {
  const checksum = createHash("sha256").update(JSON.stringify({
    tableName: resolution.tableName,
    primaryKey: resolution.primaryKey,
    resolutionAction: resolution.resolutionAction,
    fieldLevelActions: resolution.fieldLevelActions,
  })).digest("hex");
  return {
    batchId: "same-pk-resolutions",
    sourceProvider: "Railway legacy hopper snapshot",
    sourceTable: resolution.tableName,
    sourcePrimaryKey: resolution.primaryKey,
    targetPrimaryKey: resolution.primaryKey,
    action: resolution.resolutionAction,
    status,
    checksum,
    changedFields,
    importedAt: new Date().toISOString(),
    error,
    notes,
  };
}

const options = parseArgs(process.argv.slice(2));
if (!options.executeLocal || process.env.RECONCILIATION_ALLOW_LOCAL_IMPORT !== "1") {
  throw new Error("Import is disabled. Use --execute-local and RECONCILIATION_ALLOW_LOCAL_IMPORT=1 for an isolated local rehearsal only.");
}
if (!options.batch && !options.resolutionOnly) throw new Error("--batch or --resolution-only is required; all-batches execution is intentionally refused.");
if (!options.audit) throw new Error("--audit or RECONCILIATION_AUDIT_FILE is required and must point outside Git.");

const config = loadConfig();
const hasher = loadHasher(config);
const manifest = loadManifest(options.manifest);
const resolutionManifest = loadManifest(options.resolutionManifest);
const approvalsManifest = loadManifest(options.approvals);
const allowlistManifest = loadManifest(options.allowlists);
const denylistManifest = loadManifest(options.denylist);
const sourceSchema = loadSchema(config, config.sourceDb);
const targetSchema = loadSchema(config, config.targetDb);
if (manifest.schemaHash !== sourceSchema.hash || manifest.schemaHash !== targetSchema.hash) {
  throw new Error("Schema hash mismatch; import refused.");
}
if (manifest.hashKeyId !== hasher.keyId || resolutionManifest.hashKeyId !== hasher.keyId || denylistManifest.hashKeyId !== hasher.keyId) {
  throw new Error("Hash key mismatch across reconciliation manifests; import refused.");
}
if ((resolutionManifest.prohibitedActions || []).includes("REPLACE_ROW_FROM_RAILWAY") === false) {
  throw new Error("Resolution manifest does not explicitly prohibit full Railway row replacement.");
}
const supplement = loadSupplement(config, hasher);
const completedAudit = loadCompletedAudit(options.audit);
const pkCache = new Map();
const approvals = new Map((approvalsManifest.decisions || []).map((decision) => [
  `${decision.scope}\u0000${decision.tableName}\u0000${decision.primaryKey.hash}`,
  decision,
]));
const protectedPks = new Set((denylistManifest.tables || []).flatMap((table) =>
  (table.primaryKeyHashes || []).map((hash) => `${table.tableName}\u0000${hash}`)));

function hasApproval(scope, tableName, primaryKeyHash, action) {
  const decision = approvals.get(`${scope}\u0000${tableName}\u0000${primaryKeyHash}`);
  return decision?.status === "APPROVED" && decision.proposedAction === action && decision.approvedBy && decision.approvedAt;
}

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

function rowForResolution(db, resolution) {
  const schema = db === config.sourceDb ? sourceSchema : targetSchema;
  const table = schema.byName.get(resolution.tableName);
  const tuple = pkIndex(db, resolution.tableName).get(resolution.primaryKey.hash);
  return tuple ? fetchRow(config, db, table, tuple) : null;
}

function pkPredicate(table, tuple) {
  return table.primaryKey.map((column, index) => `${quoteIdent(column)} IS NOT DISTINCT FROM ${quoteLiteral(tuple[index])}`).join(" AND ");
}

const batchRecords = options.resolutionOnly ? [] : manifest.records.filter((record) => record.dependencyBatch === options.batch);
if (!options.resolutionOnly && batchRecords.length === 0) throw new Error(`No manifest records in batch ${options.batch}.`);

const sqlStatements = ["BEGIN;", "SET LOCAL statement_timeout = '60s';", "SET LOCAL lock_timeout = '3s';"];
const pendingAudit = [];
let plannedInsertCount = 0;
let plannedFieldUpdateCount = 0;
let plannedRecomputeCount = 0;

for (const record of batchRecords) {
  if (completedAudit.has(record.checksum)) continue;
  if (record.requiresOwnerApproval && !hasApproval("RAILWAY_ONLY", record.sourceTable, record.sourcePrimaryKey.hash, record.action)) {
    pendingAudit.push(auditRow(record, options.batch, "OWNER_APPROVAL_REQUIRED", null, "No matching APPROVED decision; no mutation attempted."));
    continue;
  }
  if (["RECREATE_JOB", "RECREATE_BUSINESS_EVENT"].includes(record.action)) {
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

if (options.applyResolutions) {
  for (const resolution of resolutionManifest.resolutions || []) {
    const checksum = createHash("sha256").update(JSON.stringify({
      tableName: resolution.tableName,
      primaryKey: resolution.primaryKey,
      resolutionAction: resolution.resolutionAction,
      fieldLevelActions: resolution.fieldLevelActions,
    })).digest("hex");
    if (completedAudit.has(checksum)) continue;
    if (resolution.requiresOwnerApproval && !hasApproval("SAME_PK", resolution.tableName, resolution.primaryKey.hash, resolution.resolutionAction)) {
      pendingAudit.push(resolutionAuditRow(resolution, "OWNER_APPROVAL_REQUIRED", "No matching APPROVED decision; Selectel row left unchanged."));
      continue;
    }
    if (["KEEP_SELECTEL", "SKIP_EPHEMERAL", "REJECT_RAILWAY"].includes(resolution.resolutionAction)) {
      pendingAudit.push(resolutionAuditRow(resolution, "SKIPPED", resolution.reason));
      continue;
    }
    if (resolution.resolutionAction === "MANUAL_REVIEW") {
      pendingAudit.push(resolutionAuditRow(resolution, "MANUAL_REVIEW", "No field mutation attempted."));
      continue;
    }

    const source = rowForResolution(config.sourceDb, resolution);
    const target = rowForResolution(config.targetDb, resolution);
    if (!source || !target) throw new Error(`Resolution row missing for ${resolution.tableName}.`);
    const table = targetSchema.byName.get(resolution.tableName);
    const tuple = pkIndex(config.targetDb, resolution.tableName).get(resolution.primaryKey.hash);
    const predicate = pkPredicate(table, tuple);
    const tableAllowlist = allowlistManifest.fieldAllowlists?.[resolution.tableName] ?? { allowedByManifest: [], forbiddenWithoutApproval: [] };

    if (resolution.resolutionAction === "APPLY_RAILWAY_FIELD" || resolution.resolutionAction === "MERGE_NON_CRITICAL_FIELDS") {
      const actions = resolution.fieldLevelActions.filter((item) => ["APPLY_RAILWAY_FIELD", "MERGE_NON_CRITICAL_FIELDS"].includes(item.action));
      if (!actions.length) throw new Error(`No field-level apply actions for ${resolution.tableName}.`);
      const assignments = [];
      for (const action of actions) {
        if (!tableAllowlist.allowedByManifest.includes(action.field)) {
          throw new Error(`Field allowlist refused ${resolution.tableName}.${action.field}.`);
        }
        if (action.requiresOwnerApproval && !hasApproval("SAME_PK", resolution.tableName, resolution.primaryKey.hash, resolution.resolutionAction)) {
          throw new Error(`Critical field approval missing for ${resolution.tableName}.${action.field}.`);
        }
        assignments.push(`${quoteIdent(action.field)} = ${quoteLiteral(source[action.field])}`);
      }
      if (protectedPks.has(`${resolution.tableName}\u0000${resolution.primaryKey.hash}`) && actions.length !== assignments.length) {
        throw new Error(`Protected Selectel-only row update refused for ${resolution.tableName}.`);
      }
      sqlStatements.push(`UPDATE public.${quoteIdent(resolution.tableName)} SET ${assignments.join(", ")} WHERE ${predicate};`);
      plannedFieldUpdateCount += assignments.length;
      pendingAudit.push(resolutionAuditRow(resolution, "COMPLETED", "Only manifest-listed Railway fields applied.", actions.map((item) => item.field)));
      continue;
    }

    if (resolution.resolutionAction === "RECOMPUTE") {
      const fields = resolution.fieldLevelActions.filter((item) => item.action === "RECOMPUTE").map((item) => item.field);
      const assignments = [];
      if (resolution.tableName === "messenger_conversations") {
        if (fields.includes("last_message_text")) assignments.push(`last_message_text = (SELECT msg.text FROM public.messenger_messages msg WHERE msg.conversation_id = messenger_conversations.id ORDER BY COALESCE(msg.sent_at, msg.received_at, msg.created_at) DESC NULLS LAST, msg.id DESC LIMIT 1)`);
        if (fields.includes("last_message_at")) assignments.push(`last_message_at = (SELECT COALESCE(msg.sent_at, msg.received_at, msg.created_at) FROM public.messenger_messages msg WHERE msg.conversation_id = messenger_conversations.id ORDER BY COALESCE(msg.sent_at, msg.received_at, msg.created_at) DESC NULLS LAST, msg.id DESC LIMIT 1)`);
        if (fields.includes("unread_count")) assignments.push(`unread_count = (SELECT count(*)::integer FROM public.messenger_messages msg WHERE msg.conversation_id = messenger_conversations.id AND msg.direction = 'inbound' AND msg.read_at IS NULL)`);
      } else if (resolution.tableName === "messenger_messages" && fields.includes("attachments_json")) {
        assignments.push(`attachments_json = COALESCE((SELECT jsonb_agg(jsonb_build_object('id', att.id, 'type', att.type, 'url', att.url, 'name', att.name, 'size', att.size, 'mimeType', att.mime_type, 'previewUrl', att.preview_url, 'originalStorageKey', att.original_storage_key, 'thumbnailStorageKey', att.thumbnail_storage_key, 'status', att.status, 'progress', att.progress, 'errorCode', att.error_code, 'errorMessage', att.error_message, 'caption', att.caption, 'width', att.width, 'height', att.height, 'duration', att.duration) ORDER BY att.created_at, att.id) FROM public.messenger_attachments att WHERE att.message_id = messenger_messages.id), '[]'::jsonb)`);
      }
      if (!assignments.length) {
        pendingAudit.push(resolutionAuditRow(resolution, "RECOMPUTE_DEFERRED", "No safe local deterministic formula is available; Selectel value retained."));
        continue;
      }
      for (const field of fields) {
        if (!tableAllowlist.allowedByManifest.includes(field)) throw new Error(`Recompute allowlist refused ${resolution.tableName}.${field}.`);
      }
      sqlStatements.push(`UPDATE public.${quoteIdent(resolution.tableName)} SET ${assignments.join(", ")} WHERE ${predicate};`);
      plannedRecomputeCount += 1;
      pendingAudit.push(resolutionAuditRow(resolution, "COMPLETED", "Derived fields recomputed from local merged child records.", fields));
      continue;
    }

    if (resolution.resolutionAction === "RECREATE_BUSINESS_EVENT") {
      pendingAudit.push(resolutionAuditRow(resolution, "REQUIRES_WORKFLOW", "Business event was not recreated by the SQL reconciliation script."));
      continue;
    }
    throw new Error(`Unsupported resolution action: ${resolution.resolutionAction}`);
  }
}
sqlStatements.push("COMMIT;");

if (plannedInsertCount + plannedFieldUpdateCount + plannedRecomputeCount > 0) {
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
  plannedFieldUpdates: plannedFieldUpdateCount,
  plannedRecomputations: plannedRecomputeCount,
  auditEntries: pendingAudit.length,
  productionMutationAttempted: false,
  externalSideEffectsEnabled: false,
}, null, 2));
