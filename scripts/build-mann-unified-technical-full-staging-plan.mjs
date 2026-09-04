#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenArguments = new Set(["--apply", "--write-db", "--materialize", "--production", "--activate"]);
for (const argument of process.argv.slice(2)) {
  if (forbiddenArguments.has(argument) || [...forbiddenArguments].some((prefix) => argument.startsWith(`${prefix}=`))) {
    throw new Error(`database mutation is forbidden by this staging-plan builder: ${argument}`);
  }
}

const readArgument = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
};

const sourceDir = resolve(
  workspaceRoot,
  readArgument("source-dir", "outputs/mann-technical-catalog-v9-timeweb-backup-20260823-190344"),
);
const sourcePreviewPath = resolve(sourceDir, "mann-technical-materialization-preview.json");
const sourceDecisionsPath = resolve(sourceDir, "mann-technical-requirement-decisions.ndjson");
const verifiedPlanPath = resolve(
  workspaceRoot,
  readArgument("verified-plan", "outputs/mann-unified-technical-staging-v1/mann-unified-technical-staging-plan-v1.json"),
);
const outputPath = resolve(
  workspaceRoot,
  readArgument("output", "outputs/mann-unified-technical-full-staging-v1/mann-unified-technical-full-staging-plan-v1.json"),
);

const [sourcePreviewRaw, sourceDecisionsRaw, verifiedPlanRaw] = await Promise.all([
  readFile(sourcePreviewPath, "utf8"),
  readFile(sourceDecisionsPath, "utf8"),
  readFile(verifiedPlanPath, "utf8"),
]);
const sourcePreview = JSON.parse(sourcePreviewRaw);
const verifiedPlan = JSON.parse(verifiedPlanRaw);
const sourceDecisions = sourceDecisionsRaw.trim().split("\n").filter(Boolean).map(JSON.parse);

assert.equal(sourcePreview.artifactKind, "MANN_TECHNICAL_MATERIALIZATION_DRY_RUN");
assert.equal(sourcePreview.writeMode, "DRY_RUN_ONLY");
assert.equal(sourcePreview.sourceSnapshot?.currentTimewebSnapshot, true);
assert.match(sourcePreview.sourceSnapshot?.backupSha256, /^[a-f0-9]{64}$/u);
assert.ok(Array.isArray(sourcePreview.proposedAssociations) && sourcePreview.proposedAssociations.length > 0);
assert.equal(verifiedPlan.artifactKind, "MANN_UNIFIED_TECHNICAL_STAGING_PLAN");

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};
const stableJson = (value) => JSON.stringify(stableValue(value));
const sha256 = (value) => createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
const generatedAt = new Date().toISOString();
const planCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).trim();
assert.match(planCommit, /^[a-f0-9]{40}$/u);

const decisionsByRequirement = new Map(sourceDecisions.map((decision) => [decision.requirementId, decision]));
const verifiedVehicles = new Map(verifiedPlan.canonicalVehicles.map((vehicle) => [vehicle.key, vehicle]));
const vehicleCandidates = new Map();

function canonicalVehicleFor(association) {
  const verified = verifiedVehicles.get(association.vehicleVariantKey);
  if (verified) return verified;

  const decision = decisionsByRequirement.get(association.requirementId);
  assert.ok(decision, `decision not found: ${association.requirementId}`);
  const target = decision.match?.topCandidates?.find((candidate) => candidate.variantIds?.includes(association.vehicleVariantKey));
  assert.ok(target, `MANN target context not found: ${association.vehicleVariantKey}`);

  const payload = {
    key: association.vehicleVariantKey,
    make: target.make,
    makeNormalized: target.make.toLowerCase(),
    model: target.model,
    modelNormalized: target.model.toLowerCase(),
    generation: null,
    bodyCodes: [],
    modelYears: target.vehicleYears,
    yearFrom: null,
    yearTo: null,
    vehicleText: target.vehicleText,
    engineCode: target.engineCode,
    engineCodeNormalized: target.engineCode?.toUpperCase() || null,
    engineCodes: target.engineCode ? [target.engineCode.toUpperCase()] : [],
    engineVolumeCc: null,
    powerKw: null,
    powerHp: null,
    fuelType: null,
    driveType: null,
    transmissionType: null,
    conditionText: association.independentValidation?.condition ?? null,
    sourceHashes: association.provenance?.mannSourceHashes ?? [],
  };
  return {
    ...payload,
    canonicalPayloadHash: sha256(payload),
    firstSeenAt: generatedAt,
    lastSeenAt: generatedAt,
  };
}

function fieldConfidence(association) {
  const confidence = association.fieldConfidence ?? {};
  const technical = association.technical ?? {};
  const parserReview = association.proposedState === "REVIEW";
  const result = { _audit: confidence };

  if (Array.isArray(technical.capacities) && technical.capacities.length) {
    result["technical.capacity"] = parserReview
      ? "REQUIRES_REVIEW"
      : `SECONDARY_SOURCE_PARSED_${confidence.capacity?.level ?? "LOW"}`;
  }
  if (Array.isArray(technical.specifications) && technical.specifications.length) {
    result["technical.specifications"] = `SECONDARY_SOURCE_PARSED_${confidence.specification?.level ?? "MEDIUM"}`;
  }
  if (Array.isArray(technical.viscosityGrades) && technical.viscosityGrades.length) {
    result["technical.viscosityGrades"] = "SECONDARY_SOURCE_PARSED_HIGH";
  }
  if (technical.recommendationText) result["technical.recommendation"] = "SECONDARY_SOURCE_RAW";
  if (technical.replacementIntervalText) result["technical.replacementInterval"] = "SECONDARY_SOURCE_PARSED_MEDIUM";
  return result;
}

for (const association of sourcePreview.proposedAssociations) {
  assert.ok(["ACTIVE", "REVIEW"].includes(association.proposedState));
  assert.ok(["CONFIRMED_SINGLE", "CONFIRMED_MULTI_APPLICABILITY"].includes(association.matchStatus));
  assert.equal(association.independentValidation?.independentlyValidated, true);
  assert.deepEqual(association.independentValidation?.hardConflicts, []);
  assert.deepEqual(association.independentValidation?.reviewBlockers, []);
  assert.deepEqual(association.conflictTypes, association.proposedState === "REVIEW" ? ["CAPACITY_PARSER_REVIEW_REQUIRED"] : []);

  const vehicle = canonicalVehicleFor(association);
  const existing = vehicleCandidates.get(vehicle.key);
  if (existing) {
    assert.equal(existing.canonicalPayloadHash, vehicle.canonicalPayloadHash, `conflicting MANN vehicle payload: ${vehicle.key}`);
  } else {
    vehicleCandidates.set(vehicle.key, vehicle);
  }
}

const sourcePreviewSha256 = sha256(sourcePreviewRaw);
const runSeed = {
  artifact: "mann-unified-technical-full-staging-v1",
  sourceCommit: sourcePreview.commit,
  sourcePreviewSha256,
  matcherVersion: sourcePreview.algorithms.matcher,
  capacityParserVersion: sourcePreview.algorithms.capacityParser,
  backupSha256: sourcePreview.sourceSnapshot.backupSha256,
};
const runId = `mtmr_${sha256(runSeed).slice(0, 24)}`;

const revisions = sourcePreview.proposedAssociations.map((association) => {
  const technicalData = association.technical;
  const provenance = {
    ...association.provenance,
    sourceArtifactKind: sourcePreview.artifactKind,
    sourcePreviewSha256,
    sourceAssociationFingerprint: association.associationFingerprint,
    sourceProposedState: association.proposedState,
    independentValidation: association.independentValidation,
    catalogPreviewPolicy: "MANN_V9_CONSERVATIVE_MATCHER",
    catalogPreviewEligible: true,
    planCommit,
  };
  const semanticFingerprint = sha256({
    catalogPreviewVersion: "mann-secondary-catalog-preview-v1",
    vehicleVariantKey: association.vehicleVariantKey,
    sourceRequirementId: association.requirementId,
    systemCode: association.systemCode,
    applicability: association.applicability,
    technicalData,
  });

  return {
    id: `mtar_${semanticFingerprint.slice(0, 24)}`,
    runId,
    vehicleVariantKey: association.vehicleVariantKey,
    sourceRequirementId: association.requirementId,
    systemCode: association.systemCode,
    componentModel: association.componentModel,
    applicability: association.applicability,
    verifiedFields: [],
    technicalData,
    fieldConfidence: fieldConfidence(association),
    evidence: [{
      publisher: association.provenance.sourceName ?? "podbormasla.ru",
      title: "Каталог технических жидкостей",
      url: association.provenance.sourceUrl,
    }],
    provenance,
    matchClass: association.matchStatus,
    matchScore: association.matchScore,
    semanticFingerprint,
    state: association.proposedState === "ACTIVE" ? "STAGED" : "REVIEW",
    verificationStatus: "UNVERIFIED",
    applyEligible: false,
    supersedesRevisionId: null,
  };
});

assert.equal(new Set(revisions.map((revision) => revision.id)).size, revisions.length);
assert.equal(new Set(revisions.map((revision) => revision.semanticFingerprint)).size, revisions.length);
assert.ok(revisions.every((revision) => revision.applyEligible === false && revision.verificationStatus === "UNVERIFIED"));

const stateCounts = Object.fromEntries([...Map.groupBy(revisions, (revision) => revision.state)].map(([state, rows]) => [state, rows.length]));
const artifact = {
  schemaVersion: 1,
  artifactKind: "MANN_UNIFIED_TECHNICAL_FULL_STAGING_PLAN",
  writeMode: "DRY_RUN_ONLY",
  generatedAt,
  requiredMigration: "20260902400000_mann_unified_technical_catalog_expand",
  decisions: {
    stagingImport: "OWNER_AUTHORIZED_PREVIEW_ONLY",
    activeMaterialization: "NO_GO",
    automaticProductSelection: "FORBIDDEN",
  },
  materializationRun: {
    id: runId,
    status: "PLANNED",
    mode: "STAGING",
    matcherVersion: sourcePreview.algorithms.matcher,
    capacityParserVersion: sourcePreview.algorithms.capacityParser,
    gitCommit: planCommit,
    verificationSetVersion: "mann-full-staging-v1",
    sourceSnapshot: sourcePreview.sourceSnapshot,
    sourceCounts: {
      sourceRequirements: 13_296,
      sourceProposedAssociations: sourcePreview.proposedAssociations.length,
      stagedAssociations: stateCounts.STAGED ?? 0,
      parserReviewAssociations: stateCounts.REVIEW ?? 0,
    },
    gates: {
      fullCatalog: "NO_GO_FOR_ACTIVE",
      catalogPreview: "OWNER_AUTHORIZED_STAGING",
      catalogPreviewPolicy: "MANN_V9_CONSERVATIVE_MATCHER",
      allTargetsIndependentlyValidated: true,
      hardConflictsExcluded: true,
      automaticProductSelection: false,
      independentHumanSignoff: false,
      productionApplyAuthorized: false,
    },
    approval: {},
    independentHumanSignoff: false,
    productionApplyAuthorized: false,
  },
  sourcePreviewSha256,
  counts: {
    canonicalVehicles: vehicleCandidates.size,
    revisions: revisions.length,
    stagedRevisions: stateCounts.STAGED ?? 0,
    reviewRevisions: stateCounts.REVIEW ?? 0,
  },
  canonicalVehicles: [...vehicleCandidates.values()].sort((left, right) => left.key.localeCompare(right.key)),
  revisions: revisions.sort((left, right) => left.semanticFingerprint.localeCompare(right.semanticFingerprint)),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputPath, counts: artifact.counts, decisions: artifact.decisions }, null, 2)}\n`);
