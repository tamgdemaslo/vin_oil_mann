import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = await mkdtemp(resolve(tmpdir(), "mann-full-staging-"));
const planBuilder = resolve(workspaceRoot, "scripts/build-mann-unified-technical-full-staging-plan.mjs");
const sqlBuilder = resolve(workspaceRoot, "scripts/build-mann-unified-technical-full-staging-sql.mjs");
const previewPath = resolve(fixtureDir, "mann-technical-materialization-preview.json");
const decisionsPath = resolve(fixtureDir, "mann-technical-requirement-decisions.ndjson");
const verifiedPlanPath = resolve(fixtureDir, "verified-plan.json");
const planPath = resolve(fixtureDir, "plan.json");
const sqlPath = resolve(fixtureDir, "apply.sql");

const sha = "a".repeat(64);
const commit = "b".repeat(40);
const association = (index, proposedState) => ({
  associationFingerprint: String(index).repeat(64),
  vehicleVariantKey: String(index + 2).repeat(64),
  requirementId: String(index + 4).repeat(64),
  sourceRequirementIds: [String(index + 4).repeat(64)],
  sourceRowIds: [String(index + 6).repeat(64)],
  systemCode: index === 1 ? "ENGINE_OIL" : "ENGINE_COOLANT",
  componentModel: null,
  applicability: { engineCodes: [`ENGINE${index}`] },
  proposedState,
  matchStatus: index === 1 ? "CONFIRMED_SINGLE" : "CONFIRMED_MULTI_APPLICABILITY",
  matchScore: 90,
  independentValidation: {
    independentlyValidated: true,
    condition: null,
    hardConflicts: [],
    reviewBlockers: [],
  },
  technical: {
    fillVolumeText: "4.5 л",
    capacities: [{ nominalLiters: 4.5, minLiters: 4.5, maxLiters: 4.5, confidence: proposedState === "REVIEW" ? "LOW" : "HIGH", serviceContext: "WITH_FILTER" }],
    specifications: [{ type: "ACEA", value: "ACEA C3" }],
    viscosityGrades: ["5W-30"],
    replacementIntervalText: "10 тыс. км",
  },
  fieldConfidence: {
    vehicleApplicability: { level: "HIGH", evidence: ["fixture"] },
    capacity: { level: proposedState === "REVIEW" ? "LOW" : "HIGH", evidence: ["fixture"] },
    specification: { level: "HIGH", evidence: ["fixture"] },
  },
  provenance: {
    sourceName: "fixture.example",
    sourceUrl: `https://fixture.example/${index}`,
    mannSourceHashes: [sha],
  },
  conflictTypes: proposedState === "REVIEW" ? ["CAPACITY_PARSER_REVIEW_REQUIRED"] : [],
});

const associations = [association(1, "ACTIVE"), association(2, "REVIEW")];
const sourcePreview = {
  artifactKind: "MANN_TECHNICAL_MATERIALIZATION_DRY_RUN",
  writeMode: "DRY_RUN_ONLY",
  commit,
  algorithms: { matcher: "matcher-test", capacityParser: "parser-test" },
  sourceSnapshot: { currentTimewebSnapshot: true, backupSha256: sha },
  proposedAssociations: associations,
};
const decisions = associations.map((item, index) => ({
  requirementId: item.requirementId,
  match: {
    topCandidates: [{
      variantIds: [item.vehicleVariantKey],
      make: `MAKE ${index}`,
      model: `MODEL ${index}`,
      vehicleText: "2.0",
      engineCode: `ENGINE${index}`,
      vehicleYears: "01/20 ->",
    }],
  },
}));

await Promise.all([
  writeFile(previewPath, `${JSON.stringify(sourcePreview)}\n`),
  writeFile(decisionsPath, `${decisions.map(JSON.stringify).join("\n")}\n`),
  writeFile(verifiedPlanPath, `${JSON.stringify({ artifactKind: "MANN_UNIFIED_TECHNICAL_STAGING_PLAN", canonicalVehicles: [] })}\n`),
]);

execFileSync(process.execPath, [
  planBuilder,
  `--source-dir=${fixtureDir}`,
  `--verified-plan=${verifiedPlanPath}`,
  `--output=${planPath}`,
], { cwd: workspaceRoot, stdio: "pipe" });

const plan = JSON.parse(await readFile(planPath, "utf8"));
assert.equal(plan.artifactKind, "MANN_UNIFIED_TECHNICAL_FULL_STAGING_PLAN");
assert.deepEqual(plan.counts, { canonicalVehicles: 2, revisions: 2, stagedRevisions: 1, reviewRevisions: 1 });
assert.ok(plan.revisions.every((revision) => revision.verificationStatus === "UNVERIFIED" && !revision.applyEligible));
assert.equal(plan.revisions.find((revision) => revision.state === "STAGED").fieldConfidence["technical.capacity"], "SECONDARY_SOURCE_PARSED_HIGH");
assert.equal(plan.revisions.find((revision) => revision.state === "REVIEW").fieldConfidence["technical.capacity"], "REQUIRES_REVIEW");

execFileSync(process.execPath, [
  sqlBuilder,
  `--plan=${planPath}`,
  `--output=${sqlPath}`,
  "--authorization-ref=test-owner-full-staging-only",
], { cwd: workspaceRoot, stdio: "pipe" });

const sql = await readFile(sqlPath, "utf8");
assert.match(sql, /^BEGIN;/mu);
assert.match(sql, /FULL_CATALOG_STAGING_PREVIEW_ONLY/u);
assert.match(sql, /MANN_V9_CONSERVATIVE_MATCHER/u);
assert.match(sql, /'STAGED'/u);
assert.match(sql, /'REVIEW'/u);
assert.match(sql, /'UNVERIFIED'/u);
assert.match(sql, /legacy table counts changed during full staging import/u);
assert.match(sql, /COMMIT;/u);
assert.doesNotMatch(sql, /SET\s+state\s*=\s*'ACTIVE'/iu);
assert.doesNotMatch(sql, /\b(?:DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE)\b/iu);

const forbidden = spawnSync(process.execPath, [
  sqlBuilder,
  `--plan=${planPath}`,
  `--output=${sqlPath}`,
  "--authorization-ref=test",
  "--activate",
], { cwd: workspaceRoot, encoding: "utf8" });
assert.notEqual(forbidden.status, 0);
assert.match(`${forbidden.stdout}${forbidden.stderr}`, /production activation is forbidden/u);

console.log("MANN unified technical full staging tests — passed");
