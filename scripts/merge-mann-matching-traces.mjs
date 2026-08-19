import fs from "node:fs";
import path from "node:path";

const outputArg = process.argv.find((value) => value.startsWith("--output="));
const inputArgs = process.argv.filter((value) => value.startsWith("--input="));
if (!outputArg || inputArgs.length < 1) {
  throw new Error("Usage: node scripts/merge-mann-matching-traces.mjs --input=<report.json> [--input=<report.json>] --output=<private.json>");
}
const outputPath = outputArg.slice("--output=".length);
const reports = inputArgs.map((value) => JSON.parse(fs.readFileSync(value.slice("--input=".length), "utf8")));
const [first] = reports;
for (const report of reports) {
  if (report.datasetId !== first.datasetId || report.manifestDigest !== first.manifestDigest) throw new Error("Trace parts belong to different datasets/manifests");
}
const resultsBySample = new Map();
for (const report of reports) {
  for (const result of report.results ?? []) resultsBySample.set(result.sampleId, { sampleId: result.sampleId, providerTrace: result.providerTrace });
}
const merged = {
  schemaVersion: 1,
  datasetId: first.datasetId,
  manifestDigest: first.manifestDigest,
  mergedAt: new Date().toISOString(),
  results: [...resultsBySample.values()].sort((left, right) => left.sampleId.localeCompare(right.sampleId)),
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputPath, datasetId: merged.datasetId, samples: merged.results.length }, null, 2));
