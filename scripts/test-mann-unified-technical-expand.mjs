#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = await readFile(resolve(workspaceRoot, "prisma/schema.prisma"), "utf8");
const migration = await readFile(
  resolve(workspaceRoot, "prisma/migrations/20260902400000_mann_unified_technical_catalog_expand/migration.sql"),
  "utf8",
);

for (const model of [
  "MannVehicleVariant",
  "MannTechnicalMaterializationRun",
  "MannTechnicalAssociationRevision",
  "MannTechnicalReviewDecision",
]) {
  assert.match(schema, new RegExp(`model ${model} \\{`, "u"), `missing Prisma model ${model}`);
}
for (const table of [
  "mann_vehicle_variants",
  "mann_technical_materialization_runs",
  "mann_technical_association_revisions",
  "mann_technical_review_decisions",
]) {
  assert.match(migration, new RegExp(`CREATE TABLE "${table}"`, "u"), `missing migration table ${table}`);
}
assert.equal((migration.match(/CREATE TABLE/gu) || []).length, 4, "expand migration must create exactly four tables");
assert.doesNotMatch(
  migration,
  /^\s*(?:INSERT\b|UPDATE\b|DELETE\b|TRUNCATE\b|DROP\b)/imu,
  "expand migration must not mutate existing data",
);
assert.doesNotMatch(migration, /ALTER TABLE\s+"?(?:mann_filter_applications|vehicle_fluid_requirements|fluid_source_rows|mann_fluid_requirement_links)"?/iu);
assert.match(migration, /mann_tech_runs_materialized_approval_check/u);
assert.match(migration, /mann_tech_revision_active_eligibility_check/u);
assert.match(migration, /ON DELETE RESTRICT/gu);

const outputPath = resolve(tmpdir(), `mann-unified-technical-staging-plan-${process.pid}.json`);
execFileSync(
  process.execPath,
  [
    resolve(workspaceRoot, "scripts/build-mann-unified-technical-staging-plan.mjs"),
    `--output=${outputPath}`,
  ],
  { cwd: workspaceRoot, stdio: "pipe" },
);
const staging = JSON.parse(await readFile(outputPath, "utf8"));
assert.equal(staging.artifactKind, "MANN_UNIFIED_TECHNICAL_STAGING_PLAN");
assert.equal(staging.writeMode, "DRY_RUN_ONLY");
assert.equal(staging.requiredMigration, "20260902400000_mann_unified_technical_catalog_expand");
assert.equal(staging.decisions.schemaExpand, "READY_FOR_REVIEW_NOT_APPLIED");
assert.equal(staging.decisions.stagingImport, "READY_FOR_REVIEW_NOT_APPLIED");
assert.equal(staging.decisions.runtimeCutover, "NO_GO");
assert.equal(staging.decisions.productionApply, "NOT_AUTHORIZED");
assert.deepEqual(staging.counts, { canonicalVehicles: 4, stagedRevisions: 5, reviewDecisions: 0 });
assert.equal(staging.materializationRun.independentHumanSignoff, false);
assert.equal(staging.materializationRun.productionApplyAuthorized, false);
assert.ok(staging.revisions.every((revision) => revision.state === "STAGED"));
assert.ok(staging.revisions.every((revision) => revision.applyEligible === false));
assert.ok(staging.revisions.every((revision) => Object.keys(revision.technicalData).join(",") === "capacity"));
assert.ok(staging.revisions.every((revision) => !("specificationText" in revision.technicalData)));
assert.equal(new Set(staging.canonicalVehicles.map((vehicle) => vehicle.key)).size, 4);
assert.equal(new Set(staging.revisions.map((revision) => revision.semanticFingerprint)).size, 5);

const forbidden = spawnSync(
  process.execPath,
  [resolve(workspaceRoot, "scripts/build-mann-unified-technical-staging-plan.mjs"), "--apply"],
  { cwd: workspaceRoot, encoding: "utf8" },
);
assert.notEqual(forbidden.status, 0);
assert.match(`${forbidden.stdout}${forbidden.stderr}`, /database mutation is forbidden/u);

console.log("MANN unified technical expand and staging tests — passed");
