#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputArgument = process.argv.find((argument) => argument.startsWith("--output-dir="));
const maxArgument = process.argv.find((argument) => argument.startsWith("--max-requirements="));
const snapshotIdArgument = process.argv.find((argument) => argument.startsWith("--snapshot-id="));
const snapshotCreatedAtArgument = process.argv.find((argument) => argument.startsWith("--snapshot-created-at="));
const snapshotSha256Argument = process.argv.find((argument) => argument.startsWith("--snapshot-sha256="));
const currentTimewebSnapshot = process.argv.includes("--current-timeweb-snapshot");
const outputDir = resolve(
  workspaceRoot,
  outputArgument?.slice("--output-dir=".length) || "outputs/mann-technical-catalog-v2-frozen-2026-08-23",
);
const maxRequirements = maxArgument ? Number(maxArgument.slice("--max-requirements=".length)) : null;
const snapshotId = snapshotIdArgument?.slice("--snapshot-id=".length)
  || "railway-final-frozen-backup-2026-08-02-codex-019fb41a";
const snapshotCreatedAt = snapshotCreatedAtArgument?.slice("--snapshot-created-at=".length) || null;
const snapshotSha256 = snapshotSha256Argument?.slice("--snapshot-sha256=".length) || null;
if (process.argv.some((argument) => ["--apply", "--write-db", "--materialize"].includes(argument))) {
  throw new Error("This command is permanently dry-run-only; database write flags are forbidden");
}
if (maxRequirements !== null && (!Number.isInteger(maxRequirements) || maxRequirements <= 0)) {
  throw new Error("--max-requirements must be a positive integer");
}
if (currentTimewebSnapshot && (!snapshotIdArgument || !snapshotCreatedAt || !snapshotSha256)) {
  throw new Error("Current Timeweb snapshots require --snapshot-id, --snapshot-created-at and --snapshot-sha256");
}
if (snapshotSha256 && !/^[a-f0-9]{64}$/u.test(snapshotSha256)) {
  throw new Error("--snapshot-sha256 must be a lowercase SHA-256 digest");
}
if (snapshotCreatedAt && Number.isNaN(Date.parse(snapshotCreatedAt))) {
  throw new Error("--snapshot-created-at must be an ISO-8601 timestamp");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const parsedDatabaseUrl = new URL(databaseUrl);
if (!["127.0.0.1", "localhost", "::1"].includes(parsedDatabaseUrl.hostname)) {
  throw new Error("Frozen preview is restricted to an explicitly local PostgreSQL snapshot");
}

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const { FLUID_CAPACITY_PARSER_VERSION, parseFluidCapacities } = await jiti.import(
  "../src/lib/fluid-capacity-parser.ts",
);
const { MANN_FLUID_MATCHER_VERSION, fluidSystemFamily, matchFluidRequirementToMann } = await jiti.import(
  "../src/lib/mann-fluid-matcher-v2.ts",
);
const { mannMakeFormsForTest } = await jiti.import("../src/lib/mann-vehicle-resolver.ts");
const { normalizeVehicleMake } = await jiti.import("../src/lib/vehicle-normalization.ts");
const { normalizeMannText } = await jiti.import("../src/lib/mann-catalog.ts");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const generatedAt = new Date().toISOString();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" }).trim();

function hash(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

function increment(record, key, amount = 1) {
  record[key] = (record[key] || 0) + amount;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ""))];
}

function csvCell(value) {
  const text = Array.isArray(value) || (value && typeof value === "object") ? JSON.stringify(value) : String(value ?? "");
  return /[",\n\r\t]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, columns) {
  return `${[columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n")}\n`;
}

function capacityConfidence(parsed) {
  if (!parsed.capacities.length) return { level: "NONE", evidence: ["числовой объём в литрах не выделен"] };
  if (parsed.needsReview || parsed.capacities.some((capacity) => capacity.confidence === "LOW")) {
    return { level: "LOW", evidence: unique(parsed.suspicious.map((item) => item.code)) };
  }
  if (parsed.capacities.some((capacity) => capacity.confidence === "MEDIUM")) {
    return { level: "MEDIUM", evidence: unique(parsed.capacities.map((capacity) => capacity.qualifier)) };
  }
  return { level: "HIGH", evidence: [`структурированных токенов: ${parsed.capacities.length}`] };
}

function stableCapacity(capacity) {
  return {
    kind: capacity.kind,
    minLiters: capacity.minLiters,
    maxLiters: capacity.maxLiters,
    nominalLiters: capacity.nominalLiters,
    toleranceLiters: capacity.toleranceLiters,
    context: capacity.context,
    confidence: capacity.confidence,
    raw: capacity.raw,
    qualifier: capacity.qualifier,
    serviceContext: capacity.serviceContext,
    filterContext: capacity.filterContext,
  };
}

function normalizedApplicability(requirement) {
  const componentModel = requirement.componentModel?.trim();
  const meaningfulComponentModel = componentModel && !/^(?:-|—|N\/A|NONE)$/iu.test(componentModel)
    ? componentModel.toUpperCase()
    : null;
  const inferredDriveType = requirement.driveType
    || (["TRANSFER_CASE", "AWD_COUPLING"].includes(requirement.systemCode) ? "awd" : null);
  return {
    yearFrom: requirement.yearFrom,
    yearTo: requirement.yearTo,
    engineCodes: unique([
      requirement.engineCodeNormalized,
      ...(Array.isArray(requirement.engineCodesJson) ? requirement.engineCodesJson.map(String) : []),
    ]),
    transmissionType: requirement.transmissionType,
    driveType: inferredDriveType,
    driveTypeInferredFromSystem: !requirement.driveType && Boolean(inferredDriveType),
    componentModel: meaningfulComponentModel,
    rawComponentModel: componentModel || null,
  };
}

function normalizedTechnicalPayload(requirement, capacityParsed) {
  const specifications = Array.isArray(requirement.specificationsJson) ? requirement.specificationsJson : [];
  const viscosities = Array.isArray(requirement.viscosityGradesJson) ? requirement.viscosityGradesJson : [];
  return {
    systemCode: requirement.systemCode,
    applicability: normalizedApplicability(requirement),
    capacities: capacityParsed.capacities.map((capacity) => ({
      kind: capacity.kind,
      minLiters: capacity.minLiters,
      maxLiters: capacity.maxLiters,
      nominalLiters: capacity.nominalLiters,
      toleranceLiters: capacity.toleranceLiters,
      qualifier: capacity.qualifier,
    })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    specifications: specifications.map((item) => JSON.stringify(item)).sort(),
    viscosityGrades: viscosities.map(String).sort(),
    recommendation: requirement.recommendationText?.trim() || null,
    replacementKmMin: requirement.replacementKmMin,
    replacementKmMax: requirement.replacementKmMax,
    replacementMonths: requirement.replacementMonths,
  };
}

function associationFingerprint(targetKey, requirement, capacityParsed) {
  return hash({ targetKey, technical: normalizedTechnicalPayload(requirement, capacityParsed) });
}

function interval(capacity) {
  const min = capacity.minLiters ?? capacity.nominalLiters ?? capacity.maxLiters;
  const max = capacity.maxLiters ?? capacity.nominalLiters ?? capacity.minLiters;
  return min === null || min === undefined || max === null || max === undefined ? null : { min, max };
}

function mutuallyExclusiveCapacity(left, right) {
  if (left.kind !== right.kind || left.kind === "UNKNOWN") return false;
  const leftInterval = interval(left);
  const rightInterval = interval(right);
  if (!leftInterval || !rightInterval) return false;
  const tolerance = Math.max(0.05, Math.min(leftInterval.max, rightInterval.max) * 0.03);
  return leftInterval.max + tolerance < rightInterval.min || rightInterval.max + tolerance < leftInterval.min;
}

function dangerousSystem(systemCode) {
  return ["ENGINE", "TRANSMISSION", "DRIVETRAIN"].includes(fluidSystemFamily(systemCode))
    || ["BRAKE_FLUID", "CLUTCH_FLUID", "ENGINE_COOLANT", "INVERTER_COOLANT", "POWER_STEERING"].includes(systemCode);
}

function reviewPriority(item) {
  if ((item.status === "CONFLICT" || item.parserNeedsReview) && dangerousSystem(item.systemCode)) return "P0";
  if (item.status === "REVIEW_REQUIRED" && dangerousSystem(item.systemCode)) return "P1";
  if (["CONFLICT", "REVIEW_REQUIRED"].includes(item.status)) return "P1";
  if (["NO_MATCH", "MANN_CATALOG_GAP"].includes(item.status) && (item.hasCapacity || item.hasSpecification)) return "P2";
  return "P3";
}

function stratifiedSample(rows, limit, stratum) {
  const groups = new Map();
  for (const row of rows) {
    const key = stratum(row);
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.sort((left, right) => hash(left.associationFingerprint || left.id).localeCompare(hash(right.associationFingerprint || right.id)));
  const selected = [];
  const used = new Set();
  let round = 0;
  while (selected.length < limit) {
    let added = false;
    for (const key of [...groups.keys()].sort()) {
      const row = groups.get(key)[round];
      if (!row) continue;
      const identity = row.associationFingerprint || row.id;
      if (!used.has(identity)) {
        selected.push(row);
        used.add(identity);
        added = true;
      }
      if (selected.length >= limit) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

async function writeStreamLine(stream, value) {
  if (!stream.write(`${JSON.stringify(value)}\n`)) await once(stream, "drain");
}

async function readSnapshot() {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const requirements = await transaction.vehicleFluidRequirement.findMany({
      select: {
        id: true,
        importBatchId: true,
        sourceRowId: true,
        sourceTableKey: true,
        sourceUrl: true,
        make: true,
        makeNormalized: true,
        model: true,
        modelNormalized: true,
        generation: true,
        generationNumber: true,
        bodyCodesJson: true,
        yearFrom: true,
        yearTo: true,
        engineCodeNormalized: true,
        engineCodesJson: true,
        engineVolumeCc: true,
        powerKw: true,
        powerHp: true,
        fuelType: true,
        driveType: true,
        transmissionType: true,
        componentModel: true,
        systemCode: true,
        systemNameRaw: true,
        fillVolumeText: true,
        specificationText: true,
        specificationsJson: true,
        viscosityGradesJson: true,
        recommendationText: true,
        replacementIntervalText: true,
        replacementKmMin: true,
        replacementKmMax: true,
        replacementMonths: true,
        controlIntervalText: true,
        analogText: true,
        contextConfidence: true,
        rawRequirementJson: true,
        importBatch: { select: { sourceHash: true, importedAt: true, sourceName: true } },
        sourceRow: { select: { sourcePageHash: true, sourceFetchedAt: true, sourceUrl: true } },
      },
      orderBy: { id: "asc" },
      ...(maxRequirements ? { take: maxRequirements } : {}),
    });
    const mannRows = await transaction.mannFilterApplication.findMany({
      select: {
        vehicleVariantKey: true,
        make: true,
        makeNormalized: true,
        model: true,
        modelNormalized: true,
        vehicleText: true,
        effectiveVehicleText: true,
        engineCode: true,
        engineCodeNormalized: true,
        kw: true,
        hp: true,
        vehicleYears: true,
        vehicleYearFrom: true,
        vehicleYearTo: true,
        condition: true,
        sourceHash: true,
        importedAt: true,
      },
      orderBy: { id: "asc" },
    });
    const oldLinks = await transaction.mannFluidRequirementLink.findMany({
      select: { requirementId: true, mannVariantKey: true, status: true, confidence: true, matchScore: true, matchMethod: true },
      orderBy: { id: "asc" },
    });
    return { requirements, mannRows, oldLinks };
  }, { timeout: 180_000 });
}

await mkdir(outputDir, { recursive: true });
const decisionsPath = resolve(outputDir, "mann-technical-requirement-decisions.ndjson");
const decisionStream = createWriteStream(decisionsPath, { encoding: "utf8" });

try {
  const snapshot = await readSnapshot();
  const oldLinksByRequirement = new Map();
  for (const link of snapshot.oldLinks) {
    const links = oldLinksByRequirement.get(link.requirementId) || [];
    links.push(link);
    oldLinksByRequirement.set(link.requirementId, links);
  }

  const mannRowsByNormalizedMake = new Map();
  const mannSourceHashesByVariant = new Map();
  for (const row of snapshot.mannRows) {
    const key = normalizeMannText(row.makeNormalized || row.make);
    const rows = mannRowsByNormalizedMake.get(key) || [];
    rows.push(row);
    mannRowsByNormalizedMake.set(key, rows);
    const sourceHashes = mannSourceHashesByVariant.get(row.vehicleVariantKey) || [];
    mannSourceHashesByVariant.set(row.vehicleVariantKey, unique([...sourceHashes, row.sourceHash]));
  }
  const rowsForRequirement = (requirement) => {
    const canonicalMake = normalizeVehicleMake(requirement.makeNormalized || requirement.make) || requirement.makeNormalized || requirement.make;
    return unique(mannMakeFormsForTest(canonicalMake)).flatMap((form) => mannRowsByNormalizedMake.get(normalizeMannText(form)) || []);
  };

  const compactDecisions = [];
  const proposedAssociations = [];
  let processed = 0;
  for (const requirement of snapshot.requirements) {
    const capacityParsed = parseFluidCapacities(requirement.fillVolumeText, requirement.systemCode);
    const match = matchFluidRequirementToMann(requirement, rowsForRequirement(requirement));
    const oldLinks = oldLinksByRequirement.get(requirement.id) || [];
    const capacity = {
      parserVersion: capacityParsed.parserVersion,
      capacities: capacityParsed.capacities.map(stableCapacity),
      rejected: capacityParsed.rejected,
      suspicious: capacityParsed.suspicious,
      needsReview: capacityParsed.needsReview,
    };
    const fieldConfidence = { ...match.fieldConfidence, capacity: capacityConfidence(capacityParsed) };
    await writeStreamLine(decisionStream, {
      requirementId: requirement.id,
      source: {
        sourceRowId: requirement.sourceRowId,
        sourceUrl: requirement.sourceUrl,
        sourcePageHash: requirement.sourceRow.sourcePageHash,
        sourceBatchHash: requirement.importBatch?.sourceHash ?? null,
      },
      requirement: {
        make: requirement.make,
        model: requirement.model,
        generation: requirement.generation,
        years: [requirement.yearFrom, requirement.yearTo],
        engineCode: requirement.engineCodeNormalized,
        engineVolumeCc: requirement.engineVolumeCc,
        powerKw: requirement.powerKw,
        powerHp: requirement.powerHp,
        fuelType: requirement.fuelType,
        driveType: requirement.driveType,
        transmissionType: requirement.transmissionType,
        componentModel: requirement.componentModel,
        systemCode: requirement.systemCode,
      },
      match,
      capacity,
      fieldConfidence,
      legacyLinkEvidence: oldLinks,
      legacyEvidenceUsedForDecision: false,
    });

    const compact = {
      id: requirement.id,
      requirement,
      capacity,
      match,
      fieldConfidence,
      oldLinks,
      finalStatus: match.status,
      parserNeedsReview: capacityParsed.needsReview,
    };
    compactDecisions.push(compact);
    if (["CONFIRMED_SINGLE", "CONFIRMED_MULTI_APPLICABILITY"].includes(match.status)) {
      for (const target of match.targets) {
        proposedAssociations.push({
          associationFingerprint: associationFingerprint(target.vehicleVariantKey, requirement, capacityParsed),
          vehicleVariantKey: target.vehicleVariantKey,
          requirementId: requirement.id,
          sourceRequirementIds: [requirement.id],
          sourceRowIds: [requirement.sourceRowId],
          systemCode: requirement.systemCode,
          systemFamily: match.systemFamily,
          componentModel: requirement.componentModel,
          applicability: normalizedApplicability(requirement),
          proposedState: capacityParsed.needsReview ? "REVIEW" : "ACTIVE",
          matchStatus: match.status,
          matchScore: target.score,
          independentValidation: target,
          technical: {
            fillVolumeText: requirement.fillVolumeText,
            capacities: capacity.capacities,
            specificationText: requirement.specificationText,
            specifications: requirement.specificationsJson,
            viscosityGrades: requirement.viscosityGradesJson,
            recommendationText: requirement.recommendationText,
            replacementIntervalText: requirement.replacementIntervalText,
            replacementKmMin: requirement.replacementKmMin,
            replacementKmMax: requirement.replacementKmMax,
            replacementMonths: requirement.replacementMonths,
            controlIntervalText: requirement.controlIntervalText,
            analogText: requirement.analogText,
          },
          vehicleContext: {
            make: requirement.make,
            model: requirement.model,
            generation: requirement.generation,
            yearFrom: requirement.yearFrom,
            yearTo: requirement.yearTo,
            engineCode: requirement.engineCodeNormalized,
            engineCodes: unique([
              requirement.engineCodeNormalized,
              ...(Array.isArray(requirement.engineCodesJson) ? requirement.engineCodesJson.map(String) : []),
            ]),
            engineVolumeCc: requirement.engineVolumeCc,
            powerKw: requirement.powerKw,
            powerHp: requirement.powerHp,
            fuelType: requirement.fuelType,
            driveType: requirement.driveType,
            transmissionType: requirement.transmissionType,
          },
          fieldConfidence,
          provenance: {
            sourceName: requirement.importBatch?.sourceName ?? "podbormasla.ru",
            sourceUrl: requirement.sourceUrl,
            sourceRowId: requirement.sourceRowId,
            sourcePageHash: requirement.sourceRow.sourcePageHash,
            sourceFetchedAt: requirement.sourceRow.sourceFetchedAt,
            sourceBatchHash: requirement.importBatch?.sourceHash ?? null,
            sourceImportedAt: requirement.importBatch?.importedAt ?? null,
            mannVariantKey: target.vehicleVariantKey,
            mannSourceHashes: mannSourceHashesByVariant.get(target.vehicleVariantKey) || [],
            matcherVersion: MANN_FLUID_MATCHER_VERSION,
            parserVersion: FLUID_CAPACITY_PARSER_VERSION,
            decisionFingerprint: match.decisionFingerprint,
            commit,
            generatedAt,
            writeMode: "DRY_RUN_ONLY",
          },
          conflictTypes: capacityParsed.needsReview ? ["CAPACITY_PARSER_REVIEW_REQUIRED"] : [],
          duplicateCount: 1,
        });
      }
    }
    processed += 1;
    if (processed % 500 === 0) process.stdout.write(`processed ${processed}/${snapshot.requirements.length}\n`);
  }
  decisionStream.end();
  await once(decisionStream, "finish");

  const deduplicated = new Map();
  const compactDecisionsById = new Map(compactDecisions.map((decision) => [decision.id, decision]));
  for (const association of proposedAssociations) {
    const current = deduplicated.get(association.associationFingerprint);
    if (!current) {
      deduplicated.set(association.associationFingerprint, association);
      continue;
    }
    current.sourceRequirementIds = unique([...current.sourceRequirementIds, ...association.sourceRequirementIds]);
    current.sourceRowIds = unique([...current.sourceRowIds, ...association.sourceRowIds]);
    current.duplicateCount += 1;
  }
  const associations = [...deduplicated.values()];

  for (const association of associations.filter((item) => item.proposedState === "REVIEW")) {
    for (const requirementId of association.sourceRequirementIds) {
      const decision = compactDecisionsById.get(requirementId);
      if (decision && decision.finalStatus !== "CONFLICT") decision.finalStatus = "REVIEW_REQUIRED";
    }
  }

  const associationGroups = new Map();
  for (const association of associations) {
    const key = `${association.vehicleVariantKey}|${association.systemCode}`;
    const group = associationGroups.get(key) || [];
    group.push(association);
    associationGroups.set(key, group);
  }
  let capacityConflictGroups = 0;
  let conditionalAlternativeGroups = 0;
  for (const group of associationGroups.values()) {
    if (group.length < 2) continue;
    const componentModels = unique(group.map((association) => association.componentModel?.trim().toUpperCase()));
    const conditionalAlternatives = componentModels.length > 1
      && ["TRANSMISSION", "DRIVETRAIN"].includes(group[0].systemFamily);
    if (conditionalAlternatives) conditionalAlternativeGroups += 1;
    let conflict = false;
    for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
        const left = group[leftIndex];
        const right = group[rightIndex];
        if (conditionalAlternatives && left.componentModel !== right.componentModel) continue;
        if (left.technical.capacities.some((leftCapacity) => right.technical.capacities.some((rightCapacity) => mutuallyExclusiveCapacity(leftCapacity, rightCapacity)))) {
          conflict = true;
        }
      }
    }
    if (conflict) {
      capacityConflictGroups += 1;
      for (const association of group) {
        association.proposedState = "REVIEW";
        association.conflictTypes.push("MUTUALLY_EXCLUSIVE_CAPACITY");
        for (const requirementId of association.sourceRequirementIds) {
          const decision = compactDecisionsById.get(requirementId);
          if (decision) decision.finalStatus = "CONFLICT";
        }
      }
    } else if (conditionalAlternatives) {
      for (const association of group) association.conflictTypes.push("CONDITIONAL_COMPONENT_ALTERNATIVE_NOT_CONFLICT");
    }
  }

  const activeAssociations = associations.filter((association) => association.proposedState === "ACTIVE");
  const statusCounts = {};
  const systemStatusCounts = {};
  for (const decision of compactDecisions) {
    increment(statusCounts, decision.finalStatus);
    const row = systemStatusCounts[decision.requirement.systemCode] || {};
    increment(row, decision.finalStatus);
    systemStatusCounts[decision.requirement.systemCode] = row;
  }

  const featuresByVariant = new Map();
  for (const association of activeAssociations) {
    const features = featuresByVariant.get(association.vehicleVariantKey) || new Set();
    features.add(association.systemCode);
    featuresByVariant.set(association.vehicleVariantKey, features);
  }
  const hasAny = (features, codes) => codes.some((code) => features.has(code));
  const vehicleCoverage = {
    oldSafeUniqueTargetBaseline: {
      requirements: 1474,
      vehicleVariants: 279,
      source: "verified frozen manifest; old links are evidence only",
    },
    newDryRun: {
      vehicleVariants: featuresByVariant.size,
      engineOil: [...featuresByVariant.values()].filter((features) => features.has("ENGINE_OIL")).length,
      transmission: [...featuresByVariant.values()].filter((features) => hasAny(features, [...new Set(["AUTOMATIC_TRANSMISSION", "MANUAL_TRANSMISSION", "CVT_TRANSMISSION", "ROBOT_TRANSMISSION", "TRANSMISSION_GENERIC"])])).length,
      drivetrain: [...featuresByVariant.values()].filter((features) => hasAny(features, ["TRANSFER_CASE", "FRONT_DIFFERENTIAL", "REAR_DIFFERENTIAL", "DIFFERENTIAL_GENERIC", "AWD_COUPLING"])).length,
      coolant: [...featuresByVariant.values()].filter((features) => features.has("ENGINE_COOLANT")).length,
      brakeFluid: [...featuresByVariant.values()].filter((features) => features.has("BRAKE_FLUID")).length,
      coreProfile: [...featuresByVariant.values()].filter((features) => features.has("ENGINE_OIL") && hasAny(features, ["AUTOMATIC_TRANSMISSION", "MANUAL_TRANSMISSION", "CVT_TRANSMISSION", "ROBOT_TRANSMISSION", "TRANSMISSION_GENERIC"]) && features.has("ENGINE_COOLANT") && features.has("BRAKE_FLUID")).length,
    },
  };
  vehicleCoverage.comparison = {
    absoluteDelta: vehicleCoverage.newDryRun.vehicleVariants - vehicleCoverage.oldSafeUniqueTargetBaseline.vehicleVariants,
    ratio: Number((vehicleCoverage.newDryRun.vehicleVariants / vehicleCoverage.oldSafeUniqueTargetBaseline.vehicleVariants).toFixed(3)),
  };

  const reviewItems = compactDecisions
    .filter((decision) => !["CONFIRMED_SINGLE", "CONFIRMED_MULTI_APPLICABILITY"].includes(decision.finalStatus) || decision.parserNeedsReview)
    .map((decision) => ({
      id: decision.id,
      status: decision.finalStatus,
      systemCode: decision.requirement.systemCode,
      make: decision.requirement.make,
      model: decision.requirement.model,
      generation: decision.requirement.generation,
      engineCode: decision.requirement.engineCodeNormalized,
      yearFrom: decision.requirement.yearFrom,
      yearTo: decision.requirement.yearTo,
      candidateVariantIds: decision.match.topCandidates.slice(0, 5).flatMap((candidate) => candidate.variantIds),
      topCandidates: decision.match.topCandidates.slice(0, 5),
      reviewReasons: decision.match.reviewReasons,
      conflictTypes: unique([...decision.match.conflictTypes, ...(decision.finalStatus === "CONFLICT" ? ["MATERIALIZATION_CONFLICT_OR_MATCH_CONTRADICTION"] : [])]),
      parserNeedsReview: decision.parserNeedsReview,
      hasCapacity: decision.capacity.capacities.length > 0,
      hasSpecification: Boolean(decision.requirement.specificationText),
      sourceUrl: decision.requirement.sourceUrl,
    }));
  for (const item of reviewItems) item.priority = reviewPriority(item);

  const reviewGroupsMap = new Map();
  for (const item of reviewItems) {
    const key = hash({
      status: item.status,
      systemCode: item.systemCode,
      make: item.make,
      model: item.model,
      generation: item.generation,
      engineCode: item.engineCode,
      years: [item.yearFrom, item.yearTo],
      candidates: item.candidateVariantIds.slice().sort(),
      conflicts: item.conflictTypes.slice().sort(),
    });
    const current = reviewGroupsMap.get(key) || {
      groupId: key,
      priority: item.priority,
      status: item.status,
      systemCode: item.systemCode,
      make: item.make,
      model: item.model,
      generation: item.generation,
      engineCode: item.engineCode,
      years: [item.yearFrom, item.yearTo],
      requirementIds: [],
      candidateVariantIds: [],
      conflictTypes: [],
      reasons: [],
      sourceUrls: [],
    };
    current.requirementIds.push(item.id);
    current.candidateVariantIds = unique([...current.candidateVariantIds, ...item.candidateVariantIds]);
    current.conflictTypes = unique([...current.conflictTypes, ...item.conflictTypes]);
    current.reasons = unique([...current.reasons, ...item.reviewReasons]);
    current.sourceUrls = unique([...current.sourceUrls, item.sourceUrl]);
    if (item.priority < current.priority) current.priority = item.priority;
    reviewGroupsMap.set(key, current);
  }
  const reviewGroups = [...reviewGroupsMap.values()].map((group) => ({
    ...group,
    requirementCount: group.requirementIds.length,
    impactedVehicleCandidates: group.candidateVariantIds.length,
    impactedSystems: 1,
  })).sort((left, right) => left.priority.localeCompare(right.priority) || right.requirementCount - left.requirementCount || left.groupId.localeCompare(right.groupId));

  const activeSample = stratifiedSample(activeAssociations, Math.min(200, activeAssociations.length), (association) => [
    association.vehicleContext.make,
    association.systemCode,
    association.vehicleContext.fuelType,
    association.vehicleContext.transmissionType,
  ].join("|"));
  const dangerousActive = activeAssociations.filter((association) => dangerousSystem(association.systemCode));
  const dangerousSample = stratifiedSample(dangerousActive, Math.min(200, dangerousActive.length), (association) => `${association.systemCode}|${association.vehicleContext.make}`);

  const proxyPool = compactDecisions.filter((decision) => {
    const oldHigh = decision.oldLinks.filter((link) => link.status === "auto_matched" && link.confidence === "high");
    return unique(oldHigh.map((link) => link.mannVariantKey)).length === 1;
  });
  const proxySample = stratifiedSample(proxyPool.map((decision) => ({ ...decision, associationFingerprint: decision.id })), Math.min(200, proxyPool.length), (decision) => `${decision.requirement.make}|${decision.requirement.systemCode}`);
  const retrievalProxy = { sampleSize: proxySample.length, top1: 0, top3: 0, top20: 0 };
  for (const decision of proxySample) {
    const expected = unique(decision.oldLinks.filter((link) => link.status === "auto_matched" && link.confidence === "high").map((link) => link.mannVariantKey))[0];
    const ranks = decision.match.topCandidates.map((candidate) => candidate.variantIds);
    if (ranks.slice(0, 1).some((ids) => ids.includes(expected))) retrievalProxy.top1 += 1;
    if (ranks.slice(0, 3).some((ids) => ids.includes(expected))) retrievalProxy.top3 += 1;
    if (ranks.slice(0, 20).some((ids) => ids.includes(expected))) retrievalProxy.top20 += 1;
  }
  for (const key of ["top1", "top3", "top20"]) {
    retrievalProxy[`${key}Rate`] = proxySample.length ? Number((retrievalProxy[key] / proxySample.length).toFixed(4)) : null;
  }
  retrievalProxy.datasetQuality = "PROVISIONAL_LEGACY_UNIQUE_TARGET_EVIDENCE_NOT_GOLDEN_TRUTH";
  retrievalProxy.usedForMatcherDecisions = false;

  const preview = {
    schemaVersion: 1,
    artifactKind: "MANN_TECHNICAL_MATERIALIZATION_DRY_RUN",
    writeMode: "DRY_RUN_ONLY",
    generatedAt,
    commit,
    algorithms: { matcher: MANN_FLUID_MATCHER_VERSION, capacityParser: FLUID_CAPACITY_PARSER_VERSION },
    sourceSnapshot: {
      kind: currentTimewebSnapshot ? "timeweb-logical-backup-local-restore" : "frozen-local-postgresql-snapshot",
      archiveId: snapshotId,
      backupStartedAt: snapshotCreatedAt,
      backupSha256: snapshotSha256,
      currentTimewebSnapshot,
      transactionReadOnly: true,
    },
    proposedAssociations: associations,
  };
  const summary = {
    generatedAt,
    commit,
    algorithms: preview.algorithms,
    scope: {
      requirements: snapshot.requirements.length,
      mannRows: snapshot.mannRows.length,
      mannVehicleVariants: new Set(snapshot.mannRows.map((row) => row.vehicleVariantKey)).size,
      legacyLinksReadAsEvidenceOnly: snapshot.oldLinks.length,
      truncated: Boolean(maxRequirements),
    },
    classification: statusCounts,
    systemClassification: systemStatusCounts,
    materialization: {
      proposedBeforeSemanticDedupe: proposedAssociations.length,
      afterSemanticDedupe: associations.length,
      activeAssociations: activeAssociations.length,
      reviewAssociations: associations.length - activeAssociations.length,
      exactDuplicateAssociationsCollapsed: proposedAssociations.length - associations.length,
      capacityConflictGroups,
      conditionalAlternativeGroups,
      parserReviewAssociations: associations.filter((association) => association.conflictTypes.includes("CAPACITY_PARSER_REVIEW_REQUIRED")).length,
    },
    vehicleCoverage,
    reviewQueue: {
      requirements: reviewItems.length,
      groups: reviewGroups.length,
      byPriority: reviewGroups.reduce((counts, group) => ({ ...counts, [group.priority]: (counts[group.priority] || 0) + 1 }), {}),
    },
    retrievalProxy,
    manualReview: {
      activeSampleSize: activeSample.length,
      dangerousSystemsSampleSize: dangerousSample.length,
      status: "PENDING_HUMAN_REVIEW",
    },
    gates: {
      noDatabaseWrites: true,
      sourceSnapshotReadOnly: true,
      runtimeCutover: false,
      currentTimewebSnapshotAudited: currentTimewebSnapshot,
      goldenOrManualMatcherSetAvailable: false,
      activeSampleManuallyReviewed: false,
      dangerousSystemsManuallyReviewed: false,
      decision: "NO_GO",
      blockingReasons: [
        ...(!currentTimewebSnapshot ? ["нет актуального read-only Timeweb snapshot/backup"] : []),
        "Top-N измерен только на legacy proxy, не на golden/manual truth set",
        "200 ACTIVE и dangerous-system samples ожидают независимого ручного review",
      ],
    },
  };

  const coverageRows = Object.entries(systemStatusCounts).flatMap(([systemCode, counts]) => Object.entries(counts).map(([status, count]) => ({ systemCode, status, count })));
  const reviewCsvColumns = ["groupId", "priority", "status", "systemCode", "make", "model", "generation", "engineCode", "years", "requirementCount", "impactedVehicleCandidates", "candidateVariantIds", "conflictTypes", "reasons"];
  await Promise.all([
    writeFile(resolve(outputDir, "mann-technical-materialization-preview.json"), `${JSON.stringify(preview, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDir, "mann-technical-materialization-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDir, "coverage.json"), `${JSON.stringify({ classification: statusCounts, bySystem: systemStatusCounts, vehicleCoverage }, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDir, "coverage.csv"), toCsv(coverageRows, ["systemCode", "status", "count"]), "utf8"),
    writeFile(resolve(outputDir, "review-queue.json"), `${JSON.stringify({ requirements: reviewItems, groups: reviewGroups }, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDir, "review-queue.csv"), toCsv(reviewGroups, reviewCsvColumns), "utf8"),
    writeFile(resolve(outputDir, "active-association-sample-200.json"), `${JSON.stringify({ status: "PENDING_HUMAN_REVIEW", sample: activeSample }, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDir, "dangerous-systems-review.json"), `${JSON.stringify({ status: "PENDING_HUMAN_REVIEW", population: dangerousActive.length, sample: dangerousSample }, null, 2)}\n`, "utf8"),
    writeFile(resolve(outputDir, "retrieval-legacy-proxy.json"), `${JSON.stringify({ metrics: retrievalProxy, cases: proxySample.map((decision) => ({ requirementId: decision.id, expectedLegacyVariant: unique(decision.oldLinks.filter((link) => link.status === "auto_matched" && link.confidence === "high").map((link) => link.mannVariantKey))[0], topCandidates: decision.match.topCandidates })) }, null, 2)}\n`, "utf8"),
  ]);

  process.stdout.write(`${JSON.stringify({ outputDir, summary }, null, 2)}\n`);
} catch (error) {
  decisionStream.destroy();
  throw error;
} finally {
  await prisma.$disconnect();
}
