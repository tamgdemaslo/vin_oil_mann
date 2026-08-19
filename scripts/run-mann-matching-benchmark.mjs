import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";

function argument(name, fallback = undefined) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function loadLocalEnvironment(filePath = ".env.local") {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] != null) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

loadLocalEnvironment();

const mode = argument("mode", "replay");
const manifestPath = argument("manifest");
const replayPath = argument("replay");
const outputPath = argument("output");
const labelsPath = argument("labels");
const mannDumpPath = argument("mann-catalog");
const productsDumpPath = argument("local-products");
const stockDumpPath = argument("local-stock");
const linksDumpPath = argument("mann-links");
const maximumSamples = Number(argument("max-samples", "0")) || null;
const sampleFrom = Math.max(0, Number(argument("sample-from", "0")) || 0);
const algorithmFiles = [
  "src/lib/vehicle-normalization.ts",
  "src/lib/vehicle-identity.ts",
  "src/lib/mann-vehicle-resolver.ts",
  "src/lib/mann-catalog.ts",
];
const algorithmDigest = crypto.createHash("sha256")
  .update(algorithmFiles.map((filePath) => `${filePath}\0${fs.readFileSync(filePath)}`).join("\0"))
  .digest("hex");
const algorithmVersion = argument("algorithm-version", `mann-${algorithmDigest.slice(0, 12)}`);

if (!manifestPath || !outputPath || !mannDumpPath || !productsDumpPath || !stockDumpPath || !linksDumpPath || !["live", "replay", "hybrid"].includes(mode)) {
  throw new Error("Usage: node scripts/run-mann-matching-benchmark.mjs --mode=live|replay|hybrid --manifest=<private.json> --mann-catalog=<dump.sql> --local-products=<dump.sql> --local-stock=<dump.sql> --mann-links=<dump.sql> --output=<private.json> [--replay=<prior-result.json>] [--labels=<labels.json>]");
}
if (["replay", "hybrid"].includes(mode) && !replayPath) throw new Error("--replay is required in replay/hybrid mode");
if (["live", "hybrid"].includes(mode) && !process.env.TRONK_API_KEY?.trim()) throw new Error("TRONK_API_KEY is not configured");

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": new URL("../src", import.meta.url).pathname },
});
const { tronkClient } = await jiti.import("../src/lib/integrations/tronk/client.ts");
const { assessVehicleDecodeQuality, normalizeVehicleMake, toVehicle } = await jiti.import("../src/lib/vehicle-identity.ts");
const {
  MANN_MIN_PRESENTABLE_SCORE,
  diagnoseMannCandidatesForTest,
  mannMakeFormsForTest,
  normalizeDecodedVehicleForTest,
} = await jiti.import("../src/lib/mann-vehicle-resolver.ts");
const { evaluateMannArticleProductMatch, normalizeMannArticle } = await jiti.import("../src/lib/mann-catalog.ts");

function unescapeCopyValue(value) {
  if (value === "\\N") return null;
  return value.replace(/\\([btnr\\])/g, (_, code) => ({ b: "\b", t: "\t", n: "\n", r: "\r", "\\": "\\" })[code]);
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

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function findVin(value, depth = 0) {
  if (depth > 6 || !value || typeof value !== "object") return null;
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

function primaryReports(raw) {
  const reports = record(raw?.decode ?? raw?.Decode).Reports ?? record(raw?.decode ?? raw?.Decode).reports;
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

function traceCall(method, call) {
  return {
    method,
    ok: Boolean(call?.ok),
    httpStatus: call?.httpStatus ?? null,
    code: call?.code ?? null,
    message: call?.message ?? null,
    durationMs: call?.durationMs ?? null,
    data: call?.data ?? null,
  };
}

async function liveTraceForPlate(plate) {
  const attempts = [];
  const number2vin = await tronkClient.lookupVinByPlate(plate);
  attempts.push(traceCall("number2vin", number2vin));
  const vin = number2vin.ok ? findVin(number2vin.data) : null;
  if (!vin) {
    const b2b = await tronkClient.lookupVehicleByPlate(plate);
    attempts.push(traceCall("convertb2b", b2b));
    const b2bVehicle = b2b.ok ? toVehicle(record(b2b.data.result ?? b2b.data), "tronk_convertb2b", { licensePlate: plate }) : null;
    if (b2bVehicle?.makeCanonical && b2bVehicle.modelCanonical) return { attempts, vin: null };
    const gate = await tronkClient.lookupVehicleByPlateGate(plate);
    attempts.push(traceCall("convertgate", gate));
    return { attempts, vin: null };
  }

  const primary = await tronkClient.decodeVinPrimary(vin);
  attempts.push(traceCall("vindecode", primary));
  const reports = primary.ok ? primaryReports(primary.data) : [];
  const primaryVehicles = reports.map((report) => toVehicle(record(report.Data ?? report.data ?? report), "tronk_vindecode", { vin, licensePlate: plate }));
  const primaryBest = [...primaryVehicles].sort((left, right) => assessVehicleDecodeQuality(right).score - assessVehicleDecodeQuality(left).score)[0] ?? null;
  if (!primary.ok || reports.length !== 1 || assessVehicleDecodeQuality(primaryBest).status !== "complete") {
    const extended = await tronkClient.decodeVinExtended(vin);
    attempts.push(traceCall("vindecode2", extended));
  }
  const currentTrace = { attempts, vin };
  if (assessVehicleDecodeQuality(decodedFromTrace(currentTrace, plate)).status !== "complete") {
    const b2b = await tronkClient.lookupVehicleByPlate(plate);
    attempts.push(traceCall("convertb2b", b2b));
    if (assessVehicleDecodeQuality(decodedFromTrace(currentTrace, plate)).status !== "complete") {
      const gate = await tronkClient.lookupVehicleByPlateGate(plate);
      attempts.push(traceCall("convertgate", gate));
    }
  }
  return { attempts, vin };
}

async function completeTraceForPlate(priorTrace, plate) {
  const trace = { attempts: structuredClone(priorTrace?.attempts ?? []), vin: priorTrace?.vin ?? null };
  const has = (method) => trace.attempts.some((attempt) => attempt.method === method);
  if (!trace.vin) trace.vin = findVin(trace.attempts.find((attempt) => attempt.method === "number2vin" && attempt.ok)?.data);
  let decoded = decodedFromTrace(trace, plate);
  if (trace.vin && assessVehicleDecodeQuality(decoded).status !== "complete" && !has("vindecode2")) {
    const extended = await tronkClient.decodeVinExtended(trace.vin);
    trace.attempts.push(traceCall("vindecode2", extended));
    decoded = decodedFromTrace(trace, plate);
  }
  if (assessVehicleDecodeQuality(decoded).status !== "complete" && !has("convertb2b")) {
    const b2b = await tronkClient.lookupVehicleByPlate(plate);
    trace.attempts.push(traceCall("convertb2b", b2b));
    decoded = decodedFromTrace(trace, plate);
  }
  if (assessVehicleDecodeQuality(decoded).status !== "complete" && !has("convertgate")) {
    const gate = await tronkClient.lookupVehicleByPlateGate(plate);
    trace.attempts.push(traceCall("convertgate", gate));
  }
  return trace;
}

function decodedFromTrace(trace, plate) {
  const successful = (method) => trace.attempts.find((attempt) => attempt.method === method && attempt.ok)?.data;
  const vin = trace.vin ?? findVin(successful("number2vin"));
  const primary = successful("vindecode");
  const primaryVehicles = primaryReports(primary).map((report) => toVehicle(record(report.Data ?? report.data ?? report), "tronk_vindecode", { vin, licensePlate: plate }));
  const extendedRaw = successful("vindecode2");
  const extendedVehicle = extendedRaw ? toVehicle(record(extendedRaw.result), "tronk_vindecode2", { vin, licensePlate: plate }) : null;
  const merged = primaryVehicles.length > 1 && extendedVehicle
    ? [extendedVehicle]
    : primaryVehicles.length > 0
      ? primaryVehicles.map((vehicle) => mergeVehicle(vehicle, extendedVehicle))
      : extendedVehicle
        ? [extendedVehicle]
        : [];
  const usableVehicles = merged.filter((vehicle) => vehicle.makeCanonical && vehicle.modelCanonical);
  const b2b = successful("convertb2b");
  if (b2b) {
    const vehicle = toVehicle(record(b2b.result ?? b2b), "tronk_convertb2b", { licensePlate: plate });
    if (vehicle.makeCanonical && vehicle.modelCanonical) usableVehicles.push(vehicle);
  }
  const gate = successful("convertgate");
  if (gate) {
    const vehicle = toVehicle(record(gate.result ?? gate), "tronk_convertgate", { licensePlate: plate });
    if (vehicle.makeCanonical && vehicle.modelCanonical) usableVehicles.push(vehicle);
  }
  return usableVehicles.sort((left, right) => assessVehicleDecodeQuality(right).score - assessVehicleDecodeQuality(left).score)[0] ?? null;
}

const mannRows = readCopyRows(mannDumpPath, "mann_filter_applications").map((row) => ({
  vehicleVariantKey: row.vehicle_variant_key,
  make: row.make,
  makeNormalized: row.make_normalized,
  model: row.model,
  modelNormalized: row.model_normalized,
  modelYears: row.model_years,
  vehicleText: row.vehicle_text,
  effectiveVehicleText: row.effective_vehicle_text,
  detail: row.detail,
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
  mannArticleNormalized: row.mann_article_normalized,
  pdfPage: row.pdf_page == null ? null : Number(row.pdf_page),
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
for (const row of readCopyRows(linksDumpPath, "product_mann_links")) {
  const normalized = normalizeMannArticle(row.mann_article);
  if (!normalized) continue;
  const links = explicitLinks.get(normalized) ?? [];
  links.push({ productId: row.product_id, confidence: Number(row.confidence) || 100, reason: `ProductMannLink:${row.link_type || "manual"}` });
  explicitLinks.set(normalized, links);
}

function filtersForVariants(variantIds) {
  const selectedVariants = new Set(variantIds);
  const filters = new Map();
  for (const row of mannRows) {
    if (!selectedVariants.has(row.vehicleVariantKey) || !row.mannArticle) continue;
    const key = `${row.filterType}:${row.filterSubtype ?? ""}:${normalizeMannArticle(row.mannArticle)}`;
    if (!filters.has(key)) filters.set(key, {
      filterType: row.filterType,
      filterSubtype: row.filterSubtype,
      mannArticle: row.mannArticle,
      mannArticleNormalized: normalizeMannArticle(row.mannArticle),
      note: row.filterNote ?? null,
    });
  }
  return [...filters.values()];
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

function localResultForFilter(filter) {
  const matches = localMatchesFor(filter.mannArticle);
  const strong = matches.filter((match) => match.confidence >= 80);
  const status = strong.length === 1 ? "found" : strong.length > 1 ? "multiple_matches" : matches.length > 0 ? "needs_review" : "not_found";
  return {
    ...filter,
    localStatus: status,
    candidates: matches.slice(0, 5).map((match) => ({
      productId: match.product.id,
      productName: match.product.name,
      confidence: match.confidence,
      reason: match.reason,
      available: stockByProduct.get(match.product.id)?.available ?? 0,
    })),
  };
}

function publicVehicle(vehicle) {
  if (!vehicle) return null;
  const result = { ...vehicle };
  delete result.vin;
  delete result.frameNumber;
  delete result.licensePlate;
  delete result.rawResultIds;
  return result;
}

function candidateForReport(candidate, timingAccumulator, trackTimings) {
  const filtersStartedAt = performance.now();
  const filters = filtersForVariants(candidate.variantIds);
  if (trackTimings) timingAccumulator.filtersMs += performance.now() - filtersStartedAt;
  const localStartedAt = performance.now();
  const filtersWithLocalProducts = filters.map(localResultForFilter);
  if (trackTimings) timingAccumulator.localProductsMs += performance.now() - localStartedAt;
  return {
    variantId: candidate.variantId,
    variantIds: candidate.variantIds,
    applicationId: candidate.applicationId,
    make: candidate.make,
    model: candidate.model,
    vehicleText: candidate.vehicleText,
    effectiveVehicleText: candidate.effectiveVehicleText,
    engineCode: candidate.engineCode,
    kw: candidate.kw,
    hp: candidate.hp,
    vehicleYears: candidate.vehicleYears,
    condition: candidate.condition,
    score: candidate.score,
    confidence: candidate.confidence,
    matchedFields: candidate.matchedFields,
    mismatchedFields: candidate.mismatchedFields,
    missingFields: candidate.missingFields,
    reasons: candidate.reasons,
    warnings: candidate.warnings,
    featureContributions: candidate.featureContributions,
    filters: filtersWithLocalProducts,
  };
}

function classifyDecision(candidates) {
  if (candidates[0]?.confidence === "high") return "automatic";
  if (candidates.length === 0) return "no_match";
  const topGap = candidates[0].score - (candidates[1]?.score ?? 0);
  return topGap < 10 ? "ambiguous" : "confirmation_required";
}

function decodeFailureCodeForTrace(trace) {
  const attempts = trace?.attempts ?? [];
  const providerUnavailable = attempts.some((attempt) => !attempt.ok && ["network", "circuit_open", "invalid_response", "not_configured", "limit"].includes(attempt.code));
  if (providerUnavailable) return "PROVIDER_UNAVAILABLE";
  const vin = trace?.vin ?? findVin(attempts.find((attempt) => attempt.method === "number2vin" && attempt.ok)?.data);
  if (!vin) return "VIN_NOT_RESOLVED";
  const primary = attempts.find((attempt) => attempt.method === "vindecode" && attempt.ok)?.data;
  const primaryVehicles = primaryReports(primary).map((report) => toVehicle(record(report.Data ?? report.data ?? report), "tronk_vindecode"));
  const bestPrimary = [...primaryVehicles].sort((left, right) => assessVehicleDecodeQuality(right).score - assessVehicleDecodeQuality(left).score)[0] ?? null;
  if (bestPrimary?.makeCanonical && !bestPrimary.modelCanonical) return "DECODE_MISSING_MODEL";
  if (!bestPrimary?.makeCanonical && bestPrimary?.modelCanonical) return "DECODE_MISSING_MAKE";
  return "VIN_DECODE_FAILED";
}

function layerCStatus(filters) {
  if (!filters.length) return "FILTERS_NOT_AVAILABLE";
  const found = filters.filter((filter) => filter.localStatus === "found").length;
  if (found === filters.length) return "FILTERS_FOUND_LOCAL_PRODUCTS_COMPLETE";
  if (found > 0) return "FILTERS_FOUND_LOCAL_PRODUCTS_PARTIAL";
  return "FILTERS_FOUND_LOCAL_PRODUCTS_MISSING";
}

function labelMetrics(results, labelDocument) {
  if (!labelDocument) return null;
  const labels = new Map((labelDocument.labels ?? []).map((label) => [label.sampleId, label]));
  const evaluated = results.filter((result) => labels.has(result.sampleId));
  const matchLabels = evaluated.filter((result) => labels.get(result.sampleId).outcome === "match");
  let top1Correct = 0;
  let top3Correct = 0;
  let automatic = 0;
  let falseAutomatic = 0;
  let ambiguityCorrect = 0;
  let noMatchCorrect = 0;
  let trueFilterPositive = 0;
  let falseFilterPositive = 0;
  let falseFilterNegative = 0;
  for (const result of evaluated) {
    const label = labels.get(result.sampleId);
    const expectedKeys = new Set(label.expectedVariantKeys ?? []);
    const topGroups = result.candidates.map((candidate) => candidate.variantIds ?? [candidate.variantId]);
    if (label.outcome === "match") {
      if ((topGroups[0] ?? []).some((key) => expectedKeys.has(key))) top1Correct += 1;
      if (topGroups.slice(0, 3).some((keys) => keys.some((key) => expectedKeys.has(key)))) top3Correct += 1;
    }
    if (result.decision === "automatic") {
      automatic += 1;
      if (label.outcome !== "match" || !(topGroups[0] ?? []).some((key) => expectedKeys.has(key))) falseAutomatic += 1;
    }
    if (label.outcome === "ambiguous" && result.decision === "ambiguous") ambiguityCorrect += 1;
    if (["no_match", "data_gap"].includes(label.outcome) && result.decision === "no_match") noMatchCorrect += 1;
    if (label.outcome === "match" && (topGroups[0] ?? []).some((key) => expectedKeys.has(key)) && Array.isArray(label.expectedFilterArticles)) {
      const actual = new Set((result.candidates[0]?.filters ?? []).map((filter) => filter.mannArticleNormalized));
      const expected = new Set(label.expectedFilterArticles.map(normalizeMannArticle));
      for (const article of actual) {
        if (expected.has(article)) trueFilterPositive += 1;
        else falseFilterPositive += 1;
      }
      for (const article of expected) if (!actual.has(article)) falseFilterNegative += 1;
    }
  }
  const filterPrecision = trueFilterPositive + falseFilterPositive > 0 ? trueFilterPositive / (trueFilterPositive + falseFilterPositive) : null;
  const filterRecall = trueFilterPositive + falseFilterNegative > 0 ? trueFilterPositive / (trueFilterPositive + falseFilterNegative) : null;
  return {
    labeled: evaluated.length,
    matchLabels: matchLabels.length,
    top1Accuracy: matchLabels.length ? top1Correct / matchLabels.length : null,
    top3Accuracy: matchLabels.length ? top3Correct / matchLabels.length : null,
    automaticDecisions: automatic,
    falseAutomaticDecisions: falseAutomatic,
    falsePositiveRate: automatic ? falseAutomatic / automatic : 0,
    correctAmbiguityDecisions: ambiguityCorrect,
    correctNoMatchDecisions: noMatchCorrect,
    filterPrecision,
    filterRecall,
    filterF1: filterPrecision != null && filterRecall != null && filterPrecision + filterRecall > 0 ? 2 * filterPrecision * filterRecall / (filterPrecision + filterRecall) : null,
  };
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const manifestDigest = crypto.createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex");
const prior = replayPath ? JSON.parse(fs.readFileSync(replayPath, "utf8")) : null;
if (prior) assert.equal(prior.manifestDigest, manifestDigest, "Replay result does not belong to this manifest");
const priorBySample = new Map((prior?.results ?? []).map((result) => [result.sampleId, result]));
const samples = maximumSamples ? manifest.samples.slice(sampleFrom, sampleFrom + maximumSamples) : manifest.samples.slice(sampleFrom);
const results = [];

for (const sample of samples) {
  const startedAt = Date.now();
  const priorTrace = priorBySample.get(sample.sampleId)?.providerTrace;
  const trace = mode === "live"
    ? await liveTraceForPlate(sample.plate)
    : mode === "hybrid"
      ? await completeTraceForPlate(priorTrace, sample.plate)
      : priorTrace;
  if (!trace) throw new Error(`No provider trace for ${sample.sampleId}`);
  const decoded = decodedFromTrace(trace, sample.plate);
  const decodeElapsedMs = Date.now() - startedAt;
  if (!decoded) {
    results.push({
      sampleId: sample.sampleId,
      identifierHash: sample.identifierHash,
      historical: sample.historical,
      providerTrace: trace,
      decodedVehicle: null,
      normalizedVehicle: null,
      decision: "decode_failed",
      layers: {
        tronk: { status: "DECODE_FAILED", failureCode: decodeFailureCodeForTrace(trace) },
        mannVehicle: { status: "NOT_RUN", failureCode: "TRONK_UNUSABLE_DECODE" },
        localProduct: { status: "NOT_RUN", failureCode: "MANN_NOT_RESOLVED" },
      },
      candidates: [],
      retrievalTop20VariantIds: [],
      timings: { decodeMs: decodeElapsedMs, retrievalMs: 0, scoringMs: 0, filtersMs: 0, localProductsMs: 0, totalMs: Date.now() - startedAt },
    });
    process.stderr.write(`${sample.sampleId}: decode failed\n`);
    continue;
  }
  const makeFilterStartedAt = performance.now();
  const normalized = normalizeDecodedVehicleForTest(decoded);
  const makeForms = normalized ? new Set(mannMakeFormsForTest(normalized.canonicalMake)) : new Set();
  const rowsForMake = normalized ? mannRows.filter((row) => makeForms.has(row.makeNormalized) || normalizeVehicleMake(row.make) === normalized.canonicalMake) : [];
  const makeFilterMs = performance.now() - makeFilterStartedAt;
  const diagnosis = normalized ? diagnoseMannCandidatesForTest(normalized, rowsForMake) : { rankedCandidates: [], rejected: [] };
  const timingAccumulator = { filtersMs: 0, localProductsMs: 0 };
  const candidates = diagnosis.rankedCandidates
    .filter((candidate) => candidate.score >= MANN_MIN_PRESENTABLE_SCORE)
    .slice(0, 5)
    .map((candidate, index) => candidateForReport(candidate, timingAccumulator, index === 0));
  const decision = classifyDecision(candidates);
  const rejectionCounts = new Map();
  for (const rejection of diagnosis.rejected) {
    for (const reason of rejection.reasons) rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
  }
  results.push({
    sampleId: sample.sampleId,
    identifierHash: sample.identifierHash,
    historical: sample.historical,
    providerTrace: trace,
    decodedVehicle: publicVehicle(decoded),
    normalizedVehicle: normalized,
    retrievalPoolSize: rowsForMake.length,
    retrievedCandidateCount: diagnosis.retrievedCount ?? 0,
    acceptedCandidateCount: diagnosis.rankedCandidates.length,
    retrievalTop20VariantIds: diagnosis.rankedCandidates.slice(0, 20).flatMap((candidate) => candidate.variantIds ?? [candidate.variantId]),
    decision,
    layers: {
      tronk: { status: assessVehicleDecodeQuality(decoded).status === "complete" ? "DECODE_COMPLETE" : "DECODE_PARTIAL", quality: assessVehicleDecodeQuality(decoded) },
      mannVehicle: { status: decision === "no_match" ? "VEHICLE_NO_MATCH" : decision === "automatic" ? "VEHICLE_HIGH_PROPOSAL" : "VEHICLE_AMBIGUOUS", failureCode: decision === "no_match" ? "MANN_NO_CANDIDATE" : decision === "automatic" ? undefined : "MANN_CONFIRMATION_REQUIRED" },
      localProduct: { status: layerCStatus(candidates[0]?.filters ?? []), failureCode: candidates[0]?.filters?.length ? undefined : "FILTERS_NOT_AVAILABLE" },
    },
    candidates,
    topRejections: [...rejectionCounts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 10).map(([reason, count]) => ({ reason, count })),
    rejectionExamples: diagnosis.rejected
      .filter((rejection) => !rejection.reasons.includes("базовая модель не совпадает"))
      .slice(0, 50),
    timings: {
      decodeMs: decodeElapsedMs,
      retrievalMs: makeFilterMs + (diagnosis.timings?.retrievalMs ?? 0),
      scoringMs: diagnosis.timings?.scoringMs ?? 0,
      filtersMs: timingAccumulator.filtersMs,
      localProductsMs: timingAccumulator.localProductsMs,
      totalMs: decodeElapsedMs + makeFilterMs + (diagnosis.timings?.retrievalMs ?? 0) + (diagnosis.timings?.scoringMs ?? 0) + timingAccumulator.filtersMs + timingAccumulator.localProductsMs,
      diagnosticWallMs: Date.now() - startedAt,
    },
  });
  process.stderr.write(`${sample.sampleId}: ${decision}, ${candidates.length} reported candidates\n`);
}

const labels = labelsPath ? JSON.parse(fs.readFileSync(labelsPath, "utf8")) : null;
const allCandidateFilters = results.flatMap((result) => result.candidates.flatMap((candidate) => candidate.filters));
function percentile(values, percentileValue) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1)];
}
const latency = Object.fromEntries(["decodeMs", "retrievalMs", "scoringMs", "filtersMs", "localProductsMs", "totalMs"].map((field) => [field, {
  p50: percentile(results.map((result) => result.timings[field]), 0.5),
  p95: percentile(results.map((result) => result.timings[field]), 0.95),
}]));
const report = {
  schemaVersion: 2,
  algorithmVersion,
  algorithmDigest,
  datasetId: manifest.datasetId,
  purpose: manifest.purpose,
  manifestDigest,
  mode,
  executedAt: new Date().toISOString(),
  sourceHashes: {
    mannCatalog: crypto.createHash("sha256").update(fs.readFileSync(mannDumpPath)).digest("hex"),
    localProducts: crypto.createHash("sha256").update(fs.readFileSync(productsDumpPath)).digest("hex"),
  },
  summary: {
    samples: results.length,
    decoded: results.filter((result) => result.decodedVehicle).length,
    decodeFailed: results.filter((result) => !result.decodedVehicle).length,
    automatic: results.filter((result) => result.decision === "automatic").length,
    ambiguous: results.filter((result) => result.decision === "ambiguous").length,
    confirmationRequired: results.filter((result) => result.decision === "confirmation_required").length,
    noMatch: results.filter((result) => result.decision === "no_match").length,
    reportedCandidateFilters: allCandidateFilters.length,
    localFound: allCandidateFilters.filter((filter) => filter.localStatus === "found").length,
    localMultiple: allCandidateFilters.filter((filter) => filter.localStatus === "multiple_matches").length,
    localNeedsReview: allCandidateFilters.filter((filter) => filter.localStatus === "needs_review").length,
    localNotFound: allCandidateFilters.filter((filter) => filter.localStatus === "not_found").length,
    layerA: Object.fromEntries([...new Set(results.map((result) => result.layers.tronk.status))].map((status) => [status, results.filter((result) => result.layers.tronk.status === status).length])),
    layerB: Object.fromEntries([...new Set(results.map((result) => result.layers.mannVehicle.status))].map((status) => [status, results.filter((result) => result.layers.mannVehicle.status === status).length])),
    layerC: Object.fromEntries([...new Set(results.map((result) => result.layers.localProduct.status))].map((status) => [status, results.filter((result) => result.layers.localProduct.status === status).length])),
    latency,
    metrics: labelMetrics(results, labels),
  },
  results,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ datasetId: report.datasetId, manifestDigest, outputPath, ...report.summary }, null, 2));
