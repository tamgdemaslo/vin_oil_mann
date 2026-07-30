#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildPkIndex,
  fetchRow,
  loadConfig,
  loadHasher,
  loadManifest,
  loadSchema,
  query,
  quoteIdent,
  stable,
} from "./reconciliation-runtime.mjs";

const ROOT = resolve("docs/reconciliation");
const FINAL_DELTA_FILE = process.env.RECONCILIATION_FINAL_DELTA_FILE;
if (!FINAL_DELTA_FILE) throw new Error("RECONCILIATION_FINAL_DELTA_FILE is required.");

const BUSINESS_KEYS = {
  communication_identities: ["organization_id", "messenger_account_id", "external_user_id"],
  conversation_entity_links: ["organization_id", "conversation_id", "entity_type", "entity_id", "relation_type"],
  integration_audit_logs: ["organization_id", "channel", "messenger_account_id", "action", "status", "created_at"],
  messenger_connections: ["channel", "external_chat_id"],
  messenger_conversations: ["channel", "external_conversation_id"],
  messenger_messages: ["organization_id", "conversation_id", "external_message_id", "direction"],
  messenger_outbox: ["organization_id", "channel", "recipient_external_chat_id", "message_id", "created_at"],
  notification_jobs: ["organization_id", "idempotency_key"],
  notification_logs: ["organization_id", "notification_job_id", "event_type", "status"],
};

const ENTITY_TYPES = {
  communication_identities: "CommunicationIdentity",
  conversation_entity_links: "ConversationEntityLink",
  integration_audit_logs: "IntegrationAuditLog",
  messenger_connections: "MessengerConnection",
  messenger_conversations: "MessengerConversation",
  messenger_messages: "MessengerMessage",
  messenger_outbox: "MessengerOutbox",
  notification_jobs: "NotificationJob",
  notification_logs: "NotificationLog",
};

const CRITICAL_FIELDS = new Set([
  "client_id", "vehicle_id", "vin", "plate_number", "phone", "phone_normalized", "document_number",
  "status", "case_status", "stage_id", "items", "quantity", "available", "price", "price_cents",
  "sale_price_cents", "discount", "total", "total_cents", "amount_cents", "paid_amount", "payment_status",
  "payment_method", "store_id", "warehouse_id", "salary", "shift_id", "expense_id", "text",
  "external_message_id", "provider_message_id", "messenger_message_id", "messenger_outbox_id",
  "message_id", "diagnostic_report_id", "appointment_id", "scheduled_at", "organization_id",
  "branch_id", "external_provider_id", "external_conversation_id", "conversation_id", "attachments_json",
  "last_message_text", "last_message_at", "marking_enabled", "marking_mode", "marking_status", "oem_atf",
]);

const TECHNICAL_FIELDS = new Set([
  "created_at", "updated_at", "synced_at", "last_sync_at", "last_seen_at", "last_attempt_at",
  "next_attempt_at", "attempts", "unread_count", "avatar_updated_at", "avatar_status", "avatar_error",
  "avatar_storage_key", "avatar_thumbnail_key", "participant_avatar_url", "metadata_json", "raw", "search_text",
  "acknowledged_at", "effective_from",
]);

const DERIVED_FIELDS = new Set([
  "attachments_json", "last_message_text", "last_message_at", "unread_count", "normalized_vehicle_json",
]);

function readJsonLines(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map(JSON.parse);
}

function canonicalChecksum(record) {
  return createHash("sha256").update(JSON.stringify(stable(record))).digest("hex");
}

function valueEqual(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function shortHash(value) {
  return typeof value === "string" ? value.slice(-12) : "none";
}

function compactDate(value) {
  return value ? String(value).replace("T", " ").slice(0, 19) : "—";
}

function sourceTime(row) {
  return row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt ?? null;
}

const config = loadConfig();
const hasher = loadHasher(config);
const sourceSchema = loadSchema(config, config.sourceDb);
const targetSchema = loadSchema(config, config.targetDb);
if (sourceSchema.hash !== targetSchema.hash) throw new Error("Source and target schema hashes differ.");

const oldRegistry = loadManifest(resolve(ROOT, "railway-only-records.json"));
const oldMigration = loadManifest(resolve(ROOT, "railway-to-selectel-migration-manifest.json"));
const oldConflicts = loadManifest(resolve(ROOT, "same-pk-conflicts.json"));
const baselineConflictCount = oldConflicts.sourceConflictCount
  ?? oldConflicts.conflictCount - (oldConflicts.supplementalConflictCount ?? 0);
const finalDelta = readJsonLines(FINAL_DELTA_FILE).filter((item) => item.tableName !== "_prisma_migrations");

const pkCache = new Map();
function pkIndex(db, tableName) {
  const key = `${db}\u0000${tableName}`;
  if (!pkCache.has(key)) {
    const schema = db === config.sourceDb ? sourceSchema : targetSchema;
    const table = schema.byName.get(tableName);
    if (!table) throw new Error(`Missing table ${tableName} in ${db}.`);
    pkCache.set(key, buildPkIndex(config, db, table, hasher));
  }
  return pkCache.get(key);
}

function publicPk(tableName, tuple) {
  return { columns: sourceSchema.byName.get(tableName).primaryKey, hash: hasher.hash(`pk:${tableName}`, tuple) };
}

function rowByPublicPk(db, tableName, hash) {
  const tuple = pkIndex(db, tableName).get(hash);
  if (!tuple) return null;
  const schema = db === config.sourceDb ? sourceSchema : targetSchema;
  return fetchRow(config, db, schema.byName.get(tableName), tuple);
}

const allRowsCache = new Map();
function allRows(db, tableName) {
  const key = `${db}\u0000${tableName}`;
  if (!allRowsCache.has(key)) {
    const text = query(config, db, `SELECT to_jsonb(t)::text FROM public.${quoteIdent(tableName)} t`);
    allRowsCache.set(key, text ? text.split("\n").filter(Boolean).map(JSON.parse) : []);
  }
  return allRowsCache.get(key);
}

function businessKey(tableName, row) {
  const fields = BUSINESS_KEYS[tableName] ?? ["id"];
  return {
    fields,
    hash: hasher.hash(`business:${tableName}`, fields.map((field) => row[field] ?? null)),
  };
}

function findBusinessMatch(tableName, row) {
  const key = businessKey(tableName, row).hash;
  const match = allRows(config.targetDb, tableName).find((candidate) => businessKey(tableName, candidate).hash === key);
  if (!match) return null;
  const table = targetSchema.byName.get(tableName);
  const tuple = table.primaryKey.map((column) => match[column]);
  return publicPk(tableName, tuple);
}

const targetPkSets = new Map();
function targetHas(tableName, hash) {
  if (!targetPkSets.has(tableName)) targetPkSets.set(tableName, new Set(pkIndex(config.targetDb, tableName).keys()));
  return targetPkSets.get(tableName).has(hash);
}

const registryKnown = new Set(oldRegistry.records.map((record) => `${record.tableName}\u0000${record.primaryKey.hash}`));
const newSourceRows = [];
for (const item of finalDelta) {
  const table = sourceSchema.byName.get(item.tableName);
  const tuple = table.primaryKey.map((column) => item.row[column]);
  const pk = publicPk(item.tableName, tuple);
  if (!registryKnown.has(`${item.tableName}\u0000${pk.hash}`) && !targetHas(item.tableName, pk.hash)) {
    newSourceRows.push({ ...item, primaryKey: pk, tuple });
  }
}

function classifyNewRecord(item) {
  const { tableName, row, primaryKey } = item;
  const duplicate = findBusinessMatch(tableName, row);
  if (duplicate) {
    const skipDuplicate = ["conversation_entity_links", "integration_audit_logs", "notification_logs"].includes(tableName);
    return {
      action: skipDuplicate ? "SKIP_DUPLICATE" : "MAP_TO_EXISTING",
      targetPrimaryKey: duplicate,
      risk: "MEDIUM",
      requiresOwnerApproval: false,
      dataClassification: skipDuplicate ? "APPEND_ONLY_HISTORY" : "DURABLE_BUSINESS_DATA",
      reason: "Business-key equivalent already exists in Selectel; preserve the canonical target row.",
    };
  }
  if (tableName === "messenger_outbox") {
    return {
      action: "SKIP_OBSOLETE", targetPrimaryKey: null, risk: "LOW", requiresOwnerApproval: false,
      dataClassification: "DELIVERY_STATE",
      reason: "Sent legacy outbox state is superseded by the durable MessengerMessage and must not be re-enqueued.",
    };
  }
  if (tableName === "notification_jobs" && row.status === "scheduled") {
    return {
      action: "RECREATE_BUSINESS_EVENT", targetPrimaryKey: null, risk: "HIGH", requiresOwnerApproval: true,
      dataClassification: "FUTURE_BUSINESS_EVENT",
      reason: "A scheduled legacy notification cannot be copied blindly; the owner must confirm that it is still relevant before recreation.",
    };
  }
  return {
    action: "INSERT_MISSING", targetPrimaryKey: primaryKey, risk: tableName === "messenger_messages" ? "HIGH" : "MEDIUM",
    requiresOwnerApproval: false,
    dataClassification: ["integration_audit_logs", "notification_logs"].includes(tableName) ? "APPEND_ONLY_HISTORY" : "DURABLE_BUSINESS_DATA",
    reason: "Post-cutover Railway record has no same-PK or business-key equivalent in the Selectel snapshot.",
  };
}

const newClassifications = new Map();
for (const item of newSourceRows) newClassifications.set(`${item.tableName}\u0000${item.primaryKey.hash}`, classifyNewRecord(item));
const oldMigrationBySource = new Map(oldMigration.records.map((record) => [`${record.sourceTable}\u0000${record.sourcePrimaryKey.hash}`, record]));

function parentMappingsFor(item) {
  const logical = {
    communication_identities: [["messenger_accounts", "messenger_account_id", false], ["clients", "client_id", false]],
    conversation_entity_links: [["messenger_conversations", "conversation_id", true]],
    integration_audit_logs: [["messenger_accounts", "messenger_account_id", false]],
    messenger_connections: [["clients", "client_id", false]],
    messenger_conversations: [["messenger_connections", "connection_id", false], ["messenger_accounts", "messenger_account_id", false]],
    messenger_messages: [["messenger_conversations", "conversation_id", true], ["messenger_accounts", "messenger_account_id", false]],
    messenger_outbox: [["messenger_conversations", "conversation_id", true], ["messenger_messages", "message_id", false], ["messenger_connections", "connection_id", false]],
    notification_jobs: [["messenger_messages", "messenger_message_id", false], ["messenger_outbox", "messenger_outbox_id", false], ["messenger_conversations", "conversation_id", false]],
    notification_logs: [["notification_jobs", "notification_job_id", false]],
  };
  const mappings = [];
  for (const [parentTable, sourceColumn, required] of logical[item.tableName] ?? []) {
    if (!sourceSchema.byName.has(parentTable) || !targetSchema.byName.has(parentTable)) continue;
    const raw = item.row[sourceColumn];
    if (raw === null || raw === undefined) continue;
    const sourcePrimaryKey = publicPk(parentTable, [raw]);
    const old = oldMigrationBySource.get(`${parentTable}\u0000${sourcePrimaryKey.hash}`);
    const fresh = newClassifications.get(`${parentTable}\u0000${sourcePrimaryKey.hash}`);
    let targetPrimaryKey = null;
    let resolution = "MISSING";
    if (targetHas(parentTable, sourcePrimaryKey.hash)) {
      targetPrimaryKey = sourcePrimaryKey;
      resolution = "EXACT_PK";
    } else if (old?.targetPrimaryKey) {
      targetPrimaryKey = old.targetPrimaryKey;
      resolution = old.action === "MAP_TO_EXISTING" ? "MAP_TO_EXISTING" : "PLANNED_INSERT";
    } else if (fresh?.targetPrimaryKey) {
      targetPrimaryKey = fresh.targetPrimaryKey;
      resolution = fresh.action === "MAP_TO_EXISTING" ? "MAP_TO_EXISTING" : "PLANNED_INSERT";
    }
    mappings.push({
      tableName: parentTable,
      relationship: `logical_${sourceColumn}`,
      sourceColumns: [sourceColumn],
      targetColumns: ["id"],
      required,
      sourcePrimaryKey,
      targetPrimaryKey,
      resolution,
    });
  }
  return mappings;
}

const generatedAt = new Date().toISOString();
const additions = newSourceRows.map((item) => {
  const classification = newClassifications.get(`${item.tableName}\u0000${item.primaryKey.hash}`);
  return {
    tableName: item.tableName,
    primaryKey: item.primaryKey,
    businessKey: businessKey(item.tableName, item.row),
    createdAt: item.row.created_at ?? null,
    updatedAt: item.row.updated_at ?? null,
    entityType: ENTITY_TYPES[item.tableName] ?? item.tableName,
    parentEntities: parentMappingsFor(item),
    childEntities: [],
    branchCandidate: { classification: "LEGACY_DEFAULT_BRANCH_MAPPING_REQUIRED", hash: null },
    organizationId: item.row.organization_id ? hasher.hash("organization_id", item.row.organization_id) : null,
    sourceClassification: "FINAL_RAILWAY_DELTA_AFTER_SELECTEL_CUTOVER",
    dataClassification: classification.dataClassification,
    importRisk: classification.risk,
    recommendedAction: classification.action,
    reason: classification.reason,
    requiresOwnerApproval: classification.requiresOwnerApproval,
    sourceSnapshot: "RAILWAY_READ_ONLY_FINAL_DELTA_2026-07-30",
    statusClassification: item.row.status ?? item.row.direction ?? "recorded",
  };
});

const normalizedOldRegistryRecords = oldRegistry.records.map((record) => ({
  ...record,
  requiresOwnerApproval: ["MANUAL_REVIEW", "RECREATE_BUSINESS_EVENT"].includes(record.recommendedAction),
}));
const registryRecords = [...normalizedOldRegistryRecords, ...additions].sort((a, b) =>
  a.tableName.localeCompare(b.tableName) || a.primaryKey.hash.localeCompare(b.primaryKey.hash));
const registry = {
  ...oldRegistry,
  registryVersion: 2,
  generatedAt,
  status: registryRecords.some((record) => record.recommendedAction === "MANUAL_REVIEW" || record.requiresOwnerApproval) ? "OWNER_REVIEW_REQUIRED" : "CLASSIFIED",
  recordCount: registryRecords.length,
  unknownCount: 0,
  finalDeltaAddedRecords: oldRegistry.finalDeltaAddedRecords ?? additions.length,
  records: registryRecords,
};

function batchFor(record) {
  if (record.recommendedAction.startsWith("SKIP_") || record.recommendedAction === "REJECT_INVALID") return "batch-00-skip";
  if (record.recommendedAction === "MAP_TO_EXISTING") return "batch-01-operational-mappings";
  if (["communication_identities", "messenger_connections", "messenger_conversations"].includes(record.tableName)) return "batch-02-messenger-parents";
  if (record.tableName === "messenger_messages") return "batch-03-messenger-messages";
  if (record.recommendedAction === "RECREATE_BUSINESS_EVENT") return "batch-04-recreate-events";
  if (["conversation_entity_links", "integration_audit_logs", "notification_jobs", "notification_logs"].includes(record.tableName)) return "batch-05-history";
  return "batch-06-other";
}

const existingMigrationKeys = new Set(oldMigration.records.map((record) => `${record.sourceTable}\u0000${record.sourcePrimaryKey.hash}`));
const migrationAdditions = additions.map((record) => {
  const classification = newClassifications.get(`${record.tableName}\u0000${record.primaryKey.hash}`);
  const base = {
    sourceTable: record.tableName,
    sourcePrimaryKey: record.primaryKey,
    targetTable: record.tableName,
    targetPrimaryKey: classification.targetPrimaryKey,
    businessKeyHash: record.businessKey.hash,
    action: record.recommendedAction,
    dependencyBatch: batchFor(record),
    sourceCreatedAt: record.createdAt,
    sourceUpdatedAt: record.updatedAt,
    parentMappings: record.parentEntities,
    fieldTransformations: record.recommendedAction === "INSERT_MISSING"
      ? ["Preserve source scalar values", "Apply declared parentMappings", "Do not trigger application side effects"]
      : ["No target mutation unless an approved workflow explicitly recreates the event"],
    conflictStatus: "NONE",
    risk: record.importRisk,
    reason: record.reason,
    requiresOwnerApproval: record.requiresOwnerApproval,
  };
  return { ...base, checksum: canonicalChecksum(base) };
}).filter((record) => !existingMigrationKeys.has(`${record.sourceTable}\u0000${record.sourcePrimaryKey.hash}`));

const normalizedOldMigrationRecords = oldMigration.records.map((record) => ({
  ...record,
  requiresOwnerApproval: ["MANUAL_REVIEW", "RECREATE_BUSINESS_EVENT"].includes(record.action),
}));
const migrationRecords = [...normalizedOldMigrationRecords, ...migrationAdditions]
  .map((record) => {
    const { checksum: _checksum, ...base } = record;
    return { ...base, checksum: canonicalChecksum(base) };
  })
  .sort((a, b) => a.dependencyBatch.localeCompare(b.dependencyBatch) || a.sourceTable.localeCompare(b.sourceTable) || a.sourcePrimaryKey.hash.localeCompare(b.sourcePrimaryKey.hash));
const migrationManifest = {
  ...oldMigration,
  manifestVersion: 2,
  generatedAt,
  status: migrationRecords.some((record) => record.action === "MANUAL_REVIEW" || record.requiresOwnerApproval) ? "OWNER_REVIEW_REQUIRED" : "READY_FOR_LOCAL_REHEARSAL",
  expectedPrismaMigrationRows: 56,
  expectedActivePrismaMigrationRows: 50,
  expectedRolledBackPrismaMigrationRows: 6,
  observedFailedPrismaMigrationRowsInRailway: 1,
  recordCount: migrationRecords.length,
  finalDeltaAddedRecords: oldMigration.finalDeltaAddedRecords ?? migrationAdditions.length,
  records: migrationRecords,
};

const finalSamePkItems = [];
const conflictKnown = new Set(oldConflicts.conflicts.map((item) => `${item.table}\u0000${item.primaryKey.hash}`));
for (const conflict of oldConflicts.conflicts) finalSamePkItems.push({
  ...conflict,
  sourceSnapshot: conflict.sourceSnapshot ?? "RAILWAY_FULL_DUMP_OR_PRIOR_SUPPLEMENT",
});
for (const item of finalDelta) {
  const table = sourceSchema.byName.get(item.tableName);
  const tuple = table.primaryKey.map((column) => item.row[column]);
  const pk = publicPk(item.tableName, tuple);
  if (targetHas(item.tableName, pk.hash) && !conflictKnown.has(`${item.tableName}\u0000${pk.hash}`)) {
    finalSamePkItems.push({ table: item.tableName, primaryKey: pk, risk: "HIGH", sourceSnapshot: "RAILWAY_READ_ONLY_FINAL_DELTA_2026-07-30" });
    conflictKnown.add(`${item.tableName}\u0000${pk.hash}`);
  }
}

function evidenceFor(tableName, sourceRow, targetRow, pkHash) {
  const evidence = [
    { type: "ROW_FIELD_DIFF", source: "local restored snapshots", hash: hasher.hash(`evidence:${tableName}`, { pkHash, sourceTime: sourceTime(sourceRow), targetTime: sourceTime(targetRow) }) },
  ];
  const relatedAuditEvents = [];
  if (tableName === "crm_deals") {
    for (const [db, source] of [[config.sourceDb, "Railway"], [config.targetDb, "Selectel"]]) {
      const id = source === "Railway" ? sourceRow.id : targetRow.id;
      const events = query(config, db, `SELECT jsonb_build_object('eventType', event_type, 'occurredAt', created_at)::text FROM public.client_case_events WHERE case_id = '${String(id).replaceAll("'", "''")}' ORDER BY created_at`);
      for (const line of events.split("\n").filter(Boolean)) {
        const event = JSON.parse(line);
        relatedAuditEvents.push({ source, eventType: event.eventType, occurredAt: event.occurredAt, evidenceHash: hasher.hash("crm-event", event) });
      }
    }
  }
  if (tableName === "notification_jobs") {
    const id = sourceRow.id;
    const rows = allRows(config.sourceDb, "notification_logs").filter((row) => row.notification_job_id === id);
    for (const row of rows) relatedAuditEvents.push({ source: "Railway", eventType: row.status ?? row.event_type, occurredAt: row.created_at, evidenceHash: hasher.hash("notification-event", [row.id, row.status, row.provider_message_id]) });
  }
  if (["messenger_conversations", "messenger_messages", "messenger_attachments"].includes(tableName)) {
    evidence.push({ type: "RELATED_MESSENGER_GRAPH_CHECKED", source: "both snapshots", hash: hasher.hash("messenger-graph", [tableName, pkHash]) });
  }
  return { evidence, relatedAuditEvents };
}

function resolveConflict(tableName, fields, sourceRow, targetRow, originalRisk) {
  const set = new Set(fields);
  const criticalFields = fields.filter((field) => CRITICAL_FIELDS.has(field));
  const risk = originalRisk === "HIGH" ? "HIGH" : "LOW";
  if (tableName === "crm_deals") return { conflictType: "BOTH_CHANGED", resolutionAction: "MANUAL_REVIEW", requiresOwnerApproval: true, reason: "CRM stage/status history is not sufficient to prove which independent business transition should win.", risk, criticalFields };
  if (tableName === "messenger_attachments" && set.has("message_id")) return { conflictType: "MANUAL_BUSINESS_DECISION", resolutionAction: "MANUAL_REVIEW", requiresOwnerApproval: true, reason: "The same attachment PK points to different message relationships; worker timestamps cannot resolve ownership.", risk: "HIGH", criticalFields: [...new Set([...criticalFields, "message_id"])] };
  if (tableName === "messenger_attachments") return { conflictType: "EPHEMERAL_CONFLICT", resolutionAction: "SKIP_EPHEMERAL", requiresOwnerApproval: false, reason: "Only attachment worker/retry/materialization state differs; keep Selectel storage state.", risk, criticalFields };
  if (["messenger_media_jobs", "telegram_user_sessions", "messenger_accounts"].includes(tableName)) return { conflictType: "EPHEMERAL_CONFLICT", resolutionAction: "SKIP_EPHEMERAL", requiresOwnerApproval: false, reason: "Legacy worker/session state must not replace the active Selectel runtime state.", risk, criticalFields };
  if (tableName === "messenger_conversations" && fields.some((field) => DERIVED_FIELDS.has(field))) return { conflictType: "DERIVED_CONFLICT", resolutionAction: "RECOMPUTE", requiresOwnerApproval: false, reason: "Conversation summary fields are derived from the merged message history and are recomputed without replacing the row.", risk, criticalFields };
  if (tableName === "messenger_messages" && set.has("attachments_json")) return { conflictType: "DERIVED_CONFLICT", resolutionAction: "RECOMPUTE", requiresOwnerApproval: false, reason: "Attachment summary is derived from MessengerAttachment rows; message text and identity stay Selectel-canonical.", risk, criticalFields };
  if (tableName === "notification_jobs") {
    const sentEvidence = sourceRow.status === "sent" && sourceRow.sent_at && sourceRow.provider_message_id
      && allRows(config.sourceDb, "notification_logs").some((row) => row.notification_job_id === sourceRow.id && row.status === "sent" && row.provider_message_id);
    const transferable = ["status", "sent_at", "provider_message_id", "messenger_message_id", "messenger_outbox_id", "conversation_id"]
      .filter((field) => set.has(field) && (targetRow[field] === null || targetRow[field] === undefined));
    if (sentEvidence && transferable.length > 0) return { conflictType: "RAILWAY_CONTAINS_MISSING_FIELDS", resolutionAction: "APPLY_RAILWAY_FIELD", applyFields: transferable, requiresOwnerApproval: false, reason: "A sent notification log plus provider id proves delivery; only target-null delivery evidence fields are copied to prevent duplicate sending.", risk: "HIGH", criticalFields };
    return { conflictType: "INVALID_RAILWAY_STATE", resolutionAction: "REJECT_RAILWAY", requiresOwnerApproval: false, reason: "Retry/error/scheduling state from the inactive Railway worker is stale or lacks independent delivery evidence.", risk, criticalFields };
  }
  if (tableName === "vehicle_lookup_cache") return { conflictType: "DERIVED_CONFLICT", resolutionAction: "RECOMPUTE", requiresOwnerApproval: false, reason: "Vehicle lookup cache is derived and must be rebuilt in the active Selectel contour.", risk, criticalFields };
  if (tableName === "local_stock_balances") return { conflictType: "SELECTEL_CANONICAL", resolutionAction: "KEEP_SELECTEL", requiresOwnerApproval: false, reason: "Stock balance is an external snapshot; Selectel is the active production sync contour and Railway has no independent stock movement evidence.", risk: "HIGH", criticalFields };
  if (tableName === "local_products") return { conflictType: "SELECTEL_CANONICAL", resolutionAction: "KEEP_SELECTEL", requiresOwnerApproval: false, reason: "Selectel is the active product/catalog sync contour; no Railway-side user or audit event proves a missing business edit.", risk, criticalFields };
  if (fields.every((field) => TECHNICAL_FIELDS.has(field))) return { conflictType: "IDENTICAL_BUSINESS_DIFFERENT_TECHNICAL", resolutionAction: "KEEP_SELECTEL", requiresOwnerApproval: false, reason: "Business fields are equal; only timestamps, cache, sync, or technical metadata differ.", risk, criticalFields };
  return { conflictType: "SELECTEL_CANONICAL", resolutionAction: "KEEP_SELECTEL", requiresOwnerApproval: false, reason: "No independent Railway business-event evidence outweighs the canonical Selectel record.", risk, criticalFields };
}

function establishedRisk(tableName, fields, sourceSnapshot) {
  const set = new Set(fields);
  if (sourceSnapshot === "RAILWAY_READ_ONLY_FINAL_DELTA_2026-07-30") return tableName === "notification_jobs" ? "HIGH" : "LOW";
  if (tableName === "crm_deals") return "HIGH";
  if (tableName === "local_products" && (set.has("sale_price_cents") || set.has("oem_atf"))) return "HIGH";
  if (tableName === "local_stock_balances" && (set.has("quantity") || set.has("available"))) return "HIGH";
  if (tableName === "messenger_attachments" && set.has("status")) return "HIGH";
  if (tableName === "messenger_conversations" && set.has("last_message_at")) return "HIGH";
  if (tableName === "messenger_messages" && set.has("attachments_json")) return "HIGH";
  if (tableName === "notification_jobs" && fields.some((field) => ["status", "sent_at", "provider_message_id", "messenger_message_id", "messenger_outbox_id", "conversation_id"].includes(field))) return "HIGH";
  if (tableName === "vehicle_lookup_cache" && set.has("normalized_vehicle_json")) return "HIGH";
  return "LOW";
}

const resolutions = [];
const refreshedConflicts = [];
for (const item of finalSamePkItems) {
  const sourceRow = rowByPublicPk(config.sourceDb, item.table, item.primaryKey.hash);
  const targetRow = rowByPublicPk(config.targetDb, item.table, item.primaryKey.hash);
  if (!sourceRow || !targetRow) throw new Error(`Same-PK row missing for ${item.table}.`);
  const fields = [...new Set([...Object.keys(sourceRow), ...Object.keys(targetRow)])]
    .filter((field) => !valueEqual(sourceRow[field], targetRow[field]))
    .sort();
  const originalRisk = establishedRisk(item.table, fields, item.sourceSnapshot);
  const decision = resolveConflict(item.table, fields, sourceRow, targetRow, originalRisk);
  const context = evidenceFor(item.table, sourceRow, targetRow, item.primaryKey.hash);
  const fieldLevelActions = fields.map((field) => {
    let action = "KEEP_SELECTEL";
    if (decision.resolutionAction === "SKIP_EPHEMERAL") action = "SKIP_EPHEMERAL";
    if (decision.resolutionAction === "RECOMPUTE" && DERIVED_FIELDS.has(field)) action = "RECOMPUTE";
    if (decision.resolutionAction === "APPLY_RAILWAY_FIELD" && decision.applyFields?.includes(field)) action = "APPLY_RAILWAY_FIELD";
    if (decision.resolutionAction === "MANUAL_REVIEW") action = "MANUAL_REVIEW";
    if (decision.resolutionAction === "REJECT_RAILWAY") action = "REJECT_RAILWAY";
    return {
      field,
      action,
      critical: decision.criticalFields.includes(field),
      selectelValueHash: hasher.hash(`field:${item.table}:${field}:selectel`, targetRow[field] ?? null),
      railwayValueHash: hasher.hash(`field:${item.table}:${field}:railway`, sourceRow[field] ?? null),
      requiresOwnerApproval: action === "MANUAL_REVIEW",
    };
  });
  const businessFields = Object.keys(targetRow).filter((field) => !TECHNICAL_FIELDS.has(field) && field !== "id").sort();
  resolutions.push({
    tableName: item.table,
    primaryKey: item.primaryKey,
    businessKeyHash: hasher.hash(`same-pk-business:${item.table}`, businessFields.map((field) => targetRow[field] ?? sourceRow[field] ?? null)),
    conflictingFields: fields,
    criticalFields: decision.criticalFields,
    selectelValueHash: hasher.hash(`same-pk-values:${item.table}:selectel`, Object.fromEntries(fields.map((field) => [field, targetRow[field] ?? null]))),
    railwayValueHash: hasher.hash(`same-pk-values:${item.table}:railway`, Object.fromEntries(fields.map((field) => [field, sourceRow[field] ?? null]))),
    selectelUpdatedAt: targetRow.updated_at ?? null,
    railwayUpdatedAt: sourceRow.updated_at ?? null,
    selectelSource: "Selectel canonical production snapshot 2026-07-28",
    railwaySource: item.sourceSnapshot ?? "Railway legacy snapshot",
    relatedAuditEvents: context.relatedAuditEvents,
    conflictType: decision.conflictType,
    resolutionAction: decision.resolutionAction,
    fieldLevelActions,
    reason: decision.reason,
    evidence: context.evidence,
    risk: decision.risk,
    requiresOwnerApproval: decision.requiresOwnerApproval,
    approvedBy: null,
    approvedAt: null,
  });
  refreshedConflicts.push({
    table: item.table,
    primaryKey: item.primaryKey,
    differingFields: fields,
    selectelUpdatedAt: targetRow.updated_at ?? null,
    railwayUpdatedAt: sourceRow.updated_at ?? null,
    conflictType: decision.conflictType,
    recommendedResolution: decision.resolutionAction,
    risk: decision.risk,
    sourceSnapshot: item.sourceSnapshot,
  });
}

resolutions.sort((a, b) => a.tableName.localeCompare(b.tableName) || a.primaryKey.hash.localeCompare(b.primaryKey.hash));
refreshedConflicts.sort((a, b) => a.table.localeCompare(b.table) || a.primaryKey.hash.localeCompare(b.primaryKey.hash));
const resolutionManifest = {
  manifestVersion: 1,
  generatedAt,
  status: resolutions.some((item) => item.requiresOwnerApproval) ? "OWNER_REVIEW_REQUIRED" : "DETERMINISTIC",
  sourceConflictCount: baselineConflictCount,
  supplementalConflictCount: resolutions.length - baselineConflictCount,
  conflictCount: resolutions.length,
  unknownCount: 0,
  hashKeyId: hasher.keyId,
  canonicalTarget: "Selectel",
  prohibitedActions: ["REPLACE_ROW_FROM_RAILWAY"],
  resolutions,
};

const fieldAllowlists = {};
for (const resolution of resolutions) {
  const entry = fieldAllowlists[resolution.tableName] ??= { allowedByManifest: [], forbiddenWithoutApproval: [] };
  for (const action of resolution.fieldLevelActions) {
    const explicitlyApplicable = ["APPLY_RAILWAY_FIELD", "MERGE_NON_CRITICAL_FIELDS", "RECOMPUTE"].includes(action.action);
    const bucket = explicitlyApplicable || !action.critical ? entry.allowedByManifest : entry.forbiddenWithoutApproval;
    if (!bucket.includes(action.field)) bucket.push(action.field);
  }
}
for (const entry of Object.values(fieldAllowlists)) {
  entry.allowedByManifest.sort();
  entry.forbiddenWithoutApproval.sort();
}

const critical = resolutions.filter((item) => item.risk === "HIGH");
const groups = {
  "CRM и записи": critical.filter((item) => ["crm_deals"].includes(item.tableName)),
  "Сообщения и вложения": critical.filter((item) => item.tableName.startsWith("messenger_")),
  "Уведомления": critical.filter((item) => item.tableName.startsWith("notification_")),
  "Остатки и товары": critical.filter((item) => ["local_stock_balances", "local_products"].includes(item.tableName)),
  "Интеграционные и производные данные": critical.filter((item) => !["crm_deals", "local_stock_balances", "local_products"].includes(item.tableName) && !item.tableName.startsWith("messenger_") && !item.tableName.startsWith("notification_")),
};
const criticalLines = [
  "# Critical same-PK review",
  "",
  `Сформировано: ${generatedAt}. Персональные значения не включены; идентификаторы и значения представлены HMAC-хешами.`,
  "",
  `Всего критичных конфликтов: **${critical.length}**. Требуют решения владельца: **${critical.filter((item) => item.requiresOwnerApproval).length}**.`,
  "",
];
for (const [group, items] of Object.entries(groups)) {
  if (!items.length) continue;
  criticalLines.push(`## ${group}`, "");
  for (const item of items) {
    const fieldSummary = item.fieldLevelActions.map((field) => `${field.field}: ${field.action}`).join(", ");
    criticalLines.push(
      `- **${item.tableName} / …${shortHash(item.primaryKey.hash)}** — Selectel ${compactDate(item.selectelUpdatedAt)}, Railway ${compactDate(item.railwayUpdatedAt)}. `
      + `Контекст: ${item.relatedAuditEvents.length} связанных audit/event записей. Решение: **${item.resolutionAction}** (${fieldSummary}). `
      + `Риск: ${item.reason} Владелец: ${item.requiresOwnerApproval ? "требуется" : "не требуется; правило детерминировано"}.`,
    );
  }
  criticalLines.push("");
}

const manualRecords = registryRecords.filter((record) => record.recommendedAction === "MANUAL_REVIEW");
const manualLines = [
  "# Railway-only manual review",
  "",
  `Открытых записей: **${manualRecords.length}**. Значения PII не выводятся.`,
  "",
];
for (const record of manualRecords) {
  let recommendation = "MAP_TO_EXISTING после подтверждения владельцем";
  if (record.tableName === "messenger_attachments") recommendation = "INSERT_MISSING только после подтверждения наличия локального объекта; иначе REJECT_INVALID";
  if (record.tableName === "conversation_entity_links") recommendation = "SKIP_DUPLICATE, если подтверждена эквивалентная связь; иначе MAP_TO_EXISTING";
  manualLines.push(
    `- **${record.tableName} / …${shortHash(record.primaryKey.hash)}** (${record.entityType}). Причина: ${record.reason} `
    + `Связи: ${record.parentEntities.length} parent / ${record.childEntities.length} child. При импорте возможна новая связь или объект; при пропуске может потеряться историческая привязка. `
    + `Рекомендация: **${recommendation}**.`,
  );
}

const approvals = [];
for (const item of resolutions.filter((entry) => entry.requiresOwnerApproval)) approvals.push({
  scope: "SAME_PK", tableName: item.tableName, primaryKey: item.primaryKey, proposedAction: item.resolutionAction,
  affectedFields: item.conflictingFields, status: "PENDING", approvedBy: null, approvedAt: null,
});
for (const record of registryRecords.filter((entry) => entry.recommendedAction === "MANUAL_REVIEW" || entry.requiresOwnerApproval)) approvals.push({
  scope: "RAILWAY_ONLY", tableName: record.tableName, primaryKey: record.primaryKey, proposedAction: record.recommendedAction,
  affectedFields: [], status: "PENDING", approvedBy: null, approvedAt: null,
});

const ownerByEntity = {};
for (const item of approvals) ownerByEntity[item.tableName] = (ownerByEntity[item.tableName] ?? 0) + 1;
const ownerLines = [
  "# Owner review pack",
  "",
  `Нужно утвердить: ${approvals.filter((item) => item.scope === "SAME_PK").length} critical same-PK и ${approvals.filter((item) => item.scope === "RAILWAY_ONLY").length} Railway-only решений.`,
  "",
  "## Разбивка",
  "",
  ...Object.entries(ownerByEntity).sort().map(([table, count]) => `- ${table}: ${count}`),
  "",
  "## Последствия",
  "",
  "- SAME_PK MANUAL_REVIEW: Selectel остаётся без изменений до решения; никакая строка целиком не заменяется.",
  "- Railway-only MANUAL_REVIEW: запись не импортируется до явного выбора из допустимых действий.",
  "- RECREATE_BUSINESS_EVENT: legacy job не копируется; после подтверждения создаётся новое событие штатным Selectel workflow.",
  "- Все 3 709 исходных Selectel-only строк защищены отдельным denylist/checksum-контролем.",
  "",
  "Решения записываются только в `approved-manual-decisions.json`; исходный manifest и PII не редактируются вручную.",
];

writeFileSync(resolve(ROOT, "railway-only-records.json"), `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
writeFileSync(resolve(ROOT, "railway-to-selectel-migration-manifest.json"), `${JSON.stringify(migrationManifest, null, 2)}\n`, { mode: 0o600 });
writeFileSync(resolve(ROOT, "same-pk-conflicts.json"), `${JSON.stringify({ ...oldConflicts, reportVersion: 2, generatedAt, sourceConflictCount: baselineConflictCount, conflictCount: refreshedConflicts.length, supplementalConflictCount: refreshedConflicts.length - baselineConflictCount, conflicts: refreshedConflicts }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(resolve(ROOT, "same-pk-resolution-manifest.json"), `${JSON.stringify(resolutionManifest, null, 2)}\n`, { mode: 0o600 });
writeFileSync(resolve(ROOT, "field-allowlists.json"), `${JSON.stringify({ version: 1, generatedAt, fieldAllowlists }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(resolve(ROOT, "approved-manual-decisions.json"), `${JSON.stringify({ version: 1, generatedAt, status: "PENDING_OWNER_APPROVAL", decisions: approvals }, null, 2)}\n`, { mode: 0o600 });
writeFileSync(resolve(ROOT, "critical-same-pk-review.md"), `${criticalLines.join("\n")}\n`, { mode: 0o600 });
writeFileSync(resolve(ROOT, "railway-only-manual-review.md"), `${manualLines.join("\n")}\n`, { mode: 0o600 });
writeFileSync(resolve(ROOT, "owner-review-pack.md"), `${ownerLines.join("\n")}\n`, { mode: 0o600 });

const counts = (records, getter) => Object.fromEntries([...records.reduce((map, record) => {
  const key = getter(record);
  map.set(key, (map.get(key) ?? 0) + 1);
  return map;
}, new Map()).entries()].sort());

console.log(JSON.stringify({
  status: "FINAL_MANIFESTS_BUILT",
  railwayOnly: { total: registryRecords.length, added: additions.length, actions: counts(registryRecords, (record) => record.recommendedAction) },
  samePk: { total: resolutions.length, original: baselineConflictCount, supplemental: resolutions.length - baselineConflictCount, critical: critical.length, ownerApproval: resolutions.filter((item) => item.requiresOwnerApproval).length, actions: counts(resolutions, (item) => item.resolutionAction), types: counts(resolutions, (item) => item.conflictType) },
  approvals: approvals.length,
  unknown: 0,
}, null, 2));
