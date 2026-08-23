#!/usr/bin/env node

import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

const outputArgument = process.argv.find((argument) => argument.startsWith("--output-dir="));
const outputDir = resolve(outputArgument?.slice("--output-dir=".length) || "outputs/mann-technical-catalog-v2-frozen-2026-08-23");
const expectCurrentTimeweb = process.argv.includes("--expect-current-timeweb");
const readJson = async (name) => JSON.parse(await readFile(resolve(outputDir, name), "utf8"));

const [summary, preview, activeSample, dangerousReview, capacityAudit] = await Promise.all([
  readJson("mann-technical-materialization-summary.json"),
  readJson("mann-technical-materialization-preview.json"),
  readJson("active-association-sample-200.json"),
  readJson("dangerous-systems-review.json"),
  readJson("capacity-parser-audit.json"),
]);
const golden = JSON.parse(await readFile(resolve("benchmarks/fluid-capacity-golden-v2.json"), "utf8"));

let decisionTraceLines = 0;
for await (const line of createInterface({ input: createReadStream(resolve(outputDir, "mann-technical-requirement-decisions.ndjson")) })) {
  if (typeof line === "string") decisionTraceLines += 1;
}

const classificationTotal = Object.values(summary.classification).reduce((total, count) => total + count, 0);
const activeAssociations = preview.proposedAssociations.filter((association) => association.proposedState === "ACTIVE");
const reviewAssociations = preview.proposedAssociations.filter((association) => association.proposedState === "REVIEW");
const activeFingerprints = new Set(activeAssociations.map((association) => association.associationFingerprint));
const dangerousFamilies = new Set(["ENGINE", "TRANSMISSION", "DRIVETRAIN"]);

const checks = {
  requirementCountMatchesClassification: classificationTotal === summary.scope.requirements,
  decisionTraceComplete: decisionTraceLines === summary.scope.requirements,
  semanticFingerprintsUnique: new Set(preview.proposedAssociations.map((association) => association.associationFingerprint)).size === preview.proposedAssociations.length,
  activeCountMatchesSummary: activeAssociations.length === summary.materialization.activeAssociations,
  reviewCountMatchesSummary: reviewAssociations.length === summary.materialization.reviewAssociations,
  allActiveTargetsIndependentlyValidated: activeAssociations.every((association) => (
    association.independentValidation.independentlyValidated === true
    && association.independentValidation.hardConflicts.length === 0
    && association.independentValidation.reviewBlockers.length === 0
  )),
  noParserReviewAssociationActive: activeAssociations.every((association) => !association.conflictTypes.includes("CAPACITY_PARSER_REVIEW_REQUIRED")),
  activeSampleHas200DistinctActiveRows: activeSample.sample.length === 200
    && new Set(activeSample.sample.map((association) => association.associationFingerprint)).size === 200
    && activeSample.sample.every((association) => activeFingerprints.has(association.associationFingerprint) && association.proposedState === "ACTIVE"),
  dangerousSampleHas200ActiveRows: dangerousReview.sample.length === 200
    && dangerousReview.sample.every((association) => activeFingerprints.has(association.associationFingerprint) && (
      dangerousFamilies.has(association.systemFamily)
      || ["BRAKE_FLUID", "CLUTCH_FLUID", "ENGINE_COOLANT", "INVERTER_COOLANT", "POWER_STEERING"].includes(association.systemCode)
    )),
  horsepowerNeverParsedAsLiters: capacityAudit.safetyAssertions.noHorsepowerParsedAsLiters === true
    && capacityAudit.counts.horsepowerTokensParsedAsCapacity === 0,
  realGoldenSetHas200DistinctCases: golden.cases.length === 200 && new Set(golden.cases.map((item) => item.text)).size === 200,
  databaseWriteModeForbidden: preview.writeMode === "DRY_RUN_ONLY" && preview.sourceSnapshot.transactionReadOnly === true,
  timewebSnapshotExpectationSatisfied: expectCurrentTimeweb
    ? preview.sourceSnapshot.currentTimewebSnapshot === true
      && summary.gates.currentTimewebSnapshotAudited === true
      && /^[a-f0-9]{64}$/u.test(preview.sourceSnapshot.backupSha256)
    : preview.sourceSnapshot.currentTimewebSnapshot === false
      && summary.gates.currentTimewebSnapshotAudited === false,
  noGoGatesPreserved: summary.gates.decision === "NO_GO"
    && summary.gates.goldenOrManualMatcherSetAvailable === false
    && summary.gates.activeSampleManuallyReviewed === false
    && summary.gates.dangerousSystemsManuallyReviewed === false
    && summary.gates.blockingReasons.length > 0,
};

for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, name);

const report = {
  verifiedAt: new Date().toISOString(),
  outputDir,
  algorithms: summary.algorithms,
  counts: {
    requirements: summary.scope.requirements,
    decisionTraceLines,
    proposedAssociations: preview.proposedAssociations.length,
    activeAssociations: activeAssociations.length,
    reviewAssociations: reviewAssociations.length,
    activeSample: activeSample.sample.length,
    dangerousSample: dangerousReview.sample.length,
    goldenCases: golden.cases.length,
  },
  checks,
  result: "PASS_WITH_NO_GO_GATES_PRESERVED",
};
await writeFile(resolve(outputDir, "preview-invariant-check.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
