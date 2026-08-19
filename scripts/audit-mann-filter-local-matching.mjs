import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": new URL("../src", import.meta.url).pathname },
});

const { tronkClient } = await jiti.import("../src/lib/integrations/tronk/client.ts");
const { normalizePlateInput, normalizeVehicleMake, toVehicle } = await jiti.import("../src/lib/vehicle-identity.ts");
const { diagnoseMannCandidatesForTest, normalizeDecodedVehicleForTest } = await jiti.import("../src/lib/mann-vehicle-resolver.ts");
const { evaluateMannArticleProductMatch, normalizeMannArticle } = await jiti.import("../src/lib/mann-catalog.ts");

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const demandDumpPath = argument("vehicle-records");
const mannDumpPath = argument("mann-catalog");
const productsDumpPath = argument("local-products");
const stockDumpPath = argument("local-stock");
const linksDumpPath = argument("mann-links");
const lookupDumpPath = argument("lookup-cache");
const requestedSamples = new Set(String(argument("samples") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const liveDecode = process.argv.includes("--live-decode");
if (!demandDumpPath || !mannDumpPath || !productsDumpPath || !stockDumpPath || !linksDumpPath) {
  throw new Error("Pass --vehicle-records, --mann-catalog, --local-products, --local-stock and --mann-links data-only SQL files");
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
    const rawPlate = String(value(/гос/i) ?? "").trim();
    const plate = normalizePlateInput(rawPlate).normalized;
    const year = Number(String(value(/^год$/i) ?? "").match(/(?:19|20)\d{2}/)?.[0]);
    if (!sourceModel || !/^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/.test(plate) || year < 1980 || year > 2026) continue;
    records.push({ plate, sourceModel, year });
  }
  return records;
}

const previousProfileKeys = new Set([
  "KIA CEED|2015", "LEXUS GS 300|2014", "MITSUBISHI ASX|2014", "BMW 5 GT|2012", "AUDI Q5/SPORTBACK|2013",
  "OPEL OMEGA B|1997", "BMW 2|2020", "RENAULT CAPTUR 1.6|2019", "NISSAN ALMERA|2012", "KIA SPORTAGE|2017",
  "VW POLO|2020", "VOLKSWAGEN TRANSPORTER|2002", "NISSAN X-TRAIL|2011", "KIA CERATO|2015", "MERCEDES-BENZ E 350 4MATIC|2013",
  "MAZDA CX 5|2020", "BMW X3 2.0D|2009", "HYUNDAI TUCSON|2016", "HONDA ACCORD|2009", "TOYOTA RAV4|2018",
]);

const auditProfiles = [
  ["FORD FOCUS", 2012],
  ["SKODA OCTAVIA", 2014],
  ["NISSAN MICRA", 2008],
  ["MINI COOPER", 2010],
  ["TOYOTA COROLLA", 2015],
  ["MERCEDES-BENZ GLK 300", 2012],
  ["TOYOTA LAND CRUISER 200 V8", 2008],
  ["SUBARU FORESTER", 2013],
  ["KIA RIO", 2019],
  ["CHEVROLET AVEO", 2013],
  ["MAZDA 3", 2006],
  ["SSANGYONG KORANDO", 2012],
  ["BMW 520D", 2018],
  ["JAGUAR XF", 2012],
  ["VOLKSWAGEN JETTA", 2008],
  ["SKODA KODIAQ", 2020],
  ["PEUGEOT 3008", 2018],
  ["AUDI A6", 2009],
  ["TOYOTA AVENSIS", 2007],
  ["VOLKSWAGEN TOUAREG", 2007],
].map(([sourceModel, year], index) => ({ sourceModel, year, sample: `P${index + 21}` }));

const demandRecords = demandVehicleRecords(readCopyRows(demandDumpPath, "local_demands"));
const blockedPlates = new Set(demandRecords.filter((record) => previousProfileKeys.has(`${record.sourceModel}|${record.year}`)).map((record) => record.plate));
const usedPlates = new Set();
const selectedProfiles = auditProfiles.map((profile) => {
  const record = demandRecords.find((candidate) => (
    candidate.sourceModel === profile.sourceModel
    && candidate.year === profile.year
    && !blockedPlates.has(candidate.plate)
    && !usedPlates.has(candidate.plate)
  ));
  assert.ok(record, `${profile.sample} historical plate record must exist`);
  usedPlates.add(record.plate);
  return { ...profile, plate: record.plate };
});
assert.equal(usedPlates.size, 20, "the second audit must use 20 new distinct plate records");
const profilesToRun = requestedSamples.size > 0
  ? selectedProfiles.filter((profile) => requestedSamples.has(profile.sample))
  : selectedProfiles;
assert.equal(profilesToRun.length, requestedSamples.size || 20, "all requested sample IDs must exist");

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
  filterType: row.filter_type,
  filterSubtype: row.filter_subtype,
  mannArticle: row.mann_article,
}));

const products = readCopyRows(productsDumpPath, "local_products")
  .filter((row) => row.archived !== "t" && row.entity_type !== "service")
  .map((row) => ({
    id: row.id,
    name: row.name,
    article: row.article,
    code: row.code,
    brand: row.brand,
    oemParts: row.oem_parts,
    salePriceCents: Number(row.sale_price_cents) || 0,
  }));
const productsById = new Map(products.map((product) => [product.id, product]));
const stockByProduct = new Map();
for (const row of readCopyRows(stockDumpPath, "local_stock_balances")) {
  const current = stockByProduct.get(row.product_id) ?? { stock: 0, available: 0 };
  current.stock += Number(row.quantity) || 0;
  current.available += Number(row.available) || 0;
  stockByProduct.set(row.product_id, current);
}
const explicitLinks = new Map();
const explicitLinkRows = readCopyRows(linksDumpPath, "product_mann_links");
for (const row of explicitLinkRows) {
  const normalized = normalizeMannArticle(row.mann_article);
  if (!normalized) continue;
  const links = explicitLinks.get(normalized) ?? [];
  links.push({ productId: row.product_id, confidence: Number(row.confidence) || 100, reason: `ProductMannLink:${row.link_type || "manual"}` });
  explicitLinks.set(normalized, links);
}

function firstRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function findVin(value, depth = 0) {
  if (depth > 5 || !value || typeof value !== "object") return null;
  if (!Array.isArray(value)) {
    for (const [key, candidate] of Object.entries(value)) {
      if (/^vin$/i.test(key) && typeof candidate === "string" && /^[A-HJ-NPR-Z0-9]{17}$/i.test(candidate.trim())) return candidate.trim().toUpperCase();
    }
  }
  for (const candidate of Array.isArray(value) ? value : Object.values(value)) {
    const found = findVin(candidate, depth + 1);
    if (found) return found;
  }
  return null;
}

function decryptCachedRaw(value) {
  if (!value) return null;
  try {
    const [ivRaw, tagRaw, payloadRaw] = value.split(".");
    if (!ivRaw || !tagRaw || !payloadRaw) return null;
    const secret = process.env.TRONK_CACHE_ENCRYPTION_KEY?.trim() || process.env.SESSION_SECRET || "tronk-cache-change-me";
    const key = crypto.createHash("sha256").update(secret).digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(payloadRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8"));
  } catch {
    return null;
  }
}

const lookupRows = lookupDumpPath ? readCopyRows(lookupDumpPath, "vehicle_lookup_cache") : [];

function parsedCachedVehicle(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function cachedVehicleForPlate(plate) {
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const plateRows = lookupRows.filter((row) => (
    row.input_type === "plate"
    && row.normalized_input_hash === hash(plate)
    && row.status === "success"
  ));
  const direct = plateRows.map((row) => parsedCachedVehicle(row.normalized_vehicle_json)).filter(Boolean);
  const vins = plateRows.map((row) => findVin(decryptCachedRaw(row.raw_response_encrypted))).filter(Boolean);
  const decoded = vins.flatMap((vin) => lookupRows
    .filter((row) => row.input_type === "vin" && row.normalized_input_hash === hash(vin))
    .map((row) => parsedCachedVehicle(row.normalized_vehicle_json))
    .filter(Boolean));
  const candidates = [...direct, ...decoded].sort((left, right) => Object.keys(right).length - Object.keys(left).length);
  const vehicle = candidates[0];
  if (!vehicle) return null;
  const safeVehicle = { ...vehicle };
  delete safeVehicle.vin;
  delete safeVehicle.frameNumber;
  delete safeVehicle.licensePlate;
  return safeVehicle;
}

function primaryReports(raw) {
  const reports = firstRecord(raw.decode ?? raw.Decode).Reports ?? firstRecord(raw.decode ?? raw.Decode).reports;
  if (Array.isArray(reports)) return reports.filter((item) => item && typeof item === "object");
  if (reports && typeof reports === "object") return Object.values(reports).filter((item) => item && typeof item === "object");
  return [];
}

function mergeVehicle(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const merged = { ...primary };
  for (const [key, value] of Object.entries(secondary)) {
    if (merged[key] == null || merged[key] === "" || merged[key] === 0) merged[key] = value;
  }
  merged.sourceMethods = [...new Set([...(primary.sourceMethods ?? []), ...(secondary.sourceMethods ?? [])])];
  merged.rawResultIds = [];
  return merged;
}

async function decodePlate(plate) {
  const plateResult = await tronkClient.lookupVinByPlate(plate);
  const vin = plateResult.ok ? findVin(plateResult.data) : null;
  if (!vin) {
    const b2b = await tronkClient.lookupVehicleByPlate(plate);
    if (!b2b.ok) return { vehicle: null, error: plateResult.ok ? b2b.code : plateResult.code };
    const vehicle = toVehicle(firstRecord(b2b.data.result ?? b2b.data), "tronk_convertb2b");
    return { vehicle: vehicle.makeCanonical && vehicle.modelCanonical ? vehicle : null, error: null };
  }

  const primaryResult = await tronkClient.decodeVinPrimary(vin);
  const reports = primaryResult.ok ? primaryReports(primaryResult.data) : [];
  const primary = reports[0] ? toVehicle(firstRecord(reports[0].Data ?? reports[0].data ?? reports[0]), "tronk_vindecode") : null;
  const needsExtended = reports.length !== 1 || !primary?.makeCanonical || !primary?.modelCanonical || !(primary.engineCode || primary.engineSeries || primary.engineVolumeCc || primary.powerHp);
  let extended = null;
  if (needsExtended) {
    const extendedResult = await tronkClient.decodeVinExtended(vin);
    if (extendedResult.ok) extended = toVehicle(firstRecord(extendedResult.data.result), "tronk_vindecode2");
  }
  const vehicle = mergeVehicle(primary, extended);
  return { vehicle: vehicle?.makeCanonical && vehicle?.modelCanonical ? vehicle : null, error: primaryResult.ok ? null : primaryResult.code };
}

const historicalMakes = [
  "MERCEDES-BENZ",
  "VOLKSWAGEN",
  "SSANGYONG",
  "CHEVROLET",
  "TOYOTA",
  "SUBARU",
  "NISSAN",
  "SKODA",
  "PEUGEOT",
  "JAGUAR",
  "MAZDA",
  "FORD",
  "MINI",
  "AUDI",
  "BMW",
  "KIA",
];

function vehicleFromHistoricalProfile(profile) {
  const make = historicalMakes.find((candidate) => (
    profile.sourceModel === candidate || profile.sourceModel.startsWith(`${candidate} `)
  ));
  if (!make) return null;
  return {
    makeRaw: make,
    modelRaw: profile.sourceModel.slice(make.length).trim(),
    year: profile.year,
    sourceMethods: ["manual"],
    confidence: "medium",
    rawResultIds: [],
    vinStatus: "missing",
  };
}

function filtersForCandidate(candidate) {
  if (!candidate) return [];
  const byFilter = new Map();
  for (const row of mannRows) {
    if (row.vehicleVariantKey !== candidate.variantId || !row.mannArticle) continue;
    const key = `${row.filterType}:${row.filterSubtype ?? ""}:${normalizeMannArticle(row.mannArticle)}`;
    if (!byFilter.has(key)) byFilter.set(key, { type: row.filterType, subtype: row.filterSubtype, article: row.mannArticle });
  }
  return [...byFilter.values()];
}

function localMatchesFor(article) {
  const matches = new Map();
  for (const product of products) {
    const match = evaluateMannArticleProductMatch(product, article);
    if (match) matches.set(product.id, { product, ...match });
  }
  for (const link of explicitLinks.get(normalizeMannArticle(article)) ?? []) {
    const product = productsById.get(link.productId);
    if (!product) continue;
    const current = matches.get(product.id);
    if (!current || link.confidence > current.confidence) matches.set(product.id, { product, ...link });
  }
  return [...matches.values()].sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    return (stockByProduct.get(right.product.id)?.available ?? 0) - (stockByProduct.get(left.product.id)?.available ?? 0);
  });
}

const results = [];
for (const profile of profilesToRun) {
  const cachedVehicle = liveDecode ? null : cachedVehicleForPlate(profile.plate);
  const decoded = liveDecode
    ? await decodePlate(profile.plate)
    : { vehicle: cachedVehicle ?? vehicleFromHistoricalProfile(profile), error: null };
  const decodeSource = liveDecode ? "live" : cachedVehicle ? "cache" : "historical_profile";
  if (!decoded.vehicle) {
    results.push({ sample: profile.sample, expected: `${profile.sourceModel} (${profile.year})`, decode: "not_found", decodeSource, error: decoded.error, candidate: null, candidateConfidence: null, filters: [] });
    process.stderr.write(`${profile.sample}: decode failed\n`);
    continue;
  }
  // The archive contains the recorded vehicle year. TRONK sometimes exposes
  // the generation start year as the vehicle year, so keep the provider value
  // for diagnostics but use the recorded year when checking MANN applicability.
  const providerYear = decoded.vehicle.year ?? null;
  decoded.vehicle.year = profile.year;
  const normalized = normalizeDecodedVehicleForTest(decoded.vehicle);
  const rowsForMake = normalized
    ? mannRows.filter((row) => normalizeVehicleMake(row.make) === normalized.canonicalMake)
    : [];
  const diagnosis = normalized ? diagnoseMannCandidatesForTest(normalized, rowsForMake) : { rankedCandidates: [], rejected: [] };
  const candidates = diagnosis.rankedCandidates;
  const candidate = candidates[0] ?? null;
  const relevantRejections = diagnosis.rejected.filter((item) => !item.reasons.includes("базовая модель не совпадает"));
  const rejectionCounts = new Map();
  for (const item of relevantRejections.length > 0 ? relevantRejections : diagnosis.rejected) {
    for (const reason of item.reasons) rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
  }
  const rejectionReasons = [...rejectionCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ru"))
    .slice(0, 5)
    .map(([reason, count]) => `${reason} (${count})`);
  const filters = filtersForCandidate(candidate).map((filter) => {
    const matches = localMatchesFor(filter.article);
    const best = matches[0] ?? null;
    const stock = best ? stockByProduct.get(best.product.id) : null;
    return {
      type: filter.type,
      subtype: filter.subtype,
      mannArticle: filter.article,
      localStatus: best ? (matches.filter((match) => match.confidence >= 80).length > 1 ? "multiple_matches" : "found") : "not_found",
      localProduct: best?.product.name ?? null,
      matchConfidence: best?.confidence ?? 0,
      matchReason: best?.reason ?? "not_found",
      available: stock?.available ?? 0,
      price: best ? best.product.salePriceCents / 100 : null,
    };
  });
  results.push({
    sample: profile.sample,
    expected: `${profile.sourceModel} (${profile.year})`,
    decode: "found",
    decodeSource,
    vehicle: `${decoded.vehicle.makeCanonical ?? decoded.vehicle.makeRaw} ${decoded.vehicle.modelCanonical ?? decoded.vehicle.modelRaw}${decoded.vehicle.generationRaw ? ` ${decoded.vehicle.generationRaw}` : ""}${decoded.vehicle.year ? ` (${decoded.vehicle.year})` : ""}`,
    vehicleEvidence: {
      year: decoded.vehicle.year ?? null,
      providerYear,
      generation: decoded.vehicle.generationRaw ?? decoded.vehicle.generationCanonical ?? null,
      bodyName: decoded.vehicle.bodyName ?? null,
      bodyCode: decoded.vehicle.bodyCode ?? null,
      engineCode: decoded.vehicle.engineCode ?? null,
      engineSeries: decoded.vehicle.engineSeries ?? null,
      engineVolumeCc: decoded.vehicle.engineVolumeCc ?? null,
      powerHp: decoded.vehicle.powerHp ?? decoded.vehicle.powerPs ?? null,
      powerKw: decoded.vehicle.powerKw ?? null,
      fuelType: decoded.vehicle.fuelType ?? null,
    },
    candidate: candidate ? `${candidate.model} · ${candidate.effectiveVehicleText ?? candidate.vehicleText ?? "—"}` : null,
    candidateConfidence: candidate?.confidence ?? null,
    candidateScore: candidate?.score ?? null,
    selection: candidate?.confidence === "high" ? "automatic" : candidate ? "confirmation_required" : "not_found",
    rejectionReasons: candidate ? [] : rejectionReasons,
    filters,
  });
  process.stderr.write(`${profile.sample}: decoded, ${filters.length} MANN filters checked\n`);
}

const allFilters = results.flatMap((result) => result.filters);
const summary = {
  sampleSize: results.length,
  distinctNewHistoricalPlates: profilesToRun.length,
  decoded: results.filter((result) => result.decode === "found").length,
  decodedFromCache: results.filter((result) => result.decodeSource === "cache").length,
  historicalProfilesOnly: results.filter((result) => result.decodeSource === "historical_profile").length,
  automaticVehicleMatches: results.filter((result) => result.selection === "automatic").length,
  confirmationRequired: results.filter((result) => result.selection === "confirmation_required").length,
  vehicleNotFound: results.filter((result) => result.selection === "not_found").length,
  mannFiltersChecked: allFilters.length,
  localFound: allFilters.filter((filter) => filter.localStatus === "found").length,
  localMultiple: allFilters.filter((filter) => filter.localStatus === "multiple_matches").length,
  localNotFound: allFilters.filter((filter) => filter.localStatus === "not_found").length,
  localFoundWithStock: allFilters.filter((filter) => filter.localStatus !== "not_found" && filter.available > 0).length,
  savedManualLinks: explicitLinkRows.length,
  savedManualLinksToActiveProducts: explicitLinkRows.filter((row) => productsById.has(row.product_id)).length,
  savedManualLinksRequiredForMatch: explicitLinkRows.filter((row) => {
    const product = productsById.get(row.product_id);
    return product && !evaluateMannArticleProductMatch(product, row.mann_article);
  }).length,
  results,
};
console.log(JSON.stringify(summary, null, 2));
