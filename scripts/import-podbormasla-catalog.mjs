#!/usr/bin/env node
/** Dry-run by default. Add --apply only after reviewing the generated match report. */

import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name) {
  return args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}

function helpText() {
  return `Usage: node scripts/import-podbormasla-catalog.mjs [snapshot-dir] [options]\n\n` +
    `Options:\n` +
    `  --mann-dir=PATH     MANN extraction directory (defaults to latest output)\n` +
    `  --report-dir=PATH   Report destination (defaults to snapshot directory)\n` +
    `  --apply             Replace current fluid rows and write matches to PostgreSQL\n` +
    `  --help              Show this message\n`;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(helpText());
  process.exit(0);
}

async function latestOutput(prefix) {
  const outputRoot = resolve(workspaceRoot, "outputs");
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const matches = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix)).map((entry) => entry.name).sort();
  const latest = matches.at(-1);
  if (!latest) throw new Error(`В outputs не найдена папка ${prefix}*`);
  return resolve(outputRoot, latest);
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function reviewCsv(rows) {
  const columns = [
    "requirementId",
    "sourceUrl",
    "make",
    "model",
    "generation",
    "engineCodes",
    "years",
    "systemCode",
    "systemName",
    "status",
    "candidateCount",
    "bestScore",
    "bestMannModel",
    "bestMannVehicle",
    "bestMannEngine",
    "evidence",
  ];
  return `${[columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n")}\n`;
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

function arrayValue(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function reviewContextRows(prepared) {
  const reviewIds = new Set(prepared.reviewRows.filter((row) => row.status === "review_required").map((row) => row.requirementId));
  const linksByRequirement = new Map();
  for (const link of prepared.links.filter((item) => item.status === "review_required")) {
    const current = linksByRequirement.get(link.requirementId) ?? [];
    current.push(link);
    linksByRequirement.set(link.requirementId, current);
  }
  const groups = new Map();
  for (const requirement of prepared.requirements.filter((item) => reviewIds.has(item.id))) {
    const identity = [
      requirement.makeNormalized,
      requirement.modelNormalized,
      requirement.generationNumber ?? "",
      arrayValue(requirement.bodyCodesJson).join("+"),
      arrayValue(requirement.engineCodesJson).join("+"),
      requirement.engineVolumeCc ?? "",
      requirement.powerHp ?? "",
      requirement.powerKw ?? "",
      requirement.fuelType ?? "",
      requirement.yearFrom ?? "",
      requirement.yearTo ?? "",
    ].join("|");
    const contextId = createHash("sha256").update(identity).digest("hex");
    const group = groups.get(contextId) ?? {
      contextId,
      sourceUrls: new Set(),
      make: requirement.make,
      model: requirement.model,
      generation: requirement.generation ?? "",
      bodyCodes: arrayValue(requirement.bodyCodesJson).join("; "),
      engineCodes: arrayValue(requirement.engineCodesJson).join("; "),
      engineVolumeCc: requirement.engineVolumeCc ?? "",
      powerHp: requirement.powerHp ?? "",
      powerKw: requirement.powerKw ?? "",
      fuelType: requirement.fuelType ?? "",
      years: [requirement.yearFrom, requirement.yearTo].filter((value) => value != null).join("-"),
      requirementIds: new Set(),
      systems: new Set(),
      candidates: new Map(),
    };
    group.sourceUrls.add(requirement.sourceUrl);
    group.requirementIds.add(requirement.id);
    group.systems.add(requirement.systemCode);
    for (const link of linksByRequirement.get(requirement.id) ?? []) {
      group.candidates.set(link.mannVariantKey, {
        mannVariantKey: link.mannVariantKey,
        model: link.mannModel,
        vehicle: link.mannVehicleText,
        engine: link.mannEngineCode,
        score: link.matchScore,
        evidence: link.evidenceJson,
      });
    }
    groups.set(contextId, group);
  }
  return [...groups.values()].map((group) => {
    const candidates = [...group.candidates.values()].sort((left, right) => right.score - left.score);
    return {
      contextId: group.contextId,
      sourceUrls: [...group.sourceUrls].join("; "),
      make: group.make,
      model: group.model,
      generation: group.generation,
      bodyCodes: group.bodyCodes,
      engineCodes: group.engineCodes,
      engineVolumeCc: group.engineVolumeCc,
      powerHp: group.powerHp,
      powerKw: group.powerKw,
      fuelType: group.fuelType,
      years: group.years,
      requirementCount: group.requirementIds.size,
      systems: [...group.systems].sort().join("; "),
      candidateCount: candidates.length,
      bestScore: candidates[0]?.score ?? "",
      candidatesJson: JSON.stringify(candidates),
      decision: "",
      note: "",
    };
  }).sort((left, right) => right.requirementCount - left.requirementCount || left.make.localeCompare(right.make) || left.model.localeCompare(right.model));
}

function reviewContextsCsv(rows) {
  const columns = [
    "contextId", "sourceUrls", "make", "model", "generation", "bodyCodes", "engineCodes",
    "engineVolumeCc", "powerHp", "powerKw", "fuelType", "years", "requirementCount", "systems",
    "candidateCount", "bestScore", "candidatesJson", "decision", "note",
  ];
  return `${[columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n")}\n`;
}

const positional = args.filter((value) => !value.startsWith("--"));
const snapshotDir = positional[0] ? resolve(workspaceRoot, positional[0]) : await latestOutput("podbormasla-");
const mannDirOption = option("--mann-dir");
const mannDir = mannDirOption ? resolve(workspaceRoot, mannDirOption) : await latestOutput("mann-pdf-catalog-");
const reportDirOption = option("--report-dir");
const reportDir = reportDirOption ? resolve(workspaceRoot, reportDirOption) : snapshotDir;
const apply = args.includes("--apply");

const rowsPath = resolve(snapshotDir, "podbormasla_rows.ndjson");
const summaryPath = resolve(snapshotDir, "podbormasla_summary.json");
const mannFiltersPath = resolve(mannDir, "mann_pdf_filters_long.csv");
const [rowsNdjson, summaryJson, mannFiltersCsv] = await Promise.all([
  readFile(rowsPath, "utf8"),
  readFile(summaryPath, "utf8"),
  readFile(mannFiltersPath, "utf8"),
]);

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const { importFluidCatalog, prepareFluidCatalog } = await jiti.import("../src/lib/fluid-catalog.ts");
const input = { rowsNdjson, summaryJson, mannFiltersCsv };
const prepared = prepareFluidCatalog(input);
const reviewContexts = reviewContextRows(prepared);
const report = {
  schemaVersion: 1,
  action: apply ? "validated_before_apply" : "dry_run",
  generatedAt: new Date().toISOString(),
  source: {
    snapshotDirectory: snapshotDir,
    rowsFile: basename(rowsPath),
    mannDirectory: mannDir,
    mannFiltersFile: basename(mannFiltersPath),
  },
  stats: prepared.stats,
  review: {
    contextCount: reviewContexts.length,
    statusCounts: countBy(prepared.reviewRows, (row) => row.status),
    unmatchedByModel: countBy(prepared.reviewRows.filter((row) => row.status === "unmatched"), (row) => `${row.make} ${row.model}`),
    reviewByModel: countBy(prepared.reviewRows.filter((row) => row.status === "review_required"), (row) => `${row.make} ${row.model}`),
  },
};

const reportJsonPath = resolve(reportDir, "podbormasla_mann_match_report.json");
const reviewCsvPath = resolve(reportDir, "podbormasla_mann_match_review.csv");
const reviewContextsCsvPath = resolve(reportDir, "podbormasla_mann_match_review_contexts.csv");
await Promise.all([
  writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`),
  writeFile(reviewCsvPath, reviewCsv(prepared.reviewRows)),
  writeFile(reviewContextsCsvPath, reviewContextsCsv(reviewContexts)),
]);

console.info(JSON.stringify({
  action: "validated",
  reportJsonPath,
  reviewCsvPath,
  reviewContextsCsvPath,
  ...prepared.stats,
}, null, 2));

if (prepared.stats.warnings.length > 0) {
  console.error("Импорт остановлен из-за предупреждений контрольной проверки.");
  process.exit(1);
}
if (!apply) process.exit(0);

const imported = await importFluidCatalog({
  ...input,
  rowsFileName: basename(rowsPath),
  replaceExisting: true,
});
console.info(JSON.stringify({ action: "imported", ...imported }, null, 2));
