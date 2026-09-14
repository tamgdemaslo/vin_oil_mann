#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

const planPath = resolve(argument("plan"));
const decisionsPath = resolve(argument("decisions"));
const previewPath = resolve(argument("preview"));
const mannSqlPath = resolve(argument("mann-sql"));
const fluidSqlPath = resolve(argument("fluid-sql"));
const outputPath = resolve(argument("output", "outputs/mann-technical-second-pass-verification.json"));

function decodeCopyField(value) {
  if (value === "\\N") return null;
  return value.replace(/\\([btnrfv\\])/g, (_, code) => ({
    b: "\b", t: "\t", n: "\n", r: "\r", f: "\f", v: "\v", "\\": "\\",
  })[code]);
}

function parseCopy(sql, tableName) {
  const header = sql.match(new RegExp(`COPY public\\.${tableName} \\(([^)]+)\\) FROM stdin;\\n`));
  if (!header) throw new Error(`COPY block for ${tableName} not found`);
  const columns = header[1].split(",").map((value) => value.trim());
  const start = header.index + header[0].length;
  const end = sql.indexOf("\n\\.\n", start);
  return sql.slice(start, end).split("\n").filter(Boolean).map((line) => {
    const values = line.split("\t").map(decodeCopyField);
    return Object.fromEntries(columns.map((column, index) => [column, values[index] ?? null]));
  });
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && String(value).trim() !== ""))];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function vehicleContext(decision) {
  const requirement = decision.requirement;
  return {
    make: requirement.make,
    model: requirement.model,
    generation: requirement.generation,
    years: requirement.years,
    engineCode: requirement.engineCode,
    engineVolumeCc: requirement.engineVolumeCc,
    powerKw: requirement.powerKw,
    powerHp: requirement.powerHp,
    fuelType: requirement.fuelType,
  };
}

function contextKey(decision) {
  return `mvc_${hash(vehicleContext(decision)).slice(0, 24)}`;
}

const COMPONENT_SELECTION_SYSTEMS = new Set([
  "AUTOMATIC_TRANSMISSION", "MANUAL_TRANSMISSION", "CVT_TRANSMISSION", "ROBOT_TRANSMISSION",
  "TRANSMISSION_GENERIC", "CLUTCH_FLUID", "TRANSFER_CASE", "FRONT_DIFFERENTIAL",
  "REAR_DIFFERENTIAL", "DIFFERENTIAL_GENERIC", "AWD_COUPLING", "PTO", "RETARDER",
  "POWER_STEERING", "SUSPENSION_HYDRAULIC", "HYDRAULIC_SYSTEM",
]);
const ALLOWED_COMPONENT_BLOCKERS = new Set([
  "MANN variant не подтверждает тип или модель коробки",
  "MANN variant не подтверждает привод или модель агрегата",
  "MANN variant не подтверждает наличие этой гидравлической системы",
]);

const [planRaw, decisionsRaw, previewRaw, mannSql, fluidSql] = await Promise.all([
  readFile(planPath, "utf8"),
  readFile(decisionsPath, "utf8"),
  readFile(previewPath, "utf8"),
  readFile(mannSqlPath, "utf8"),
  readFile(fluidSqlPath, "utf8"),
]);
const plan = JSON.parse(planRaw);
const decisions = decisionsRaw.trim().split("\n").filter(Boolean).map(JSON.parse);
const preview = JSON.parse(previewRaw);
const mannRows = parseCopy(mannSql, "mann_filter_applications");
const fluidRows = parseCopy(fluidSql, "vehicle_fluid_requirements");
const decisionById = new Map(decisions.map((row) => [row.requirementId, row]));
const fluidById = new Map(fluidRows.map((row) => [row.id, row]));
const mannByVariant = Map.groupBy(mannRows, (row) => row.vehicle_variant_key);

const issues = [];
const warnings = [];
const issue = (code, id, detail) => issues.push({ code, id, detail });

if (plan.artifactKind !== "MANN_TECHNICAL_SECOND_PASS_PLAN") issue("PLAN_KIND", null, plan.artifactKind);
if (plan.writeMode !== "DRY_RUN_ONLY") issue("WRITE_MODE", null, plan.writeMode);
if (preview.writeMode !== "DRY_RUN_ONLY") issue("PREVIEW_WRITE_MODE", null, preview.writeMode);

const existingLinked = new Set();
const linkedVariantsByContext = new Map();
for (const association of preview.proposedAssociations ?? []) {
  for (const id of unique([association.requirementId, ...(association.sourceRequirementIds ?? [])])) existingLinked.add(id);
}
for (const decision of decisions) {
  if (!existingLinked.has(decision.requirementId)) continue;
  const variants = linkedVariantsByContext.get(contextKey(decision)) ?? new Set();
  for (const association of preview.proposedAssociations ?? []) {
    if (association.requirementId === decision.requirementId || association.sourceRequirementIds?.includes(decision.requirementId)) {
      variants.add(association.vehicleVariantKey);
    }
  }
  linkedVariantsByContext.set(contextKey(decision), variants);
}

function candidateFor(decision, variantKey) {
  return (decision.match?.topCandidates ?? []).find((candidate) => candidate.variantIds?.includes(variantKey)) ?? null;
}

function checkCommon(row, expectedComponent) {
  const decision = decisionById.get(row.requirementId);
  const technical = fluidById.get(row.requirementId);
  if (!decision) return issue("REQUIREMENT_NOT_IN_DECISIONS", row.requirementId, null);
  if (!technical) issue("REQUIREMENT_NOT_IN_FLUID_SOURCE", row.requirementId, null);
  if (!mannByVariant.has(row.vehicleVariantKey)) issue("MANN_VARIANT_NOT_FOUND", row.requirementId, row.vehicleVariantKey);
  if (existingLinked.has(row.requirementId)) issue("ALREADY_LINKED_DUPLICATE", row.requirementId, null);
  const isComponent = COMPONENT_SELECTION_SYSTEMS.has(row.systemCode);
  if (isComponent !== expectedComponent) issue("SYSTEM_CLASSIFICATION", row.requirementId, row.systemCode);
  const candidate = candidateFor(decision, row.vehicleVariantKey);
  if (!candidate) issue("TARGET_NOT_IN_ROW_CANDIDATES", row.requirementId, row.vehicleVariantKey);
  if ((candidate?.hardConflicts ?? []).length) issue("HARD_CONFLICT", row.requirementId, candidate.hardConflicts);
  if (decision.capacity?.needsReview) issue("CAPACITY_REVIEW_LEAK", row.requirementId, decision.capacity);
  if (!technical?.fill_volume_text) issue("MISSING_FILL_VOLUME", row.requirementId, null);
  if (!technical?.specification_text) issue("MISSING_SPECIFICATION", row.requirementId, null);
  return { decision, candidate, technical };
}

for (const row of plan.directProposals ?? []) {
  const checked = checkCommon(row, false);
  if (!checked) continue;
  if ((checked.candidate?.reviewBlockers ?? []).length) issue("DIRECT_REVIEW_BLOCKER", row.requirementId, checked.candidate.reviewBlockers);
  if (row.method === "CONFIRMED_CONTEXT_INHERITANCE") {
    const anchors = linkedVariantsByContext.get(contextKey(checked.decision));
    if (anchors?.size !== 1 || !anchors.has(row.vehicleVariantKey)) issue("INVALID_INHERITANCE", row.requirementId, [...(anchors ?? [])]);
  }
  if (row.method === "CROSS_SYSTEM_CONSENSUS") {
    if ((row.agreeingSystems ?? []).length < plan.strategy.minAgreeingSystems) issue("INSUFFICIENT_CONSENSUS", row.requirementId, row.agreeingSystems);
    if ((row.topScore ?? 0) < plan.strategy.minScore) issue("LOW_SCORE", row.requirementId, row.topScore);
  }
  let engineCodes = [];
  try { engineCodes = JSON.parse(checked.technical.engine_codes_json ?? "[]"); } catch { /* reported as warning below */ }
  if (engineCodes.length > 1) warnings.push({ code: "GROUPED_ENGINE_CODES", id: row.requirementId, count: engineCodes.length });
}

for (const row of plan.conditionalComponentItems ?? []) {
  const checked = checkCommon(row, true);
  if (!checked) continue;
  const unexpected = (checked.candidate?.reviewBlockers ?? []).filter((blocker) => !ALLOWED_COMPONENT_BLOCKERS.has(blocker));
  if (unexpected.length) issue("CONDITIONAL_UNEXPECTED_BLOCKER", row.requirementId, unexpected);
}

const partitions = [
  ["EXISTING", [...existingLinked]],
  ["DIRECT", (plan.directProposals ?? []).map((row) => row.requirementId)],
  ["CONDITIONAL", (plan.conditionalComponentItems ?? []).map((row) => row.requirementId)],
  ["REVIEW", (plan.reviewContexts ?? []).flatMap((row) => row.requirementIds)],
  ["DEFERRED", (plan.deferredRequirements ?? []).map((row) => row.requirementId)],
];
const membership = new Map();
for (const [name, ids] of partitions) {
  for (const id of ids) {
    const names = membership.get(id) ?? [];
    names.push(name);
    membership.set(id, names);
  }
}
for (const decision of decisions) {
  const names = membership.get(decision.requirementId) ?? [];
  if (names.length === 0) issue("UNPARTITIONED_REQUIREMENT", decision.requirementId, null);
  if (names.length > 1) issue("DUPLICATE_PARTITION", decision.requirementId, names);
}
for (const id of membership.keys()) {
  if (!decisionById.has(id)) issue("UNKNOWN_PARTITION_REQUIREMENT", id, membership.get(id));
}

const checks = {
  decisions: decisions.length,
  fluidRequirements: fluidRows.length,
  mannRows: mannRows.length,
  mannVariants: mannByVariant.size,
  existingLinked: existingLinked.size,
  directVerified: plan.directProposals?.length ?? 0,
  conditionalVerified: plan.conditionalComponentItems?.length ?? 0,
  reviewRequirements: partitions.find(([name]) => name === "REVIEW")[1].length,
  deferredRequirements: plan.deferredRequirements?.length ?? 0,
  partitionedRequirements: membership.size,
  groupedEngineWarnings: warnings.filter((row) => row.code === "GROUPED_ENGINE_CODES").length,
};

const report = {
  schemaVersion: 1,
  artifactKind: "MANN_TECHNICAL_SECOND_PASS_VERIFICATION",
  generatedAt: new Date().toISOString(),
  result: issues.length === 0 ? "PASS_FOR_STAGING_PREVIEW" : "FAIL",
  productionApplyAuthorized: false,
  checks,
  issueCount: issues.length,
  warningCount: warnings.length,
  issues: issues.slice(0, 500),
  warningSummary: Object.fromEntries(
    [...Map.groupBy(warnings, (row) => row.code)].map(([code, rows]) => [code, rows.length]),
  ),
  warningSample: warnings.slice(0, 50),
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (issues.length) process.exitCode = 1;
