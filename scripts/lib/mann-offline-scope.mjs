import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const YEAR_BLOCKER = "диапазон MANN покрывает только часть лет источника; требуется ограничить применяемость";
export const sha = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const unique = values => [...new Set(values.filter(v => v != null && String(v).trim() !== ""))];

export function parseCopy(sql, table) {
  const header = sql.match(new RegExp(`COPY public\\.${table} \\(([^)]+)\\) FROM stdin;\\n`));
  assert.ok(header, `Missing COPY ${table}`);
  const start = header.index + header[0].length, end = sql.indexOf("\n\\.\n", start);
  assert.ok(end > start);
  const keys = header[1].split(", ").map(k => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
  const numeric = new Set(["yearFrom", "yearTo", "vehicleYearFrom", "vehicleYearTo", "engineVolumeCc", "powerKw", "powerHp", "generationNumber", "replacementKmMin", "replacementKmMax", "replacementMonths"]);
  return sql.slice(start, end).split("\n").map(line => {
    const fields = line.split("\t");
    assert.equal(fields.length, keys.length);
    return Object.fromEntries(fields.map((raw, i) => {
      const key = keys[i];
      let value = raw === "\\N" ? null : raw.replace(/\\([btnrfv\\])/g, (_, c) => ({b:"\b",t:"\t",n:"\n",r:"\r",f:"\f",v:"\v","\\":"\\"})[c]);
      if (value != null && key.endsWith("Json")) value = JSON.parse(value);
      if (value != null && numeric.has(key)) { value = Number(value); assert.ok(Number.isFinite(value)); }
      return [key, value];
    }));
  });
}

const validYear = year => Number.isInteger(year) && year >= 1886 && year <= 2100;
const index = (year, month) => year * 12 + month - 1;
const display = value => value == null ? null : `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2,"0")}`;
function monthIndex(month, yearToken, structuredYear) {
  const m = Number(month);
  if (m < 1 || m > 12) return null;
  const year = yearToken.length === 4 ? Number(yearToken) : structuredYear;
  if (!validYear(year) || (yearToken.length === 2 && String(year).slice(-2) !== yearToken)) return null;
  if (structuredYear != null && year !== structuredYear) return null;
  return index(year, m);
}

// No century guessing or replacement of a month boundary by January.
export function applicabilityWindow(requirement, row) {
  if ([requirement.yearFrom, requirement.yearTo].some(y => y != null && !validYear(y))) return null;
  const sourceFrom = requirement.yearFrom == null ? null : index(requirement.yearFrom, 1);
  const sourceTo = requirement.yearTo == null ? null : index(requirement.yearTo, 12);
  if (sourceFrom == null && sourceTo == null) return null;
  if (sourceFrom != null && sourceTo != null && sourceFrom > sourceTo) return null;
  const raw = String(row.vehicleYears ?? "").trim();
  const closed = raw.match(/^(\d{1,2})\/(\d{2}|\d{4})\s*[-–]\s*(\d{1,2})\/(\d{2}|\d{4})$/);
  const open = raw.match(/^(\d{1,2})\/(\d{2}|\d{4})\s*(?:->|→)$/);
  const ending = raw.match(/^(?:->|→)\s*(\d{1,2})\/(\d{2}|\d{4})$/);
  let from = null, to = null;
  if (closed) {
    from = monthIndex(closed[1], closed[2], row.vehicleYearFrom);
    to = monthIndex(closed[3], closed[4], row.vehicleYearTo);
    if (from == null || to == null) return null;
  } else if (open) {
    from = monthIndex(open[1], open[2], row.vehicleYearFrom);
    if (from == null || row.vehicleYearTo != null) return null;
  } else if (ending) {
    to = monthIndex(ending[1], ending[2], row.vehicleYearTo);
    if (to == null || row.vehicleYearFrom != null) return null;
  } else return null;
  const lo = Math.max(sourceFrom ?? -Infinity, from ?? -Infinity);
  const hi = Math.min(sourceTo ?? Infinity, to ?? Infinity);
  if (lo > hi) return null;
  const start = Number.isFinite(lo) ? lo : null, end = Number.isFinite(hi) ? hi : null;
  return {
    source: {from: display(sourceFrom), to: display(sourceTo)},
    mann: {from: display(from), to: display(to), raw},
    intersection: {from: display(start), to: display(end)},
    narrowedYears: { yearFrom: start == null ? null : Math.floor(start / 12), yearTo: end == null ? null : Math.floor(end / 12) },
    restricted: start !== sourceFrom || end !== sourceTo,
    precision: "MONTH", boundaryPolicy: "INCLUSIVE_MONTHS_EXACT_BUILD_MONTH_REQUIRED_AT_BOUNDARIES",
  };
}

// This mirrors the existing materialization fingerprint, including ORIGINAL
// source applicability: clipping dates must never bypass an earlier rejection.
export function originalAssociationFingerprint(targetKey, r, parsed) {
  const component = r.componentModel?.trim();
  const meaningful = component && !/^(?:-|—|N\/A|NONE)$/iu.test(component) ? component.toUpperCase() : null;
  const inferredDrive = r.driveType || (["TRANSFER_CASE", "AWD_COUPLING"].includes(r.systemCode) ? "awd" : null);
  const applicability = {
    yearFrom:r.yearFrom, yearTo:r.yearTo,
    engineCodes: unique([r.engineCodeNormalized, ...(Array.isArray(r.engineCodesJson) ? r.engineCodesJson.map(String) : [])]),
    transmissionType:r.transmissionType, driveType:inferredDrive,
    driveTypeInferredFromSystem:!r.driveType && Boolean(inferredDrive),
    componentModel:meaningful, rawComponentModel:component || null,
  };
  return sha({targetKey, technical: {
    systemCode:r.systemCode, applicability,
    capacities:parsed.capacities.map(c=>({kind:c.kind,minLiters:c.minLiters,maxLiters:c.maxLiters,nominalLiters:c.nominalLiters,toleranceLiters:c.toleranceLiters,qualifier:c.qualifier})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
    specifications:(r.specificationsJson ?? []).map(JSON.stringify).sort(),
    viscosityGrades:(r.viscosityGradesJson ?? []).map(String).sort(),
    recommendation:r.recommendationText?.trim() || null,
    replacementKmMin:r.replacementKmMin,replacementKmMax:r.replacementKmMax,replacementMonths:r.replacementMonths,
  }});
}
