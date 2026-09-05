#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readArgument = (name, fallback = null) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const planPath = resolve(workspaceRoot, readArgument(
  "plan",
  "outputs/mann-unified-technical-transmission-staging-v1/mann-unified-technical-transmission-staging-plan-v1.json",
));
const outputPath = resolve(workspaceRoot, readArgument(
  "output",
  "outputs/mann-unified-technical-transmission-staging-v1/mann-unified-technical-transmission-staging-apply-v1.sql",
));
const authorizationRef = readArgument("authorization-ref");

if (!authorizationRef) throw new Error("--authorization-ref is required for an auditable staging-only import");
if (process.argv.some((argument) => ["--production", "--activate", "--materialize"].includes(argument))) {
  throw new Error("production activation is forbidden by the conditional transmission staging SQL builder");
}

const rawPlan = await readFile(planPath, "utf8");
const plan = JSON.parse(rawPlan);
const planSha256 = createHash("sha256").update(rawPlan).digest("hex");

assert.equal(plan.artifactKind, "MANN_UNIFIED_TECHNICAL_TRANSMISSION_STAGING_PLAN");
assert.equal(plan.writeMode, "DRY_RUN_ONLY");
assert.equal(plan.requiredMigration, "20260902400000_mann_unified_technical_catalog_expand");
assert.equal(plan.canonicalVehicles.length, plan.counts.canonicalVehicles);
assert.equal(plan.revisions.length, plan.counts.revisions);
assert.equal(plan.counts.missingTechnicalRequirements, 0);
assert.equal(plan.materializationRun.mode, "STAGING");
assert.equal(plan.materializationRun.independentHumanSignoff, false);
assert.equal(plan.materializationRun.productionApplyAuthorized, false);
assert.equal(plan.materializationRun.gates.conditionalTransmissionPolicy, "USER_CONFIRMED_TRANSMISSION_V1");
assert.equal(plan.materializationRun.gates.explicitUserTransmissionChoiceRequired, true);
assert.equal(plan.materializationRun.gates.automaticProductSelection, false);
assert.ok(plan.revisions.every((revision) => revision.state === "REVIEW"));
assert.ok(plan.revisions.every((revision) => revision.applyEligible === false));
assert.ok(plan.revisions.every((revision) => revision.verificationStatus === "UNVERIFIED"));
assert.ok(plan.revisions.every((revision) => revision.verifiedFields.length === 0));
assert.ok(plan.revisions.every((revision) => revision.matchClass === "CONDITIONAL_TRANSMISSION"));
assert.ok(plan.revisions.every((revision) => revision.provenance?.conditionalTransmissionEligible === true));
assert.ok(plan.revisions.every((revision) => revision.provenance?.conditionalTransmissionChoiceRequired === true));
assert.ok(plan.revisions.every((revision) => revision.provenance?.independentValidation?.vehicleIdentityIndependentlyValidated === true));
assert.ok(plan.revisions.every((revision) => revision.provenance?.independentValidation?.hardConflicts?.length === 0));
assert.ok(plan.revisions.every((revision) => (
  revision.provenance?.independentValidation?.reviewBlockers?.length === 1
  && revision.provenance.independentValidation.reviewBlockers[0] === "MANN variant не подтверждает тип или модель коробки"
)));

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlNullableString = (value) => value == null ? "NULL" : sqlString(value);
const sqlNullableNumber = (value) => value == null ? "NULL" : String(value);
const sqlBoolean = (value) => value ? "TRUE" : "FALSE";
const sqlJson = (value) => `${sqlString(JSON.stringify(value))}::jsonb`;
const sqlTimestamp = (value) => `${sqlString(value)}::timestamptz`;
const sqlList = (values) => values.map(sqlString).join(", ");

const approval = {
  authorizationRef,
  authorizationType: "OWNER_EXPLICIT_CHAT_AUTHORIZATION",
  scope: "USER_CONFIRMED_TRANSMISSION_STAGING_PREVIEW_ONLY",
  approvedAction: `Import ${plan.counts.canonicalVehicles} canonical vehicles and ${plan.counts.revisions} conditional transmission preview revisions`,
  independentHumanSignoff: false,
  productionApplyAuthorized: false,
  stagingPlanSha256: planSha256,
};
const gates = {
  ...plan.materializationRun.gates,
  ownerStagingAuthorization: true,
  independentHumanSignoff: false,
  productionApplyAuthorized: false,
  activeMaterialization: "NO_GO",
};

const vehicleRows = plan.canonicalVehicles.map((vehicle) => `(
  ${sqlString(vehicle.key)}, ${sqlString(vehicle.make)}, ${sqlString(vehicle.makeNormalized)},
  ${sqlString(vehicle.model)}, ${sqlString(vehicle.modelNormalized)}, ${sqlNullableString(vehicle.generation)},
  ${sqlJson(vehicle.bodyCodes)}, ${sqlNullableString(vehicle.modelYears)}, ${sqlNullableNumber(vehicle.yearFrom)},
  ${sqlNullableNumber(vehicle.yearTo)}, ${sqlNullableString(vehicle.vehicleText)}, ${sqlNullableString(vehicle.engineCode)},
  ${sqlNullableString(vehicle.engineCodeNormalized)}, ${sqlJson(vehicle.engineCodes)}, ${sqlNullableNumber(vehicle.engineVolumeCc)},
  ${sqlNullableNumber(vehicle.powerKw)}, ${sqlNullableNumber(vehicle.powerHp)}, ${sqlNullableString(vehicle.fuelType)},
  ${sqlNullableString(vehicle.driveType)}, ${sqlNullableString(vehicle.transmissionType)}, ${sqlNullableString(vehicle.conditionText)},
  ${sqlString(vehicle.canonicalPayloadHash)}, ${sqlJson(vehicle.sourceHashes)}, ${sqlTimestamp(vehicle.firstSeenAt)},
  ${sqlTimestamp(vehicle.lastSeenAt)}
)`).join(",\n");

const revisionRows = plan.revisions.map((revision) => `(
  ${sqlString(revision.id)}, ${sqlString(revision.runId)}, ${sqlString(revision.vehicleVariantKey)},
  ${sqlString(revision.sourceRequirementId)}, ${sqlString(revision.systemCode)}, ${sqlNullableString(revision.componentModel)},
  ${sqlJson(revision.applicability)}, ${sqlJson(revision.verifiedFields)}, ${sqlJson(revision.technicalData)},
  ${sqlJson(revision.fieldConfidence)}, ${sqlJson(revision.evidence)}, ${sqlJson(revision.provenance)},
  ${sqlString(revision.matchClass)}, ${revision.matchScore}, ${sqlString(revision.semanticFingerprint)},
  ${sqlString(revision.state)}, ${sqlString(revision.verificationStatus)}, ${sqlBoolean(revision.applyEligible)},
  ${sqlNullableString(revision.supersedesRevisionId)}
)`).join(",\n");

const vehicleKeys = sqlList(plan.canonicalVehicles.map((vehicle) => vehicle.key));
const revisionIds = sqlList(plan.revisions.map((revision) => revision.id));
const vehicleHashRows = plan.canonicalVehicles
  .map((vehicle) => `(${sqlString(vehicle.key)}, ${sqlString(vehicle.canonicalPayloadHash)})`)
  .join(",\n        ");

const sql = `-- Generated conditional transmission staging preview import.
-- Plan SHA-256: ${planSha256}
-- Authorization: ${authorizationRef}
-- Safety: user transmission choice required; UNVERIFIED REVIEW rows only; no product-selection writes.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(hashtextextended('mann-unified-technical-transmission-staging-v1', 0));

DO $$
BEGIN
  IF current_database() <> 'vin_oil' THEN
    RAISE EXCEPTION 'wrong database: expected vin_oil, got %', current_database();
  END IF;
  IF (
    SELECT count(*) FROM _prisma_migrations
    WHERE migration_name = '20260902400000_mann_unified_technical_catalog_expand'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'required expand migration is not applied exactly once';
  END IF;
  IF EXISTS (
    SELECT 1 FROM mann_vehicle_variants
    WHERE variant_key IN (${vehicleKeys})
      AND (variant_key, canonical_payload_hash) NOT IN (
        ${vehicleHashRows}
      )
  ) THEN
    RAISE EXCEPTION 'canonical vehicle hash conflict';
  END IF;
  IF EXISTS (
    SELECT 1 FROM mann_technical_materialization_runs
    WHERE id = ${sqlString(plan.materializationRun.id)}
      AND (mode <> 'STAGING' OR independent_human_signoff OR production_apply_authorized)
  ) THEN
    RAISE EXCEPTION 'existing run conflicts with staging-only safety gates';
  END IF;
END $$;

CREATE TEMP TABLE _mann_transmission_staging_legacy_baseline ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM mann_filter_applications) AS mann_filter_applications,
  (SELECT count(*) FROM vehicle_fluid_requirements) AS vehicle_fluid_requirements,
  (SELECT count(*) FROM fluid_source_rows) AS fluid_source_rows;

INSERT INTO mann_vehicle_variants (
  variant_key, make, make_normalized, model, model_normalized, generation,
  body_codes_json, model_years, year_from, year_to, vehicle_text,
  engine_code, engine_code_normalized, engine_codes_json, engine_volume_cc,
  power_kw, power_hp, fuel_type, drive_type, transmission_type, condition_text,
  canonical_payload_hash, source_hashes_json, first_seen_at, last_seen_at
) VALUES
${vehicleRows}
ON CONFLICT (variant_key) DO NOTHING;

INSERT INTO mann_technical_materialization_runs (
  id, status, mode, matcher_version, capacity_parser_version, git_commit,
  verification_set_version, source_snapshot_json, source_counts_json,
  gates_json, approval_json, independent_human_signoff,
  production_apply_authorized, started_at
) VALUES (
  ${sqlString(plan.materializationRun.id)}, 'RUNNING', 'STAGING',
  ${sqlString(plan.materializationRun.matcherVersion)}, ${sqlString(plan.materializationRun.capacityParserVersion)},
  ${sqlString(plan.materializationRun.gitCommit)}, ${sqlNullableString(plan.materializationRun.verificationSetVersion)},
  ${sqlJson(plan.materializationRun.sourceSnapshot)}, ${sqlJson(plan.materializationRun.sourceCounts)},
  ${sqlJson(gates)}, ${sqlJson(approval)}, FALSE, FALSE, CURRENT_TIMESTAMP
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO mann_technical_association_revisions (
  id, run_id, vehicle_variant_key, source_requirement_id, system_code,
  component_model, applicability_json, verified_fields_json,
  technical_data_json, field_confidence_json, evidence_json, provenance_json,
  match_class, match_score, semantic_fingerprint, state, verification_status,
  apply_eligible, supersedes_revision_id
) VALUES
${revisionRows}
ON CONFLICT (id) DO NOTHING;

UPDATE mann_technical_materialization_runs
SET status = 'COMPLETED', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
WHERE id = ${sqlString(plan.materializationRun.id)} AND status <> 'COMPLETED';

DO $$
BEGIN
  IF (SELECT count(*) FROM mann_vehicle_variants WHERE variant_key IN (${vehicleKeys})) <> ${plan.counts.canonicalVehicles} THEN
    RAISE EXCEPTION 'canonical vehicle count mismatch';
  END IF;
  IF (
    SELECT count(*) FROM mann_technical_association_revisions
    WHERE id IN (${revisionIds}) AND run_id = ${sqlString(plan.materializationRun.id)}
      AND state = 'REVIEW' AND verification_status = 'UNVERIFIED' AND apply_eligible = FALSE
      AND match_class = 'CONDITIONAL_TRANSMISSION'
  ) <> ${plan.counts.revisions} THEN
    RAISE EXCEPTION 'conditional transmission staging revision count mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM mann_technical_association_revisions
    WHERE run_id = ${sqlString(plan.materializationRun.id)}
      AND (state <> 'REVIEW' OR apply_eligible OR verification_status <> 'UNVERIFIED' OR match_class <> 'CONDITIONAL_TRANSMISSION')
  ) THEN
    RAISE EXCEPTION 'unsafe conditional transmission revision state detected';
  END IF;
  IF EXISTS (
    SELECT 1 FROM mann_technical_materialization_runs
    WHERE id = ${sqlString(plan.materializationRun.id)}
      AND (status <> 'COMPLETED' OR mode <> 'STAGING' OR independent_human_signoff OR production_apply_authorized)
  ) THEN
    RAISE EXCEPTION 'run safety gates failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM _mann_transmission_staging_legacy_baseline baseline
    WHERE baseline.mann_filter_applications <> (SELECT count(*) FROM mann_filter_applications)
       OR baseline.vehicle_fluid_requirements <> (SELECT count(*) FROM vehicle_fluid_requirements)
       OR baseline.fluid_source_rows <> (SELECT count(*) FROM fluid_source_rows)
  ) THEN
    RAISE EXCEPTION 'legacy table counts changed during conditional transmission staging import';
  END IF;
END $$;

COMMIT;

SELECT json_build_object(
  'database', current_database(),
  'run', (
    SELECT json_build_object(
      'id', id, 'status', status, 'mode', mode,
      'independentHumanSignoff', independent_human_signoff,
      'productionApplyAuthorized', production_apply_authorized
    ) FROM mann_technical_materialization_runs WHERE id = ${sqlString(plan.materializationRun.id)}
  ),
  'rows', json_build_object(
    'canonicalVehicles', (SELECT count(*) FROM mann_vehicle_variants WHERE variant_key IN (${vehicleKeys})),
    'revisions', (SELECT count(*) FROM mann_technical_association_revisions WHERE id IN (${revisionIds}))
  ),
  'revisionStates', (
    SELECT json_agg(row_to_json(s) ORDER BY s.state) FROM (
      SELECT state, verification_status, match_class, apply_eligible, count(*) AS count
      FROM mann_technical_association_revisions WHERE run_id = ${sqlString(plan.materializationRun.id)}
      GROUP BY state, verification_status, match_class, apply_eligible
    ) s
  ),
  'legacyCounts', json_build_object(
    'mannFilterApplications', (SELECT count(*) FROM mann_filter_applications),
    'vehicleFluidRequirements', (SELECT count(*) FROM vehicle_fluid_requirements),
    'fluidSourceRows', (SELECT count(*) FROM fluid_source_rows)
  )
) AS verification;
`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, sql, "utf8");
process.stdout.write(`${JSON.stringify({ outputPath, planSha256, authorizationRef, counts: plan.counts, sqlBytes: Buffer.byteLength(sql) }, null, 2)}\n`);
