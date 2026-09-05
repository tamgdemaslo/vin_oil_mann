import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = await mkdtemp(resolve(tmpdir(), "mann-transmission-staging-"));
const planBuilder = resolve(workspaceRoot, "scripts/build-mann-unified-technical-transmission-staging-plan.mjs");
const sqlBuilder = resolve(workspaceRoot, "scripts/build-mann-unified-technical-transmission-staging-sql.mjs");
const decisionsPath = resolve(fixtureDir, "decisions.ndjson");
const technicalPreviewPath = resolve(fixtureDir, "preview.json");
const fullPlanPath = resolve(fixtureDir, "full-plan.json");
const planPath = resolve(fixtureDir, "plan.json");
const sqlPath = resolve(fixtureDir, "apply.sql");

const sha = "a".repeat(64);
const variantKey = "b".repeat(64);
const requirementId = "c".repeat(64);
const sourceRowId = "d".repeat(64);
const decision = {
  requirementId,
  source: { sourceRowId, sourceUrl: "https://fixture.example/vehicle", sourcePageHash: sha, sourceBatchHash: sha },
  requirement: {
    make: "hyundai",
    model: "solaris",
    generation: "II",
    years: [2017, 2022],
    engineCode: "G4LC",
    engineVolumeCc: 1400,
    powerHp: 100,
    fuelType: "gasoline",
    driveType: null,
    transmissionType: "automatic",
    componentModel: null,
    systemCode: "AUTOMATIC_TRANSMISSION",
  },
  match: {
    matcherVersion: "mann-fluid-matcher-v9",
    status: "REVIEW_REQUIRED",
    decisionFingerprint: sha,
    topCandidates: [{
      variantIds: [variantKey],
      make: "HYUNDAI",
      model: "Solaris II/Accent(HC)",
      vehicleText: "1.4",
      engineCode: "G4LC",
      vehicleYears: "02/17 ->",
      score: 92,
      confidence: "high",
      hardConflicts: [],
      reviewBlockers: ["MANN variant не подтверждает тип или модель коробки"],
      matchedFields: ["марка", "точный код двигателя"],
      missingFields: ["топливо MANN"],
    }],
  },
  capacity: {
    parserVersion: "capacity-parser-v5",
    needsReview: false,
    capacities: [{ nominalLiters: 6.7, minLiters: 6.7, maxLiters: 6.7, confidence: "HIGH", serviceContext: "UNKNOWN" }],
  },
  fieldConfidence: { capacity: { level: "HIGH" }, specification: { level: "HIGH" } },
};
const association = {
  vehicleVariantKey: variantKey,
  requirementId,
  technical: {
    fillVolumeText: "6.7 л.",
    capacities: decision.capacity.capacities,
    specifications: [{ type: "OEM", value: "HYUNDAI ATF SP-IV" }],
    viscosityGrades: [],
    replacementIntervalText: "100 тыс. км или 6 лет",
  },
  provenance: { sourceName: "fixture.example", sourceUrl: "https://fixture.example/vehicle", mannSourceHashes: [sha] },
};

await Promise.all([
  writeFile(decisionsPath, `${JSON.stringify(decision)}\n`),
  writeFile(technicalPreviewPath, `${JSON.stringify({
    artifactKind: "MANN_TECHNICAL_MATERIALIZATION_DRY_RUN",
    writeMode: "DRY_RUN_ONLY",
    algorithms: { matcher: "matcher-v2", capacityParser: "parser-v2" },
    sourceSnapshot: { currentTimewebSnapshot: true, backupSha256: sha },
    proposedAssociations: [association],
  })}\n`),
  writeFile(fullPlanPath, `${JSON.stringify({ artifactKind: "MANN_UNIFIED_TECHNICAL_FULL_STAGING_PLAN", canonicalVehicles: [] })}\n`),
]);

const planResult = spawnSync(process.execPath, [
  planBuilder,
  `--decisions=${decisionsPath}`,
  `--technical-preview=${technicalPreviewPath}`,
  `--full-plan=${fullPlanPath}`,
  `--output=${planPath}`,
], { cwd: workspaceRoot, encoding: "utf8" });
assert.equal(planResult.status, 0, `${planResult.stdout}${planResult.stderr}`);

const plan = JSON.parse(await readFile(planPath, "utf8"));
assert.equal(plan.artifactKind, "MANN_UNIFIED_TECHNICAL_TRANSMISSION_STAGING_PLAN");
assert.deepEqual(plan.counts, { eligibleTransmissionRequirements: 1, canonicalVehicles: 1, revisions: 1, missingTechnicalRequirements: 0 });
assert.equal(plan.revisions[0].matchClass, "CONDITIONAL_TRANSMISSION");
assert.equal(plan.revisions[0].state, "REVIEW");
assert.equal(plan.revisions[0].applyEligible, false);
assert.equal(plan.revisions[0].applicability.transmissionType, "automatic");
assert.equal(plan.revisions[0].technicalData.capacities[0].nominalLiters, 6.7);
assert.equal(plan.revisions[0].fieldConfidence["technical.capacity"], "SECONDARY_SOURCE_PARSED_HIGH");

const sqlResult = spawnSync(process.execPath, [
  sqlBuilder,
  `--plan=${planPath}`,
  `--output=${sqlPath}`,
  "--authorization-ref=test-owner-user-confirmed-transmission-staging",
], { cwd: workspaceRoot, encoding: "utf8" });
assert.equal(sqlResult.status, 0, `${sqlResult.stdout}${sqlResult.stderr}`);

const sql = await readFile(sqlPath, "utf8");
assert.match(sql, /^BEGIN;/mu);
assert.match(sql, /USER_CONFIRMED_TRANSMISSION_STAGING_PREVIEW_ONLY/u);
assert.match(sql, /USER_CONFIRMED_TRANSMISSION_V1/u);
assert.match(sql, /'CONDITIONAL_TRANSMISSION'/u);
assert.match(sql, /'REVIEW'/u);
assert.match(sql, /'UNVERIFIED'/u);
assert.match(sql, /legacy table counts changed during conditional transmission staging import/u);
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

console.log("MANN unified technical conditional transmission staging tests — passed");
