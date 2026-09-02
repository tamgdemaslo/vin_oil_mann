#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const { parseMannTechnicalPrimarySourceVerification } = await jiti.import(
  "../src/lib/mann-technical-primary-source-policy.ts",
);

const forbiddenArguments = new Set(["--apply", "--write-db", "--materialize", "--production"]);
for (const argument of process.argv.slice(2)) {
  if (forbiddenArguments.has(argument) || [...forbiddenArguments].some((prefix) => argument.startsWith(`${prefix}=`))) {
    throw new Error(`database mutation is forbidden by this preview builder: ${argument}`);
  }
}

const readArgument = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || fallback;
};

const inputDir = resolve(
  workspaceRoot,
  readArgument("input-dir", "outputs/mann-technical-catalog-v9-timeweb-backup-20260823-190344"),
);
const verificationPath = resolve(
  workspaceRoot,
  readArgument("verification", "data/mann-technical-primary-source-verification-v1.json"),
);
const outputPath = resolve(
  workspaceRoot,
  readArgument("output", `${inputDir}/mann-primary-source-verified-preview-v1.json`),
);
const inputPath = resolve(inputDir, "mann-technical-materialization-preview.json");

const [previewRaw, verificationRaw] = await Promise.all([
  readFile(inputPath, "utf8").then(JSON.parse),
  readFile(verificationPath, "utf8").then(JSON.parse),
]);
const verification = parseMannTechnicalPrimarySourceVerification(verificationRaw);

assert.equal(previewRaw.artifactKind, verification.sourcePreview.artifactKind, "source artifact kind drifted");
assert.equal(previewRaw.writeMode, verification.sourcePreview.writeMode, "source write mode drifted");
assert.equal(previewRaw.commit, verification.sourcePreview.commit, "source commit drifted");
assert.equal(previewRaw.algorithms?.matcher, verification.sourcePreview.matcher, "matcher version drifted");
assert.equal(
  previewRaw.algorithms?.capacityParser,
  verification.sourcePreview.capacityParser,
  "capacity parser version drifted",
);
assert.equal(
  previewRaw.sourceSnapshot?.backupSha256,
  verification.sourcePreview.backupSha256,
  "source backup snapshot drifted",
);
assert.equal(previewRaw.sourceSnapshot?.currentTimewebSnapshot, true, "source must be the audited Timeweb snapshot");
assert.equal(previewRaw.sourceSnapshot?.transactionReadOnly, true, "source snapshot must remain read-only");

const proposedAssociations = Array.isArray(previewRaw.proposedAssociations)
  ? previewRaw.proposedAssociations
  : [];
const proposedByFingerprint = new Map();
for (const association of proposedAssociations) {
  assert.equal(
    proposedByFingerprint.has(association.associationFingerprint),
    false,
    `duplicate source association fingerprint: ${association.associationFingerprint}`,
  );
  proposedByFingerprint.set(association.associationFingerprint, association);
}

const documentsById = new Map(verification.documents.map((document) => [document.id, document]));
const approximatelyEqual = (left, right) => Math.abs(Number(left) - Number(right)) < 1e-9;
const normalized = (value) => String(value || "").trim().toLowerCase();
const normalizedEngine = (value) => String(value || "").trim().toUpperCase();

const verifiedAssociations = verification.associations.map((verified) => {
  const source = proposedByFingerprint.get(verified.associationFingerprint);
  assert.ok(source, `verified association missing from source preview: ${verified.associationFingerprint}`);
  assert.equal(source.requirementId, verified.requirementId, "requirement id drifted");
  assert.equal(source.systemCode, verified.systemCode, "system code drifted");
  assert.equal(source.proposedState, "ACTIVE", "verified association is no longer ACTIVE");
  assert.equal(source.matchStatus, "CONFIRMED_SINGLE", "verified association is no longer a single confirmed match");
  assert.equal(source.independentValidation?.independentlyValidated, true, "independent vehicle validation failed");
  assert.deepEqual(source.independentValidation?.hardConflicts, [], "hard vehicle conflicts appeared");
  assert.deepEqual(source.independentValidation?.reviewBlockers, [], "vehicle review blockers appeared");
  assert.ok(
    source.independentValidation?.matchedFields?.includes("точный код двигателя"),
    "exact engine-code validation is required",
  );
  assert.equal(normalized(source.vehicleContext?.make), verified.vehicle.make, "vehicle make drifted");
  assert.equal(normalized(source.vehicleContext?.model), verified.vehicle.model, "vehicle model drifted");
  assert.equal(normalizedEngine(source.vehicleContext?.engineCode), verified.vehicle.engineCode, "engine code drifted");
  assert.ok(
    source.applicability?.engineCodes?.map(normalizedEngine).includes(verified.vehicle.engineCode),
    "verified engine is absent from source applicability",
  );
  assert.deepEqual(source.conflictTypes, [], "source association now has conflicts");

  const matchingCapacities = (source.technical?.capacities || []).filter((capacity) => (
    capacity.confidence === "HIGH"
    && approximatelyEqual(capacity.nominalLiters, verified.capacity.nominalLiters)
    && approximatelyEqual(capacity.toleranceLiters ?? 0, verified.capacity.toleranceLiters)
  ));
  assert.ok(matchingCapacities.length > 0, "primary-source capacity no longer matches parsed source capacity");

  const document = documentsById.get(verified.evidence.documentId);
  assert.ok(document, `primary-source document is missing: ${verified.evidence.documentId}`);

  return {
    associationFingerprint: source.associationFingerprint,
    requirementId: source.requirementId,
    vehicleVariantKey: source.vehicleVariantKey,
    sourceState: source.proposedState,
    sourceMatchScore: source.matchScore,
    verifiedIdentity: {
      make: verified.vehicle.make,
      model: verified.vehicle.model,
      engineCode: verified.vehicle.engineCode,
    },
    systemCode: verified.systemCode,
    verifiedTechnical: {
      capacity: {
        nominalLiters: verified.capacity.nominalLiters,
        toleranceLiters: verified.capacity.toleranceLiters,
        serviceContext: verified.capacity.serviceContext,
      },
    },
    primarySourceEvidence: {
      publisher: document.publisher,
      title: document.title,
      officialIndexUrl: document.officialIndexUrl,
      url: document.url,
      sha256: document.sha256,
      pdfPage: verified.evidence.pdfPage,
      printedPage: verified.evidence.printedPage,
      summary: verified.evidence.summary,
    },
    excludedUnverifiedSourceFields: [
      "technical.specificationText",
      "technical.specifications",
      "technical.viscosityGrades",
      "technical.recommendationText",
      "technical.replacementIntervalText",
      "technical.replacementKmMin",
      "technical.replacementKmMax",
      "technical.replacementMonths",
      "technical.controlIntervalText",
      "technical.analogText",
    ],
  };
});

assert.equal(
  new Set(verifiedAssociations.map((association) => association.associationFingerprint)).size,
  verifiedAssociations.length,
  "verified subset fingerprints must be unique",
);
assert.equal(
  new Set(verifiedAssociations.map((association) => association.requirementId)).size,
  verifiedAssociations.length,
  "verified subset requirement ids must be unique",
);

const countBySystem = Object.fromEntries(
  [...new Set(verifiedAssociations.map((association) => association.systemCode))]
    .sort()
    .map((systemCode) => [
      systemCode,
      verifiedAssociations.filter((association) => association.systemCode === systemCode).length,
    ]),
);

const artifact = {
  schemaVersion: 1,
  artifactKind: "MANN_PRIMARY_SOURCE_VERIFIED_SUBSET_PREVIEW",
  writeMode: "DRY_RUN_ONLY",
  generatedAt: new Date().toISOString(),
  sourcePreview: {
    path: inputPath,
    commit: previewRaw.commit,
    algorithms: previewRaw.algorithms,
    sourceSnapshot: previewRaw.sourceSnapshot,
  },
  verification: {
    version: verification.version,
    path: verificationPath,
    reviewerType: verification.reviewerType,
    verificationScope: verification.verificationScope,
    independentHumanSignoff: false,
    productionApplyAuthorized: false,
  },
  decisions: {
    fullCatalog: "NO_GO",
    verifiedSubset: "GO_FOR_SCHEMA_AND_STAGING_DESIGN",
    productionApply: "NOT_AUTHORIZED",
  },
  counts: {
    verifiedAssociations: verifiedAssociations.length,
    sourceProposedAssociations: proposedAssociations.length,
    excludedFromVerifiedSubset: proposedAssociations.length - verifiedAssociations.length,
    bySystem: countBySystem,
  },
  associations: verifiedAssociations,
};

await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ outputPath, ...artifact.counts, decisions: artifact.decisions }, null, 2)}\n`);
