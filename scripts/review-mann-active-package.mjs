#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

const outputDir = path.resolve(argument(
  "output-dir",
  "outputs/mann-technical-catalog-v6-timeweb-backup-20260823-190344",
));
const packagePath = path.resolve(argument("package", path.join(outputDir, "mann-active-review-package.json")));
const reviewPath = path.resolve(argument("output", path.join(outputDir, "mann-active-codex-review.json")));
const csvPath = path.resolve(argument("csv", path.join(outputDir, "mann-active-codex-review.csv")));

const criticalFlags = new Set([
  "LOW_MATCH_SCORE",
  "NO_CHASSIS_IDENTITY_MATCH",
  "NO_EXACT_ENGINE_MATCH",
  "BROAD_SOURCE_ENGINE_GROUP",
  "MANN_PDF_CONTAMINATION",
  "MANN_CONDITION_PRESENT",
  "DRIVETRAIN_NOT_EXPLICIT_IN_MANN_TARGET",
  "HYDRAULIC_SYSTEM_TYPE_NOT_PROVEN_BY_MANN",
]);

const flagNotes = {
  LOW_MATCH_SCORE: "Недостаточно сильный score для независимого утверждения связи.",
  NO_CHASSIS_IDENTITY_MATCH: "Нужно вручную подтвердить поколение или код кузова.",
  NO_EXACT_ENGINE_MATCH: "Нужно вручную подтвердить применимость без точного кода двигателя.",
  BROAD_SOURCE_ENGINE_GROUP: "Source row объединяет слишком широкую группу двигателей.",
  MANN_PDF_CONTAMINATION: "В строке MANN есть признаки загрязнения текстом PDF.",
  MANN_CONDITION_PRESENT: "Дополнительное условие MANN требует отдельного подтверждения.",
  DRIVETRAIN_NOT_EXPLICIT_IN_MANN_TARGET: "MANN target явно не подтверждает тип привода.",
  HYDRAULIC_SYSTEM_TYPE_NOT_PROVEN_BY_MANN: "MANN target не подтверждает тип гидравлической системы.",
  NO_STRUCTURED_CAPACITY: "Связь проверяется без подтверждённого числового объёма; raw text сохранён.",
  NON_EXACT_CAPACITY: "Диапазон/приближённое значение сохранено без превращения в exact.",
  MULTIPLE_CAPACITY_FACTS: "Несколько значений разделены parser v5 по разным контекстам либо численно совпадают.",
  NO_STRUCTURED_SPECIFICATION: "Связь не подтверждает отсутствующую структурированную спецификацию.",
};

function unique(values) {
  return [...new Set(values)];
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const reviewPackage = JSON.parse(await readFile(packagePath, "utf8"));
const decisions = reviewPackage.associations.map((association) => {
  const blockingFlags = association.reviewFlags.filter((flag) => criticalFlags.has(flag));
  const verdict = blockingFlags.length > 0 ? "REVIEW" : "APPROVE";
  const reasonCodes = verdict === "REVIEW"
    ? blockingFlags
    : ["NO_CRITICAL_APPLICABILITY_OR_PARSER_FLAGS"];
  const notes = unique([
    ...(verdict === "APPROVE"
      ? ["Vehicle applicability и parser safety проходят проверенную консервативную policy."]
      : blockingFlags.map((flag) => flagNotes[flag] ?? flag)),
    ...association.reviewFlags
      .filter((flag) => !criticalFlags.has(flag))
      .map((flag) => flagNotes[flag] ?? flag),
  ]);
  return {
    associationFingerprint: association.associationFingerprint,
    samples: association.samples,
    requirementId: association.requirementId,
    vehicleVariantKey: association.vehicleVariantKey,
    systemCode: association.systemCode,
    sourceVehicle: association.sourceVehicle,
    mannTarget: association.mannTarget,
    match: association.match,
    technical: association.technical,
    sourceUrl: association.provenance.sourceUrl,
    reviewFlags: association.reviewFlags,
    verdict,
    reasonCodes,
    notes,
    reviewScope: "VEHICLE_APPLICABILITY_AND_PARSER_SAFETY",
  };
});

const byVerdict = {};
const bySystem = {};
const bySample = {};
for (const decision of decisions) {
  increment(byVerdict, decision.verdict);
  bySystem[decision.systemCode] ??= {};
  increment(bySystem[decision.systemCode], decision.verdict);
  for (const sample of decision.samples) {
    bySample[sample] ??= {};
    increment(bySample[sample], decision.verdict);
  }
}

const report = {
  version: "mann-active-codex-review-v1",
  reviewedAt: new Date().toISOString(),
  sourcePackage: packagePath,
  reviewer: {
    type: "CODEX_DATA_REVIEW",
    independentHuman: false,
    scope: "Vehicle applicability evidence, matcher contradictions, and capacity-parser safety.",
    limitation: "Не заменяет проверку технических фактов по официальной документации и человеческий sign-off.",
  },
  policy: {
    criticalFlags: [...criticalFlags],
    approveMeaning: "В проверяемом scope не найден критический флаг; это не разрешение на production migration.",
    reviewMeaning: "Связь нельзя считать независимо подтверждённой без ручной проверки указанного признака.",
  },
  counts: {
    decisions: decisions.length,
    byVerdict,
    bySystem,
    bySample,
  },
  gates: {
    allSampleRowsClassified: decisions.length === reviewPackage.counts.uniqueAssociations,
    criticalFlagsNeverApproved: decisions.every((decision) => (
      decision.verdict !== "APPROVE" || decision.reviewFlags.every((flag) => !criticalFlags.has(flag))
    )),
    independentHumanSignoff: false,
    migrationDecision: "NO_GO",
  },
  decisions,
};

const columns = [
  "associationFingerprint", "samples", "verdict", "systemCode", "sourceVehicle", "sourceYears",
  "sourceEngineCodes", "mannTarget", "mannVehicleText", "mannEngineCode", "matchScore", "fillVolumeText",
  "specificationText", "reviewFlags", "reasonCodes", "notes", "sourceUrl",
];
const csvRows = decisions.map((decision) => ({
  associationFingerprint: decision.associationFingerprint,
  samples: decision.samples,
  verdict: decision.verdict,
  systemCode: decision.systemCode,
  sourceVehicle: `${decision.sourceVehicle.make} ${decision.sourceVehicle.model} ${decision.sourceVehicle.generation ?? ""}`.trim(),
  sourceYears: decision.sourceVehicle.years,
  sourceEngineCodes: decision.sourceVehicle.engineCodes,
  mannTarget: `${decision.mannTarget.make} ${decision.mannTarget.model}`,
  mannVehicleText: decision.mannTarget.vehicleText,
  mannEngineCode: decision.mannTarget.engineCode,
  matchScore: decision.match.score,
  fillVolumeText: decision.technical.fillVolumeText,
  specificationText: decision.technical.specificationText,
  reviewFlags: decision.reviewFlags,
  reasonCodes: decision.reasonCodes,
  notes: decision.notes,
  sourceUrl: decision.sourceUrl,
}));
const csv = `${[columns.join(","), ...csvRows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n")}\n`;

await Promise.all([
  writeFile(reviewPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  writeFile(csvPath, csv, "utf8"),
]);
process.stdout.write(`${JSON.stringify({ reviewPath, csvPath, counts: report.counts, gates: report.gates }, null, 2)}\n`);
