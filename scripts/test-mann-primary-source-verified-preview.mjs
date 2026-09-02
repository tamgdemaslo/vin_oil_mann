#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verificationPath = resolve(workspaceRoot, "data/mann-technical-primary-source-verification-v1.json");
const outputPath = resolve(tmpdir(), `mann-primary-source-verified-preview-${process.pid}.json`);
const inputDir = resolve(workspaceRoot, "outputs/mann-technical-catalog-v9-timeweb-backup-20260823-190344");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const {
  MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_SCOPE,
  MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_VERSION,
  parseMannTechnicalPrimarySourceVerification,
} = await jiti.import("../src/lib/mann-technical-primary-source-policy.ts");

const raw = JSON.parse(await readFile(verificationPath, "utf8"));
const verification = parseMannTechnicalPrimarySourceVerification(raw);
assert.equal(verification.version, MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_VERSION);
assert.deepEqual(verification.verificationScope, [...MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_SCOPE]);
assert.equal(verification.documents.length, 3);
assert.equal(verification.associations.length, 5);
assert.equal(new Set(verification.associations.map((entry) => entry.associationFingerprint)).size, 5);
assert.equal(new Set(verification.associations.map((entry) => entry.requirementId)).size, 5);

assert.throws(
  () => parseMannTechnicalPrimarySourceVerification({ ...raw, independentHumanSignoff: true }),
  /must not claim independent human sign-off/u,
);
assert.throws(
  () => parseMannTechnicalPrimarySourceVerification({ ...raw, productionApplyAuthorized: true }),
  /must not authorize a production apply/u,
);
assert.throws(
  () => parseMannTechnicalPrimarySourceVerification({ ...raw, effect: "ALLOW_PRODUCTION" }),
  /effect must remain preview-only/u,
);

execFileSync(
  process.execPath,
  [
    resolve(workspaceRoot, "scripts/build-mann-primary-source-verified-preview.mjs"),
    `--input-dir=${inputDir}`,
    `--verification=${verificationPath}`,
    `--output=${outputPath}`,
  ],
  { cwd: workspaceRoot, stdio: "pipe" },
);

const artifact = JSON.parse(await readFile(outputPath, "utf8"));
assert.equal(artifact.artifactKind, "MANN_PRIMARY_SOURCE_VERIFIED_SUBSET_PREVIEW");
assert.equal(artifact.writeMode, "DRY_RUN_ONLY");
assert.equal(artifact.decisions.fullCatalog, "NO_GO");
assert.equal(artifact.decisions.verifiedSubset, "GO_FOR_SCHEMA_AND_STAGING_DESIGN");
assert.equal(artifact.decisions.productionApply, "NOT_AUTHORIZED");
assert.equal(artifact.counts.verifiedAssociations, 5);
assert.equal(artifact.counts.sourceProposedAssociations, 953);
assert.equal(artifact.counts.excludedFromVerifiedSubset, 948);
assert.deepEqual(artifact.counts.bySystem, { ENGINE_COOLANT: 1, ENGINE_OIL: 4 });
assert.ok(artifact.associations.every((entry) => entry.verifiedTechnical?.capacity));
assert.ok(artifact.associations.every((entry) => !("technical" in entry)));
assert.ok(artifact.associations.every((entry) => entry.excludedUnverifiedSourceFields.length > 0));

const forbidden = spawnSync(
  process.execPath,
  [resolve(workspaceRoot, "scripts/build-mann-primary-source-verified-preview.mjs"), "--apply"],
  { cwd: workspaceRoot, encoding: "utf8" },
);
assert.notEqual(forbidden.status, 0);
assert.match(`${forbidden.stdout}${forbidden.stderr}`, /database mutation is forbidden/u);

console.log("MANN primary-source verified subset preview tests — passed");
