import fs from "node:fs";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

const reportPath = argument("report");
const labelsPath = argument("labels");
if (!reportPath || !labelsPath) {
  throw new Error("Usage: node scripts/score-mann-matching-report.mjs --report=<private-result.json> --labels=<private-labels.json>");
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const labelDocument = JSON.parse(fs.readFileSync(labelsPath, "utf8"));
if (report.datasetId !== labelDocument.datasetId) throw new Error("Report and labels belong to different datasets");

const normalizeArticle = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const labels = new Map((labelDocument.labels ?? []).map((label) => [label.sampleId, label]));
const evaluated = (report.results ?? []).filter((result) => labels.has(result.sampleId));
const matchLabels = evaluated.filter((result) => labels.get(result.sampleId).outcome === "match");
const outcomeCounts = {};
const failureTaxonomy = {};
const byMake = new Map();
const byEnginePresence = new Map();
let top1Correct = 0;
let top3Correct = 0;
let retrievalTop20Correct = 0;
let endToEndSuccess = 0;
let automatic = 0;
let falseAutomatic = 0;
const falseAutomaticSampleIds = [];
let ambiguityCorrect = 0;
let noMatchCorrect = 0;
let trueFilterPositive = 0;
let falseFilterPositive = 0;
let falseFilterNegative = 0;
const localMapping = {
  found: 0,
  multiple_matches: 0,
  needs_review: 0,
  not_found: 0,
  unknown: 0,
};

function increment(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

function recordAccuracy(group, topCorrect, top3CorrectForResult) {
  group.matchLabels += 1;
  if (topCorrect) group.top1Correct += 1;
  if (top3CorrectForResult) group.top3Correct += 1;
}

for (const result of evaluated) {
  const label = labels.get(result.sampleId);
  increment(outcomeCounts, label.outcome);
  if (label.failureClass) increment(failureTaxonomy, label.failureClass);
  const expectedKeys = new Set(label.expectedVariantKeys ?? []);
  const topGroups = (result.candidates ?? []).map((candidate) => candidate.variantIds ?? [candidate.variantId ?? candidate.applicationId]);
  const topCorrect = label.outcome === "match" && (topGroups[0] ?? []).some((key) => expectedKeys.has(key));
  const top3CorrectForResult = label.outcome === "match"
    && topGroups.slice(0, 3).some((keys) => keys.some((key) => expectedKeys.has(key)));
  const retrievalCorrectForResult = label.outcome === "match"
    && (result.retrievalTop20VariantIds ?? topGroups.slice(0, 20).flat()).some((key) => expectedKeys.has(key));
  if (topCorrect) top1Correct += 1;
  if (top3CorrectForResult) top3Correct += 1;
  if (retrievalCorrectForResult) retrievalTop20Correct += 1;
  if (label.outcome === "match") {
    const make = result.decodedVehicle?.makeCanonical ?? result.decodedVehicle?.makeRaw ?? "UNKNOWN";
    if (!byMake.has(make)) byMake.set(make, { make, matchLabels: 0, top1Correct: 0, top3Correct: 0 });
    recordAccuracy(byMake.get(make), topCorrect, top3CorrectForResult);
    const engineBucket = result.decodedVehicle?.engineSeries ? "engineCodePresent" : "engineCodeAbsent";
    if (!byEnginePresence.has(engineBucket)) {
      byEnginePresence.set(engineBucket, { bucket: engineBucket, matchLabels: 0, top1Correct: 0, top3Correct: 0 });
    }
    recordAccuracy(byEnginePresence.get(engineBucket), topCorrect, top3CorrectForResult);
  }
  if (result.decision === "automatic") {
    automatic += 1;
    if (!topCorrect) {
      falseAutomatic += 1;
      falseAutomaticSampleIds.push(result.sampleId);
    }
  }
  if (label.outcome === "ambiguous" && result.decision === "ambiguous") ambiguityCorrect += 1;
  if (["no_match", "data_gap"].includes(label.outcome) && result.decision === "no_match") noMatchCorrect += 1;
  if (topCorrect && Array.isArray(label.expectedFilterArticles)) {
    const candidateFilters = result.candidates?.[0]?.filters ?? [];
    const actual = new Set(candidateFilters.map((filter) => normalizeArticle(filter.mannArticleNormalized ?? filter.mannArticle)));
    const expected = new Set(label.expectedFilterArticles.map(normalizeArticle));
    for (const article of actual) {
      if (expected.has(article)) trueFilterPositive += 1;
      else falseFilterPositive += 1;
    }
    for (const article of expected) if (!actual.has(article)) falseFilterNegative += 1;
    for (const filter of candidateFilters) {
      if (!expected.has(normalizeArticle(filter.mannArticleNormalized ?? filter.mannArticle))) continue;
      const status = Object.hasOwn(localMapping, filter.localStatus) ? filter.localStatus : "unknown";
      localMapping[status] += 1;
    }
    const actualExpectedFilters = candidateFilters.filter((filter) => expected.has(normalizeArticle(filter.mannArticleNormalized ?? filter.mannArticle)));
    const exactFilterSet = actual.size === expected.size && [...actual].every((article) => expected.has(article));
    if (exactFilterSet && expected.size > 0 && actualExpectedFilters.length === expected.size && actualExpectedFilters.every((filter) => filter.localStatus === "found")) {
      endToEndSuccess += 1;
    }
  }
}

const filterPrecision = trueFilterPositive + falseFilterPositive > 0 ? trueFilterPositive / (trueFilterPositive + falseFilterPositive) : null;
const filterRecall = trueFilterPositive + falseFilterNegative > 0 ? trueFilterPositive / (trueFilterPositive + falseFilterNegative) : null;
const localMappingTotal = Object.values(localMapping).reduce((sum, value) => sum + value, 0);
const withAccuracy = (group) => ({
  ...group,
  top1Accuracy: group.matchLabels ? group.top1Correct / group.matchLabels : null,
  top3Accuracy: group.matchLabels ? group.top3Correct / group.matchLabels : null,
});
const decoded = evaluated.filter((result) => result.decodedVehicle).length;
const metrics = {
  datasetId: report.datasetId,
  samples: evaluated.length,
  decoded,
  decodeRate: evaluated.length ? decoded / evaluated.length : null,
  outcomeCounts,
  matchLabels: matchLabels.length,
  top1Correct,
  top3Correct,
  retrievalTop20Correct,
  top1Accuracy: matchLabels.length ? top1Correct / matchLabels.length : null,
  top3Accuracy: matchLabels.length ? top3Correct / matchLabels.length : null,
  retrievalTop20Recall: matchLabels.length ? retrievalTop20Correct / matchLabels.length : null,
  automaticDecisions: automatic,
  falseAutomaticDecisions: falseAutomatic,
  falseAutomaticSampleIds,
  falsePositiveRate: automatic ? falseAutomatic / automatic : 0,
  correctAmbiguityDecisions: ambiguityCorrect,
  ambiguityLabels: outcomeCounts.ambiguous ?? 0,
  correctAmbiguityRate: outcomeCounts.ambiguous ? ambiguityCorrect / outcomeCounts.ambiguous : null,
  correctNoMatchDecisions: noMatchCorrect,
  noMatchLabels: (outcomeCounts.no_match ?? 0) + (outcomeCounts.data_gap ?? 0),
  decodedDecisionRates: decoded ? {
    automatic: evaluated.filter((result) => result.decodedVehicle && result.decision === "automatic").length / decoded,
    ambiguous: evaluated.filter((result) => result.decodedVehicle && result.decision === "ambiguous").length / decoded,
    confirmationRequired: evaluated.filter((result) => result.decodedVehicle && result.decision === "confirmation_required").length / decoded,
    noMatch: evaluated.filter((result) => result.decodedVehicle && result.decision === "no_match").length / decoded,
  } : null,
  filterPrecision,
  filterRecall,
  filterF1: filterPrecision != null && filterRecall != null && filterPrecision + filterRecall > 0
    ? 2 * filterPrecision * filterRecall / (filterPrecision + filterRecall)
    : null,
  filterEvaluationScope: "filters of correctly selected Top-1 vehicle only",
  catalogCoverage: {
    coveredLabels: (outcomeCounts.match ?? 0) + (outcomeCounts.ambiguous ?? 0),
    dataGaps: outcomeCounts.data_gap ?? 0,
    rateAmongDecoded: decoded ? ((outcomeCounts.match ?? 0) + (outcomeCounts.ambiguous ?? 0)) / decoded : null,
  },
  localFilterMapping: {
    ...localMapping,
    total: localMappingTotal,
    mappedCoverage: localMappingTotal ? (localMapping.found + localMapping.multiple_matches) / localMappingTotal : null,
    uniqueCoverage: localMappingTotal ? localMapping.found / localMappingTotal : null,
    multipleMatchRate: localMappingTotal ? localMapping.multiple_matches / localMappingTotal : null,
  },
  accuracyByMake: [...byMake.values()].map(withAccuracy).sort((a, b) => a.make.localeCompare(b.make)),
  accuracyByEnginePresence: [...byEnginePresence.values()].map(withAccuracy),
  failureTaxonomy,
  layers: {
    tronk: report.summary?.layerA ?? null,
    mannVehicle: report.summary?.layerB ?? null,
    localProduct: report.summary?.layerC ?? null,
  },
  latency: report.summary?.latency ?? null,
  endToEnd: {
    strictSuccesses: endToEndSuccess,
    denominator: evaluated.length,
    successRate: evaluated.length ? endToEndSuccess / evaluated.length : null,
    definition: "correct Top-1 vehicle + exact expected MANN filter set + every expected filter has one unique LocalProduct",
  },
};

console.log(JSON.stringify(metrics, null, 2));
