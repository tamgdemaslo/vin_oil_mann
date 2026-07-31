#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PATHS = {
  owner: resolve("docs/reconciliation/owner-decisions.json"),
  approvals: resolve("docs/reconciliation/approved-manual-decisions.json"),
  resolutions: resolve("docs/reconciliation/same-pk-resolution-manifest.json"),
  migration: resolve("docs/reconciliation/railway-to-selectel-migration-manifest.json"),
};

function parseArgs(argv) {
  const options = {
    responses: new Map(),
    decidedAt: null,
    approvedBy: "owner",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--responses") {
      for (const item of argv[++index].split(",")) {
        const match = item.trim().match(/^(?:DEC-)?(\d{1,3}):([A-D])$/i);
        if (!match) throw new Error(`Invalid response: ${item}`);
        const decisionId = `DEC-${String(Number(match[1])).padStart(3, "0")}`;
        options.responses.set(decisionId, match[2].toUpperCase());
      }
    } else if (arg === "--decided-at") options.decidedAt = argv[++index];
    else if (arg === "--approved-by") options.approvedBy = argv[++index];
    else if (arg === "--help") {
      console.log("Usage: apply-owner-same-pk-decisions.mjs --responses 1:A,2:A [--decided-at ISO] [--approved-by owner]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.responses.size === 0) throw new Error("At least one --responses entry is required.");
  if (options.decidedAt && Number.isNaN(Date.parse(options.decidedAt))) throw new Error("--decided-at must be an ISO timestamp.");
  if (!options.approvedBy.trim()) throw new Error("--approved-by must not be empty.");
  return options;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function counts(decisions) {
  return decisions.reduce((result, decision) => {
    result[decision.status] = (result[decision.status] ?? 0) + 1;
    return result;
  }, {});
}

const options = parseArgs(process.argv.slice(2));
const owner = readJson(PATHS.owner);
const approvals = readJson(PATHS.approvals);
const resolutions = readJson(PATHS.resolutions);
const migration = readJson(PATHS.migration);
const samePkApprovals = approvals.decisions.filter((decision) => decision.scope === "SAME_PK");

if (samePkApprovals.length !== 6) throw new Error(`Expected 6 same-PK approvals, found ${samePkApprovals.length}.`);
if (resolutions.unknownCount !== 0) throw new Error("UNKNOWN must remain zero before owner decisions are applied.");

const expectedTables = ["crm_deals", "crm_deals", "crm_deals", "crm_deals", "messenger_attachments", "messenger_attachments"];
let changed = false;
let effectiveTimestamp = options.decidedAt ?? new Date().toISOString();

for (const [decisionId, selectedOption] of options.responses) {
  const ordinal = Number(decisionId.slice(4));
  if (ordinal < 1 || ordinal > 6) throw new Error(`${decisionId} is not part of the same-PK owner batch 1-6.`);
  if (selectedOption !== "A") throw new Error(`${decisionId}: this guarded helper only maps option A to KEEP_SELECTEL.`);

  const ownerDecision = owner.decisions.find((decision) => decision.decisionId === decisionId);
  const legacyDecision = samePkApprovals[ordinal - 1];
  if (!ownerDecision || !legacyDecision) throw new Error(`Decision mapping is missing for ${decisionId}.`);
  if (ownerDecision.recommendedOption !== "A") throw new Error(`${decisionId}: recommendation changed; refusing stale response.`);
  if (legacyDecision.tableName !== expectedTables[ordinal - 1]) throw new Error(`${decisionId}: unexpected table mapping.`);
  if (ownerDecision.status === "APPROVED" && ownerDecision.selectedOption !== selectedOption) {
    throw new Error(`${decisionId}: an already approved option cannot be overwritten.`);
  }

  const resolution = resolutions.resolutions.find((entry) =>
    entry.tableName === legacyDecision.tableName
      && entry.primaryKey.hash === legacyDecision.primaryKey.hash);
  if (!resolution) throw new Error(`${decisionId}: same-PK resolution was not found.`);

  const decisionWasAlreadyApplied = ownerDecision.status === "APPROVED"
    && ownerDecision.selectedOption === selectedOption
    && resolution.resolutionAction === "KEEP_SELECTEL"
    && resolution.ownerDecision?.decisionId === decisionId;
  const decidedAt = ownerDecision.decidedAt ?? effectiveTimestamp;
  if (decisionWasAlreadyApplied) effectiveTimestamp = decidedAt;
  else changed = true;

  Object.assign(ownerDecision, {
    selectedOption,
    status: "APPROVED",
    requiresManifestUpdate: false,
    requiresProductionMutation: false,
    decidedAt,
  });

  Object.assign(legacyDecision, {
    proposedAction: "KEEP_SELECTEL",
    status: "APPROVED",
    approvedBy: options.approvedBy,
    approvedAt: decidedAt,
    decisionId,
    selectedOption,
  });

  Object.assign(resolution, {
    resolutionAction: "KEEP_SELECTEL",
    fieldLevelActions: resolution.fieldLevelActions.map((field) => ({
      ...field,
      action: "KEEP_SELECTEL",
      requiresOwnerApproval: false,
    })),
    reason: "Owner approved option A: keep the Selectel version and apply no Railway fields.",
    requiresOwnerApproval: false,
    approvedBy: options.approvedBy,
    approvedAt: decidedAt,
    ownerDecision: {
      decisionId,
      selectedOption,
      status: "APPROVED",
      effect: "KEEP_SELECTEL",
      decidedAt,
    },
  });
}

const ownerCounts = counts(owner.decisions);
const pendingDecisionIds = owner.decisions
  .filter((decision) => decision.status === "PENDING")
  .map((decision) => decision.decisionId);
const approvedDecisionIds = owner.decisions
  .filter((decision) => decision.status === "APPROVED")
  .map((decision) => decision.decisionId);
const reviewProgress = {
  total: owner.decisions.length,
  approved: ownerCounts.APPROVED ?? 0,
  pending: ownerCounts.PENDING ?? 0,
  needsMoreInfo: ownerCounts.NEEDS_MORE_INFO ?? 0,
  rejected: ownerCounts.REJECTED ?? 0,
  approvedDecisionIds,
  explicitlyDeferredDecisionIds: pendingDecisionIds,
  deferReason: pendingDecisionIds.length > 0
    ? "Awaiting the next owner-review batches; no production action is permitted."
    : null,
  nextBatch: pendingDecisionIds.length > 0 ? pendingDecisionIds.slice(0, 5) : [],
};

owner.status = pendingDecisionIds.length > 0 ? "PARTIALLY_APPROVED" : "APPROVED";
owner.updatedAt = effectiveTimestamp;
owner.reviewProgress = reviewProgress;

approvals.generatedAt = effectiveTimestamp;
approvals.status = pendingDecisionIds.length > 0 ? "PARTIALLY_APPROVED" : "APPROVED";
approvals.ownerDecisionSummary = reviewProgress;

const remainingSamePkApprovals = resolutions.resolutions.filter((entry) => entry.requiresOwnerApproval).length;
resolutions.generatedAt = effectiveTimestamp;
resolutions.status = remainingSamePkApprovals === 0 ? "DETERMINISTIC" : "OWNER_REVIEW_REQUIRED";
resolutions.ownerDecisionSummary = {
  approvedSamePkDecisions: approvedDecisionIds.filter((id) => Number(id.slice(4)) <= 6),
  pendingSamePkDecisions: remainingSamePkApprovals,
  effect: "KEEP_SELECTEL",
  productionMutationRequired: false,
};

migration.generatedAt = effectiveTimestamp;
migration.status = pendingDecisionIds.length > 0 ? "OWNER_REVIEW_REQUIRED" : "READY_FOR_LOCAL_REHEARSAL";
migration.ownerDecisionSummary = reviewProgress;

writeJson(PATHS.owner, owner);
writeJson(PATHS.approvals, approvals);
writeJson(PATHS.resolutions, resolutions);
writeJson(PATHS.migration, migration);

console.log(JSON.stringify({
  status: "OWNER_DECISIONS_RECORDED",
  changed,
  approvedDecisionIds,
  explicitlyDeferredDecisionIds: pendingDecisionIds,
  samePkOwnerApprovalsRemaining: remainingSamePkApprovals,
  unknownCount: resolutions.unknownCount,
  productionMutationAttempted: false,
}, null, 2));
