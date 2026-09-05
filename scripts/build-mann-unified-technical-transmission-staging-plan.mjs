#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenArguments = new Set(["--apply", "--write-db", "--materialize", "--production", "--activate"]);
for (const argument of process.argv.slice(2)) {
  if (forbiddenArguments.has(argument) || [...forbiddenArguments].some((prefix) => argument.startsWith(`${prefix}=`))) {
    throw new Error(`database mutation is forbidden by this staging-plan builder: ${argument}`);
  }
}

const readArgument = (name, fallback = null) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};

const decisionsPath = resolve(workspaceRoot, readArgument(
  "decisions",
  "outputs/mann-technical-catalog-v9-timeweb-backup-20260823-190344/mann-technical-requirement-decisions.ndjson",
));
const technicalPreviewPath = resolve(workspaceRoot, readArgument(
  "technical-preview",
  "outputs/mann-technical-catalog-v2-timeweb-backup-20260823-190344/mann-technical-materialization-preview.json",
));
const fullPlanPath = resolve(workspaceRoot, readArgument(
  "full-plan",
  "outputs/mann-unified-technical-full-staging-v1/mann-unified-technical-full-staging-plan-v1.json",
));
const outputPath = resolve(workspaceRoot, readArgument(
  "output",
  "outputs/mann-unified-technical-transmission-staging-v1/mann-unified-technical-transmission-staging-plan-v1.json",
));
const backupArgument = readArgument("backup");
const backupPath = backupArgument ? resolve(workspaceRoot, backupArgument) : null;

const [decisionsRaw, technicalPreviewRaw, fullPlanRaw] = await Promise.all([
  readFile(decisionsPath, "utf8"),
  readFile(technicalPreviewPath, "utf8"),
  readFile(fullPlanPath, "utf8"),
]);
const decisions = decisionsRaw.trim().split("\n").filter(Boolean).map(JSON.parse);
const technicalPreview = JSON.parse(technicalPreviewRaw);
const fullPlan = JSON.parse(fullPlanRaw);

assert.equal(technicalPreview.artifactKind, "MANN_TECHNICAL_MATERIALIZATION_DRY_RUN");
assert.equal(technicalPreview.writeMode, "DRY_RUN_ONLY");
assert.equal(technicalPreview.sourceSnapshot?.currentTimewebSnapshot, true);
assert.match(technicalPreview.sourceSnapshot?.backupSha256, /^[a-f0-9]{64}$/u);
assert.equal(fullPlan.artifactKind, "MANN_UNIFIED_TECHNICAL_FULL_STAGING_PLAN");

const TRANSMISSION_SYSTEMS = new Map([
  ["AUTOMATIC_TRANSMISSION", "automatic"],
  ["MANUAL_TRANSMISSION", "manual"],
  ["CVT_TRANSMISSION", "cvt"],
  ["ROBOT_TRANSMISSION", "robot"],
]);
const REVIEW_BLOCKER = "MANN variant не подтверждает тип или модель коробки";
const CONDITIONAL_POLICY = "USER_CONFIRMED_TRANSMISSION_V1";

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

function postgresCopyText(value) {
  if (value === "\\N") return null;
  return value.replace(/\\([bnrt\\])/gu, (_match, escaped) => ({ b: "\b", n: "\n", r: "\r", t: "\t", "\\": "\\" })[escaped]);
}

async function backupTechnicalRows(path, wantedIds) {
  const result = new Map();
  if (!path || !wantedIds.size) return result;
  const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  let columns = null;
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber += 1;
    if (!columns) {
      if (!line.startsWith("COPY public.vehicle_fluid_requirements (")) continue;
      columns = line.slice(line.indexOf("(") + 1, line.indexOf(") FROM stdin;")).split(", ");
      continue;
    }
    if (line === "\\.") break;
    const rawId = line.slice(0, line.indexOf("\t"));
    if (!wantedIds.has(rawId)) continue;
    const values = line.split("\t").map(postgresCopyText);
    assert.equal(values.length, columns.length, `invalid vehicle_fluid_requirements row at backup line ${lineNumber}`);
    const row = Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex]]));
    result.set(row.id, row);
    if (result.size === wantedIds.size) {
      lines.close();
      break;
    }
  }
  assert.ok(columns, "vehicle_fluid_requirements COPY section not found in backup");
  return result;
}

function jsonArray(value) {
  if (!value) return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

function technicalFromBackup(row, decision) {
  if (!row) return null;
  return {
    fillVolumeText: row.fill_volume_text,
    capacities: decision.capacity?.capacities ?? jsonArray(row.capacities_json),
    specificationText: row.specification_text,
    specifications: jsonArray(row.specifications_json),
    viscosityGrades: jsonArray(row.viscosity_grades_json),
    recommendationText: row.recommendation_text,
    replacementIntervalText: row.replacement_interval_text,
    replacementKmMin: row.replacement_km_min == null ? null : Number(row.replacement_km_min),
    replacementKmMax: row.replacement_km_max == null ? null : Number(row.replacement_km_max),
    replacementMonths: row.replacement_months == null ? null : Number(row.replacement_months),
    controlIntervalText: row.control_interval_text,
    analogText: row.analog_text,
  };
}

function isEligibleDecision(decision) {
  const requirement = decision.requirement ?? {};
  const candidate = decision.match?.topCandidates?.[0];
  const expectedTransmission = TRANSMISSION_SYSTEMS.get(requirement.systemCode);
  return Boolean(expectedTransmission)
    && requirement.transmissionType === expectedTransmission
    && decision.match?.status === "REVIEW_REQUIRED"
    && candidate?.confidence === "high"
    && candidate.score >= 80
    && candidate.variantIds?.length === 1
    && candidate.hardConflicts?.length === 0
    && candidate.reviewBlockers?.length === 1
    && candidate.reviewBlockers[0] === REVIEW_BLOCKER
    && candidate.matchedFields?.includes("точный код двигателя");
}

const eligibleDecisions = decisions.filter(isEligibleDecision);
assert.ok(eligibleDecisions.length > 0, "no conditional transmission decisions found");
const previewByRequirementAndVehicle = new Map(technicalPreview.proposedAssociations.map((association) => [
  `${association.requirementId}:${association.vehicleVariantKey}`,
  association,
]));
const requirementsMissingPreview = new Set(eligibleDecisions.flatMap((decision) => {
  const vehicleVariantKey = decision.match.topCandidates[0].variantIds[0];
  return previewByRequirementAndVehicle.has(`${decision.requirementId}:${vehicleVariantKey}`) ? [] : [decision.requirementId];
}));
const backupRows = await backupTechnicalRows(backupPath, requirementsMissingPreview);
const existingVehicles = new Map(fullPlan.canonicalVehicles.map((vehicle) => [vehicle.key, vehicle]));
const canonicalVehicles = new Map();
const missingTechnicalRequirements = [];

function canonicalVehicleFor(decision) {
  const candidate = decision.match.topCandidates[0];
  const key = candidate.variantIds[0];
  const existing = existingVehicles.get(key);
  if (existing) return existing;
  const payload = {
    key,
    make: candidate.make,
    makeNormalized: candidate.make.toLowerCase(),
    model: candidate.model,
    modelNormalized: candidate.model.toLowerCase(),
    generation: null,
    bodyCodes: [],
    modelYears: candidate.vehicleYears,
    yearFrom: null,
    yearTo: null,
    vehicleText: candidate.vehicleText,
    engineCode: candidate.engineCode,
    engineCodeNormalized: candidate.engineCode?.toUpperCase() || null,
    engineCodes: candidate.engineCode ? [candidate.engineCode.toUpperCase()] : [],
    engineVolumeCc: null,
    powerKw: null,
    powerHp: null,
    fuelType: null,
    driveType: null,
    transmissionType: null,
    conditionText: null,
    sourceHashes: technicalPreview.sourceSnapshot?.mannSnapshotSha256 ? [technicalPreview.sourceSnapshot.mannSnapshotSha256] : [],
  };
  return { ...payload, canonicalPayloadHash: sha256(payload), firstSeenAt: generatedAt, lastSeenAt: generatedAt };
}

function technicalPayload(decision, association) {
  if (association?.technical) {
    return {
      ...association.technical,
      capacities: decision.capacity?.capacities ?? association.technical.capacities ?? [],
    };
  }
  return technicalFromBackup(backupRows.get(decision.requirementId), decision);
}

function fieldConfidence(decision, technical) {
  const confidence = decision.fieldConfidence ?? {};
  const result = { _audit: confidence };
  if (technical.capacities?.length) {
    result["technical.capacity"] = decision.capacity?.needsReview
      ? "REQUIRES_REVIEW"
      : `SECONDARY_SOURCE_PARSED_${confidence.capacity?.level ?? "LOW"}`;
  }
  if (technical.specifications?.length) {
    result["technical.specifications"] = `SECONDARY_SOURCE_PARSED_${confidence.specification?.level ?? "MEDIUM"}`;
  }
  if (technical.viscosityGrades?.length) result["technical.viscosityGrades"] = "SECONDARY_SOURCE_PARSED_HIGH";
  if (technical.recommendationText) result["technical.recommendation"] = "SECONDARY_SOURCE_RAW";
  if (technical.replacementIntervalText) result["technical.replacementInterval"] = "SECONDARY_SOURCE_PARSED_MEDIUM";
  return result;
}

const prepared = [];
for (const decision of eligibleDecisions) {
  const candidate = decision.match.topCandidates[0];
  const vehicleVariantKey = candidate.variantIds[0];
  const association = previewByRequirementAndVehicle.get(`${decision.requirementId}:${vehicleVariantKey}`);
  const technical = technicalPayload(decision, association);
  if (!technical) {
    missingTechnicalRequirements.push(decision.requirementId);
    continue;
  }
  const vehicle = canonicalVehicleFor(decision);
  const existing = canonicalVehicles.get(vehicle.key);
  if (existing) assert.equal(existing.canonicalPayloadHash, vehicle.canonicalPayloadHash, `conflicting MANN vehicle payload: ${vehicle.key}`);
  else canonicalVehicles.set(vehicle.key, vehicle);
  prepared.push({ decision, association, technical, vehicleVariantKey });
}

assert.ok(prepared.length > 0, "no conditional transmission rows have technical data");
if (backupPath) assert.deepEqual(missingTechnicalRequirements, [], "backup must provide every eligible technical requirement");

const decisionsSha256 = sha256(decisionsRaw);
const technicalPreviewSha256 = sha256(technicalPreviewRaw);
const runSeed = {
  artifact: "mann-unified-technical-transmission-staging-v1",
  decisionsSha256,
  technicalPreviewSha256,
  backupSha256: technicalPreview.sourceSnapshot.backupSha256,
  conditionalPolicy: CONDITIONAL_POLICY,
};
const runId = `mtmr_${sha256(runSeed).slice(0, 24)}`;

const revisions = prepared.map(({ decision, association, technical, vehicleVariantKey }) => {
  const requirement = decision.requirement;
  const candidate = decision.match.topCandidates[0];
  const applicability = {
    yearFrom: requirement.years?.[0] ?? null,
    yearTo: requirement.years?.[1] ?? null,
    engineCodes: requirement.engineCode ? [requirement.engineCode.toUpperCase()] : [],
    transmissionType: requirement.transmissionType,
    driveType: requirement.driveType ?? null,
    componentModel: requirement.componentModel ?? null,
  };
  const independentValidation = {
    vehicleIdentityIndependentlyValidated: true,
    score: candidate.score,
    hardConflicts: candidate.hardConflicts,
    reviewBlockers: candidate.reviewBlockers,
    matchedFields: candidate.matchedFields,
    missingFields: candidate.missingFields,
  };
  const provenance = {
    ...(association?.provenance ?? decision.source),
    sourceArtifactKind: technicalPreview.artifactKind,
    technicalPreviewSha256,
    sourceDecisionFingerprint: decision.match.decisionFingerprint,
    matcherVersion: decision.match.matcherVersion,
    parserVersion: decision.capacity?.parserVersion ?? technicalPreview.algorithms.capacityParser,
    independentValidation,
    conditionalTransmissionPolicy: CONDITIONAL_POLICY,
    conditionalTransmissionChoiceRequired: true,
    conditionalTransmissionEligible: true,
    catalogPreviewEligible: false,
    planCommit,
  };
  const semanticFingerprint = sha256({
    catalogPreviewVersion: "mann-user-confirmed-transmission-preview-v1",
    vehicleVariantKey,
    sourceRequirementId: decision.requirementId,
    systemCode: requirement.systemCode,
    applicability,
    technical,
  });
  return {
    id: `mtar_${semanticFingerprint.slice(0, 24)}`,
    runId,
    vehicleVariantKey,
    sourceRequirementId: decision.requirementId,
    systemCode: requirement.systemCode,
    componentModel: requirement.componentModel,
    applicability,
    verifiedFields: [],
    technicalData: technical,
    fieldConfidence: fieldConfidence(decision, technical),
    evidence: [{ publisher: "podbormasla.ru", title: "Каталог технических жидкостей", url: decision.source.sourceUrl }],
    provenance,
    matchClass: "CONDITIONAL_TRANSMISSION",
    matchScore: candidate.score,
    semanticFingerprint,
    state: "REVIEW",
    verificationStatus: "UNVERIFIED",
    applyEligible: false,
    supersedesRevisionId: null,
  };
});

assert.equal(new Set(revisions.map((revision) => revision.id)).size, revisions.length);
assert.equal(new Set(revisions.map((revision) => revision.semanticFingerprint)).size, revisions.length);
assert.ok(revisions.every((revision) => revision.matchClass === "CONDITIONAL_TRANSMISSION"));
assert.ok(revisions.every((revision) => revision.state === "REVIEW" && !revision.applyEligible && revision.verificationStatus === "UNVERIFIED"));

const artifact = {
  schemaVersion: 1,
  artifactKind: "MANN_UNIFIED_TECHNICAL_TRANSMISSION_STAGING_PLAN",
  writeMode: "DRY_RUN_ONLY",
  generatedAt,
  requiredMigration: "20260902400000_mann_unified_technical_catalog_expand",
  decisions: {
    stagingImport: "OWNER_AUTHORIZED_USER_CONFIRMED_TRANSMISSION_PREVIEW_ONLY",
    activeMaterialization: "NO_GO",
    automaticProductSelection: "FORBIDDEN",
  },
  materializationRun: {
    id: runId,
    status: "PLANNED",
    mode: "STAGING",
    matcherVersion: decisionMatcherVersion(eligibleDecisions),
    capacityParserVersion: decisionParserVersion(eligibleDecisions),
    gitCommit: planCommit,
    verificationSetVersion: "mann-conditional-transmission-staging-v1",
    sourceSnapshot: technicalPreview.sourceSnapshot,
    sourceCounts: {
      eligibleTransmissionRequirements: eligibleDecisions.length,
      stagedConditionalAssociations: revisions.length,
      missingTechnicalRequirements: missingTechnicalRequirements.length,
    },
    gates: {
      conditionalTransmissionPolicy: CONDITIONAL_POLICY,
      explicitUserTransmissionChoiceRequired: true,
      vehicleIdentityIndependentlyValidated: true,
      hardConflictsExcluded: true,
      automaticProductSelection: false,
      independentHumanSignoff: false,
      productionApplyAuthorized: false,
    },
    approval: {},
    independentHumanSignoff: false,
    productionApplyAuthorized: false,
  },
  decisionsSha256,
  technicalPreviewSha256,
  counts: {
    eligibleTransmissionRequirements: eligibleDecisions.length,
    canonicalVehicles: canonicalVehicles.size,
    revisions: revisions.length,
    missingTechnicalRequirements: missingTechnicalRequirements.length,
  },
  missingTechnicalRequirements,
  canonicalVehicles: [...canonicalVehicles.values()].sort((left, right) => left.key.localeCompare(right.key)),
  revisions: revisions.sort((left, right) => left.semanticFingerprint.localeCompare(right.semanticFingerprint)),
};

function decisionMatcherVersion(source) {
  return [...new Set(source.map((decision) => decision.match.matcherVersion))].join("+");
}

function decisionParserVersion(source) {
  return [...new Set(source.map((decision) => decision.capacity?.parserVersion).filter(Boolean))].join("+");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputPath, counts: artifact.counts, decisions: artifact.decisions }, null, 2)}\n`);
