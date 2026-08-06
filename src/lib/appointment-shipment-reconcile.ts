import { normalizePhone } from "@/lib/phone-normalize";
import { formatServiceTime, toServiceDateInput } from "@/lib/date-time";

export type JsonRecord = Record<string, unknown>;

export type AppointmentLike = JsonRecord & {
  id?: string | number;
  createdAt?: string;
  name?: string;
  phone?: string;
  vin?: string;
  slotId?: string;
  slot?: {
    id?: string;
    day?: string;
    date?: string;
    weekday?: string;
    time?: string;
    available?: boolean;
  };
  comment?: string;
  date?: string;
  datetime?: string;
  attendance?: number;
  confirmed?: number;
  services?: Array<{ title?: string }>;
  client?: JsonRecord & {
    id?: string | number;
    display_name?: string;
    name?: string;
    phone?: string;
    is_new?: boolean;
  };
  vehicle?: JsonRecord;
  car?: JsonRecord;
  auto?: JsonRecord;
  vehicle_model?: string;
  vehicle_plate?: string;
  vehicle_vin?: string;
  source?: "local" | "yclients" | string;
};

export type ShipmentLike = {
  id: string;
  name: string;
  momentAt: Date | string;
  documentDate: string;
  applicable: boolean;
  sumCents?: number;
  description?: string | null;
  counterpartyId?: string | null;
  agentNameSnapshot?: string | null;
  organizationId?: string | null;
  attributes?: unknown;
  raw?: unknown;
  positions?: unknown[];
  counterparty?: {
    id?: string;
    name?: string | null;
    phone?: string | null;
    normalizedPhone?: string | null;
    phonesRaw?: unknown;
    searchText?: string | null;
    raw?: unknown;
  } | null;
};

export type AppointmentShipmentStatusKind =
  | "shipment_linked"
  | "matched_by_client"
  | "matched_by_phone"
  | "matched_by_vehicle"
  | "matched_by_phone_and_vehicle"
  | "shipment_draft_started"
  | "needs_manual_link"
  | "shipment_not_found"
  | "appointment_cancelled";

export type AppointmentShipmentLinkSource =
  | "created_from_appointment"
  | "matched_by_client"
  | "matched_by_phone"
  | "matched_by_vehicle"
  | "matched_by_phone_and_vehicle"
  | "manual"
  | "auto_on_shipment_post";

export type AppointmentShipmentConfidence = "high" | "medium" | "low";

export type ShipmentMatchReason = "direct" | "client" | "phone" | "vehicle" | "time";

export type ShipmentCandidate = {
  shipmentId: string;
  shipmentName: string;
  shipmentHref: string;
  documentDate: string;
  moment: string | null;
  applicable: boolean;
  hasPositions: boolean;
  client: string;
  score: number;
  confidence: AppointmentShipmentConfidence;
  reasons: ShipmentMatchReason[];
  linkSource: AppointmentShipmentLinkSource;
  label: string;
  vehicleMismatch: boolean;
  phoneKey: string | null;
  clientKeys: string[];
};

export type AppointmentShipmentStatus = {
  appointmentId: string;
  appointmentDate: string;
  kind: AppointmentShipmentStatusKind;
  label: string;
  hasShipment: boolean;
  countsAsWithoutShipment: boolean;
  requiresManualLink: boolean;
  linkSource: AppointmentShipmentLinkSource | null;
  confidence: AppointmentShipmentConfidence | null;
  matchedShipment: ShipmentCandidate | null;
  candidates: ShipmentCandidate[];
  action: "none" | "open_shipment" | "link_manually" | "create_shipment";
};

type ScoredCandidate = ShipmentCandidate & {
  direct: boolean;
  clientMatch: boolean;
  phoneMatch: boolean;
  vehicleMatch: boolean;
};

const TERMINAL_APPOINTMENT_RE = /cancel|cancell|отмен|не\s*при[шёе]л|no[-_\s]*show|перенес|закрыт\s*вручн|дубл/i;
const CYR_PLATE_MAP: Record<string, string> = {
  A: "А",
  B: "В",
  E: "Е",
  K: "К",
  M: "М",
  H: "Н",
  O: "О",
  P: "Р",
  C: "С",
  T: "Т",
  Y: "У",
  X: "Х",
};

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function stringValue(value: unknown): string {
  return String(value ?? "").trim();
}

export function arrayValue<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function nestedValue(source: JsonRecord, keys: string[]): unknown {
  let cursor: unknown = source;
  for (const key of keys) {
    const record = asRecord(cursor);
    cursor = record[key];
  }
  return cursor;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((item) => stringValue(item)).filter(Boolean))];
}

function jsonArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
}

function jsonStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item)).filter(Boolean);
}

function attrText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return stringValue(value);
  const record = asRecord(value);
  return stringValue(record.name ?? record.title ?? record.value);
}

function attrByName(attributes: unknown, re: RegExp): string {
  return jsonArray(attributes)
    .filter((attr) => re.test(stringValue(attr.name)))
    .map((attr) => attrText(attr.value))
    .filter(Boolean)
    .join(" ");
}

function textAfterLabel(text: string, re: RegExp): string {
  const match = text.match(re);
  return match?.[1]?.trim() ?? "";
}

export function normalizePlate(value: string | null | undefined): string {
  return stringValue(value)
    .toUpperCase()
    .replace(/[ABEKMHOPCTYX]/g, (char) => CYR_PLATE_MAP[char] ?? char)
    .replace(/[^0-9А-ЯA-Z]/g, "");
}

export function normalizeVin(value: string | null | undefined): string {
  return stringValue(value).toUpperCase().replace(/[^0-9A-Z]/g, "");
}

function normalizeModel(value: string | null | undefined): string {
  return stringValue(value).toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я]+/g, " ").trim();
}

function vehicleFromRecord(record: JsonRecord): { model: string; plate: string; vin: string } {
  return {
    model: stringValue(record.model ?? record.title ?? record.name ?? record.vehicleModel ?? record.vehicle_model),
    plate: stringValue(record.plate ?? record.number ?? record.license_plate ?? record.vehiclePlate ?? record.vehicle_plate),
    vin: stringValue(record.vin ?? record.VIN ?? record.vehicleVin ?? record.vehicle_vin),
  };
}

function mergeVehicleParts(parts: Array<{ model?: string; plate?: string; vin?: string }>): {
  model: string;
  plate: string;
  vin: string;
  normalizedModel: string;
  normalizedPlate: string;
  normalizedVin: string;
} {
  const model = parts.map((item) => item.model).find((item) => stringValue(item)) ?? "";
  const plate = parts.map((item) => item.plate).find((item) => stringValue(item)) ?? "";
  const vin = parts.map((item) => item.vin).find((item) => stringValue(item)) ?? "";
  return {
    model: stringValue(model),
    plate: stringValue(plate),
    vin: stringValue(vin),
    normalizedModel: normalizeModel(model),
    normalizedPlate: normalizePlate(plate),
    normalizedVin: normalizeVin(vin),
  };
}

export function appointmentDateTime(appointment: AppointmentLike): Date | null {
  const slotId = stringValue(appointment.slotId || appointment.slot?.id);
  const matched = slotId.match(/^(\d{4}-\d{2}-\d{2})-(\d{4})$/);
  const raw = matched
    ? `${matched[1]}T${matched[2].slice(0, 2)}:${matched[2].slice(2)}:00`
    : stringValue(appointment.date ?? appointment.datetime).replace(" ", "T");
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function appointmentServiceDate(appointment: AppointmentLike): string {
  const slotId = stringValue(appointment.slotId || appointment.slot?.id);
  const localSlotDate = slotId.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1] ?? "";
  if (localSlotDate) return localSlotDate;
  const slotDate = stringValue(appointment.slot?.date || appointment.slot?.day);
  if (/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) return slotDate;
  const date = appointmentDateTime(appointment);
  if (!date) return "";
  return toServiceDateInput(date);
}

export function appointmentClientName(appointment: AppointmentLike): string {
  return (
    stringValue(appointment.client?.display_name) ||
    stringValue(appointment.client?.name) ||
    stringValue(appointment.name) ||
    "Клиент"
  );
}

export function appointmentPhone(appointment: AppointmentLike): string {
  return stringValue(appointment.client?.phone) || stringValue(appointment.phone);
}

export function appointmentTimeLabel(appointment: AppointmentLike): string {
  if (appointment.slot?.time) return appointment.slot.time;
  const date = appointmentDateTime(appointment);
  if (!date) return "";
  return formatServiceTime(date.toISOString());
}

export function appointmentVehicleLabel(appointment: AppointmentLike): string {
  const vehicle = appointmentVehicleParts(appointment);
  return [vehicle.model, vehicle.plate, vehicle.vin].filter(Boolean).join(" · ");
}

export function appointmentServiceTitle(appointment: AppointmentLike): string {
  const serviceTitles = arrayValue<{ title?: string }>(appointment.services)
    .map((service) => stringValue(service.title))
    .filter(Boolean);
  return serviceTitles.join(", ") || stringValue(appointment.comment) || stringValue(appointment.oilId) || "Запись";
}

export function appointmentStatusLabel(appointment: AppointmentLike): string {
  const rawStatus = stringValue(asRecord(appointment).status || asRecord(appointment).state).toLowerCase();
  if (/cancel|отмен/.test(rawStatus)) return "отменена";
  if (/done|finish|complete|заверш/.test(rawStatus)) return "завершена";
  if (appointment.attendance === -1) return "не пришёл";
  if (appointment.attendance === 1) return "приехал";
  if (appointment.confirmed === 1) return "подтверждена";
  if (appointment.client?.is_new) return "новая";
  return "ожидает";
}

export function appointmentIsTerminal(appointment: AppointmentLike): boolean {
  const text = [
    stringValue(asRecord(appointment).status),
    stringValue(asRecord(appointment).state),
    stringValue(asRecord(appointment).status_name),
    stringValue(asRecord(appointment).attendance_status),
    appointmentStatusLabel(appointment),
  ].join(" ");
  return appointment.attendance === -1 || TERMINAL_APPOINTMENT_RE.test(text);
}

function appointmentClientKeys(appointment: AppointmentLike): string[] {
  const client = asRecord(appointment.client);
  const values = [
    appointment.client?.id,
    appointment.clientId,
    appointment.client_id,
    appointment.yclientsClientId,
    appointment.yclients_client_id,
    appointment.clientExternalId,
    appointment.client_external_id,
    appointment.agentId,
    appointment.agent_id,
    appointment.counterpartyId,
    appointment.counterparty_id,
    client.id,
    client.client_id,
    client.yclients_id,
    client.external_id,
  ];
  return uniqueStrings(values.map((value) => (stringValue(value) ? `client:${stringValue(value)}` : "")));
}

function demandClientKeys(demand: ShipmentLike): string[] {
  const raw = asRecord(demand.raw);
  const counterpartyRaw = asRecord(demand.counterparty?.raw);
  const values = [
    demand.counterpartyId,
    demand.counterparty?.id,
    demand.counterparty?.id,
    demand.counterpartyId,
    raw.counterpartyId,
    raw.counterpartyId,
    raw.agentId,
    raw.yclientsClientId,
    nestedValue(raw, ["sourceRecord", "clientId"]),
    nestedValue(raw, ["sourceRecord", "yclientsClientId"]),
    counterpartyRaw.yclientsClientId,
    counterpartyRaw.clientId,
    counterpartyRaw.externalId,
  ];
  return uniqueStrings(values.map((value) => (stringValue(value) ? `client:${stringValue(value)}` : "")));
}

function appointmentPhoneKeys(appointment: AppointmentLike): string[] {
  const client = asRecord(appointment.client);
  return uniqueStrings(
    [
      appointment.phone,
      appointment.client?.phone,
      client.normalizedPhone,
      appointment.phoneNormalized,
      appointment.phone_normalized,
    ].map((item) => normalizePhone(stringValue(item)))
  );
}

function demandPhoneKeys(demand: ShipmentLike): string[] {
  const counterpartyRaw = asRecord(demand.counterparty?.raw);
  const raw = asRecord(demand.raw);
  return uniqueStrings(
    [
      demand.counterparty?.phone,
      demand.counterparty?.normalizedPhone,
      ...jsonStrings(demand.counterparty?.phonesRaw),
      counterpartyRaw.phone,
      counterpartyRaw.normalizedPhone,
      nestedValue(raw, ["agent", "phone"]),
      nestedValue(raw, ["counterparty", "phone"]),
      nestedValue(raw, ["sourceRecord", "clientPhone"]),
    ].map((item) => normalizePhone(stringValue(item)))
  );
}

function appointmentShipmentRefs(appointment: AppointmentLike): string[] {
  return uniqueStrings([
    appointment.shipmentId,
    appointment.shipment_id,
    appointment.demandId,
    appointment.demand_id,
    appointment.localDemandId,
    appointment.local_demand_id,
    nestedValue(asRecord(appointment), ["shipment", "id"]),
    nestedValue(asRecord(appointment), ["demand", "id"]),
  ].map((value) => stringValue(value)));
}

function demandAppointmentRefs(demand: ShipmentLike): string[] {
  const raw = asRecord(demand.raw);
  const recordIds = arrayValue(raw.recordIds).map(stringValue);
  return uniqueStrings([
    raw.recordId,
    raw.yclientsRecordId,
    raw.appointmentId,
    nestedValue(raw, ["record", "id"]),
    nestedValue(raw, ["appointment", "id"]),
    nestedValue(raw, ["sourceRecord", "id"]),
    nestedValue(raw, ["appointmentShipmentLink", "appointmentId"]),
    ...recordIds,
  ].map((value) => stringValue(value)));
}

function appointmentVehicleParts(appointment: AppointmentLike) {
  const client = asRecord(appointment.client);
  const comment = stringValue(appointment.comment);
  return mergeVehicleParts([
    vehicleFromRecord(asRecord(appointment.vehicle)),
    vehicleFromRecord(asRecord(appointment.car)),
    vehicleFromRecord(asRecord(appointment.auto)),
    vehicleFromRecord(asRecord(client.vehicle)),
    vehicleFromRecord(asRecord(client.car)),
    vehicleFromRecord(asRecord(client.auto)),
    {
      model: stringValue(appointment.vehicle_model),
      plate: stringValue(appointment.vehicle_plate),
      vin: stringValue(appointment.vehicle_vin || appointment.vin),
    },
    {
      model: textAfterLabel(comment, /(?:авто|автомобиль|модель)\s*:\s*([^\n]+)/i),
      plate: textAfterLabel(comment, /(?:госномер|гос\.?\s*номер|номер)\s*:\s*([^\n]+)/i),
      vin: textAfterLabel(comment, /vin\s*:\s*([^\n]+)/i),
    },
  ]);
}

function demandVehicleParts(demand: ShipmentLike) {
  const raw = asRecord(demand.raw);
  const sourceRecord = asRecord(raw.sourceRecord);
  const counterpartyRaw = asRecord(demand.counterparty?.raw);
  const description = stringValue(demand.description);
  return mergeVehicleParts([
    vehicleFromRecord(asRecord(raw.vehicle)),
    vehicleFromRecord(asRecord(raw.car)),
    vehicleFromRecord(asRecord(raw.auto)),
    vehicleFromRecord(asRecord(sourceRecord.vehicle)),
    vehicleFromRecord(asRecord(counterpartyRaw.vehicle)),
    {
      model: attrByName(demand.attributes, /модель|model|авто|автомобиль/i),
      plate: attrByName(demand.attributes, /гос|г\/н|госномер|номер\s*(тс|а\/м|авто)|plate/i),
      vin: attrByName(demand.attributes, /vin|вин/i),
    },
    {
      model: textAfterLabel(description, /(?:авто|автомобиль|модель)\s*:\s*([^\n]+)/i),
      plate: textAfterLabel(description, /(?:госномер|гос\.?\s*номер|номер)\s*:\s*([^\n]+)/i),
      vin: textAfterLabel(description, /vin\s*:\s*([^\n]+)/i),
    },
  ]);
}

function vehicleMatchKind(appointment: AppointmentLike, demand: ShipmentLike): { matched: boolean; mismatch: boolean } {
  const left = appointmentVehicleParts(appointment);
  const right = demandVehicleParts(demand);
  if (left.normalizedVin && right.normalizedVin) {
    return { matched: left.normalizedVin === right.normalizedVin, mismatch: left.normalizedVin !== right.normalizedVin };
  }
  if (left.normalizedPlate && right.normalizedPlate) {
    return { matched: left.normalizedPlate === right.normalizedPlate, mismatch: left.normalizedPlate !== right.normalizedPlate };
  }
  if (!left.normalizedVin && !left.normalizedPlate && !right.normalizedVin && !right.normalizedPlate) {
    const matched = Boolean(left.normalizedModel && right.normalizedModel && left.normalizedModel === right.normalizedModel);
    return { matched, mismatch: false };
  }
  return { matched: false, mismatch: false };
}

function shipmentHasPositions(demand: ShipmentLike): boolean {
  return arrayValue(demand.positions).length > 0;
}

function confidenceFor(score: number): AppointmentShipmentConfidence {
  if (score >= 75) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function candidateLabel(source: AppointmentShipmentLinkSource, applicable: boolean): string {
  const suffix = applicable ? "" : " · черновик с позициями";
  if (source === "created_from_appointment") return `Отгрузка связана${suffix}`;
  if (source === "matched_by_client") return `Отгрузка найдена по клиенту${suffix}`;
  if (source === "matched_by_phone") return `Отгрузка найдена по телефону${suffix}`;
  if (source === "matched_by_vehicle") return `Отгрузка найдена по автомобилю${suffix}`;
  if (source === "matched_by_phone_and_vehicle") return `Отгрузка найдена по телефону и автомобилю${suffix}`;
  if (source === "manual") return `Отгрузка связана вручную${suffix}`;
  return `Отгрузка связана автоматически${suffix}`;
}

function linkSourceForCandidate(params: {
  direct: boolean;
  phoneMatch: boolean;
  clientMatch: boolean;
  vehicleMatch: boolean;
  rawLinkSource?: string;
}): AppointmentShipmentLinkSource {
  const raw = stringValue(params.rawLinkSource) as AppointmentShipmentLinkSource;
  if (
    raw === "manual" ||
    raw === "created_from_appointment" ||
    raw === "auto_on_shipment_post" ||
    raw === "matched_by_client" ||
    raw === "matched_by_phone" ||
    raw === "matched_by_vehicle" ||
    raw === "matched_by_phone_and_vehicle"
  ) {
    return raw;
  }
  if (params.direct) return "created_from_appointment";
  if (params.phoneMatch && params.vehicleMatch) return "matched_by_phone_and_vehicle";
  if (params.clientMatch) return "matched_by_client";
  if (params.phoneMatch) return "matched_by_phone";
  return "matched_by_vehicle";
}

function countKeys(items: string[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const keys of items) {
    for (const key of new Set(keys)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function statusFromCandidate(candidate: ShipmentCandidate): AppointmentShipmentStatusKind {
  if (!candidate.applicable) return "shipment_draft_started";
  if (candidate.linkSource === "created_from_appointment" || candidate.linkSource === "manual" || candidate.linkSource === "auto_on_shipment_post") {
    return "shipment_linked";
  }
  return candidate.linkSource;
}

function scoreShipmentCandidate(
  appointment: AppointmentLike,
  demand: ShipmentLike,
  appointmentId: string
): ScoredCandidate | null {
  const demandIds = uniqueStrings([demand.id, demand.id]);
  const direct =
    demandAppointmentRefs(demand).includes(appointmentId) ||
    appointmentShipmentRefs(appointment).some((ref) => demandIds.includes(ref));
  const clientKeys = demandClientKeys(demand);
  const clientMatch = appointmentClientKeys(appointment).some((key) => clientKeys.includes(key));
  const demandPhones = demandPhoneKeys(demand);
  const phoneKey = appointmentPhoneKeys(appointment).find((key) => demandPhones.includes(key)) ?? null;
  const phoneMatch = Boolean(phoneKey);
  const vehicle = vehicleMatchKind(appointment, demand);
  const sameDay = appointmentServiceDate(appointment) === demand.documentDate;
  if (!sameDay || (!direct && !clientMatch && !phoneMatch && !vehicle.matched)) return null;

  const reasons: ShipmentMatchReason[] = [];
  let score = 0;
  if (direct) {
    reasons.push("direct");
    score += 100;
  }
  if (clientMatch) {
    reasons.push("client");
    score += 72;
  }
  if (phoneMatch) {
    reasons.push("phone");
    score += 68;
  }
  if (vehicle.matched) {
    reasons.push("vehicle");
    score += phoneMatch ? 22 : 42;
  }
  const appointmentAt = appointmentDateTime(appointment);
  const demandAt = new Date(demand.momentAt);
  if (appointmentAt && !Number.isNaN(demandAt.getTime()) && demandAt.getTime() >= appointmentAt.getTime() - 60 * 60 * 1000) {
    reasons.push("time");
    score += 5;
  }
  if (vehicle.mismatch && !direct) score -= 35;

  const rawLink = stringValue(nestedValue(asRecord(demand.raw), ["appointmentShipmentLink", "linkSource"]));
  const linkSource = linkSourceForCandidate({ direct, clientMatch, phoneMatch, vehicleMatch: vehicle.matched, rawLinkSource: rawLink });
  const applicable = Boolean(demand.applicable);
  const hasPositions = shipmentHasPositions(demand);
  return {
    shipmentId: demand.id,
    shipmentName: demand.name,
    shipmentHref: `/shipment/${encodeURIComponent(demand.id)}`,
    documentDate: demand.documentDate,
    moment: demandAt && !Number.isNaN(demandAt.getTime()) ? demandAt.toISOString() : null,
    applicable,
    hasPositions,
    client: stringValue(demand.counterparty?.name) || stringValue(demand.agentNameSnapshot) || "Клиент не указан",
    score,
    confidence: confidenceFor(score),
    reasons,
    linkSource,
    label: candidateLabel(linkSource, applicable),
    vehicleMismatch: vehicle.mismatch,
    phoneKey,
    clientKeys,
    direct,
    clientMatch,
    phoneMatch,
    vehicleMatch: vehicle.matched,
  };
}

export function reconcileAppointmentShipments(
  appointments: AppointmentLike[],
  shipments: ShipmentLike[]
): AppointmentShipmentStatus[] {
  const activeShipments = shipments.filter((shipment) => shipment.applicable || shipmentHasPositions(shipment));
  const appointmentPhoneCounts = countKeys(appointments.map(appointmentPhoneKeys));
  const appointmentClientCounts = countKeys(appointments.map(appointmentClientKeys));
  const shipmentPhoneCounts = countKeys(activeShipments.map(demandPhoneKeys));
  const shipmentClientCounts = countKeys(activeShipments.map(demandClientKeys));
  const shipmentClientsByPhone = new Map<string, Set<string>>();
  for (const shipment of activeShipments) {
    const clients = demandClientKeys(shipment);
    for (const phone of demandPhoneKeys(shipment)) {
      const set = shipmentClientsByPhone.get(phone) ?? new Set<string>();
      for (const client of clients) set.add(client);
      shipmentClientsByPhone.set(phone, set);
    }
  }

  return appointments.map((appointment) => {
    const appointmentId = stringValue(appointment.id);
    const appointmentDate = appointmentServiceDate(appointment);
    if (!appointmentId || appointmentIsTerminal(appointment)) {
      return {
        appointmentId,
        appointmentDate,
        kind: "appointment_cancelled",
        label: "Запись отменена",
        hasShipment: false,
        countsAsWithoutShipment: false,
        requiresManualLink: false,
        linkSource: null,
        confidence: null,
        matchedShipment: null,
        candidates: [],
        action: "none",
      };
    }

    const candidates = shipments
      .map((shipment) => scoreShipmentCandidate(appointment, shipment, appointmentId))
      .filter((item): item is ScoredCandidate => Boolean(item))
      .sort((a, b) => b.score - a.score || String(a.moment ?? "").localeCompare(String(b.moment ?? "")));

    const direct = candidates.filter((candidate) => candidate.direct);
    const closingDirect = direct.filter((candidate) => candidate.applicable || candidate.hasPositions);
    if (closingDirect.length === 1) {
      const match = closingDirect[0];
      return {
        appointmentId,
        appointmentDate,
        kind: statusFromCandidate(match),
        label: match.label,
        hasShipment: true,
        countsAsWithoutShipment: false,
        requiresManualLink: false,
        linkSource: match.linkSource,
        confidence: "high",
        matchedShipment: match,
        candidates,
        action: "open_shipment",
      };
    }
    if (closingDirect.length > 1) {
      return {
        appointmentId,
        appointmentDate,
        kind: "needs_manual_link",
        label: "Нужно выбрать отгрузку",
        hasShipment: false,
        countsAsWithoutShipment: false,
        requiresManualLink: true,
        linkSource: null,
        confidence: "medium",
        matchedShipment: null,
        candidates,
        action: "link_manually",
      };
    }

    const confident = candidates.filter((candidate) => {
      if (!candidate.applicable && !candidate.hasPositions) return false;
      if (candidate.vehicleMismatch) return false;
      return candidate.clientMatch || candidate.phoneMatch;
    });
    const autoCandidates = confident.filter((candidate) => {
      const phoneAmbiguous =
        candidate.phoneMatch &&
        !candidate.vehicleMatch &&
        candidate.phoneKey &&
        ((appointmentPhoneCounts.get(candidate.phoneKey) ?? 0) > 1 ||
          (shipmentPhoneCounts.get(candidate.phoneKey) ?? 0) > 1 ||
          (shipmentClientsByPhone.get(candidate.phoneKey)?.size ?? 0) > 1);
      const clientAmbiguous =
        candidate.clientMatch &&
        !candidate.vehicleMatch &&
        candidate.clientKeys.some((key) => (appointmentClientCounts.get(key) ?? 0) > 1 || (shipmentClientCounts.get(key) ?? 0) > 1);
      return !phoneAmbiguous && !clientAmbiguous && candidate.score >= 65;
    });

    if (autoCandidates.length === 1) {
      const match = autoCandidates[0];
      return {
        appointmentId,
        appointmentDate,
        kind: statusFromCandidate(match),
        label: match.label,
        hasShipment: true,
        countsAsWithoutShipment: false,
        requiresManualLink: false,
        linkSource: match.linkSource,
        confidence: match.confidence,
        matchedShipment: match,
        candidates,
        action: "open_shipment",
      };
    }

    const reviewCandidates = candidates.filter((candidate) => candidate.applicable || candidate.hasPositions);
    if (
      candidates.length > 1 ||
      confident.length > 1 ||
      autoCandidates.length > 1 ||
      (confident.length === 1 && autoCandidates.length === 0) ||
      reviewCandidates.some((candidate) => candidate.vehicleMismatch)
    ) {
      return {
        appointmentId,
        appointmentDate,
        kind: "needs_manual_link",
        label: "Нужно выбрать отгрузку",
        hasShipment: false,
        countsAsWithoutShipment: false,
        requiresManualLink: true,
        linkSource: null,
        confidence: "medium",
        matchedShipment: null,
        candidates,
        action: "link_manually",
      };
    }

    return {
      appointmentId,
      appointmentDate,
      kind: "shipment_not_found",
      label: "Отгрузка не найдена",
      hasShipment: false,
      countsAsWithoutShipment: true,
      requiresManualLink: false,
      linkSource: null,
      confidence: null,
      matchedShipment: null,
      candidates,
      action: "create_shipment",
    };
  });
}
