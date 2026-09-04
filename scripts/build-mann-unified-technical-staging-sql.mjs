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

const planPath = resolve(
  workspaceRoot,
  readArgument("plan", "outputs/mann-unified-technical-staging-v1/mann-unified-technical-staging-plan-v1.json"),
);
const outputPath = resolve(
  workspaceRoot,
  readArgument("output", "outputs/mann-unified-technical-staging-v1/mann-unified-technical-staging-apply-v1.sql"),
);
const authorizationRef = readArgument("authorization-ref");

if (!authorizationRef) {
  throw new Error("--authorization-ref is required for an auditable staging-only import");
}
if (process.argv.some((argument) => ["--production", "--activate", "--materialize"].includes(argument))) {
  throw new Error("production activation is forbidden by the staging SQL builder");
}

const rawPlan = await readFile(planPath, "utf8");
const plan = JSON.parse(rawPlan);
const planSha256 = createHash("sha256").update(rawPlan).digest("hex");

assert.equal(plan.artifactKind, "MANN_UNIFIED_TECHNICAL_STAGING_PLAN");
assert.equal(plan.writeMode, "DRY_RUN_ONLY");
assert.equal(plan.requiredMigration, "20260902400000_mann_unified_technical_catalog_expand");
assert.deepEqual(plan.counts, { canonicalVehicles: 4, stagedRevisions: 5, reviewDecisions: 0 });
assert.equal(plan.canonicalVehicles.length, 4);
assert.equal(plan.revisions.length, 5);
assert.equal(plan.materializationRun.mode, "STAGING");
assert.equal(plan.materializationRun.independentHumanSignoff, false);
assert.equal(plan.materializationRun.productionApplyAuthorized, false);
assert.ok(plan.revisions.every((revision) => revision.state === "STAGED"));
assert.ok(plan.revisions.every((revision) => revision.applyEligible === false));
assert.ok(plan.revisions.every((revision) => revision.verificationStatus === "PRIMARY_SOURCE_VERIFIED_FIELDS"));
assert.ok(plan.revisions.every((revision) => Object.keys(revision.technicalData).join(",") === "capacity"));

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlNullableString = (value) => value == null ? "NULL" : sqlString(value);
const sqlNullableNumber = (value) => value == null ? "NULL" : String(value);
const sqlBoolean = (value) => value ? "TRUE" : "FALSE";
const sqlJson = (value) => `${sqlString(JSON.stringify(value))}::jsonb`;
const sqlTimestamp = (value) => `${sqlString(value)}::timestamptz`;
const sqlList = (values) => values.map(sqlString).join(", ");

const decisionSeed = `${plan.materializationRun.id}:${authorizationRef}:system-import-confirm`;
const reviewDecisions = plan.revisions.map((revision) => ({
  id: `mtrd_${createHash("sha256").update(`${decisionSeed}:${revision.id}`).digest("hex").slice(0, 24)}`,
  revisionId: revision.id,
  decision: "CONFIRM",
  actorType: "SYSTEM_IMPORT",
  actorId: "codex-primary-source-audit-v1",
  reason: "Объём и контекст обслуживания подтверждены первичным документом производителя; владелец явно разрешил staging-only импорт. Независимая техническая подпись отсутствует, поэтому ревизия остаётся STAGED и не допускается к ACTIVE/runtime.",
  evidence: revision.evidence,
  correction: {},
}));

const approval = {
  authorizationRef,
  authorizationType: "OWNER_EXPLICIT_CHAT_AUTHORIZATION",
  scope: "STAGING_IMPORT_ONLY",
  approvedAction: "Import four canonical vehicles, five staged capacity revisions, and five SYSTEM_IMPORT confirmation decisions",
  independentHumanSignoff: false,
  productionApplyAuthorized: false,
  stagingPlanSha256: planSha256,
};
const gates = {
  ...plan.materializationRun.gates,
  ownerStagingAuthorization: true,
  independentHumanSignoff: false,
  productionApplyAuthorized: false,
  runtimeCutover: "NO_GO",
};

const vehicleRows = plan.canonicalVehicles.map((vehicle) => `(
  ${sqlString(vehicle.key)},
  ${sqlString(vehicle.make)},
  ${sqlString(vehicle.makeNormalized)},
  ${sqlString(vehicle.model)},
  ${sqlString(vehicle.modelNormalized)},
  ${sqlNullableString(vehicle.generation)},
  ${sqlJson(vehicle.bodyCodes)},
  ${sqlNullableString(vehicle.modelYears)},
  ${sqlNullableNumber(vehicle.yearFrom)},
  ${sqlNullableNumber(vehicle.yearTo)},
  ${sqlNullableString(vehicle.vehicleText)},
  ${sqlNullableString(vehicle.engineCode)},
  ${sqlNullableString(vehicle.engineCodeNormalized)},
  ${sqlJson(vehicle.engineCodes)},
  ${sqlNullableNumber(vehicle.engineVolumeCc)},
  ${sqlNullableNumber(vehicle.powerKw)},
  ${sqlNullableNumber(vehicle.powerHp)},
  ${sqlNullableString(vehicle.fuelType)},
  ${sqlNullableString(vehicle.driveType)},
  ${sqlNullableString(vehicle.transmissionType)},
  ${sqlNullableString(vehicle.conditionText)},
  ${sqlString(vehicle.canonicalPayloadHash)},
  ${sqlJson(vehicle.sourceHashes)},
  ${sqlTimestamp(vehicle.firstSeenAt)},
  ${sqlTimestamp(vehicle.lastSeenAt)}
)`).join(",\n");

const revisionRows = plan.revisions.map((revision) => `(
  ${sqlString(revision.id)},
  ${sqlString(revision.runId)},
  ${sqlString(revision.vehicleVariantKey)},
  ${sqlString(revision.sourceRequirementId)},
  ${sqlString(revision.systemCode)},
  ${sqlNullableString(revision.componentModel)},
  ${sqlJson(revision.applicability)},
  ${sqlJson(revision.verifiedFields)},
  ${sqlJson(revision.technicalData)},
  ${sqlJson(revision.fieldConfidence)},
  ${sqlJson(revision.evidence)},
  ${sqlJson(revision.provenance)},
  ${sqlString(revision.matchClass)},
  ${revision.matchScore},
  ${sqlString(revision.semanticFingerprint)},
  ${sqlString(revision.state)},
  ${sqlString(revision.verificationStatus)},
  ${sqlBoolean(revision.applyEligible)},
  ${sqlNullableString(revision.supersedesRevisionId)}
)`).join(",\n");

const decisionRows = reviewDecisions.map((decision) => `(
  ${sqlString(decision.id)},
  ${sqlString(decision.revisionId)},
  ${sqlString(decision.decision)},
  ${sqlString(decision.actorType)},
  ${sqlString(decision.actorId)},
  ${sqlString(decision.reason)},
  ${sqlJson(decision.evidence)},
  ${sqlJson(decision.correction)}
)`).join(",\n");

const vehicleKeys = sqlList(plan.canonicalVehicles.map((vehicle) => vehicle.key));
const revisionIds = sqlList(plan.revisions.map((revision) => revision.id));
const decisionIds = sqlList(reviewDecisions.map((decision) => decision.id));

const sql = `-- Generated staging-only import for the primary-source-verified MANN subset.
-- Plan SHA-256: ${planSha256}
-- Authorization: ${authorizationRef}
-- Safety: no ACTIVE revisions, no runtime cutover, no legacy-table writes.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtextextended('mann-unified-technical-staging-v1', 0));

DO $$
BEGIN
  IF current_database() <> 'vin_oil' THEN
    RAISE EXCEPTION 'wrong database: expected vin_oil, got %', current_database();
  END IF;
  IF (
    SELECT count(*)
    FROM _prisma_migrations
    WHERE migration_name = '20260902400000_mann_unified_technical_catalog_expand'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'required expand migration is not applied exactly once';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM mann_vehicle_variants
    WHERE variant_key IN (${vehicleKeys})
      AND (variant_key, canonical_payload_hash) NOT IN (
        ${plan.canonicalVehicles.map((vehicle) => `(${sqlString(vehicle.key)}, ${sqlString(vehicle.canonicalPayloadHash)})`).join(",\n        ")}
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

CREATE TEMP TABLE _mann_staging_legacy_baseline ON COMMIT DROP AS
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
  ${sqlString(plan.materializationRun.id)},
  'RUNNING',
  'STAGING',
  ${sqlString(plan.materializationRun.matcherVersion)},
  ${sqlString(plan.materializationRun.capacityParserVersion)},
  ${sqlString(plan.materializationRun.gitCommit)},
  ${sqlNullableString(plan.materializationRun.verificationSetVersion)},
  ${sqlJson(plan.materializationRun.sourceSnapshot)},
  ${sqlJson(plan.materializationRun.sourceCounts)},
  ${sqlJson(gates)},
  ${sqlJson(approval)},
  FALSE,
  FALSE,
  CURRENT_TIMESTAMP
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

INSERT INTO mann_technical_review_decisions (
  id, revision_id, decision, actor_type, actor_id, reason,
  evidence_json, correction_json
) VALUES
${decisionRows}
ON CONFLICT (id) DO NOTHING;

UPDATE mann_technical_materialization_runs
SET status = 'COMPLETED', completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
WHERE id = ${sqlString(plan.materializationRun.id)}
  AND status <> 'COMPLETED';

DO $$
BEGIN
  IF (SELECT count(*) FROM mann_vehicle_variants WHERE variant_key IN (${vehicleKeys})) <> 4 THEN
    RAISE EXCEPTION 'expected 4 canonical vehicles';
  END IF;
  IF (
    SELECT count(*)
    FROM mann_technical_association_revisions
    WHERE id IN (${revisionIds})
      AND run_id = ${sqlString(plan.materializationRun.id)}
      AND state = 'STAGED'
      AND verification_status = 'PRIMARY_SOURCE_VERIFIED_FIELDS'
      AND apply_eligible = FALSE
  ) <> 5 THEN
    RAISE EXCEPTION 'expected 5 safe staged revisions';
  END IF;
  IF (
    SELECT count(*)
    FROM mann_technical_review_decisions
    WHERE id IN (${decisionIds})
      AND decision = 'CONFIRM'
      AND actor_type = 'SYSTEM_IMPORT'
  ) <> 5 THEN
    RAISE EXCEPTION 'expected 5 auditable system-import decisions';
  END IF;
  IF EXISTS (
    SELECT 1 FROM mann_technical_materialization_runs
    WHERE id = ${sqlString(plan.materializationRun.id)}
      AND (status <> 'COMPLETED' OR mode <> 'STAGING' OR independent_human_signoff OR production_apply_authorized)
  ) THEN
    RAISE EXCEPTION 'run safety gates failed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM mann_technical_association_revisions
    WHERE run_id = ${sqlString(plan.materializationRun.id)}
      AND (state <> 'STAGED' OR apply_eligible OR verification_status <> 'PRIMARY_SOURCE_VERIFIED_FIELDS')
  ) THEN
    RAISE EXCEPTION 'unsafe revision state detected';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM _mann_staging_legacy_baseline baseline
    WHERE baseline.mann_filter_applications <> (SELECT count(*) FROM mann_filter_applications)
       OR baseline.vehicle_fluid_requirements <> (SELECT count(*) FROM vehicle_fluid_requirements)
       OR baseline.fluid_source_rows <> (SELECT count(*) FROM fluid_source_rows)
  ) THEN
    RAISE EXCEPTION 'legacy table counts changed during staging import';
  END IF;
END $$;

COMMIT;

SELECT json_build_object(
  'database', current_database(),
  'run', (
    SELECT json_build_object(
      'id', id,
      'status', status,
      'mode', mode,
      'independentHumanSignoff', independent_human_signoff,
      'productionApplyAuthorized', production_apply_authorized
    )
    FROM mann_technical_materialization_runs
    WHERE id = ${sqlString(plan.materializationRun.id)}
  ),
  'rows', json_build_object(
    'canonicalVehicles', (SELECT count(*) FROM mann_vehicle_variants WHERE variant_key IN (${vehicleKeys})),
    'stagedRevisions', (SELECT count(*) FROM mann_technical_association_revisions WHERE id IN (${revisionIds})),
    'systemImportDecisions', (SELECT count(*) FROM mann_technical_review_decisions WHERE id IN (${decisionIds}))
  ),
  'revisionStates', (
    SELECT json_agg(row_to_json(s) ORDER BY s.state)
    FROM (
      SELECT state, verification_status, apply_eligible, count(*) AS count
      FROM mann_technical_association_revisions
      WHERE run_id = ${sqlString(plan.materializationRun.id)}
      GROUP BY state, verification_status, apply_eligible
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
process.stdout.write(`${JSON.stringify({
  outputPath,
  planSha256,
  authorizationRef,
  counts: {
    canonicalVehicles: plan.canonicalVehicles.length,
    stagedRevisions: plan.revisions.length,
    systemImportDecisions: reviewDecisions.length,
  },
}, null, 2)}\n`);
