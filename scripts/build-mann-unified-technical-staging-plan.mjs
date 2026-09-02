#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const forbiddenArguments = new Set(["--apply", "--write-db", "--materialize", "--production"]);
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
const verifiedPreviewPath = resolve(
  workspaceRoot,
  readArgument("verified-preview", `${sourceDir}/mann-primary-source-verified-preview-v1.json`),
);
const sourcePreviewPath = resolve(sourceDir, "mann-technical-materialization-preview.json");
const outputPath = resolve(
  workspaceRoot,
  readArgument("output", "outputs/mann-unified-technical-staging-v1/mann-unified-technical-staging-plan-v1.json"),
);

const [verifiedPreview, sourcePreview] = await Promise.all([
  readFile(verifiedPreviewPath, "utf8").then(JSON.parse),
  readFile(sourcePreviewPath, "utf8").then(JSON.parse),
]);

assert.equal(verifiedPreview.artifactKind, "MANN_PRIMARY_SOURCE_VERIFIED_SUBSET_PREVIEW");
assert.equal(verifiedPreview.writeMode, "DRY_RUN_ONLY");
assert.equal(verifiedPreview.decisions?.fullCatalog, "NO_GO");
assert.equal(verifiedPreview.decisions?.verifiedSubset, "GO_FOR_SCHEMA_AND_STAGING_DESIGN");
assert.equal(verifiedPreview.decisions?.productionApply, "NOT_AUTHORIZED");
assert.equal(verifiedPreview.verification?.independentHumanSignoff, false);
assert.equal(verifiedPreview.verification?.productionApplyAuthorized, false);
assert.equal(sourcePreview.artifactKind, "MANN_TECHNICAL_MATERIALIZATION_DRY_RUN");
assert.equal(sourcePreview.writeMode, "DRY_RUN_ONLY");
assert.equal(sourcePreview.commit, verifiedPreview.sourcePreview?.commit);
assert.deepEqual(sourcePreview.algorithms, verifiedPreview.sourcePreview?.algorithms);
assert.equal(sourcePreview.sourceSnapshot?.backupSha256, verifiedPreview.sourcePreview?.sourceSnapshot?.backupSha256);

const sourceByFingerprint = new Map(
  sourcePreview.proposedAssociations.map((association) => [association.associationFingerprint, association]),
);
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
};
const stableJson = (value) => JSON.stringify(stableValue(value));
const sha256 = (value) => createHash("sha256").update(stableJson(value)).digest("hex");
const generatedAt = new Date().toISOString();
const planCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).trim();
assert.match(planCommit, /^[a-f0-9]{40}$/u);

const vehicleCandidates = new Map();
for (const verified of verifiedPreview.associations) {
  const source = sourceByFingerprint.get(verified.associationFingerprint);
  assert.ok(source, `source association not found: ${verified.associationFingerprint}`);
  assert.equal(source.vehicleVariantKey, verified.vehicleVariantKey);
  assert.equal(source.requirementId, verified.requirementId);
  assert.equal(source.systemCode, verified.systemCode);
  assert.equal(source.proposedState, "ACTIVE");

  const payload = {
    key: source.vehicleVariantKey,
    make: source.vehicleContext.make,
    makeNormalized: source.vehicleContext.make.toLowerCase(),
    model: source.vehicleContext.model,
    modelNormalized: source.vehicleContext.model.toLowerCase(),
    generation: source.vehicleContext.generation,
    bodyCodes: source.vehicleContext.bodyCodes,
    modelYears: null,
    yearFrom: source.vehicleContext.yearFrom,
    yearTo: source.vehicleContext.yearTo,
    vehicleText: null,
    engineCode: source.vehicleContext.engineCode,
    engineCodeNormalized: source.vehicleContext.engineCode?.toUpperCase() || null,
    engineCodes: source.vehicleContext.engineCodes,
    engineVolumeCc: source.vehicleContext.engineVolumeCc,
    powerKw: source.vehicleContext.powerKw,
    powerHp: source.vehicleContext.powerHp,
    fuelType: source.vehicleContext.fuelType,
    driveType: source.vehicleContext.driveType,
    transmissionType: source.vehicleContext.transmissionType,
    conditionText: source.independentValidation.condition,
    sourceHashes: source.provenance.mannSourceHashes,
  };
  const canonicalPayloadHash = sha256(payload);
  const existing = vehicleCandidates.get(payload.key);
  if (existing) {
    assert.equal(existing.canonicalPayloadHash, canonicalPayloadHash, `conflicting canonical vehicle payload: ${payload.key}`);
  } else {
    vehicleCandidates.set(payload.key, {
      ...payload,
      canonicalPayloadHash,
      firstSeenAt: generatedAt,
      lastSeenAt: generatedAt,
    });
  }
}

const runSeed = {
  verificationSetVersion: verifiedPreview.verification.version,
  sourceCommit: sourcePreview.commit,
  matcherVersion: sourcePreview.algorithms.matcher,
  capacityParserVersion: sourcePreview.algorithms.capacityParser,
  backupSha256: sourcePreview.sourceSnapshot.backupSha256,
};
const runId = `mtmr_${sha256(runSeed).slice(0, 24)}`;

const revisions = verifiedPreview.associations.map((verified) => {
  const source = sourceByFingerprint.get(verified.associationFingerprint);
  const applicability = { engineCodes: [verified.verifiedIdentity.engineCode] };
  const verifiedFields = verifiedPreview.verification.verificationScope;
  const technicalData = verified.verifiedTechnical;
  const semanticFingerprint = sha256({
    vehicleVariantKey: verified.vehicleVariantKey,
    sourceRequirementId: verified.requirementId,
    systemCode: verified.systemCode,
    applicability,
    verifiedFields,
    technicalData,
  });

  return {
    id: `mtar_${semanticFingerprint.slice(0, 24)}`,
    runId,
    vehicleVariantKey: verified.vehicleVariantKey,
    sourceRequirementId: verified.requirementId,
    systemCode: verified.systemCode,
    componentModel: null,
    applicability,
    verifiedFields,
    technicalData,
    fieldConfidence: Object.fromEntries(verifiedFields.map((field) => [field, "PRIMARY_SOURCE_VERIFIED"])),
    evidence: [verified.primarySourceEvidence],
    provenance: {
      sourceAssociationFingerprint: verified.associationFingerprint,
      sourceDecisionFingerprint: source.provenance.decisionFingerprint,
      sourceRowIds: source.sourceRowIds,
      sourcePageHash: source.provenance.sourcePageHash,
      sourceBatchHash: source.provenance.sourceBatchHash,
      mannSourceHashes: source.provenance.mannSourceHashes,
      sourcePreviewCommit: sourcePreview.commit,
      planCommit,
      matcherVersion: sourcePreview.algorithms.matcher,
      capacityParserVersion: sourcePreview.algorithms.capacityParser,
      verificationSetVersion: verifiedPreview.verification.version,
      backupSha256: sourcePreview.sourceSnapshot.backupSha256,
    },
    matchClass: "PRIMARY_SOURCE_VERIFIED_SUBSET",
    matchScore: source.matchScore,
    semanticFingerprint,
    state: "STAGED",
    verificationStatus: "PRIMARY_SOURCE_VERIFIED_FIELDS",
    applyEligible: false,
    supersedesRevisionId: null,
  };
});

assert.equal(new Set(revisions.map((revision) => revision.id)).size, revisions.length);
assert.equal(new Set(revisions.map((revision) => revision.semanticFingerprint)).size, revisions.length);
assert.ok(revisions.every((revision) => revision.state === "STAGED" && revision.applyEligible === false));

const artifact = {
  schemaVersion: 1,
  artifactKind: "MANN_UNIFIED_TECHNICAL_STAGING_PLAN",
  writeMode: "DRY_RUN_ONLY",
  generatedAt,
  requiredMigration: "20260902400000_mann_unified_technical_catalog_expand",
  decisions: {
    schemaExpand: "READY_FOR_REVIEW_NOT_APPLIED",
    stagingImport: "READY_FOR_REVIEW_NOT_APPLIED",
    runtimeCutover: "NO_GO",
    productionApply: "NOT_AUTHORIZED",
  },
  materializationRun: {
    id: runId,
    status: "PLANNED",
    mode: "STAGING",
    matcherVersion: sourcePreview.algorithms.matcher,
    capacityParserVersion: sourcePreview.algorithms.capacityParser,
    gitCommit: planCommit,
    verificationSetVersion: verifiedPreview.verification.version,
    sourceSnapshot: sourcePreview.sourceSnapshot,
    sourceCounts: {
      sourceProposedAssociations: sourcePreview.proposedAssociations.length,
      stagedAssociations: revisions.length,
    },
    gates: {
      fullCatalog: "NO_GO",
      fieldLevelPrimarySourceVerification: "PASS",
      independentHumanSignoff: false,
      productionApplyAuthorized: false,
    },
    approval: {},
    independentHumanSignoff: false,
    productionApplyAuthorized: false,
  },
  counts: {
    canonicalVehicles: vehicleCandidates.size,
    stagedRevisions: revisions.length,
    reviewDecisions: 0,
  },
  canonicalVehicles: [...vehicleCandidates.values()].sort((left, right) => left.key.localeCompare(right.key)),
  revisions: revisions.sort((left, right) => left.semanticFingerprint.localeCompare(right.semanticFingerprint)),
  reviewDecisions: [],
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputPath, counts: artifact.counts, decisions: artifact.decisions }, null, 2)}\n`);
