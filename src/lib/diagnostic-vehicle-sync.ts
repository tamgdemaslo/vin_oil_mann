import { Prisma } from "@prisma/client";
import { logChange } from "@/lib/change-log";
import { prisma } from "@/lib/db";

export type DiagnosticVehicleSyncMode = "fillMissingOnly" | "forceOverwrite";

export type ShipmentVehicleSnapshot = {
  brand: string | null;
  model: string | null;
  year: number | null;
  licensePlate: string | null;
  vin: string | null;
  mileage: number | null;
  engine: string | null;
  volume: string | null;
  oilSpec: string | null;
  displayName: string | null;
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
};

type SyncField = keyof Pick<
  ShipmentVehicleSnapshot,
  "brand" | "model" | "year" | "licensePlate" | "vin" | "mileage" | "clientId" | "clientName" | "clientPhone"
>;

export type DiagnosticVehicleSyncDiff = {
  field: SyncField;
  label: string;
  diagnosticValue: string;
  shipmentValue: string;
  canFillMissing: boolean;
};

export type DiagnosticVehicleSyncState = {
  shipmentId: string | null;
  hasShipment: boolean;
  hasDifferences: boolean;
  fields: DiagnosticVehicleSyncDiff[];
  missingFields: DiagnosticVehicleSyncDiff[];
  differingFields: DiagnosticVehicleSyncDiff[];
  shipmentVehicle: ShipmentVehicleSnapshot | null;
};

export type DiagnosticVehicleSyncResult = DiagnosticVehicleSyncState & {
  changedFields: DiagnosticVehicleSyncDiff[];
  mode: DiagnosticVehicleSyncMode;
};

const FIELD_LABELS: Record<SyncField, string> = {
  brand: "Марка",
  model: "Модель",
  year: "Год",
  licensePlate: "Госномер",
  vin: "VIN",
  mileage: "Пробег",
  clientId: "Клиент",
  clientName: "Имя клиента",
  clientPhone: "Телефон клиента",
};

const SYNC_FIELDS: SyncField[] = ["brand", "model", "year", "licensePlate", "vin", "mileage", "clientId", "clientName", "clientPhone"];

function cleanString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (typeof value === "object" && "name" in value) return cleanString((value as { name?: unknown }).name);
  return "";
}

function nullIfBlank(value: unknown): string | null {
  const text = cleanString(value);
  if (!text || ["null", "undefined", "не указан", "не указано"].includes(text.toLowerCase())) return null;
  return text;
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const text = cleanString(value);
  if (!text) return null;
  const parsed = Number.parseInt(text.replace(/\D/gu, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeAttrName(value: unknown): string {
  return cleanString(value).toLowerCase().replace(/ё/gu, "е");
}

function attrValue(attributes: unknown, matcher: RegExp): string | null {
  for (const item of jsonArray(attributes)) {
    const row = jsonRecord(item);
    if (matcher.test(normalizeAttrName(row.name))) return nullIfBlank(row.value);
  }
  return null;
}

function textFromRecord(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = nullIfBlank(record[key]);
    if (value) return value;
  }
  return null;
}

function intFromRecord(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = asInt(record[key]);
    if (value != null) return value;
  }
  return null;
}

function normalizePlate(value: string | null): string | null {
  return value ? value.replace(/\s+/gu, "").toUpperCase() : null;
}

function normalizeVin(value: string | null): string | null {
  return value ? value.replace(/\s+/gu, "").toUpperCase() : null;
}

function splitVehicleModel(value: string | null): { brand: string | null; model: string | null } {
  const parts = (value ?? "").split(/\s+/u).filter(Boolean);
  if (parts.length === 0) return { brand: null, model: null };
  if (parts.length === 1) return { brand: parts[0], model: null };
  return { brand: parts[0], model: parts.slice(1).join(" ") };
}

function firstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const clean = nullIfBlank(value);
    if (clean) return clean;
  }
  return null;
}

function firstInt(...values: Array<number | string | null | undefined>): number | null {
  for (const value of values) {
    const parsed = asInt(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function formatFieldValue(field: SyncField, value: unknown): string {
  if (value == null || value === "") return "—";
  if (field === "mileage" && typeof value === "number") return `${value.toLocaleString("ru-RU").replace(/\u00a0/gu, " ")} км`;
  return String(value);
}

function valuesEqual(field: SyncField, current: unknown, next: unknown): boolean {
  if (field === "year" || field === "mileage") return asInt(current) === asInt(next);
  const left = cleanString(current).toLowerCase().replace(/\s+/gu, field === "licensePlate" || field === "vin" ? "" : " ");
  const right = cleanString(next).toLowerCase().replace(/\s+/gu, field === "licensePlate" || field === "vin" ? "" : " ");
  return left === right;
}

function isMissing(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return !nullIfBlank(value);
  return false;
}

function compactObject(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry != null && entry !== ""));
}

export async function getVehicleSnapshotFromShipment(shipmentId: string | null | undefined): Promise<ShipmentVehicleSnapshot | null> {
  const rawId = cleanString(shipmentId);
  if (!rawId) return null;
  const demand = await prisma.localDemand.findFirst({
    where: { OR: [{ id: rawId }, { id: rawId }, { name: rawId }] },
    select: {
      id: true,
      attributes: true,
      raw: true,
      agentNameSnapshot: true,
      counterpartyId: true,
      counterparty: { select: { id: true, name: true, phone: true, normalizedPhone: true } },
    },
  });
  if (!demand) return null;

  const raw = jsonRecord(demand.raw);
  const sourceRecord = jsonRecord(raw.sourceRecord);
  const sourceVehicle = jsonRecord(sourceRecord.vehicle);
  const rawVehicle = jsonRecord(raw.vehicle);
  const decoded = jsonRecord(raw.decoded ?? raw.vinDecoded ?? raw.vinLookupDecoded);
  const oilInfo = jsonRecord(raw.oilInfo);

  const attrModel = attrValue(demand.attributes, /^модель авто$|vehicle|car|авто|модель/u);
  const split = splitVehicleModel(attrModel);
  const brand = firstText(
    textFromRecord(rawVehicle, ["brand", "make", "manufacturer"]),
    textFromRecord(sourceVehicle, ["brand", "make", "manufacturer"]),
    textFromRecord(decoded, ["make", "brand", "manufacturer"]),
    split.brand
  );
  const model = firstText(
    textFromRecord(rawVehicle, ["model", "modelName", "title"]),
    textFromRecord(sourceVehicle, ["model", "modelName", "title"]),
    textFromRecord(decoded, ["model", "modelName"]),
    split.model,
    brand && attrModel?.toLowerCase().startsWith(brand.toLowerCase()) ? attrModel.slice(brand.length).trim() : attrModel
  );
  const year = firstInt(
    attrValue(demand.attributes, /^год$|model\s*year|year/u),
    intFromRecord(rawVehicle, ["year", "modelYear"]),
    intFromRecord(sourceVehicle, ["year", "modelYear"]),
    intFromRecord(decoded, ["year", "modelYear"])
  );
  const licensePlate = normalizePlate(firstText(
    attrValue(demand.attributes, /гос.*номер|госномер|license\s*plate|plate|номер/u),
    textFromRecord(rawVehicle, ["licensePlate", "plate", "number", "stateNumber"]),
    textFromRecord(sourceVehicle, ["licensePlate", "plate", "number", "stateNumber"])
  ));
  const vin = normalizeVin(firstText(
    attrValue(demand.attributes, /vin|вин/u),
    textFromRecord(rawVehicle, ["vin", "VIN"]),
    textFromRecord(sourceVehicle, ["vin", "VIN"]),
    textFromRecord(decoded, ["vin", "VIN"])
  ));
  const mileage = firstInt(
    attrValue(demand.attributes, /пробег|mileage|odometer/u),
    intFromRecord(rawVehicle, ["mileage", "odometer"]),
    intFromRecord(sourceVehicle, ["mileage", "odometer"])
  );
  const volume = firstText(
    attrValue(demand.attributes, /^объем$|^обьем$|объем двигателя|обьем двигателя|volume|displacement/u),
    textFromRecord(rawVehicle, ["volume", "displacementL"]),
    textFromRecord(sourceVehicle, ["volume", "displacementL"]),
    textFromRecord(decoded, ["displacementL"])
  );
  const engine = firstText(
    textFromRecord(rawVehicle, ["engine", "engineSeries", "modification", "trim"]),
    textFromRecord(sourceVehicle, ["engine", "engineSeries", "modification", "trim"]),
    textFromRecord(decoded, ["engine", "engineSeries", "modification", "trim"])
  );
  const oilSpec = firstText(
    attrValue(demand.attributes, /моторное масло|допуск масла|oil/u),
    textFromRecord(oilInfo, ["approval", "fillVolumeLiters"])
  );
  const displayName = [brand, model, year ? String(year) : ""].filter(Boolean).join(" ") || attrModel || null;

  return {
    brand,
    model,
    year,
    licensePlate,
    vin,
    mileage,
    engine,
    volume,
    oilSpec,
    displayName,
    clientId: demand.counterparty?.id ?? demand.counterpartyId ?? null,
    clientName: firstText(demand.counterparty?.name, demand.agentNameSnapshot, textFromRecord(jsonRecord(raw.agent), ["name"]), textFromRecord(sourceRecord, ["clientName"])),
    clientPhone: firstText(demand.counterparty?.phone, demand.counterparty?.normalizedPhone, textFromRecord(sourceRecord, ["clientPhone"])),
  };
}

async function sessionSyncState(sessionId: string): Promise<DiagnosticVehicleSyncState> {
  const session = await prisma.diagnosticMapSession.findUnique({
    where: { id: sessionId },
    select: {
      demandId: true,
      brand: true,
      model: true,
      year: true,
      licensePlate: true,
      vin: true,
      mileage: true,
      clientId: true,
      clientName: true,
      clientPhone: true,
    },
  });
  if (!session?.demandId) {
    return { shipmentId: session?.demandId ?? null, hasShipment: false, hasDifferences: false, fields: [], missingFields: [], differingFields: [], shipmentVehicle: null };
  }
  const snapshot = await getVehicleSnapshotFromShipment(session.demandId);
  if (!snapshot) {
    return { shipmentId: session.demandId, hasShipment: false, hasDifferences: false, fields: [], missingFields: [], differingFields: [], shipmentVehicle: null };
  }

  const fields = SYNC_FIELDS.flatMap((field) => {
    const shipmentValue = snapshot[field];
    if (isMissing(shipmentValue)) return [];
    const diagnosticValue = session[field];
    if (valuesEqual(field, diagnosticValue, shipmentValue)) return [];
    return [{
      field,
      label: FIELD_LABELS[field],
      diagnosticValue: formatFieldValue(field, diagnosticValue),
      shipmentValue: formatFieldValue(field, shipmentValue),
      canFillMissing: isMissing(diagnosticValue),
    }];
  });
  const missingFields = fields.filter((field) => field.canFillMissing);
  const differingFields = fields.filter((field) => !field.canFillMissing);
  return {
    shipmentId: session.demandId,
    hasShipment: true,
    hasDifferences: fields.length > 0,
    fields,
    missingFields,
    differingFields,
    shipmentVehicle: snapshot,
  };
}

export async function getDiagnosticVehicleSyncState(sessionId: string): Promise<DiagnosticVehicleSyncState> {
  return sessionSyncState(sessionId);
}

export async function syncDiagnosticVehicleFromShipment(
  diagnosticId: string,
  options: {
    mode?: DiagnosticVehicleSyncMode;
    userLogin?: string | null;
    reason?: string;
  } = {}
): Promise<DiagnosticVehicleSyncResult> {
  const mode = options.mode ?? "fillMissingOnly";
  const state = await sessionSyncState(diagnosticId);
  const snapshot = state.shipmentVehicle;
  if (!state.hasShipment || !snapshot) return { ...state, changedFields: [], mode };

  const session = await prisma.diagnosticMapSession.findUnique({
    where: { id: diagnosticId },
    select: { vehicleHints: true, brand: true, model: true, year: true, licensePlate: true, vin: true, mileage: true, clientId: true, clientName: true, clientPhone: true },
  });
  if (!session) return { ...state, changedFields: [], mode };

  const data: Prisma.DiagnosticMapSessionUpdateInput = {};
  const changedFields: DiagnosticVehicleSyncDiff[] = [];
  for (const diff of state.fields) {
    if (mode === "fillMissingOnly" && !diff.canFillMissing) continue;
    const nextValue = snapshot[diff.field];
    if (isMissing(nextValue)) continue;
    if (diff.field === "year" || diff.field === "mileage") {
      data[diff.field] = asInt(nextValue);
    } else {
      data[diff.field] = cleanString(nextValue) || null;
    }
    changedFields.push(diff);
  }

  const currentHints = jsonRecord(session.vehicleHints);
  if (changedFields.length > 0) {
    data.vehicleHints = compactObject({
      ...currentHints,
      shipmentVehicleSnapshot: snapshot,
      vehicleDataSyncedAt: new Date().toISOString(),
      vehicleDataSourceJson: {
        ...jsonRecord(currentHints.vehicleDataSourceJson),
        ...Object.fromEntries(changedFields.map((field) => [field.field, "shipment"])),
      },
    }) as Prisma.InputJsonValue;
    await prisma.diagnosticMapSession.update({ where: { id: diagnosticId }, data });
    await logChange({
      entityType: "diagnostic_map_session",
      entityId: diagnosticId,
      action: "update",
      oldValue: { reason: options.reason ?? "vehicle-sync", fields: changedFields.map((field) => field.field) },
      newValue: { mode, shipmentId: state.shipmentId, changedFields },
      performedByLogin: options.userLogin || "system",
    }).catch((error) => {
      console.warn("[diagnostics] vehicle sync audit failed", error);
    });
    console.info("[diagnostics] vehicle synced from shipment", {
      diagnosticId,
      shipmentId: state.shipmentId,
      mode,
      fields: changedFields.map((field) => field.field),
    });
  }

  const nextState = await sessionSyncState(diagnosticId);
  return { ...nextState, changedFields, mode };
}

export async function syncDiagnosticVehicleFromShipmentByToken(token: string, options: Parameters<typeof syncDiagnosticVehicleFromShipment>[1] = {}) {
  const row = await prisma.diagnosticMapSession.findUnique({ where: { publicToken: token }, select: { id: true } });
  if (!row) return null;
  return syncDiagnosticVehicleFromShipment(row.id, options);
}

export async function syncActiveDiagnosticVehiclesForShipment(
  shipmentId: string,
  options: { userLogin?: string | null; reason?: string } = {}
) {
  const rows = await prisma.diagnosticMapSession.findMany({
    where: { demandId: shipmentId },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  const results = [];
  for (const row of rows) {
    results.push(await syncDiagnosticVehicleFromShipment(row.id, { mode: "fillMissingOnly", userLogin: options.userLogin, reason: options.reason ?? "shipment-update" }));
  }
  return results;
}
