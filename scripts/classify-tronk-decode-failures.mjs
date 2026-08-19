import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
const baselinePath = argument("baseline");
const optimizedPath = argument("optimized");
const outputPath = argument("output");
if (!baselinePath || !optimizedPath || !outputPath) throw new Error("Usage: node scripts/classify-tronk-decode-failures.mjs --baseline=<C.json> --optimized=<C.json> --output=<private.json>");

const jiti = createJiti(import.meta.url, { interopDefault: true, alias: { "@": new URL("../src", import.meta.url).pathname } });
const { assessVehicleDecodeQuality, toVehicle } = await jiti.import("../src/lib/vehicle-identity.ts");

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function findVin(value, depth = 0) {
  if (depth > 6 || !value || typeof value !== "object") return null;
  if (!Array.isArray(value)) {
    for (const [key, candidate] of Object.entries(value)) {
      if (/^vin$/i.test(key) && typeof candidate === "string" && /^[A-HJ-NPR-Z0-9]{17}$/i.test(candidate.trim())) return "VIN_RESOLVED";
    }
  }
  for (const candidate of Array.isArray(value) ? value : Object.values(value)) if (findVin(candidate, depth + 1)) return "VIN_RESOLVED";
  return null;
}
function primaryReports(raw) {
  const reports = record(raw?.decode ?? raw?.Decode).Reports ?? record(raw?.decode ?? raw?.Decode).reports;
  if (Array.isArray(reports)) return reports.filter((item) => item && typeof item === "object");
  return reports && typeof reports === "object" ? Object.values(reports).filter((item) => item && typeof item === "object") : [];
}
function attempt(trace, method) {
  return trace?.attempts?.find((item) => item.method === method) ?? null;
}
function vehicleFromAttempt(item, method) {
  if (!item?.ok) return null;
  if (method === "vindecode") {
    return primaryReports(item.data).map((report) => toVehicle(record(report.Data ?? report.data ?? report), "tronk_vindecode"))
      .sort((left, right) => assessVehicleDecodeQuality(right).score - assessVehicleDecodeQuality(left).score)[0] ?? null;
  }
  const source = method === "vindecode2" ? "tronk_vindecode2" : method === "convertb2b" ? "tronk_convertb2b" : "tronk_convertgate";
  return toVehicle(record(item.data?.result ?? item.data), source);
}
function safeAttemptStatus(item, vehicle = null) {
  if (!item) return "NOT_CALLED";
  if (!item.ok) return /(?:нет\s+данных|no\s+data|not\s+found)/i.test(item.message ?? "") ? "PROVIDER_NO_DATA" : "PROVIDER_ERROR";
  if (!vehicle) return "SUCCESS_NO_USABLE_VEHICLE";
  const quality = assessVehicleDecodeQuality(vehicle);
  return quality.status === "insufficient"
    ? quality.missing.includes("model") && !quality.missing.includes("make") ? "MISSING_MODEL" : quality.missing.includes("make") ? "MISSING_MAKE" : "INSUFFICIENT"
    : quality.status === "complete" ? "COMPLETE" : "PARTIAL";
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const optimized = JSON.parse(fs.readFileSync(optimizedPath, "utf8"));
const optimizedBySample = new Map((optimized.results ?? []).map((result) => [result.sampleId, result]));
const failures = (baseline.results ?? []).filter((result) => !result.decodedVehicle).map((result) => {
  const trace = result.providerTrace;
  const number2vin = attempt(trace, "number2vin");
  const vinResolved = findVin(number2vin?.data) === "VIN_RESOLVED" || Boolean(trace?.vin);
  const primaryVehicle = vehicleFromAttempt(attempt(trace, "vindecode"), "vindecode");
  const extendedVehicle = vehicleFromAttempt(attempt(trace, "vindecode2"), "vindecode2");
  const b2bVehicle = vehicleFromAttempt(attempt(trace, "convertb2b"), "convertb2b");
  const gateVehicle = vehicleFromAttempt(attempt(trace, "convertgate"), "convertgate");
  const fallbackRecoveredByNormalization = !vinResolved && [b2bVehicle, gateVehicle].some((vehicle) => assessVehicleDecodeQuality(vehicle).status !== "insufficient");
  const baselineClass = vinResolved
    ? "VIN_RESOLVED_PRIMARY_MISSING_MODEL_EXTENDED_NO_DATA"
    : fallbackRecoveredByNormalization
      ? "PLATE_FALLBACK_NORMALIZATION_LOSS"
      : "PLATE_TO_VIN_NO_VIN_ALL_FALLBACKS_NO_DATA";
  const optimizedResult = optimizedBySample.get(result.sampleId);
  return {
    sampleId: result.sampleId,
    baselineClass,
    primary: {
      number2vin: vinResolved ? "VIN_RESOLVED" : safeAttemptStatus(number2vin),
      vindecode: safeAttemptStatus(attempt(trace, "vindecode"), primaryVehicle),
      vindecode2: safeAttemptStatus(attempt(trace, "vindecode2"), extendedVehicle),
    },
    plateFallback: {
      convertb2b: safeAttemptStatus(attempt(optimizedResult?.providerTrace, "convertb2b"), vehicleFromAttempt(attempt(optimizedResult?.providerTrace, "convertb2b"), "convertb2b")),
      convertgate: safeAttemptStatus(attempt(optimizedResult?.providerTrace, "convertgate"), vehicleFromAttempt(attempt(optimizedResult?.providerTrace, "convertgate"), "convertgate")),
    },
    final: optimizedResult?.decodedVehicle ? "USABLE_DECODE" : "DECODE_FAILED",
  };
});
const countBy = (field) => Object.fromEntries([...new Set(failures.map((item) => item[field]))].sort().map((value) => [value, failures.filter((item) => item[field] === value).length]));
const output = {
  schemaVersion: 1,
  datasetId: baseline.datasetId,
  baselineFailures: failures.length,
  baselineClasses: countBy("baselineClass"),
  optimizedOutcomes: countBy("final"),
  privacy: "Contains sample IDs and sanitized statuses only; no plates, VINs or raw provider payloads.",
  failures,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputPath, baselineFailures: output.baselineFailures, baselineClasses: output.baselineClasses, optimizedOutcomes: output.optimizedOutcomes }, null, 2));
