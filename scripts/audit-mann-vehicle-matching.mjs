import assert from "node:assert/strict";
import fs from "node:fs";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": new URL("../src", import.meta.url).pathname },
});

const {
  normalizeDecodedVehicleForTest,
  rankMannCandidatesForTest,
} = await jiti.import("../src/lib/mann-vehicle-resolver.ts");

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const demandDumpPath = argument("vehicle-records");
const mannDumpPath = argument("mann-catalog");
const decodedCacheDumpPath = argument("decoded-cache");
const summaryOnly = process.argv.includes("--summary");
if (!demandDumpPath || !mannDumpPath) {
  throw new Error("Usage: node scripts/audit-mann-vehicle-matching.mjs --vehicle-records=<data-only SQL> --mann-catalog=<data-only SQL>");
}

function unescapeCopyValue(value) {
  if (value === "\\N") return null;
  return value.replace(/\\([btnr\\])/g, (_, code) => ({
    b: "\b",
    t: "\t",
    n: "\n",
    r: "\r",
    "\\": "\\",
  })[code]);
}

function readCopyRows(filePath, table) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith(`COPY public.${table} (`));
  if (headerIndex < 0) throw new Error(`COPY section for ${table} was not found in ${filePath}`);
  const columns = lines[headerIndex].match(/\((.*)\) FROM stdin;/)?.[1]?.split(", ");
  if (!columns) throw new Error(`COPY columns for ${table} could not be parsed`);

  const rows = [];
  for (let index = headerIndex + 1; index < lines.length && lines[index] !== "\\."; index += 1) {
    const values = lines[index].split("\t").map(unescapeCopyValue);
    rows.push(Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex]])));
  }
  return rows;
}

function demandVehicleRecords(rows) {
  const records = [];
  for (const row of rows) {
    let attributes;
    try {
      attributes = JSON.parse(row.attributes);
    } catch {
      continue;
    }
    if (!Array.isArray(attributes)) continue;
    const value = (pattern) => attributes.find((attribute) => pattern.test(String(attribute?.name ?? "")))?.value;
    const sourceModel = String(value(/модель авто/i) ?? "").trim().toUpperCase().replace(/\s+/g, " ");
    const plate = String(value(/гос/i) ?? "").trim().toUpperCase();
    const year = Number(String(value(/^год$/i) ?? "").match(/(?:19|20)\d{2}/)?.[0]);
    if (!sourceModel || !plate || year < 1980 || year > 2026) continue;
    records.push({ plate, sourceModel, year });
  }
  return records;
}

const auditProfiles = [
  { sourceModel: "KIA CEED", year: 2015, makeRaw: "KIA", modelRaw: "Ceed" },
  { sourceModel: "LEXUS GS 300", year: 2014, makeRaw: "LEXUS", modelRaw: "GS" },
  { sourceModel: "MITSUBISHI ASX", year: 2014, makeRaw: "MITSUBISHI", modelRaw: "ASX" },
  { sourceModel: "BMW 5 GT", year: 2012, makeRaw: "BMW", modelRaw: "5 GT" },
  { sourceModel: "AUDI Q5/SPORTBACK", year: 2013, makeRaw: "AUDI", modelRaw: "Q5" },
  { sourceModel: "OPEL OMEGA B", year: 1997, makeRaw: "OPEL", modelRaw: "Omega B" },
  { sourceModel: "BMW 2", year: 2020, makeRaw: "BMW", modelRaw: "2" },
  { sourceModel: "RENAULT CAPTUR 1.6", year: 2019, makeRaw: "RENAULT", modelRaw: "Captur", engineVolumeCc: 1600 },
  { sourceModel: "NISSAN ALMERA", year: 2012, makeRaw: "NISSAN", modelRaw: "Almera" },
  { sourceModel: "KIA SPORTAGE", year: 2017, makeRaw: "KIA", modelRaw: "Sportage" },
  { sourceModel: "VW POLO", year: 2020, makeRaw: "VOLKSWAGEN", modelRaw: "Polo" },
  { sourceModel: "VOLKSWAGEN TRANSPORTER", year: 2002, makeRaw: "VOLKSWAGEN", modelRaw: "Transporter" },
  { sourceModel: "NISSAN X-TRAIL", year: 2011, makeRaw: "NISSAN", modelRaw: "X-Trail" },
  { sourceModel: "KIA CERATO", year: 2015, makeRaw: "KIA", modelRaw: "Cerato" },
  { sourceModel: "MERCEDES-BENZ E 350 4MATIC", year: 2013, makeRaw: "MERCEDES-BENZ", modelRaw: "E-Class" },
  { sourceModel: "MAZDA CX 5", year: 2020, makeRaw: "MAZDA", modelRaw: "CX-5" },
  { sourceModel: "BMW X3 2.0D", year: 2009, makeRaw: "BMW", modelRaw: "X3" },
  { sourceModel: "HYUNDAI TUCSON", year: 2016, makeRaw: "HYUNDAI", modelRaw: "Tucson" },
  { sourceModel: "HONDA ACCORD", year: 2009, makeRaw: "HONDA", modelRaw: "Accord" },
  { sourceModel: "TOYOTA RAV4", year: 2018, makeRaw: "TOYOTA", modelRaw: "RAV4" },
];

const demandRecords = demandVehicleRecords(readCopyRows(demandDumpPath, "local_demands"));
const selectedProfiles = auditProfiles.map((profile, index) => {
  const record = demandRecords.find((candidate) => candidate.sourceModel === profile.sourceModel && candidate.year === profile.year);
  assert.ok(record, `historical plate record ${profile.sourceModel} (${profile.year}) must exist`);
  return { ...profile, sample: `P${String(index + 1).padStart(2, "0")}`, plate: record.plate };
});
assert.equal(new Set(selectedProfiles.map((profile) => profile.plate)).size, auditProfiles.length, "audit must use 20 different plate records");

const mannRows = readCopyRows(mannDumpPath, "mann_filter_applications").map((row) => ({
  vehicleVariantKey: row.vehicle_variant_key,
  make: row.make,
  makeNormalized: row.make_normalized,
  model: row.model,
  modelNormalized: row.model_normalized,
  vehicleText: row.vehicle_text,
  effectiveVehicleText: row.effective_vehicle_text,
  engineCode: row.engine_code,
  engineCodeNormalized: row.engine_code_normalized,
  kw: row.kw,
  hp: row.hp,
  vehicleYears: row.vehicle_years,
  vehicleYearFrom: row.vehicle_year_from == null ? null : Number(row.vehicle_year_from),
  vehicleYearTo: row.vehicle_year_to == null ? null : Number(row.vehicle_year_to),
  condition: row.condition,
}));

function auditVehicle(sample, vehicleLabel, decodedVehicle) {
  const normalized = normalizeDecodedVehicleForTest(decodedVehicle);
  assert.ok(normalized, `${sample} must normalize`);

  const accepted = rankMannCandidatesForTest(normalized, mannRows);
  const top = accepted[0];
  const runnerUp = accepted[1];
  const gap = top ? top.score - (runnerUp?.score ?? -999) : null;
  const autoSelected = top?.confidence === "high";
  return {
    sample,
    vehicle: vehicleLabel,
    accepted: accepted.length,
    topScore: top?.score ?? null,
    gap,
    autoSelected,
    top: accepted.slice(0, 3).map((candidate) => ({
      model: candidate.model,
      modification: candidate.effectiveVehicleText ?? candidate.vehicleText,
      engineCode: candidate.engineCode,
      score: candidate.score,
      matched: candidate.matchedFields,
      missing: candidate.missingFields,
    })),
  };
}

const results = selectedProfiles.map((profile) => auditVehicle(
  profile.sample,
  `${profile.makeRaw} ${profile.modelRaw} (${profile.year})`,
  {
    sourceMethods: ["historical_crm"],
    confidence: "medium",
    rawResultIds: [],
    vinStatus: "unknown",
    makeRaw: profile.makeRaw,
    modelRaw: profile.modelRaw,
    year: profile.year,
    engineVolumeCc: profile.engineVolumeCc,
  },
));

const decodedResults = [];
if (decodedCacheDumpPath) {
  const seen = new Set();
  for (const row of readCopyRows(decodedCacheDumpPath, "vehicle_lookup_cache")) {
    if (row.status !== "success" || !row.normalized_vehicle_json) continue;
    let vehicle;
    try {
      vehicle = JSON.parse(row.normalized_vehicle_json);
    } catch {
      continue;
    }
    if (!vehicle?.makeCanonical || !vehicle?.modelCanonical) continue;
    const signature = JSON.stringify([
      vehicle.makeCanonical,
      vehicle.modelCanonical,
      vehicle.generationRaw,
      vehicle.year,
      vehicle.bodyName,
      vehicle.engineSeries,
      vehicle.engineVolumeCc,
      vehicle.powerHp,
    ]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    const sample = `D${String(decodedResults.length + 1).padStart(2, "0")}`;
    decodedResults.push(auditVehicle(
      sample,
      `${vehicle.makeCanonical} ${vehicle.modelCanonical}${vehicle.generationRaw ? ` ${vehicle.generationRaw}` : ""}${vehicle.year ? ` (${vehicle.year})` : ""}`,
      vehicle,
    ));
  }
}

const autoSelected = results.filter((result) => result.autoSelected).length;
const report = {
  sampleSize: results.length,
  distinctHistoricalPlates: new Set(selectedProfiles.map((profile) => profile.plate)).size,
  mannCatalogRows: mannRows.length,
  autoSelected,
  manualConfirmationRequired: results.length - autoSelected,
  results,
  decodedCacheResults: decodedResults,
};
if (summaryOnly) {
  const compact = (items) => items.map((item) => ({
    sample: item.sample,
    vehicle: item.vehicle,
    accepted: item.accepted,
    topScore: item.topScore,
    gap: item.gap,
    autoSelected: item.autoSelected,
    top: item.top[0] ? `${item.top[0].model} · ${item.top[0].modification ?? "—"}` : null,
  }));
  console.log(JSON.stringify({
    sampleSize: report.sampleSize,
    distinctHistoricalPlates: report.distinctHistoricalPlates,
    mannCatalogRows: report.mannCatalogRows,
    autoSelected: report.autoSelected,
    manualConfirmationRequired: report.manualConfirmationRequired,
    results: compact(results),
    decodedCacheResults: compact(decodedResults),
  }, null, 2));
} else {
  console.log(JSON.stringify(report, null, 2));
}
