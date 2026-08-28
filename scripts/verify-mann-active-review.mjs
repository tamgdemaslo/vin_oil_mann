#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

const outputDir = path.resolve(argument(
  "output-dir",
  "outputs/mann-technical-catalog-v6-timeweb-backup-20260823-190344",
));
const packagePath = path.resolve(argument("package", path.join(outputDir, "mann-active-review-package.json")));
const reviewPath = path.resolve(argument("review", path.join(outputDir, "mann-active-codex-review.json")));
const outputPath = path.resolve(argument("output", path.join(outputDir, "mann-active-codex-review-check.json")));

const [reviewPackage, review] = await Promise.all([
  readFile(packagePath, "utf8").then(JSON.parse),
  readFile(reviewPath, "utf8").then(JSON.parse),
]);
const packageFingerprints = new Set(reviewPackage.associations.map((item) => item.associationFingerprint));
const reviewFingerprints = new Set(review.decisions.map((item) => item.associationFingerprint));
const activeSample = review.decisions.filter((item) => item.samples.includes("ACTIVE_200"));
const dangerousSample = review.decisions.filter((item) => item.samples.includes("DANGEROUS_200"));

const checks = {
  oneDecisionPerUniqueAssociation: review.decisions.length === reviewPackage.counts.uniqueAssociations
    && reviewFingerprints.size === review.decisions.length,
  decisionSetMatchesPackage: packageFingerprints.size === reviewFingerprints.size
    && [...packageFingerprints].every((fingerprint) => reviewFingerprints.has(fingerprint)),
  activeSampleCovered: activeSample.length === reviewPackage.counts.activeSample,
  dangerousSampleCovered: dangerousSample.length === reviewPackage.counts.dangerousSample,
  verdictsValid: review.decisions.every((item) => ["APPROVE", "REVIEW", "REJECT"].includes(item.verdict)),
  criticalFlagsNeverApproved: review.gates.criticalFlagsNeverApproved === true,
  scopeExplicit: review.decisions.every((item) => item.reviewScope === "VEHICLE_APPLICABILITY_AND_PARSER_SAFETY"),
  humanSignoffNotClaimed: review.reviewer.independentHuman === false
    && review.gates.independentHumanSignoff === false
    && review.gates.migrationDecision === "NO_GO",
};
for (const [name, passed] of Object.entries(checks)) assert.equal(passed, true, name);

const report = {
  verifiedAt: new Date().toISOString(),
  packagePath,
  reviewPath,
  counts: {
    uniqueAssociations: review.decisions.length,
    activeSample: activeSample.length,
    dangerousSample: dangerousSample.length,
    byVerdict: review.counts.byVerdict,
  },
  checks,
  result: "PASS_CODEX_REVIEW_HUMAN_SIGNOFF_STILL_REQUIRED",
};
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
