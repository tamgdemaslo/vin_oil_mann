import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function argumentsFor(name) {
  const prefix = `--${name}=`;
  return process.argv.filter((value) => value.startsWith(prefix)).map((value) => value.slice(prefix.length));
}

function argument(name, fallback = undefined) {
  return argumentsFor(name).at(-1) ?? fallback;
}

const sourcePath = argument("vehicle-records");
const datasetId = String(argument("dataset") ?? "").toUpperCase();
const outputPath = argument("output");
const count = Number(argument("count", ["C", "D"].includes(datasetId) ? "100" : "20"));
const seed = argument("seed", `mann-generalization-${datasetId}-2026-08-19`);
const excludePaths = argumentsFor("exclude-manifest");
const requireRecordedProfile = process.argv.includes("--require-recorded-profile");

if (!sourcePath || !outputPath || !/^[ABCD]$/.test(datasetId) || !Number.isInteger(count) || count < 1) {
  throw new Error("Usage: node scripts/prepare-mann-matching-dataset.mjs --vehicle-records=<dump.sql> --dataset=A|B|C|D --count=100 --seed=<seed> --output=<private.json> [--exclude-manifest=<private.json>]");
}

function unescapeCopyValue(value) {
  if (value === "\\N") return null;
  return value.replace(/\\([btnr\\])/g, (_, code) => ({ b: "\b", t: "\t", n: "\n", r: "\r", "\\": "\\" })[code]);
}

function readCopyRows(filePath, table) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith(`COPY public.${table} (`));
  if (headerIndex < 0) throw new Error(`COPY section for ${table} was not found`);
  const columns = lines[headerIndex].match(/\((.*)\) FROM stdin;/)?.[1]?.split(", ");
  if (!columns) throw new Error(`COPY columns for ${table} could not be parsed`);
  const rows = [];
  for (let index = headerIndex + 1; index < lines.length && lines[index] !== "\\."; index += 1) {
    const values = lines[index].split("\t").map(unescapeCopyValue);
    rows.push(Object.fromEntries(columns.map((column, columnIndex) => [column, values[columnIndex]])));
  }
  return rows;
}

const CYRILLIC_PLATE_LETTERS = "АВЕКМНОРСТУХ";
const LATIN_TO_CYRILLIC = { A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х", Y: "У" };

function normalizePlate(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/[ABCEHKMOPTXY]/g, (character) => LATIN_TO_CYRILLIC[character] ?? character);
}

function validPlate(value) {
  return new RegExp(`^[${CYRILLIC_PLATE_LETTERS}]\\d{3}[${CYRILLIC_PLATE_LETTERS}]{2}\\d{2,3}$`).test(value);
}

function attributeValue(attributes, pattern) {
  return attributes.find((attribute) => pattern.test(String(attribute?.name ?? "")))?.value;
}

const MAKE_PREFIXES = [
  "MERCEDES-BENZ", "LAND ROVER", "GREAT WALL", "ALFA ROMEO", "ASTON MARTIN",
  "VOLKSWAGEN", "MITSUBISHI", "SSANGYONG", "CHEVROLET", "CHRYSLER",
  "TOYOTA", "HYUNDAI", "RENAULT", "PEUGEOT", "CITROEN", "SUBARU",
  "NISSAN", "SKODA", "PORSCHE", "SUZUKI", "LEXUS", "INFINITI",
  "HAVAL", "CHERY", "GEELY", "MAZDA", "HONDA", "VOLVO", "OPEL",
  "FORD", "AUDI", "BMW", "MINI", "KIA", "VW", "LADA", "ВАЗ", "ГАЗ", "УАЗ",
];

function makeGroup(sourceModel) {
  const normalized = String(sourceModel ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const prefix = MAKE_PREFIXES.find((candidate) => normalized === candidate || normalized.startsWith(`${candidate} `));
  if (prefix === "VW") return "VOLKSWAGEN";
  if (prefix === "ВАЗ") return "LADA";
  return prefix ?? "OTHER";
}

function recordFromDemand(row) {
  let attributes;
  try {
    attributes = JSON.parse(row.attributes);
  } catch {
    return null;
  }
  if (!Array.isArray(attributes)) return null;
  const plate = normalizePlate(attributeValue(attributes, /гос/i));
  const sourceModel = String(attributeValue(attributes, /модель авто/i) ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const recordedYear = Number(String(attributeValue(attributes, /^год$/i) ?? "").match(/(?:19|20)\d{2}/)?.[0]) || null;
  if (!validPlate(plate) || !sourceModel) return null;
  if (requireRecordedProfile && !recordedYear) return null;
  return {
    plate,
    sourceModel,
    recordedYear,
    makeGroup: makeGroup(sourceModel),
    shipmentName: row.name,
    momentAt: row.moment_at,
  };
}

const PREVIOUS_PROFILE_KEYS = new Set([
  "KIA CEED|2015", "LEXUS GS 300|2014", "MITSUBISHI ASX|2014", "BMW 5 GT|2012", "AUDI Q5/SPORTBACK|2013",
  "OPEL OMEGA B|1997", "BMW 2|2020", "RENAULT CAPTUR 1.6|2019", "NISSAN ALMERA|2012", "KIA SPORTAGE|2017",
  "VW POLO|2020", "VOLKSWAGEN TRANSPORTER|2002", "NISSAN X-TRAIL|2011", "KIA CERATO|2015", "MERCEDES-BENZ E 350 4MATIC|2013",
  "MAZDA CX 5|2020", "BMW X3 2.0D|2009", "HYUNDAI TUCSON|2016", "HONDA ACCORD|2009", "TOYOTA RAV4|2018",
  "FORD FOCUS|2012", "SKODA OCTAVIA|2014", "NISSAN MICRA|2008", "MINI COOPER|2010", "TOYOTA COROLLA|2015",
  "MERCEDES-BENZ GLK 300|2012", "TOYOTA LAND CRUISER 200 V8|2008", "SUBARU FORESTER|2013", "KIA RIO|2019", "CHEVROLET AVEO|2013",
  "MAZDA 3|2006", "SSANGYONG KORANDO|2012", "BMW 520D|2018", "JAGUAR XF|2012", "VOLKSWAGEN JETTA|2008",
  "SKODA KODIAQ|2020", "PEUGEOT 3008|2018", "AUDI A6|2009", "TOYOTA AVENSIS|2007", "VOLKSWAGEN TOUAREG|2007",
]);

const excludedPlates = new Set();
for (const manifestPath of excludePaths) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const sample of manifest.samples ?? []) excludedPlates.add(normalizePlate(sample.plate));
}

const latestByPlate = new Map();
for (const row of readCopyRows(sourcePath, "local_demands")) {
  const record = recordFromDemand(row);
  if (!record) continue;
  if (PREVIOUS_PROFILE_KEYS.has(`${record.sourceModel}|${record.recordedYear}`)) {
    excludedPlates.add(record.plate);
    continue;
  }
  const current = latestByPlate.get(record.plate);
  if (!current || String(record.momentAt).localeCompare(String(current.momentAt)) > 0) latestByPlate.set(record.plate, record);
}

function stableRank(value) {
  return crypto.createHash("sha256").update(`${seed}|${value}`).digest("hex");
}

const eligible = [...latestByPlate.values()]
  .filter((record) => !excludedPlates.has(record.plate))
  .sort((left, right) => stableRank(left.plate).localeCompare(stableRank(right.plate)));

const buckets = new Map();
for (const record of eligible) {
  const bucket = buckets.get(record.makeGroup) ?? [];
  bucket.push(record);
  buckets.set(record.makeGroup, bucket);
}

const preferredGroups = [...buckets.entries()]
  .filter(([make, records]) => make !== "OTHER" && records.length > 0)
  .sort((left, right) => right[1].length - left[1].length || stableRank(left[0]).localeCompare(stableRank(right[0])))
  .map(([make]) => make);
const groupOrder = [...preferredGroups, ...(buckets.has("OTHER") ? ["OTHER"] : [])];
const selected = [];
let round = 0;
while (selected.length < count) {
  let added = false;
  for (const group of groupOrder) {
    const candidate = buckets.get(group)?.[round];
    if (!candidate) continue;
    selected.push(candidate);
    added = true;
    if (selected.length === count) break;
  }
  if (!added) break;
  round += 1;
}

assert.equal(selected.length, count, `Only ${selected.length} eligible records are available for ${datasetId}`);
assert.equal(new Set(selected.map((record) => record.plate)).size, count, "Dataset plates must be unique");
assert.ok(selected.every((record) => !excludedPlates.has(record.plate)), "Dataset must not overlap excluded manifests");

const manifest = {
  schemaVersion: 1,
  datasetId,
  purpose: datasetId === "A" ? "development" : datasetId === "B" ? "blind-control" : "unseen-random",
  seed,
  selectedAt: new Date().toISOString(),
  sourceFileHash: crypto.createHash("sha256").update(fs.readFileSync(sourcePath)).digest("hex"),
  exclusions: {
    priorHardcodedProfiles: PREVIOUS_PROFILE_KEYS.size,
    manifestDigests: excludePaths.map((manifestPath) => crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex")),
  },
  samples: selected.map((record, index) => ({
    sampleId: `${datasetId}${String(index + 1).padStart(3, "0")}`,
    plate: record.plate,
    identifierHash: crypto.createHash("sha256").update(record.plate).digest("hex"),
    historical: {
      sourceModel: record.sourceModel,
      recordedYear: record.recordedYear,
      shipmentName: record.shipmentName,
      momentAt: record.momentAt,
      makeGroup: record.makeGroup,
    },
  })),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
const digest = crypto.createHash("sha256").update(fs.readFileSync(outputPath)).digest("hex");
const distribution = Object.fromEntries([...new Set(selected.map((record) => record.makeGroup))].sort().map((make) => [make, selected.filter((record) => record.makeGroup === make).length]));
console.log(JSON.stringify({ datasetId, count, purpose: manifest.purpose, digest, distribution, outputPath }, null, 2));
