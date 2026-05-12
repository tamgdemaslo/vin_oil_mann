import { prisma } from "@/lib/db";
import { loadDemandDetailPayload, type DemandDetailAttribute } from "@/lib/demand-detail-load";
import { fetchPosterBortJournalFromMoySklad } from "@/lib/job-order-poster-bortjournal";
import {
  pickJournalOilNoteFromRawRows,
  pickJournalOilNoteFromSyncedPositions,
} from "@/lib/job-order-poster-oil-note";
import { fetchOrganizationRecord, sellerFromOrg } from "@/lib/job-order-poster-org";
import { moyskladFetch } from "@/lib/moysklad";
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
  opts?: { nextIntervalKm?: number }
): Promise<JobOrderPosterModel | null> {
  const loaded = await loadDemandDetailPayload(demandId);
  if (!loaded.ok) return null;

  const { header, attributes, raw, rawPositions } = loaded.data;
  const rawRows = Array.isArray(rawPositions) ? (rawPositions as RawDemandPosition[]) : [];

  const orgRecord = await fetchOrganizationRecord(raw);
  const seller = sellerFromOrg(orgRecord);

  const site = process.env.POSTER_SITE?.trim() || "tamgdemaslo.ru";
  const tg = process.env.POSTER_TELEGRAM?.trim() || "@tamgdemaslo";
  const envIntervalKm = Math.max(1000, parseInt(process.env.POSTER_NEXT_INTERVAL_KM ?? "8000", 10) || 8000);
  const intervalKm = Math.max(1000, opts?.nextIntervalKm ?? envIntervalKm);
  const intervalMonths = Math.max(1, parseInt(process.env.POSTER_NEXT_INTERVAL_MONTHS ?? "6", 10) || 6);
  const warrantyDays = Math.max(1, parseInt(process.env.POSTER_WARRANTY_DAYS ?? "60", 10) || 60);
  const defaultCity = process.env.POSTER_CITY?.trim() || "Калининград";

  const address = seller.legalAddress || "";
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
  let displayPhone = extractRawPhoneFromAgent(agentRaw)?.trim() ?? "";
  if (!displayPhone && agentRaw) {
    const href = (agentRaw as { meta?: { href?: string } })?.meta?.href;
    const id = href?.split("/").filter(Boolean).pop();
    if (id) {
      const cp = await moyskladFetch<Record<string, unknown>>(`/entity/counterparty/${id}`, {
        cache: "no-store",
      });
      if (cp.ok) {
        displayPhone =
          extractRawPhoneFromAgent(cp.data as CounterpartyPhoneSource)?.trim() ??
          (typeof (cp.data as { phone?: string }).phone === "string"
            ? (cp.data as { phone: string }).phone
            : "");
      }
    }
  }

  const phoneKey = normalizePhoneKey(displayPhone) ?? pickNormalizedPhoneFromCounterparty(agentRaw);

  const agentHref =
    (raw as { agent?: { meta?: { href?: string } } })?.agent?.meta?.href?.trim() ?? "";

  let historyRows: PosterHistoryRow[] = [];
  let visits = 1;
  let sinceVisit = formatDemandDateRu(header.moment);

  const msJournal = agentHref
    ? await fetchPosterBortJournalFromMoySklad({
        agentHref,
        currentDemandId: demandId,
        currentVin: vin,
        currentPlate: plate,
        currentMileage: mileage,
        rawRows,
        displayVisits: 5,
      })
    : null;

  if (msJournal && msJournal.rows.length > 0) {
    historyRows = msJournal.rows;
    visits = msJournal.totalMatching;
    sinceVisit = msJournal.sinceVisitRu;
  } else if (phoneKey) {
    try {
      const synced = await prisma.moySkladDemandSync.findMany({
        where: { normalizedPhone: phoneKey },
        include: { positions: true },
        orderBy: { momentAt: "asc" },
        take: 12,
      });
      visits = Math.max(synced.length, 1);
      if (synced.length > 0) {
        sinceVisit = synced[0]!.documentDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1");
      }
      const syncedWindow = synced.slice(-5);
      historyRows = syncedWindow.map((d) => {
        const docDate = d.documentDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3.$2.$1");
        let note = pickNoteForSyncedDemand(
          d.name,
          d.positions.map((p) => ({ name: p.name, assortmentType: p.assortmentType }))
        );
        if (d.id === demandId) {
          const liveOil = pickJournalOilNoteFromRawRows(rawRows);
          if (liveOil) note = liveOil;
        }
        const km = d.id === demandId ? (mileage > 0 ? mileage : null) : null;
        return { date: docDate, km, note };
      });
    } catch {
      historyRows = [];
    }
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
  const oilTagLine =
    oilPick ||
    (parts[0]?.name ?? "").split(",")[0]?.trim() ||
    "—";

  const payMethod =
    header.description?.trim().split(/\n/)[0]?.slice(0, 80) ||
    process.env.POSTER_DEFAULT_PAY_METHOD?.trim() ||
    "—";

  const nextDate = addMonthsRuFormat(header.moment, intervalMonths);
  const nextMileage = mileage > 0 ? mileage + intervalKm : intervalKm;

  let lifetimeVisits = visits;
  let lifetimeSinceYear = "";
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(sinceVisit)) {
    lifetimeSinceYear = sinceVisit.slice(-4);
  }
  if (phoneKey) {
    try {
      const agg = await prisma.moySkladDemandSync.aggregate({
        where: { normalizedPhone: phoneKey, applicable: true },
        _count: { id: true },
        _min: { documentDate: true },
      });
      const c = agg._count.id;
      if (c > 0) lifetimeVisits = c;
      const md = agg._min.documentDate;
      if (md && /^\d{4}-\d{2}-\d{2}$/.test(md)) {
        lifetimeSinceYear = md.slice(0, 4);
      }
    } catch {
      /* оставляем по журналу */
    }
  }

  return {
    number: header.name?.trim() || demandId,
    date: formatDemandDateRu(header.moment),
    city,
    point: header.storeName?.trim() || shortPointFromAddress(address, city),
    ip: {
      name: seller.director || header.organizationName || "—",
      inn: seller.inn,
      ogrn: seller.ogrn,
      address,
      phone: seller.phones || "—",
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
  };
}

