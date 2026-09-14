#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenArguments = new Set(["--apply", "--write-db", "--materialize", "--production", "--activate"]);
for (const argument of process.argv.slice(2)) {
  if (forbiddenArguments.has(argument) || [...forbiddenArguments].some((prefix) => argument.startsWith(`${prefix}=`))) {
    throw new Error(`database mutation is forbidden by this second-pass builder: ${argument}`);
  }
}

function argument(name, fallback) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const sourceDir = resolve(workspaceRoot, argument(
  "source-dir",
  "outputs/mann-technical-catalog-v9-timeweb-backup-20260823-190344",
));
const outputPath = resolve(workspaceRoot, argument(
  "output",
  "outputs/mann-technical-second-pass-v1/mann-technical-second-pass-plan-v1.json",
));
const decisionsPath = resolve(sourceDir, "mann-technical-requirement-decisions.ndjson");
const previewPath = resolve(sourceDir, "mann-technical-materialization-preview.json");

const MIN_SCORE = 70;
const MIN_TOP_GAP = 12;
const MIN_AGREEING_SYSTEMS = 2;

const COMPONENT_SELECTION_SYSTEMS = new Set([
  "AUTOMATIC_TRANSMISSION",
  "MANUAL_TRANSMISSION",
  "CVT_TRANSMISSION",
  "ROBOT_TRANSMISSION",
  "TRANSMISSION_GENERIC",
  "CLUTCH_FLUID",
  "TRANSFER_CASE",
  "FRONT_DIFFERENTIAL",
  "REAR_DIFFERENTIAL",
  "DIFFERENTIAL_GENERIC",
  "AWD_COUPLING",
  "PTO",
  "RETARDER",
  "POWER_STEERING",
  "SUSPENSION_HYDRAULIC",
  "HYDRAULIC_SYSTEM",
]);

const [decisionsRaw, previewRaw] = await Promise.all([
  readFile(decisionsPath, "utf8"),
  readFile(previewPath, "utf8"),
]);
const decisions = decisionsRaw.trim().split("\n").filter(Boolean).map(JSON.parse);
const preview = JSON.parse(previewRaw);

assert.equal(preview.artifactKind, "MANN_TECHNICAL_MATERIALIZATION_DRY_RUN");
assert.equal(preview.writeMode, "DRY_RUN_ONLY");
assert.equal(decisions.length, 13_296);

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim() !== ""))];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function vehicleContext(decision) {
  const requirement = decision.requirement;
  return {
    make: requirement.make,
    model: requirement.model,
    generation: requirement.generation,
    years: requirement.years,
    engineCode: requirement.engineCode,
    engineVolumeCc: requirement.engineVolumeCc,
    powerKw: requirement.powerKw,
    powerHp: requirement.powerHp,
    fuelType: requirement.fuelType,
  };
}

function vehicleContextKey(decision) {
  return `mvc_${hash(vehicleContext(decision)).slice(0, 24)}`;
}

function sourceContextKey(decision) {
  return `${decision.source?.sourceUrl ?? "NO_URL"}|${vehicleContextKey(decision)}`;
}

function candidateForVariant(rows, variantKey) {
  return rows.flatMap((row) => row.match?.topCandidates ?? [])
    .find((candidate) => candidate.variantIds?.includes(variantKey)) ?? null;
}

function eligibleConsensusVote(decision) {
  const candidate = decision.match?.topCandidates?.[0];
  if (!candidate || candidate.variantIds?.length !== 1) return null;
  if (candidate.score < MIN_SCORE || (decision.match?.top1Top2Gap ?? 0) < MIN_TOP_GAP) return null;
  if ((candidate.hardConflicts ?? []).length > 0) return null;
  if (decision.requirement.engineCode && !(candidate.matchedFields ?? []).includes("точный код двигателя")) return null;
  return { decision, candidate, variantKey: candidate.variantIds[0] };
}

const associationsByRequirement = new Map();
for (const association of preview.proposedAssociations) {
  for (const id of unique([association.requirementId, ...(association.sourceRequirementIds ?? [])])) {
    const variants = associationsByRequirement.get(id) ?? new Set();
    variants.add(association.vehicleVariantKey);
    associationsByRequirement.set(id, variants);
  }
}

const linkedVariantsByContext = new Map();
for (const decision of decisions) {
  const variants = associationsByRequirement.get(decision.requirementId);
  if (!variants) continue;
  const contextKey = vehicleContextKey(decision);
  const contextVariants = linkedVariantsByContext.get(contextKey) ?? new Set();
  for (const variantKey of variants) contextVariants.add(variantKey);
  linkedVariantsByContext.set(contextKey, contextVariants);
}

const unlinked = decisions.filter((decision) => !associationsByRequirement.has(decision.requirementId));
const unlinkedByContext = Map.groupBy(unlinked, vehicleContextKey);
const qualifiedContexts = new Map();

for (const [contextKey, rows] of unlinkedByContext) {
  const anchorVariants = linkedVariantsByContext.get(contextKey);
  if (anchorVariants?.size === 1) {
    qualifiedContexts.set(contextKey, {
      method: "CONFIRMED_CONTEXT_INHERITANCE",
      variantKey: [...anchorVariants][0],
      agreeingSystems: [],
      evidenceCount: 1,
      rows,
    });
    continue;
  }

  const votes = rows.map(eligibleConsensusVote).filter(Boolean);
  const variants = unique(votes.map((vote) => vote.variantKey));
  if (variants.length !== 1) continue;
  const agreeingSystems = unique(votes.map((vote) => vote.decision.requirement.systemCode));
  if (agreeingSystems.length < MIN_AGREEING_SYSTEMS) continue;

  qualifiedContexts.set(contextKey, {
    method: "CROSS_SYSTEM_CONSENSUS",
    variantKey: variants[0],
    agreeingSystems,
    evidenceCount: votes.length,
    rows,
  });
}

function proposalRow(decision, qualification) {
  const candidate = candidateForVariant(qualification.rows, qualification.variantKey);
  return {
    requirementId: decision.requirementId,
    vehicleContextKey: vehicleContextKey(decision),
    vehicleVariantKey: qualification.variantKey,
    method: qualification.method,
    evidenceCount: qualification.evidenceCount,
    agreeingSystems: qualification.agreeingSystems,
    vehicle: vehicleContext(decision),
    systemCode: decision.requirement.systemCode,
    transmissionType: decision.requirement.transmissionType,
    componentModel: decision.requirement.componentModel,
    originalStatus: decision.match.status,
    topScore: candidate?.score ?? decision.match?.top1Score ?? null,
    top1Top2Gap: decision.match?.top1Top2Gap ?? null,
    mannTarget: candidate ? {
      make: candidate.make,
      model: candidate.model,
      vehicleText: candidate.vehicleText,
      engineCode: candidate.engineCode,
      vehicleYears: candidate.vehicleYears,
      matchedFields: candidate.matchedFields,
    } : null,
    source: decision.source,
  };
}

const ALLOWED_COMPONENT_BLOCKERS = new Set([
  "MANN variant не подтверждает тип или модель коробки",
  "MANN variant не подтверждает привод или модель агрегата",
  "MANN variant не подтверждает наличие этой гидравлической системы",
]);

function validateProposal(decision, qualification, componentSelection) {
  const candidate = (decision.match?.topCandidates ?? [])
    .find((item) => item.variantIds?.includes(qualification.variantKey));
  const reasons = [];
  if (!candidate) reasons.push("выбранный MANN variant отсутствует среди кандидатов строки");
  for (const conflict of candidate?.hardConflicts ?? []) reasons.push(`конфликт MANN: ${conflict}`);
  if (decision.capacity?.needsReview) reasons.push("парсер объёма требует проверки");
  for (const blocker of candidate?.reviewBlockers ?? []) {
    if (componentSelection && ALLOWED_COMPONENT_BLOCKERS.has(blocker)) continue;
    reasons.push(blocker);
  }
  return unique(reasons);
}

const directProposals = [];
const conditionalComponentItems = [];
const demotedRows = [];
for (const qualification of qualifiedContexts.values()) {
  for (const decision of qualification.rows) {
    const row = proposalRow(decision, qualification);
    const componentSelection = COMPONENT_SELECTION_SYSTEMS.has(decision.requirement.systemCode);
    const verificationReasons = validateProposal(decision, qualification, componentSelection);
    if (verificationReasons.length > 0) {
      demotedRows.push({ decision, from: componentSelection ? "CONDITIONAL" : "DIRECT", verificationReasons });
    } else if (componentSelection) {
      conditionalComponentItems.push({
        ...row,
        disposition: "VEHICLE_MATCHED_COMPONENT_SELECTION_REQUIRED",
      });
    } else {
      directProposals.push({
        ...row,
        disposition: "STAGED_SECOND_PASS_PROPOSAL",
      });
    }
  }
}

const remaining = unlinked.filter((decision) => !qualifiedContexts.has(vehicleContextKey(decision)));
const reviewRows = [
  ...remaining.filter((decision) => ["REVIEW_REQUIRED", "CONFLICT"].includes(decision.match.status)),
  ...demotedRows.map((row) => row.decision),
];
const deferredRequirements = remaining.filter((decision) => !["REVIEW_REQUIRED", "CONFLICT"].includes(decision.match.status));
const demotionByRequirement = new Map(demotedRows.map((row) => [row.decision.requirementId, row]));

const reviewContexts = [...Map.groupBy(reviewRows, sourceContextKey)].map(([key, rows]) => {
  const first = rows[0];
  const candidateMap = new Map();
  for (const row of rows) {
    for (const candidate of (row.match?.topCandidates ?? []).slice(0, 3)) {
      for (const variantKey of candidate.variantIds ?? []) {
        const current = candidateMap.get(variantKey) ?? { variantKey, appearances: 0, maxScore: 0, candidate };
        current.appearances += 1;
        current.maxScore = Math.max(current.maxScore, candidate.score ?? 0);
        candidateMap.set(variantKey, current);
      }
    }
  }
  const candidates = [...candidateMap.values()]
    .sort((left, right) => right.appearances - left.appearances || right.maxScore - left.maxScore)
    .slice(0, 5)
    .map(({ variantKey, appearances, maxScore, candidate }) => ({
      variantKey,
      appearances,
      maxScore,
      make: candidate.make,
      model: candidate.model,
      vehicleText: candidate.vehicleText,
      engineCode: candidate.engineCode,
      vehicleYears: candidate.vehicleYears,
    }));
  const blockers = unique(rows.flatMap((row) => [
    ...(row.match?.topCandidates?.[0]?.reviewBlockers ?? []),
    ...(demotionByRequirement.get(row.requirementId)?.verificationReasons ?? []),
  ]));
  const conflicts = unique(rows.flatMap((row) => row.match?.topCandidates?.[0]?.hardConflicts ?? []));
  return {
    reviewContextId: `mrc_${hash(key).slice(0, 24)}`,
    batchId: `mrb_${hash(first.source?.sourceUrl ?? "NO_URL").slice(0, 20)}`,
    vehicleContextKey: vehicleContextKey(first),
    sourceUrl: first.source?.sourceUrl ?? null,
    vehicle: vehicleContext(first),
    requirementIds: rows.map((row) => row.requirementId),
    requirementCount: rows.length,
    systems: unique(rows.map((row) => row.requirement.systemCode)),
    transmissionTypes: unique(rows.map((row) => row.requirement.transmissionType)),
    componentModels: unique(rows.map((row) => row.requirement.componentModel)),
    statuses: unique(rows.map((row) => row.match.status)),
    candidates,
    blockers,
    conflicts,
  };
}).sort((left, right) => right.requirementCount - left.requirementCount || left.reviewContextId.localeCompare(right.reviewContextId));

const reviewBatches = [...Map.groupBy(reviewContexts, (row) => row.batchId)].map(([batchId, contexts]) => {
  const requirementCount = contexts.reduce((sum, row) => sum + row.requirementCount, 0);
  const priority = requirementCount >= 20 ? "P1" : requirementCount >= 8 ? "P2" : "P3";
  return {
    batchId,
    priority,
    sourceUrl: contexts[0].sourceUrl,
    contextCount: contexts.length,
    requirementCount,
    makes: unique(contexts.map((row) => row.vehicle.make)),
    models: unique(contexts.map((row) => row.vehicle.model)),
    systems: unique(contexts.flatMap((row) => row.systems)),
    blockers: unique(contexts.flatMap((row) => row.blockers)),
    conflicts: unique(contexts.flatMap((row) => row.conflicts)),
  };
}).sort((left, right) => left.priority.localeCompare(right.priority) || right.requirementCount - left.requirementCount || left.batchId.localeCompare(right.batchId));

const statusCounts = (rows, selector) => Object.fromEntries(
  [...Map.groupBy(rows, selector)].map(([key, values]) => [key, values.length]).sort((left, right) => right[1] - left[1]),
);

const artifact = {
  schemaVersion: 1,
  artifactKind: "MANN_TECHNICAL_SECOND_PASS_PLAN",
  writeMode: "DRY_RUN_ONLY",
  generatedAt: new Date().toISOString(),
  source: {
    previewPath,
    decisionsPath,
    matcherVersion: preview.algorithms?.matcher,
    sourceSnapshot: preview.sourceSnapshot,
  },
  strategy: {
    minScore: MIN_SCORE,
    minTop1Top2Gap: MIN_TOP_GAP,
    minAgreeingSystems: MIN_AGREEING_SYSTEMS,
    exactEngineRequiredWhenPresent: true,
    componentSelectionSystems: [...COMPONENT_SELECTION_SYSTEMS],
    productionApplyAllowed: false,
  },
  counts: {
    sourceRequirements: decisions.length,
    existingLinkedRequirements: associationsByRequirement.size,
    unlinkedRequirementsBeforeSecondPass: unlinked.length,
    qualifiedVehicleContexts: qualifiedContexts.size,
    directSecondPassProposals: directProposals.length,
    conditionalComponentItems: conditionalComponentItems.length,
    demotedAfterVerification: demotedRows.length,
    demotedFromDirect: demotedRows.filter((row) => row.from === "DIRECT").length,
    demotedFromConditional: demotedRows.filter((row) => row.from === "CONDITIONAL").length,
    remainingReviewRows: reviewRows.length,
    reviewContexts: reviewContexts.length,
    reviewBatches: reviewBatches.length,
    deferredRequirements: deferredRequirements.length,
  },
  distributions: {
    directByMethod: statusCounts(directProposals, (row) => row.method),
    directBySystem: statusCounts(directProposals, (row) => row.systemCode),
    conditionalBySystem: statusCounts(conditionalComponentItems, (row) => row.systemCode),
    demotionReasons: statusCounts(
      demotedRows.flatMap((row) => row.verificationReasons.map((reason) => ({ reason }))),
      (row) => row.reason,
    ),
    reviewBatchByPriority: statusCounts(reviewBatches, (row) => row.priority),
    deferredByStatus: statusCounts(deferredRequirements, (row) => row.match.status),
  },
  directProposals,
  conditionalComponentItems,
  reviewBatches,
  reviewContexts,
  deferredRequirements: deferredRequirements.map((decision) => ({
    requirementId: decision.requirementId,
    vehicleContextKey: vehicleContextKey(decision),
    sourceUrl: decision.source?.sourceUrl ?? null,
    vehicle: vehicleContext(decision),
    systemCode: decision.requirement.systemCode,
    status: decision.match.status,
    reason: decision.match?.reviewReasons?.join("; ") ?? null,
  })),
};

assert.equal(
  artifact.counts.existingLinkedRequirements
    + artifact.counts.unlinkedRequirementsBeforeSecondPass,
  artifact.counts.sourceRequirements,
);
assert.equal(
  artifact.counts.directSecondPassProposals
    + artifact.counts.conditionalComponentItems
    + artifact.counts.remainingReviewRows
    + artifact.counts.deferredRequirements,
  artifact.counts.unlinkedRequirementsBeforeSecondPass,
);
assert.ok(directProposals.every((row) => !COMPONENT_SELECTION_SYSTEMS.has(row.systemCode)));
assert.ok(conditionalComponentItems.every((row) => COMPONENT_SELECTION_SYSTEMS.has(row.systemCode)));
assert.ok(reviewContexts.every((row) => row.requirementCount > 0 && row.sourceUrl));
assert.ok(reviewBatches.every((row) => row.contextCount > 0 && row.requirementCount > 0));

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputPath, counts: artifact.counts, distributions: artifact.distributions }, null, 2)}\n`);
