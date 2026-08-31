import { prisma } from "@/lib/db";
import { type DemandDetailAttribute } from "@/lib/demand-detail-load";
import {
  pickJournalOilNoteFromRawRows,
  pickJournalOilNoteFromSyncedPositions,
} from "@/lib/job-order-poster-oil-note";
import { fetchOrganizationRecord, sellerFromOrg } from "@/lib/job-order-poster-org";
import { loadLocalDemandDetailPayload } from "@/lib/local-demand-write";
import {
  extractRawPhoneFromAgent,
  normalizePhoneKey,
  pickNormalizedPhoneFromCounterparty,
} from "@/lib/phone-normalize";
import type { CounterpartyPhoneSource } from "@/lib/phone-normalize";
import type {
  JobOrderPosterModel,
  PosterHistoryRow,
  PosterPart,
  PosterWork,
} from "@/lib/job-order-poster-types";
import { resolveBranchPrintContext } from "@/lib/branch-print-context";

function formatDemandDateRu(momentStr: string): string {
  const normalized = momentStr.includes("T") ? momentStr : momentStr.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return momentStr;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatAttrValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "да" : "нет";
  return JSON.stringify(value);
}

function findAttr(attributes: DemandDetailAttribute[], templateLabel: string): string {
  const want = templateLabel.trim().toLowerCase();
  for (const a of attributes) {
    const n = (a.name ?? "").trim().toLowerCase();
    if (n === want) return formatAttrValue(a.value);
  }
  for (const a of attributes) {
    const n = (a.name ?? "").trim().toLowerCase();
    if (!n) continue;
    if (n.includes(want) || want.includes(n)) return formatAttrValue(a.value);
  }
  return "";
}

function findAttrByNameRe(attributes: DemandDetailAttribute[], re: RegExp): string {
  for (const a of attributes) {
    const n = (a.name ?? "").trim();
    if (n && re.test(n)) return formatAttrValue(a.value);
  }
  return "";
}

function findExactAttrNormalized(attributes: DemandDetailAttribute[], exactName: string): string {
  const want = exactName.trim().toLowerCase().replace(/ё/g, "е");
  for (const a of attributes) {
    const n = (a.name ?? "").trim().toLowerCase().replace(/ё/g, "е");
    if (n === want) return formatAttrValue(a.value);
  }
  return "";
}

/** Значение похоже на VIN (латиница+цифры), а не на госномер с кириллицей. */
function looksLikeVinValue(value: string): boolean {
  const t = value.replace(/\s/g, "");
  if (!t) return false;
  if (/[А-Яа-яЁё]{2,}/.test(value)) return false;
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(t)) return true;
  if (t.length >= 11 && t.length <= 19 && /^[A-HJ-NPR-Z0-9]+$/i.test(t)) return true;
  return false;
}

/** Госномер: не путать с VIN из поля «номер». */
function findPlateValue(attributes: DemandDetailAttribute[]): string {
  const plateLabelRes = [
    /гос\s*номер|государственн|регистрационн|рег\s*знак|^\s*plate\s*$/i,
    /гос(?!\w)|номер\s*а\/м|номер\s*авто/i,
  ];
  for (const re of plateLabelRes) {
    for (const a of attributes) {
      const label = (a.name ?? "").trim();
      if (!label || /vin|вин/i.test(label)) continue;
      if (/телефон|phone|контакт|email|почт/i.test(label)) continue;
      if (!re.test(label)) continue;
      const val = formatAttrValue(a.value).trim();
      if (val && !looksLikeVinValue(val)) return val;
    }
  }
  for (const a of attributes) {
    const label = (a.name ?? "").trim().toLowerCase();
    if (/vin|вин|кузов|двигател|шасси|рамы|frame/i.test(label)) continue;
    if (/телефон|phone|контакт|email|почт/i.test(label)) continue;
    if (!/номер/.test(label)) continue;
    const val = formatAttrValue(a.value).trim();
    if (!val || looksLikeVinValue(val)) continue;
    if (/[А-Яа-яЁёA-Za-z]/.test(val)) return val;
  }
  return "";
}

function findVinValue(attributes: DemandDetailAttribute[]): string {
  for (const a of attributes) {
    const label = (a.name ?? "").trim();
    const nl = label.toLowerCase();
    if (/^vin|^вин\b|vin\s*номер|идентификатор\s*тс/i.test(nl)) {
      const val = formatAttrValue(a.value).trim();
      if (val) return val;
    }
  }
  return findAttr(attributes, "vin").trim();
}

function parseIntRu(s: string): number {
  const digits = s.replace(/\s/g, "").replace(/[^\d-]/g, "");
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

function addMonthsRuFormat(momentStr: string, months: number): string {
  const normalized = momentStr.includes("T") ? momentStr : momentStr.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return formatDemandDateRu(momentStr);
  const copy = new Date(d.getTime());
  copy.setMonth(copy.getMonth() + months);
  const dd = String(copy.getDate()).padStart(2, "0");
  const mm = String(copy.getMonth() + 1).padStart(2, "0");
  const yyyy = copy.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function addDaysRuFormat(momentStr: string, days: number): string {
  const normalized = momentStr.includes("T") ? momentStr : momentStr.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return formatDemandDateRu(momentStr);
  const copy = new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
  const dd = String(copy.getDate()).padStart(2, "0");
  const mm = String(copy.getMonth() + 1).padStart(2, "0");
  const yyyy = copy.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function nextMilestoneKm(mileage: number): { value: number; leftKm: number } {
  if (!Number.isFinite(mileage) || mileage <= 0) return { value: 100_000, leftKm: 100_000 };
  const next = Math.ceil((mileage + 1) / 100_000) * 100_000;
  return { value: next, leftKm: Math.max(0, next - mileage) };
}

type RawDemandPosition = {
  quantity?: number;
  price?: number;
  discount?: number;
  assortment?: { name?: string; meta?: { type?: string; href?: string } };
};

type LocalHistoryDemand = {
  id: string;
  name: string;
  documentDate: string;
  momentAt: Date;
  attributes: unknown;
  positions: Array<{ name: string; assortmentType: string }>;
};

function assortmentKind(pos: RawDemandPosition): "service" | "product" {
  const t = pos.assortment?.meta?.type;
  if (t === "service") return "service";
  if (t === "product") return "product";
  const href = pos.assortment?.meta?.href ?? "";
  if (/\/entity\/service\//i.test(href)) return "service";
  if (/\/entity\/product\//i.test(href)) return "product";
  return "product";
}

function lineRubParts(priceKop: number, qty: number, discountPct: number) {
  const priceRub = priceKop / 100;
  const lineBase = qty * priceRub;
  const discountRub = lineBase * (discountPct / 100);
  const sum = Math.round((lineBase - discountRub) * 100) / 100;
  return { priceRub, discountRub, sum };
}

function isLikelyOrderNumberLabel(name: string): boolean {
  const t = name.trim();
  return /^0*\d{3,8}$/.test(t);
}

function pickNoteForSyncedDemand(
  name: string,
  positions: { name: string; assortmentType: string }[]
): string {
  const oil = pickJournalOilNoteFromSyncedPositions(positions);
  if (oil) return oil;
  if (name && !isLikelyOrderNumberLabel(name)) return name;
  return "—";
}

function demandAttributesFromJson(value: unknown): DemandDetailAttribute[] {
  if (!Array.isArray(value)) return [];
  const out: DemandDetailAttribute[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as { definitionId?: unknown; id?: unknown; name?: unknown; type?: unknown; value?: unknown };
    const id =
      typeof record.definitionId === "string"
        ? record.definitionId
        : typeof record.id === "string"
          ? record.id
          : typeof record.name === "string"
            ? record.name
            : "";
    const name = typeof record.name === "string" ? record.name : id;
    if (!name) continue;
    out.push({
      id,
      name,
      type: typeof record.type === "string" ? record.type : "string",
      meta: { href: `local://demand-attribute/${id}`, type: "demand-attribute", mediaType: "application/json" },
      value: record.value ?? null,
    });
  }
  return out;
}

function normalizeVehicleKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s\-_.]+/g, "");
}

function localDemandMatchesVehicle(demand: LocalHistoryDemand, currentVin: string, currentPlate: string): boolean {
  const attrs = demandAttributesFromJson(demand.attributes);
  const wantVin = normalizeVehicleKey(currentVin === "—" ? "" : currentVin);
  const wantPlate = normalizeVehicleKey(currentPlate === "—" ? "" : currentPlate);
  if (!wantVin && !wantPlate) return true;

  const vin = normalizeVehicleKey(findVinValue(attrs));
  const plate = normalizeVehicleKey(findPlateValue(attrs));
  if (wantVin && vin && vin === wantVin) return true;
  if (wantPlate && plate && plate === wantPlate) return true;
  return false;
}

function localHistoryRowFromDemand(
  demand: LocalHistoryDemand,
  currentDemandId: string,
  currentMileage: number,
  rawRows: RawDemandPosition[]
): PosterHistoryRow {
  const attrs = demandAttributesFromJson(demand.attributes);
  const attrMileage = parseIntRu(findAttr(attrs, "пробег").trim());
  const km = demand.id === currentDemandId && currentMileage > 0 ? currentMileage : attrMileage > 0 ? attrMileage : null;
  const note =
    demand.id === currentDemandId
      ? pickJournalOilNoteFromRawRows(rawRows) ||
        pickNoteForSyncedDemand(demand.name, demand.positions)
      : pickNoteForSyncedDemand(demand.name, demand.positions);
  return {
    date: demand.documentDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1"),
    km,
    note,
  };
}

async function fetchLocalPosterHistory(params: {
  currentDemandId: string;
  phoneKey: string | null;
  currentVin: string;
  currentPlate: string;
  currentMileage: number;
  rawRows: RawDemandPosition[];
}): Promise<{ rows: PosterHistoryRow[]; visits: number; sinceVisit: string } | null> {
  const current = await prisma.localDemand.findUnique({
    where: { id: params.currentDemandId },
    select: {
      id: true,
      counterpartyId: true,
      counterparty: { select: { normalizedPhone: true } },
    },
  });
  if (!current) return null;

  const phoneKey = params.phoneKey ?? current.counterparty?.normalizedPhone ?? null;
  const or = [
    { id: current.id },
    current.counterpartyId ? { counterpartyId: current.counterpartyId } : null,
    phoneKey ? { counterparty: { is: { normalizedPhone: phoneKey } } } : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (or.length === 0) return null;

  const candidates = await prisma.localDemand.findMany({
    where: { OR: or },
    select: {
      id: true,
      name: true,
      documentDate: true,
      momentAt: true,
      attributes: true,
      positions: {
        select: { name: true, assortmentType: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { momentAt: "asc" },
    take: 60,
  });

  const localCandidates: LocalHistoryDemand[] = candidates.map((demand) => ({
    id: demand.id,
    name: demand.name,
    documentDate: demand.documentDate,
    momentAt: demand.momentAt,
    attributes: demand.attributes,
    positions: demand.positions,
  }));
  const unique = [...new Map(localCandidates.map((demand) => [demand.id, demand])).values()];
  if (unique.length === 0) return null;

  const hasVehicleKey = normalizeVehicleKey(params.currentVin === "—" ? "" : params.currentVin) || normalizeVehicleKey(params.currentPlate === "—" ? "" : params.currentPlate);
  const vehicleScoped = hasVehicleKey
    ? unique.filter((demand) => demand.id === params.currentDemandId || localDemandMatchesVehicle(demand, params.currentVin, params.currentPlate))
    : unique;
  const scoped = vehicleScoped.length > 0 ? vehicleScoped : unique;
  const window = scoped.slice(-5);
  const rows = window.map((demand) =>
    localHistoryRowFromDemand(demand, params.currentDemandId, params.currentMileage, params.rawRows)
  );
  if (rows.length === 0) return null;

  return {
    rows,
    visits: Math.max(scoped.length, 1),
    sinceVisit: scoped[0]!.documentDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1"),
  };
}

function shortPointFromAddress(address: string, city: string): string {
  const c = `г. ${city}, `;
  if (address.toLowerCase().startsWith("г.")) {
    const without = address.replace(/^г\.\s*[^,]+,\s*/i, "").trim();
    if (without) return without;
  }
  if (address.includes(c)) return address.split(c).pop()?.trim() ?? address;
  return address.replace(/^г\.\s*[^,]+,\s*/i, "").trim() || address;
}

/** `?variant=…` на страницах /poster и /tags: интервал «следующего пит-стопа» в км. */
const POSTER_VARIANT_INTERVAL_KM: Record<string, number> = {
  akpp_partial: 20_000,
  akpp_full: 60_000,
};

export function posterModelOptsFromVariant(
  variant: string | undefined
): { nextIntervalKm: number } | undefined {
  const key = variant?.trim();
  if (!key) return undefined;
  const km = POSTER_VARIANT_INTERVAL_KM[key];
  if (km == null) return undefined;
  return { nextIntervalKm: km };
}

export async function buildJobOrderPosterModel(
  demandId: string,
  opts?: { nextIntervalKm?: number; branchId?: string }
): Promise<JobOrderPosterModel | null> {
  const loaded = await loadLocalDemandDetailPayload(demandId, opts?.branchId);
  if (!loaded.ok) return null;

  const { header, attributes, raw, rawPositions } = loaded.data;
  const rawRows = Array.isArray(rawPositions) ? (rawPositions as RawDemandPosition[]) : [];

  const orgRecord = await fetchOrganizationRecord(raw);
  const seller = sellerFromOrg(orgRecord);
  const branchPrint = await resolveBranchPrintContext(loaded.data.branchId);

  const site = process.env.POSTER_SITE?.trim() || "tamgdemaslo.ru";
  const tg = process.env.POSTER_TELEGRAM?.trim() || "@tamgdemaslo";
  const envIntervalKm = Math.max(1000, parseInt(process.env.POSTER_NEXT_INTERVAL_KM ?? "8000", 10) || 8000);
  const intervalKm = Math.max(1000, opts?.nextIntervalKm ?? envIntervalKm);
  const intervalMonths = Math.max(1, parseInt(process.env.POSTER_NEXT_INTERVAL_MONTHS ?? "6", 10) || 6);
  const warrantyDays = Math.max(1, parseInt(process.env.POSTER_WARRANTY_DAYS ?? "60", 10) || 60);
  const defaultCity = process.env.POSTER_CITY?.trim() || "Калининград";

  const serviceAddress = branchPrint?.address || "";
  const address = serviceAddress || seller.legalAddress || "";
  const city =
    address.match(/г\.\s*([^,]+)/i)?.[1]?.trim() ||
    address.match(/,\s*([^,]+)\s*,/)?.[1]?.trim() ||
    defaultCity;

  const modelRaw = findAttr(attributes, "модель авто").trim();
  const tokens = modelRaw.split(/\s+/).filter(Boolean);
  const make = tokens[0] ?? "—";
  const model = tokens.slice(1).join(" ") || "—";
  const year = findAttr(attributes, "год").trim() || "—";
  const plate = findPlateValue(attributes).trim() || "—";
  const vin = findVinValue(attributes).trim() || "—";
  const mileageStr = findAttr(attributes, "пробег").trim();
  const mileage = parseIntRu(mileageStr);

  const masterName =
    findAttrByNameRe(attributes, /мастер|исполнитель|специалист/i).trim() ||
    process.env.POSTER_DEFAULT_MASTER?.trim() ||
    "Лобов Максим";

  const agentRaw = (raw as { agent?: CounterpartyPhoneSource })?.agent ?? null;
  const displayPhone = extractRawPhoneFromAgent(agentRaw)?.trim() ?? "";

  const phoneKey = normalizePhoneKey(displayPhone) ?? pickNormalizedPhoneFromCounterparty(agentRaw);

  let historyRows: PosterHistoryRow[] = [];
  let visits = 1;
  let sinceVisit = formatDemandDateRu(header.moment);

  const localHistory = await fetchLocalPosterHistory({
    currentDemandId: demandId,
    phoneKey,
    currentVin: vin,
    currentPlate: plate,
    currentMileage: mileage,
    rawRows,
  }).catch(() => null);

  if (localHistory) {
    historyRows = localHistory.rows;
    visits = localHistory.visits;
    sinceVisit = localHistory.sinceVisit;
  }

  if (historyRows.length === 0) {
    const oilNote = pickJournalOilNoteFromRawRows(rawRows);
    const nm = header.name?.trim() ?? "";
    const note =
      oilNote ||
      (!isLikelyOrderNumberLabel(nm) && nm ? nm : "") ||
      "—";
    historyRows = [
      {
        date: formatDemandDateRu(header.moment),
        km: mileage > 0 ? mileage : null,
        note,
      },
    ];
  } else if (mileage > 0 && !historyRows.some((r) => r.km != null)) {
    historyRows = historyRows.map((r, i, arr) =>
      i === arr.length - 1 ? { ...r, km: mileage } : r
    );
  }

  const works: PosterWork[] = [];
  const parts: PosterPart[] = [];

  for (const p of rawRows) {
    const qty = Number(p.quantity) || 0;
    const priceKop = typeof p.price === "number" ? p.price : 0;
    const discountPct = typeof p.discount === "number" ? p.discount : 0;
    const name = (p.assortment?.name ?? "").trim() || "—";
    const { priceRub, discountRub, sum } = lineRubParts(priceKop, qty, discountPct);
    const kind = assortmentKind(p);
    if (kind === "service") {
      works.push({
        name,
        price: Math.round(priceRub),
        qty,
        discount: Math.round(discountRub * 100) / 100,
        sum,
      });
    } else {
      parts.push({
        name,
        price: Math.round(priceRub),
        qty,
        discount: Math.round(discountRub * 100) / 100,
        sum,
      });
    }
  }

  const worksTotal = Math.round(works.reduce((s, w) => s + w.sum, 0) * 100) / 100;
  const partsTotal = Math.round(parts.reduce((s, p) => s + p.sum, 0) * 100) / 100;
  const grandTotal = Math.round((header.sum / 100) * 100) / 100;

  const oilPick = pickJournalOilNoteFromRawRows(rawRows);
  const manualOilTagLine = findExactAttrNormalized(attributes, "моторное масло").trim();
  const oilTagLine =
    manualOilTagLine ||
    oilPick ||
    (parts[0]?.name ?? "").split(",")[0]?.trim() ||
    "—";
  const oilTagVolume = findExactAttrNormalized(attributes, "объем").trim();

  const payMethod =
    header.description?.trim().split(/\n/)[0]?.slice(0, 80) ||
    process.env.POSTER_DEFAULT_PAY_METHOD?.trim() ||
    "—";

  const nextDate = addMonthsRuFormat(header.moment, intervalMonths);
  const nextMileage = mileage > 0 ? mileage + intervalKm : intervalKm;

  const lifetimeVisits = visits;
  let lifetimeSinceYear = "";
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(sinceVisit)) {
    lifetimeSinceYear = sinceVisit.slice(-4);
  }
  return {
    number: header.name?.trim() || demandId,
    date: formatDemandDateRu(header.moment),
    city,
    point: branchPrint?.shortName?.trim() || header.storeName?.trim() || shortPointFromAddress(address, city),
    ip: {
      name: seller.director || header.organizationName || "—",
      inn: seller.inn,
      ogrn: seller.ogrn,
      address: seller.legalAddress || "",
      phone: branchPrint?.phone || "",
      site,
      tg,
    },
    master: { name: masterName || "—" },
    ecoUser: header.ecoUserName?.trim() || "—",
    client: {
      name: header.agentName?.trim() || "—",
      phone: displayPhone || "—",
      visits,
      sinceVisit,
      history: historyRows,
      lifetimeVisits,
      lifetimeSinceYear: lifetimeSinceYear || sinceVisit.slice(-4) || "—",
    },
    car: {
      make,
      model,
      year,
      plate,
      vin,
      mileage,
    },
    works,
    parts,
    worksTotal,
    partsTotal,
    grandTotal,
    payMethod,
    next: {
      date: nextDate,
      mileage: nextMileage,
      intervalKm,
      intervalMonths,
    },
    warrantyUntil: addDaysRuFormat(header.moment, warrantyDays),
    warrantyDays,
    milestone: nextMilestoneKm(mileage),
    oilTagLine,
    oilTagVolume,
  };
}
