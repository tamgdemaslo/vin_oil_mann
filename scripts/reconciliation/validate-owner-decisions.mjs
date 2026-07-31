#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function parseArgs(argv) {
  const options = { output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") options.output = resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

const options = parseArgs(process.argv.slice(2));
const owner = readJson("docs/reconciliation/owner-decisions.json");
const approvals = readJson("docs/reconciliation/approved-manual-decisions.json");
const resolutions = readJson("docs/reconciliation/same-pk-resolution-manifest.json");
const migration = readJson("docs/reconciliation/railway-to-selectel-migration-manifest.json");
const allowlists = readJson("docs/reconciliation/field-allowlists.json").fieldAllowlists;
const errors = [];
const warnings = [];
const allowedStatuses = new Set(["PENDING", "NEEDS_MORE_INFO", "APPROVED", "REJECTED", "SUPERSEDED"]);
const knownResolutionActions = new Set([
  "KEEP_SELECTEL",
  "APPLY_RAILWAY_FIELD",
  "RECOMPUTE",
  "SKIP_EPHEMERAL",
  "REJECT_RAILWAY",
  "MANUAL_REVIEW",
]);

function fail(type, details = {}) {
  errors.push({ type, ...details });
}

if (owner.decisions.length !== 26) fail("OWNER_DECISION_COUNT", { actual: owner.decisions.length, expected: 26 });
if (new Set(owner.decisions.map((decision) => decision.decisionId)).size !== owner.decisions.length) fail("DUPLICATE_DECISION_ID");
for (const decision of owner.decisions) {
  if (!allowedStatuses.has(decision.status)) fail("UNKNOWN_OWNER_STATUS", { decisionId: decision.decisionId, status: decision.status });
  if (decision.status === "APPROVED" && (!decision.selectedOption || !decision.decidedAt)) fail("INCOMPLETE_APPROVAL", { decisionId: decision.decisionId });
  if (decision.status === "PENDING" && (decision.selectedOption !== null || decision.decidedAt !== null)) fail("DIRTY_PENDING_DECISION", { decisionId: decision.decisionId });
}

const pendingIds = owner.decisions.filter((decision) => decision.status === "PENDING").map((decision) => decision.decisionId).sort();
const deferredIds = [...(owner.reviewProgress?.explicitlyDeferredDecisionIds ?? [])].sort();
if (JSON.stringify(pendingIds) !== JSON.stringify(deferredIds)) fail("PENDING_NOT_EXPLICITLY_DEFERRED");
if (pendingIds.length > 0 && !owner.reviewProgress?.deferReason) fail("DEFER_REASON_MISSING");

const legacySamePk = approvals.decisions.filter((decision) => decision.scope === "SAME_PK");
for (let index = 0; index < 6; index += 1) {
  const decisionId = `DEC-${String(index + 1).padStart(3, "0")}`;
  const decision = owner.decisions.find((entry) => entry.decisionId === decisionId);
  const legacy = legacySamePk[index];
  if (!decision || decision.status !== "APPROVED" || decision.selectedOption !== "A") fail("EXPECTED_APPROVED_A", { decisionId });
  if (decision?.requiresManifestUpdate !== false || decision?.requiresProductionMutation !== false) fail("APPROVED_DECISION_FLAGS", { decisionId });
  if (!legacy || legacy.decisionId !== decisionId || legacy.status !== "APPROVED" || legacy.proposedAction !== "KEEP_SELECTEL") {
    fail("LEGACY_APPROVAL_MISMATCH", { decisionId });
    continue;
  }
  const resolution = resolutions.resolutions.find((entry) =>
    entry.tableName === legacy.tableName && entry.primaryKey.hash === legacy.primaryKey.hash);
  if (!resolution) {
    fail("RESOLUTION_NOT_FOUND", { decisionId });
    continue;
  }
  if (resolution.resolutionAction !== "KEEP_SELECTEL" || resolution.requiresOwnerApproval || resolution.ownerDecision?.decisionId !== decisionId) {
    fail("RESOLUTION_DECISION_MISMATCH", { decisionId });
  }
  if (resolution.fieldLevelActions.some((field) => field.action !== "KEEP_SELECTEL" || field.requiresOwnerApproval)) {
    fail("OWNER_KEEP_SELECTEL_FIELD_WRITE", { decisionId });
  }
}

let writeFieldsChecked = 0;
let conditionallyProtectedFields = 0;
for (const resolution of resolutions.resolutions) {
  if (!knownResolutionActions.has(resolution.resolutionAction)) fail("UNKNOWN_RESOLUTION_ACTION", { tableName: resolution.tableName, action: resolution.resolutionAction });
  for (const field of resolution.fieldLevelActions) {
    if (!["APPLY_RAILWAY_FIELD", "RECOMPUTE"].includes(field.action)) continue;
    writeFieldsChecked += 1;
    const allowlist = allowlists[resolution.tableName];
    if (!allowlist?.allowedByManifest.includes(field.field)) {
      fail("FIELD_ALLOWLIST_VIOLATION", { tableName: resolution.tableName, field: field.field, action: field.action });
    }
    if (allowlist?.forbiddenWithoutApproval.includes(field.field)) {
      conditionallyProtectedFields += 1;
      if (!resolution.evidence?.length) fail("PROTECTED_FIELD_EVIDENCE_MISSING", { tableName: resolution.tableName, field: field.field });
    }
  }
}

if (resolutions.unknownCount !== 0) fail("UNKNOWN_NOT_ZERO", { actual: resolutions.unknownCount });
if (resolutions.resolutions.length !== resolutions.conflictCount) fail("RESOLUTION_COUNT_MISMATCH");
if (resolutions.resolutions.some((entry) => entry.requiresOwnerApproval)) fail("SAME_PK_OWNER_REVIEW_REMAINS");
if (migration.records.length !== migration.recordCount) fail("MIGRATION_RECORD_COUNT_MISMATCH");
if (migration.ownerDecisionSummary?.explicitlyDeferredDecisionIds?.length !== pendingIds.length) fail("MIGRATION_DECISION_SUMMARY_MISMATCH");

const approved = owner.decisions.filter((decision) => decision.status === "APPROVED").length;
const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "PASS" : "FAIL",
  productionMutationAttempted: false,
  externalSideEffectsEnabled: false,
  dependencyCheck: {
    status: errors.some((error) => error.type.includes("MISMATCH") || error.type.includes("NOT_FOUND")) ? "FAIL" : "PASS",
    approvedKeepSelectelDecisions: 6,
    parentMappingsRequired: 0,
    deferredPendingDecisions: pendingIds.length,
  },
  ownerDecisions: { total: owner.decisions.length, approved, pending: pendingIds.length, explicitlyDeferred: deferredIds.length },
  samePk: {
    total: resolutions.resolutions.length,
    unknown: resolutions.unknownCount,
    requiresOwnerApproval: resolutions.resolutions.filter((entry) => entry.requiresOwnerApproval).length,
    manualReview: resolutions.resolutions.filter((entry) => entry.resolutionAction === "MANUAL_REVIEW").length,
  },
  fieldAllowlist: { status: errors.some((error) => error.type.includes("FIELD_")) ? "FAIL" : "PASS", writeFieldsChecked, conditionallyProtectedFields, violations: errors.filter((error) => error.type.includes("FIELD_")).length },
  errors,
  warnings,
};

if (options.output) writeFileSync(options.output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exitCode = errors.length === 0 ? 0 : 1;
