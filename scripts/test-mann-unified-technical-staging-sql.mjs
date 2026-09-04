#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builder = resolve(workspaceRoot, "scripts/build-mann-unified-technical-staging-sql.mjs");
const outputPath = resolve(tmpdir(), `mann-unified-technical-staging-apply-${process.pid}.sql`);

execFileSync(
  process.execPath,
  [builder, `--output=${outputPath}`, "--authorization-ref=test-owner-staging-only"],
  { cwd: workspaceRoot, stdio: "pipe" },
);

const sql = await readFile(outputPath, "utf8");
assert.match(sql, /^BEGIN;/mu);
assert.match(sql, /pg_advisory_xact_lock/u);
assert.match(sql, /current_database\(\) <> 'vin_oil'/u);
assert.match(sql, /required expand migration is not applied exactly once/u);
assert.match(sql, /CREATE TEMP TABLE _mann_staging_legacy_baseline/u);
assert.match(sql, /INSERT INTO mann_vehicle_variants/u);
assert.match(sql, /INSERT INTO mann_technical_materialization_runs/u);
assert.match(sql, /INSERT INTO mann_technical_association_revisions/u);
assert.match(sql, /INSERT INTO mann_technical_review_decisions/u);
assert.match(sql, /'STAGING'/u);
assert.match(sql, /'STAGED'/u);
assert.match(sql, /'PRIMARY_SOURCE_VERIFIED_FIELDS'/u);
assert.match(sql, /'SYSTEM_IMPORT'/u);
assert.match(sql, /STAGING_IMPORT_ONLY/u);
assert.match(sql, /runtimeCutover/u);
assert.match(sql, /NO_GO/u);
assert.match(sql, /productionApplyAuthorized/u);
assert.match(sql, /FALSE/u);
assert.match(sql, /legacy table counts changed during staging import/u);
assert.match(sql, /COMMIT;/u);
assert.doesNotMatch(sql, /\b(?:DELETE\s+FROM|TRUNCATE\s+TABLE|DROP\s+TABLE)\b/iu);
assert.doesNotMatch(sql, /SET\s+state\s*=\s*'ACTIVE'/iu);
assert.doesNotMatch(sql, /production_apply_authorized\s*,?\s*TRUE/iu);

for (const table of [
  "mann_filter_applications",
  "vehicle_fluid_requirements",
  "fluid_source_rows",
]) {
  assert.doesNotMatch(sql, new RegExp(`(?:INSERT\\s+INTO|UPDATE)\\s+${table}`, "iu"));
}

const missingAuthorization = spawnSync(process.execPath, [builder, `--output=${outputPath}`], {
  cwd: workspaceRoot,
  encoding: "utf8",
});
assert.notEqual(missingAuthorization.status, 0);
assert.match(`${missingAuthorization.stdout}${missingAuthorization.stderr}`, /authorization-ref is required/u);

const productionAttempt = spawnSync(
  process.execPath,
  [builder, `--output=${outputPath}`, "--authorization-ref=test", "--production"],
  { cwd: workspaceRoot, encoding: "utf8" },
);
assert.notEqual(productionAttempt.status, 0);
assert.match(`${productionAttempt.stdout}${productionAttempt.stderr}`, /production activation is forbidden/u);

console.log("MANN unified technical staging SQL tests — passed");
