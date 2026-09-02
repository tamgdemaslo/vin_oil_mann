#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

const outputDir = path.resolve(argument(
  "output-dir",
  "outputs/mann-technical-catalog-v3-timeweb-backup-20260823-190344",
));
const packagePath = path.resolve(argument("output", path.join(outputDir, "mann-active-review-package.json")));
const csvPath = path.resolve(argument("csv", path.join(outputDir, "mann-active-review-package.csv")));
const activePath = path.join(outputDir, "active-association-sample-200.json");
const dangerousPath = path.join(outputDir, "dangerous-systems-review.json");
const decisionsPath = path.join(outputDir, "mann-technical-requirement-decisions.ndjson");

const [active, dangerous] = await Promise.all([
  readFile(activePath, "utf8").then(JSON.parse),
  readFile(dangerousPath, "utf8").then(JSON.parse),
]);
const sampleMembership = new Map();
for (const [sampleName, sample] of [["ACTIVE_200", active.sample], ["DANGEROUS_200", dangerous.sample]]) {
  for (const association of sample) {
    const current = sampleMembership.get(association.associationFingerprint) ?? {
      association,
      samples: [],
    };
    current.samples.push(sampleName);
    sampleMembership.set(association.associationFingerprint, current);
  }
}

const requirementIds = new Set([...sampleMembership.values()].map((item) => item.association.requirementId));
const decisions = new Map();
const input = readline.createInterface({ input: createReadStream(decisionsPath), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const decision = JSON.parse(line);
  if (requirementIds.has(decision.requirementId)) decisions.set(decision.requirementId, decision);
}

function sourceYears(association) {
  return [association.vehicleContext.yearFrom, association.vehicleContext.yearTo].filter((value) => value != null).join("–");
}

function reviewFlags(association, candidate) {
  const matched = new Set(association.independentValidation.matchedFields);
  const sourceEngineCodes = association.vehicleContext.engineCodes?.filter(Boolean) ?? [];
  const sourceHasChassisIdentity = Boolean(
    association.vehicleContext.generation
    || association.vehicleContext.bodyCodes?.length,
  );
  const flags = [];
  if (association.matchScore < 60) flags.push("LOW_MATCH_SCORE");
  if (sourceEngineCodes.length > 0 && !matched.has("точный код двигателя")) flags.push("NO_EXACT_ENGINE_MATCH");
  if (sourceHasChassisIdentity && !matched.has("поколение") && !matched.has("код кузова")) flags.push("NO_CHASSIS_IDENTITY_MATCH");
  if (sourceEngineCodes.length >= 5) flags.push("BROAD_SOURCE_ENGINE_GROUP");
  if ((association.technical.capacities?.length ?? 0) > 1) flags.push("MULTIPLE_CAPACITY_FACTS");
  if ((association.technical.capacities?.length ?? 0) === 0) flags.push("NO_STRUCTURED_CAPACITY");
  if (association.technical.capacities?.some((capacity) => capacity.qualifier === "RANGE" || capacity.qualifier === "APPROXIMATE")) flags.push("NON_EXACT_CAPACITY");
  if (!association.technical.specifications?.length) flags.push("NO_STRUCTURED_SPECIFICATION");
  if (candidate?.condition) flags.push("MANN_CONDITION_PRESENT");
  if (/\+{3}|FOR OUR COMPLETE|VISIT CATALOG/i.test(`${candidate?.vehicleText ?? ""} ${candidate?.vehicleYears ?? ""}`)) flags.push("MANN_PDF_CONTAMINATION");
  if (["FRONT_DIFFERENTIAL", "REAR_DIFFERENTIAL", "DIFFERENTIAL_GENERIC", "AWD_COUPLING"].includes(association.systemCode)
    && !/(?:4WD|AWD|QUATTRO|4MATIC|XDRIVE)/i.test(`${candidate?.vehicleText ?? ""} ${candidate?.model ?? ""}`)) {
    flags.push("DRIVETRAIN_NOT_EXPLICIT_IN_MANN_TARGET");
  }
  if (["POWER_STEERING", "SUSPENSION_HYDRAULIC"].includes(association.systemCode)) flags.push("HYDRAULIC_SYSTEM_TYPE_NOT_PROVEN_BY_MANN");
  return flags;
}

const rows = [...sampleMembership.values()].map(({ association, samples }) => {
  const decision = decisions.get(association.requirementId);
  const candidate = decision?.match?.topCandidates?.find((item) => item.variantIds?.includes(association.vehicleVariantKey)) ?? null;
  return {
    associationFingerprint: association.associationFingerprint,
    samples: [...new Set(samples)].sort(),
    requirementId: association.requirementId,
    vehicleVariantKey: association.vehicleVariantKey,
    systemCode: association.systemCode,
    sourceVehicle: {
      make: association.vehicleContext.make,
      model: association.vehicleContext.model,
      generation: association.vehicleContext.generation,
      years: sourceYears(association),
      engineCodes: association.vehicleContext.engineCodes,
      engineVolumeCc: association.vehicleContext.engineVolumeCc,
      powerKw: association.vehicleContext.powerKw,
      powerHp: association.vehicleContext.powerHp,
      fuelType: association.vehicleContext.fuelType,
      driveType: association.vehicleContext.driveType,
      transmissionType: association.vehicleContext.transmissionType,
    },
    mannTarget: candidate ? {
      make: candidate.make,
      model: candidate.model,
      vehicleText: candidate.vehicleText,
      engineCode: candidate.engineCode,
      vehicleYears: candidate.vehicleYears,
      condition: candidate.condition,
    } : null,
    match: {
      status: association.matchStatus,
      score: association.matchScore,
      matchedFields: association.independentValidation.matchedFields,
      missingFields: association.independentValidation.missingFields,
      hardConflicts: association.independentValidation.hardConflicts,
      reviewBlockers: association.independentValidation.reviewBlockers,
    },
    technical: association.technical,
    provenance: association.provenance,
    reviewFlags: reviewFlags(association, candidate),
  };
}).sort((left, right) => (
  left.systemCode.localeCompare(right.systemCode)
  || left.sourceVehicle.make.localeCompare(right.sourceVehicle.make)
  || left.sourceVehicle.model.localeCompare(right.sourceVehicle.model)
  || left.associationFingerprint.localeCompare(right.associationFingerprint)
));

const report = {
  version: "mann-active-review-package-v1",
  generatedAt: new Date().toISOString(),
  sourceOutputDir: outputDir,
  counts: {
    activeSample: active.sample.length,
    dangerousSample: dangerous.sample.length,
    overlap: rows.filter((row) => row.samples.length === 2).length,
    uniqueAssociations: rows.length,
    decisionsFound: decisions.size,
    decisionsMissing: requirementIds.size - decisions.size,
  },
  associations: rows,
};

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const csvColumns = [
  "associationFingerprint", "samples", "systemCode", "sourceVehicle", "sourceYears", "sourceEngineCodes",
  "mannModel", "mannVehicleText", "mannEngineCode", "mannYears", "matchScore", "matchedFields", "fillVolumeText",
  "specificationText", "reviewFlags", "sourceUrl",
];
const csvRows = rows.map((row) => ({
  associationFingerprint: row.associationFingerprint,
  samples: row.samples,
  systemCode: row.systemCode,
  sourceVehicle: `${row.sourceVehicle.make} ${row.sourceVehicle.model} ${row.sourceVehicle.generation ?? ""}`.trim(),
  sourceYears: row.sourceVehicle.years,
  sourceEngineCodes: row.sourceVehicle.engineCodes,
  mannModel: row.mannTarget?.model,
  mannVehicleText: row.mannTarget?.vehicleText,
  mannEngineCode: row.mannTarget?.engineCode,
  mannYears: row.mannTarget?.vehicleYears,
  matchScore: row.match.score,
  matchedFields: row.match.matchedFields,
  fillVolumeText: row.technical.fillVolumeText,
  specificationText: row.technical.specificationText,
  reviewFlags: row.reviewFlags,
  sourceUrl: row.provenance.sourceUrl,
}));
const csv = `${csvColumns.join(",")}\n${csvRows.map((row) => csvColumns.map((column) => csvCell(row[column])).join(",")).join("\n")}\n`;

await Promise.all([
  writeFile(packagePath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(csvPath, csv, "utf8"),
]);
process.stdout.write(`${JSON.stringify({ packagePath, csvPath, counts: report.counts }, null, 2)}\n`);
