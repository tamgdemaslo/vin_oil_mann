import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tronkClient, type TronkCallResult, type TronkMethod } from "@/lib/integrations/tronk/client";

export type VehicleLookupInputType = "vin" | "plate" | "frame";
export type VehicleSourceMethod = "tronk_vindecode" | "tronk_vindecode2" | "tronk_plate" | "tronk_frame" | "tronk_convertb2b" | "tronk_convertgate" | "manual" | "mann_manual";
export type VinStatus = "valid" | "check_digit_absent" | "format_warning" | "invalid" | "frame_number" | "unknown";

export type NormalizedVehicleIdentity = {
  vin?: string;
  frameNumber?: string;
  licensePlate?: string;
  makeRaw?: string;
  makeCanonical?: string;
  modelRaw?: string;
  modelCanonical?: string;
  generationRaw?: string;
  generationCanonical?: string;
  bodyName?: string;
  bodyCode?: string;
  bodyType?: string;
  year?: number;
  modelYearFrom?: number;
  modelYearTo?: number;
  engineName?: string;
  engineCode?: string;
  engineSeries?: string;
  engineVolumeLiters?: number;
  engineVolumeCc?: number;
  powerHp?: number;
  powerPs?: number;
  powerKw?: number;
  fuelType?: string;
  transmissionType?: string;
  transmissionName?: string;
  driveType?: string;
  steeringPosition?: string;
  market?: string;
  countryOfOrigin?: string;
  mileage?: number;
  ownersCount?: number;
  sourceMethods: VehicleSourceMethod[];
  confidence: "high" | "medium" | "low";
  rawResultIds: string[];
  vinStatus: VinStatus;
};

export type VehicleLookupCandidate = {
  key: string;
  vehicle: NormalizedVehicleIdentity;
  differences: string[];
};

export type VehicleLookupResult = {
  status: "found" | "not_found" | "frame_number" | "unavailable";
  vehicle: NormalizedVehicleIdentity | null;
  candidates: VehicleLookupCandidate[];
  message?: string;
  fromCache: boolean;
  cacheIds: string[];
  sourceMethods: VehicleSourceMethod[];
};

type LookupOptions = {
  organizationId: string;
  inputType: VehicleLookupInputType;
  input: string;
  extended?: boolean;
  refresh?: boolean;
  actorLogin?: string | null;
};

type RecordValue = Record<string, unknown>;

const MAKE_ALIASES: Record<string, string> = {
  "MERCEDES-BENZ": "MERCEDES",
  "MERCEDES BENZ": "MERCEDES",
  MERCEDES: "MERCEDES",
  VOLKSWAGEN: "VOLKSWAGEN",
  VW: "VOLKSWAGEN",
  LANDROVER: "LAND ROVER",
  "LAND ROVER": "LAND ROVER",
  "SSANG YONG": "SSANGYONG",
  SSANGYONG: "SSANGYONG",
  GREATWALL: "GREAT WALL",
  "GREAT WALL": "GREAT WALL",
};

const PLATE_CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X",
};

const paidRequestBuckets = ((globalThis as typeof globalThis & {
  __ecoTronkPaidRequestBuckets?: Map<string, number[]>;
}).__ecoTronkPaidRequestBuckets ??= new Map<string, number[]>());

function reservePaidRequest(organizationId: string): boolean {
  const limit = Math.max(1, Math.min(10_000, Number(process.env.TRONK_DAILY_LOOKUP_LIMIT ?? 100) || 100));
  const key = organizationId || "default";
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const requests = (paidRequestBuckets.get(key) ?? []).filter((requestedAt) => requestedAt > dayAgo);
  if (requests.length >= limit) {
    paidRequestBuckets.set(key, requests);
    return false;
  }
  requests.push(Date.now());
  paidRequestBuckets.set(key, requests);
  return true;
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}

function valueAt(object: RecordValue, path: string[]): unknown {
  let current: unknown = object;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function firstText(object: RecordValue, paths: string[][]): string | undefined {
  for (const path of paths) {
    const value = valueAt(object, path);
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (Array.isArray(value)) {
      const first = value.find((item): item is string | number => (typeof item === "string" && item.trim().length > 0) || (typeof item === "number" && Number.isFinite(item)));
      if (typeof first === "string") return first.trim();
      if (typeof first === "number") return String(first);
    }
  }
  return undefined;
}

function firstNumber(object: RecordValue, paths: string[][]): number | undefined {
  for (const path of paths) {
    const raw = valueAt(object, path);
    const numeric = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(",", ".").replace(/[^\d.-]/g, "")) : Number.NaN;
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return undefined;
}

function firstYear(object: RecordValue, paths: string[][]): number | undefined {
  for (const path of paths) {
    const raw = valueAt(object, path);
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1886 && raw <= 2100) return raw;
    if (typeof raw !== "string") continue;
    const years = raw.match(/(?:19|20)\d{2}/g);
    const year = years?.at(-1);
    if (year) return Number(year);
  }
  return undefined;
}

function cleanText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function normalizeVehicleMake(value: unknown): string | undefined {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/Ё/g, "Е")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;
  return MAKE_ALIASES[normalized] ?? normalized;
}

export function normalizeVehicleModel(value: unknown, make?: string): { raw?: string; canonical?: string; generation?: string; bodyCode?: string } {
  const raw = cleanText(String(value ?? ""));
  if (!raw) return {};
  let normalized = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[‐‑‒–—―]/g, "-").replace(/\s+/g, " ").trim();
  if (make && normalized.startsWith(`${make} `)) normalized = normalized.slice(make.length).trim();
  const codes = [...normalized.matchAll(/\b(?:[A-Z]\d{1,3}[A-Z]?|\d[A-Z]\d|[A-Z]{1,3}\d{1,3})\b/g)].map((match) => match[0]);
  const generation = normalized.match(/\b(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\b/)?.[0];
  const canonical = normalized
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { raw, canonical: canonical || normalized, generation, bodyCode: codes[0] };
}

export function normalizeEngineCode(value: unknown): string | undefined {
  const normalized = String(value ?? "").toUpperCase().replace(/[‐‑‒–—―\s_-]/g, "").trim();
  return normalized || undefined;
}

export function normalizeVinInput(value: string): string {
  return value.trim().toUpperCase().replace(/[\s.\-_/|]+/g, "");
}

export function normalizeFrameInput(value: string): string {
  return value.trim().toUpperCase().replace(/[\s.\-_/|]+/g, "");
}

export function normalizePlateInput(value: string): { original: string; normalized: string } {
  const original = value.trim();
  const normalized = original.toUpperCase().replace(/\s+/g, "").replace(/[АВЕКМНОРСТУХ]/g, (char) => PLATE_CYRILLIC_TO_LATIN[char] ?? char);
  return { original, normalized };
}

function vinStatus(vin: string, primary: RecordValue | null): VinStatus {
  if (vin.length !== 17) return "frame_number";
  const reportCheck = primaryReports(primary ?? {})
    .map((report) => firstText(asRecord(report.Data ?? report.data ?? report), [["CheckDigit", "Result"], ["check_digit", "result"]]))
    .find((value): value is string => Boolean(value));
  const check = (firstText(primary ?? {}, [["decode", "CheckDigit", "Result"], ["decode", "check_digit", "result"], ["CheckDigit", "Result"]]) ?? reportCheck)?.toLowerCase();
  if (check && /absent|отсутств/i.test(check)) return "check_digit_absent";
  if (check && /invalid|некоррект/i.test(check)) return "format_warning";
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? "valid" : "format_warning";
}

function asNumber(value?: number): number | undefined {
  return value && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function toVehicle(input: RecordValue, method: VehicleSourceMethod, identifiers: Partial<Pick<NormalizedVehicleIdentity, "vin" | "frameNumber" | "licensePlate">> = {}): NormalizedVehicleIdentity {
  const data = asRecord(input.Data ?? input.data ?? input);
  const makeRaw = firstText(data, [
    ["Brand"], ["brand"], ["mark"], ["make"],
    ["mark_info", "en_name"], ["mark_info", "ru_name"], ["mark_info", "name"], ["mark_info", "name_eng"], ["mark_info", "code"],
  ]);
  const makeCanonical = normalizeVehicleMake(makeRaw);
  const modelRaw = firstText(data, [
    ["Model"], ["model"],
    ["model_info", "en_name"], ["model_info", "ru_name"], ["model_info", "name"], ["model_info", "name_eng"], ["model_info", "code"],
  ]);
  const model = normalizeVehicleModel(modelRaw, makeCanonical);
  const volumeLiters = firstNumber(data, [["EngineVolumeLiters"], ["engine_volume_liters"], ["EngineVolume", "L"], ["engine", "volume"], ["tech_param", "engine_volume"], ["engine_volume"]]);
  const volumeCc = firstNumber(data, [["EngineVolumeCc"], ["engine_volume_cc"], ["EngineVolume", "Ccm"], ["engine", "volume_cc"], ["tech_param", "displacement"]]);
  const powerHp = firstNumber(data, [["PowerHp"], ["power_hp"], ["EnginePower", "PS"], ["EnginePower", "Hp"], ["tech_param", "power_hp"], ["tech_param", "power"], ["horse_power"], ["power"]]);
  const powerKw = firstNumber(data, [["PowerKw"], ["power_kw"], ["EnginePower", "KW"], ["tech_param", "power_kw"], ["tech_param", "power_kvt"], ["kw"]]);
  const year = firstYear(data, [["Year"], ["year"], ["StartYear"], ["model_year"], ["year_from"]]);
  const resolvedLiters = asNumber(volumeLiters) ?? (asNumber(volumeCc) ? Number((volumeCc! / 1000).toFixed(3)) : undefined);
  const resolvedCc = asNumber(volumeCc) ?? (resolvedLiters ? Math.round(resolvedLiters * 1000) : undefined);
  const resolvedHp = asNumber(powerHp) ?? (asNumber(powerKw) ? Math.round(powerKw! * 1.35962) : undefined);
  const resolvedKw = asNumber(powerKw) ?? (resolvedHp ? Math.round(resolvedHp / 1.35962) : undefined);
  return {
    ...identifiers,
    makeRaw,
    makeCanonical,
    modelRaw: model.raw,
    modelCanonical: model.canonical,
    generationRaw: firstText(data, [["Generation"], ["generation"], ["super_gen", "name"]]) ?? model.generation,
    generationCanonical: model.generation,
    bodyName: firstText(data, [["BodyName"], ["body_name"], ["body", "name"], ["human_name"]]),
    bodyCode: firstText(data, [["BodyCode"], ["body_code"]]) ?? model.bodyCode,
    bodyType: firstText(data, [["BodyType"], ["body_type"]]),
    year: year ? Math.round(year) : undefined,
    modelYearFrom: firstYear(data, [["ModelYearFrom"], ["model_year_from"], ["StartYear"], ["super_gen", "year_from"]]),
    modelYearTo: firstYear(data, [["ModelYearTo"], ["model_year_to"], ["FinishYear"], ["super_gen", "year_to"]]),
    engineName: firstText(data, [["EngineName"], ["engine_name"], ["Modification"], ["engine", "name"], ["tech_param", "human_name"]]),
    engineCode: normalizeEngineCode(firstText(data, [["EngineCode"], ["engine_code"], ["engine", "code"]])),
    engineSeries: normalizeEngineCode(firstText(data, [["EngineSeries"], ["engine_series"], ["engine", "series"]])),
    engineVolumeLiters: resolvedLiters,
    engineVolumeCc: resolvedCc,
    powerHp: resolvedHp,
    powerPs: firstNumber(data, [["PowerPs"], ["power_ps"], ["EnginePower", "PS"], ["tech_param", "power_ps"]]) ?? resolvedHp,
    powerKw: resolvedKw,
    fuelType: firstText(data, [["FuelType"], ["fuel_type"], ["tech_param", "fuel_type"]]),
    transmissionType: firstText(data, [["TransmissionType"], ["transmission_type"], ["Gear"], ["tech_param", "gear_type"]]),
    transmissionName: firstText(data, [["TransmissionName"], ["transmission_name"], ["tech_param", "gearbox"], ["tech_param", "transmission"]]),
    driveType: firstText(data, [["DriveType"], ["drive_type"], ["Drive"], ["tech_param", "drive_type"]]),
    steeringPosition: firstText(data, [["SteeringPosition"], ["steering_wheel"], ["steering"]]),
    market: firstText(data, [["Market"], ["market"]]),
    countryOfOrigin: firstText(data, [["CountryOfOrigin"], ["country_of_origin"], ["country"]]),
    mileage: firstNumber(data, [["Mileage"], ["mileage"]]),
    ownersCount: firstNumber(data, [["OwnersCount"], ["pts_owners_count"], ["owners_count"]]),
    sourceMethods: [method],
    confidence: makeCanonical && model.canonical ? "high" : makeCanonical || model.canonical ? "medium" : "low",
    rawResultIds: [],
    vinStatus: "unknown",
  };
}

function mergeVehicle(primary: NormalizedVehicleIdentity, secondary: NormalizedVehicleIdentity): NormalizedVehicleIdentity {
  const merged: NormalizedVehicleIdentity = { ...primary };
  for (const key of Object.keys(secondary) as Array<keyof NormalizedVehicleIdentity>) {
    const candidate = secondary[key];
    const existing = merged[key];
    if (existing == null || existing === "" || existing === 0) {
      Object.assign(merged, { [key]: candidate });
    }
  }
  merged.sourceMethods = [...new Set([...primary.sourceMethods, ...secondary.sourceMethods])];
  merged.rawResultIds = [...new Set([...primary.rawResultIds, ...secondary.rawResultIds])];
  merged.confidence = primary.makeCanonical && primary.modelCanonical ? primary.confidence : secondary.confidence;
  return merged;
}

function primaryReports(raw: RecordValue): RecordValue[] {
  const reports = valueAt(raw, ["decode", "Reports"]) ?? valueAt(raw, ["decode", "reports"]) ?? valueAt(raw, ["Decode", "Reports"]);
  if (Array.isArray(reports)) return reports.filter(isRecord);
  if (isRecord(reports)) return Object.values(reports).filter(isRecord);
  return [];
}

function usefulPrimary(raw: RecordValue): boolean {
  return primaryReports(raw).some((report) => {
    const vehicle = toVehicle(asRecord(report.Data ?? report.data ?? report), "tronk_vindecode");
    return Boolean(vehicle.makeCanonical && vehicle.modelCanonical);
  });
}

function usefulExtended(raw: RecordValue): boolean {
  const result = asRecord(raw.result);
  return Object.keys(result).length > 0 && Object.keys(asRecord(result.model_info)).length > 0;
}

function usefulFrame(raw: RecordValue): boolean {
  const result = asRecord(raw.result);
  return Object.keys(result).length > 0 && Object.keys(asRecord(result.tech_data)).length > 0;
}

function dedupeCandidates(candidates: NormalizedVehicleIdentity[]): NormalizedVehicleIdentity[] {
  const byKey = new Map<string, NormalizedVehicleIdentity>();
  for (const candidate of candidates) {
    const key = [candidate.makeCanonical, candidate.modelCanonical, candidate.generationCanonical, candidate.bodyName, candidate.engineSeries].map((item) => item ?? "").join("|");
    const current = byKey.get(key);
    const weight = (item: NormalizedVehicleIdentity) => Object.values(item).filter((value) => value != null && value !== "" && value !== 0).length;
    if (!current || weight(candidate) > weight(current)) byKey.set(key, candidate);
  }
  return [...byKey.values()];
}

function encryptRaw(value: RecordValue): string {
  const key = crypto.createHash("sha256").update(process.env.TRONK_CACHE_ENCRYPTION_KEY?.trim() || process.env.SESSION_SECRET || "tronk-cache-change-me").digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptRaw(value: string | null): RecordValue | null {
  if (!value) return null;
  try {
    const [ivRaw, tagRaw, payloadRaw] = value.split(".");
    if (!ivRaw || !tagRaw || !payloadRaw) return null;
    const key = crypto.createHash("sha256").update(process.env.TRONK_CACHE_ENCRYPTION_KEY?.trim() || process.env.SESSION_SECRET || "tronk-cache-change-me").digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    const decoded = Buffer.concat([decipher.update(Buffer.from(payloadRaw, "base64url")), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function inputHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function maskInput(value: string): string {
  if (value.length <= 4) return "••••";
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

async function cachedTronkCall(params: {
  organizationId: string;
  inputType: VehicleLookupInputType;
  normalizedInput: string;
  method: TronkMethod;
  refresh?: boolean;
  call: () => Promise<TronkCallResult>;
}): Promise<{ call: TronkCallResult; fromCache: boolean; cacheId: string | null }> {
  const hash = inputHash(params.normalizedInput);
  if (!params.refresh) {
    const cached = await prisma.vehicleLookupCache.findFirst({
      where: { organizationId: params.organizationId, inputType: params.inputType, normalizedInputHash: hash, method: params.method, status: "success", expiresAt: { gt: new Date() } },
      orderBy: { completedAt: "desc" },
    });
    const raw = decryptRaw(cached?.rawResponseEncrypted ?? null);
    if (cached && raw) {
      return { call: { ok: true, method: params.method, data: raw, durationMs: 0, providerRequestId: cached.providerRequestId }, fromCache: true, cacheId: cached.id };
    }
  }

  const call = reservePaidRequest(params.organizationId)
    ? await params.call()
    : { ok: false as const, method: params.method, code: "limit" as const, message: "Дневной лимит платных запросов TRONK исчерпан", durationMs: 0 };
  const ttlHours = Math.max(1, Math.min(24 * 365, Number(process.env.TRONK_CACHE_TTL_HOURS ?? 720) || 720));
  const raw = call.ok ? call.data : null;
  const status = call.ok ? "success" : call.code === "provider" ? "not_found" : "error";
  const saved = await prisma.vehicleLookupCache.create({
    data: {
      organizationId: params.organizationId,
      inputType: params.inputType,
      normalizedInputHash: hash,
      maskedInput: maskInput(params.normalizedInput),
      method: params.method,
      status,
      rawResponseEncrypted: raw ? encryptRaw(raw) : null,
      normalizedVehicleJson: Prisma.JsonNull,
      requestedAt: new Date(Date.now() - call.durationMs),
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
      errorCode: call.ok ? null : call.code,
      errorMessage: call.ok ? null : call.message,
      providerRequestId: call.ok ? call.providerRequestId : null,
      sourceVersion: "2026-07-21",
    },
  }).catch(() => null);
  return { call, fromCache: false, cacheId: saved?.id ?? null };
}

function sourceForMethod(method: TronkMethod): VehicleSourceMethod {
  switch (method) {
    case "vindecode": return "tronk_vindecode";
    case "vindecode2": return "tronk_vindecode2";
    case "number2vin": return "tronk_plate";
    case "frameapi": return "tronk_frame";
    case "convertb2b": return "tronk_convertb2b";
    case "convertgate": return "tronk_convertgate";
  }
}

function resultFromVehicles(params: { vehicles: NormalizedVehicleIdentity[]; inputVin?: string; message?: string; status?: VehicleLookupResult["status"]; fromCache: boolean; cacheIds: string[]; sourceMethods: VehicleSourceMethod[] }): VehicleLookupResult {
  const candidates = dedupeCandidates(params.vehicles).map((vehicle): VehicleLookupCandidate => {
    const resolvedVinStatus: VinStatus = vehicle.vinStatus === "unknown" ? (params.inputVin ? "valid" : "unknown") : vehicle.vinStatus;
    return {
      key: crypto.createHash("sha1").update(JSON.stringify([vehicle.makeCanonical, vehicle.modelCanonical, vehicle.engineCode, vehicle.year])).digest("hex"),
      vehicle: { ...vehicle, vin: params.inputVin ?? vehicle.vin, vinStatus: resolvedVinStatus },
      differences: [vehicle.engineCode, vehicle.engineVolumeLiters ? `${vehicle.engineVolumeLiters} л` : undefined, vehicle.powerHp ? `${vehicle.powerHp} л.с.` : undefined, vehicle.driveType, vehicle.transmissionType].filter((value): value is string => Boolean(value)),
    };
  });
  const best = candidates[0]?.vehicle ?? null;
  const result: VehicleLookupResult = {
    status: params.status ?? (best ? "found" : "not_found"),
    vehicle: best,
    candidates,
    message: params.message,
    fromCache: params.fromCache,
    cacheIds: params.cacheIds,
    sourceMethods: params.sourceMethods,
  };
  if (best && params.cacheIds.length > 0) {
    void prisma.vehicleLookupCache.updateMany({
      where: { id: { in: params.cacheIds } },
      data: { normalizedVehicleJson: best as unknown as Prisma.InputJsonValue },
    }).catch(() => undefined);
  }
  return result;
}

export async function lookupVehicle(options: LookupOptions): Promise<VehicleLookupResult> {
  const rawInput = options.input.trim();
  const normalizedVin = normalizeVinInput(rawInput);
  const plate = normalizePlateInput(rawInput);
  const normalizedInput = options.inputType === "plate" ? plate.normalized : options.inputType === "frame" ? normalizeFrameInput(rawInput) : normalizedVin;
  if (!normalizedInput) return { status: "not_found", vehicle: null, candidates: [], message: "Введите VIN, госномер или номер кузова", fromCache: false, cacheIds: [], sourceMethods: [] };

  const cacheIds: string[] = [];
  let fromCache = true;
  const collect = async (method: TronkMethod, inputType: VehicleLookupInputType, call: () => Promise<TronkCallResult>) => {
    const item = await cachedTronkCall({ organizationId: options.organizationId, inputType, normalizedInput, method, refresh: options.refresh, call });
    if (item.cacheId) cacheIds.push(item.cacheId);
    fromCache &&= item.fromCache;
    return item.call;
  };

  if (options.inputType === "frame" || (options.inputType === "vin" && normalizedVin.length !== 17)) {
    const frame = options.inputType === "frame" ? normalizedInput : normalizedVin;
    const call = await collect("frameapi", "frame", () => tronkClient.lookupVehicleByFrame(frame));
    if (!call.ok || !usefulFrame(call.data)) {
      return { status: "frame_number", vehicle: null, candidates: [], message: "Похоже, указан номер кузова, а не 17-значный VIN. Данные автомобиля не найдены — выберите MANN вручную.", fromCache, cacheIds, sourceMethods: ["tronk_frame"] };
    }
    const vehicle = toVehicle(asRecord(call.data.result), "tronk_frame", { frameNumber: frame });
    return resultFromVehicles({ vehicles: [vehicle], status: "found", fromCache, cacheIds, sourceMethods: ["tronk_frame"] });
  }

  if (options.inputType === "plate") {
    const number2vin = await collect("number2vin", "plate", () => tronkClient.lookupVinByPlate(plate.normalized));
    const numberResult = number2vin.ok ? asRecord(number2vin.data.result) : {};
    const resolvedVin = firstText(numberResult, [["vin"], ["VIN"]]) ?? firstText(number2vin.ok ? number2vin.data : {}, [["vin"], ["VIN"]]);
    if (resolvedVin) {
      const candidate = normalizeVinInput(resolvedVin);
      if (candidate.length === 17) {
        return lookupVehicle({ ...options, inputType: "vin", input: candidate, refresh: options.refresh });
      }
      return lookupVehicle({ ...options, inputType: "frame", input: candidate, refresh: options.refresh });
    }
    const b2b = await collect("convertb2b", "plate", () => tronkClient.lookupVehicleByPlate(plate.normalized));
    const b2bVehicle = b2b.ok ? toVehicle(asRecord(b2b.data.result ?? b2b.data), "tronk_convertb2b", { licensePlate: plate.normalized }) : null;
    if (b2bVehicle?.makeCanonical && b2bVehicle.modelCanonical) {
      return resultFromVehicles({ vehicles: [b2bVehicle], message: "Автомобиль определён по госномеру, VIN не получен.", fromCache, cacheIds, sourceMethods: ["tronk_plate", "tronk_convertb2b"] });
    }
    const gate = await collect("convertgate", "plate", () => tronkClient.lookupVehicleByPlateGate(plate.normalized));
    const gateVehicle = gate.ok ? toVehicle(asRecord(gate.data.result ?? gate.data), "tronk_convertgate", { licensePlate: plate.normalized }) : null;
    if (gateVehicle?.makeCanonical && gateVehicle.modelCanonical) {
      return resultFromVehicles({ vehicles: [gateVehicle], message: "Автомобиль определён по госномеру, VIN не получен.", fromCache, cacheIds, sourceMethods: ["tronk_plate", "tronk_convertgate"] });
    }
    return { status: "not_found", vehicle: null, candidates: [], message: "По госномеру автомобиль не найден. Можно продолжить ручной подбор MANN.", fromCache, cacheIds, sourceMethods: ["tronk_plate", "tronk_convertb2b", "tronk_convertgate"] };
  }

  const primary = await collect("vindecode", "vin", () => tronkClient.decodeVinPrimary(normalizedVin));
  const primaryRaw = primary.ok ? primary.data : null;
  const primaryVehicles = primaryRaw
    ? primaryReports(primaryRaw).map((report) => toVehicle(asRecord(report.Data ?? report.data ?? report), "tronk_vindecode", { vin: normalizedVin }))
    : [];
  const hasPrimary = primaryRaw ? usefulPrimary(primaryRaw) : false;
  // Multiple reports from the legacy endpoint mean that it has not selected one
  // concrete vehicle. In that case vindecode2 is the authoritative tie-breaker:
  // merging it into every legacy report would retain their contradictory make/model.
  const hasAmbiguousPrimaryReports = primaryVehicles.length > 1;
  const wantsExtended = Boolean(options.extended || !hasPrimary || hasAmbiguousPrimaryReports);
  let mergedVehicles = primaryVehicles;
  if (wantsExtended) {
    const extended = await collect("vindecode2", "vin", () => tronkClient.decodeVinExtended(normalizedVin));
    if (extended.ok && usefulExtended(extended.data)) {
      const extendedVehicle = toVehicle(asRecord(extended.data.result), "tronk_vindecode2", { vin: normalizedVin });
      mergedVehicles = hasAmbiguousPrimaryReports
        ? [extendedVehicle]
        : primaryVehicles.length > 0
        ? primaryVehicles.map((vehicle) => mergeVehicle(vehicle, extendedVehicle))
        : [extendedVehicle];
    }
  }
  if (mergedVehicles.length === 0 || !mergedVehicles.some((vehicle) => vehicle.makeCanonical && vehicle.modelCanonical)) {
    return { status: primary.ok ? "not_found" : "unavailable", vehicle: null, candidates: [], message: primary.ok ? "Не удалось определить автомобиль. Выберите модификацию MANN вручную." : primary.message, fromCache, cacheIds, sourceMethods: ["tronk_vindecode"] };
  }
  const status = vinStatus(normalizedVin, primaryRaw);
  mergedVehicles = mergedVehicles.map((vehicle) => ({ ...vehicle, vinStatus: status }));
  return resultFromVehicles({ vehicles: mergedVehicles, inputVin: normalizedVin, fromCache, cacheIds, sourceMethods: [...new Set(mergedVehicles.flatMap((vehicle) => vehicle.sourceMethods))] });
}

export function vehicleFieldValues(vehicle: NormalizedVehicleIdentity): Partial<Record<string, { value: string; source: VehicleSourceMethod }>> {
  const source = vehicle.sourceMethods[0] ?? "manual";
  return {
    "vin номер": vehicle.vin ? { value: vehicle.vin, source } : undefined,
    "гос. номер": vehicle.licensePlate ? { value: vehicle.licensePlate, source } : undefined,
    "модель авто": [vehicle.makeRaw, vehicle.modelRaw].filter(Boolean).join(" ") ? { value: [vehicle.makeRaw, vehicle.modelRaw].filter(Boolean).join(" "), source } : undefined,
    "год": vehicle.year ? { value: String(vehicle.year), source } : undefined,
    "двигатель": [vehicle.engineCode, vehicle.engineName].filter(Boolean).join(" · ") ? { value: [vehicle.engineCode, vehicle.engineName].filter(Boolean).join(" · "), source } : undefined,
    "объем двигателя": vehicle.engineVolumeLiters ? { value: `${vehicle.engineVolumeLiters} л`, source } : undefined,
    "мощность": vehicle.powerHp ? { value: `${vehicle.powerHp} л.с.`, source } : undefined,
    "коробка": [vehicle.transmissionType, vehicle.transmissionName].filter(Boolean).join(" · ") ? { value: [vehicle.transmissionType, vehicle.transmissionName].filter(Boolean).join(" · "), source } : undefined,
    "привод": vehicle.driveType ? { value: vehicle.driveType, source } : undefined,
  };
}
