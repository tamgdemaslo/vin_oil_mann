import type { PublicOilCard, PublicOilOffer } from "@/lib/public-oil";
import {
  getPublicOilById,
  getPublicOilFilters,
  getPublicVinOilRecommendation,
  listPublicOils,
  normalizePublicVin,
} from "@/lib/public-oil";
import clientSiteData from "@/lib/client-site-data.json";

type ClientOil = {
  id: string;
  article?: string;
  brand: string;
  line: string;
  visc: string;
  spec: string;
  type: string;
  volume: string;
  base?: string;
  price: number | null;
  workPrice?: number;
  badge?: string;
  note?: string;
  color: string;
  stock: number;
  pricesDiffer: boolean;
  offers: PublicOilOffer[];
  updatedAt: string;
  imageHref?: string;
  uom?: string;
};

type ClientData = {
  CASES: Record<string, unknown>[];
  SERVICES: Record<string, unknown>[];
  ACCOUNT: Record<string, unknown>;
};

type ClientSlot = {
  id: string;
  day: string;
  date: string;
  weekday: string;
  time: string;
  available: boolean;
};

type ClientAppointment = {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  vin: string;
  oilId: string;
  slotId: string;
  slot: ClientSlot;
  comment: string;
};

const DATA = clientSiteData as ClientData;
const ECO_OIL_TIMEOUT_MS = 25_000;
const BRAND_COLORS: Record<string, string> = {
  bardahl: "#D08A2C",
  bmw: "#1A4480",
  cworks: "#3D3D3D",
  elf: "#003B7A",
  eurol: "#0E4FA0",
  gm: "#1A4480",
  idemitsu: "#B43A2B",
  liqui: "#0E4FA0",
  "liqui moly": "#0E4FA0",
  lukoil: "#CC0000",
  mannol: "#7A2B2B",
  mobil: "#1A4480",
  motul: "#B43A2B",
  ngn: "#B43A2B",
  rolf: "#3D3D3D",
  shell: "#C2410C",
  total: "#B43A2B",
  vag: "#3D3D3D",
  zerpo: "#D08A2C",
  zic: "#7A2B2B",
};

const KNOWN_OIL_BRANDS = [
  { name: "Bardahl", aliases: ["bardahl"] },
  { name: "BMW", aliases: ["bmw"] },
  { name: "Cworks", aliases: ["cworks"] },
  { name: "Elf", aliases: ["elf"] },
  { name: "Eurol", aliases: ["eurol"] },
  { name: "GM", aliases: ["gm"] },
  { name: "Idemitsu", aliases: ["idemitsu"] },
  { name: "Liqui Moly", aliases: ["liqui moly", "liqui"] },
  { name: "Lukoil", aliases: ["lukoil", "лукойл"] },
  { name: "Mannol", aliases: ["mannol"] },
  { name: "Mobil", aliases: ["mobil"] },
  { name: "Motul", aliases: ["motul"] },
  { name: "NGN", aliases: ["ngn"] },
  { name: "Rolf", aliases: ["rolf"] },
  { name: "Shell", aliases: ["shell"] },
  { name: "Total", aliases: ["total"] },
  { name: "Vag", aliases: ["vag"] },
  { name: "ZERPO", aliases: ["zerpo"] },
  { name: "Zic", aliases: ["zic"] },
];

const GENERIC_BRANDS = new Set(["масло", "моторное", "oil", "engine"]);

const globalAppointmentStore = globalThis as typeof globalThis & {
  __clientSiteAppointments?: ClientAppointment[];
};

export function getClientSiteData() {
  return DATA;
}

export async function getClientOils(searchParams?: URLSearchParams) {
  const oils = await loadClientOils(clientOilLimit(searchParams));
  return filterClientOils(oils, searchParams);
}

export async function getClientOilById(id: string) {
  const oil = await getPublicOilById(id);
  return oil ? publicOilToClientOil(oil) : null;
}

export async function getClientOilFilters() {
  const filters = await getPublicOilFilters();
  return {
    brands: filters.brands,
    viscs: filters.sae,
    volumes: filters.packageVolumes,
    types: [],
  };
}

export async function buildClientVinLookup(rawVin: unknown) {
  const vin = normalizePublicVin(rawVin);

  if (vin.length !== 17) {
    return emptyVinLookup(vin, "VIN должен состоять из 17 символов.");
  }

  try {
    const publicResult = await getPublicVinOilRecommendation({ vin });
    const recommended = publicResult.recommended
      .map((oil) => publicOilToClientOil(oil))
      .filter(Boolean);
    const alternatives = publicResult.alternatives
      .map((oil) => publicOilToClientOil(oil))
      .filter(Boolean);

    return {
      car: {
        brand: publicResult.vehicle?.make,
        model: publicResult.vehicle?.model,
        generation: publicResult.vehicle?.series,
        year: publicResult.vehicle?.year,
        engine: publicResult.vehicle?.engine,
      },
      maintenance: {
        oilSpec: oilSpecFromRequirements(publicResult.requirements),
        filters: {},
      },
      recommended: recommended[0] ?? null,
      alternatives: alternatives.length ? alternatives : recommended.slice(1),
      source: { vin: "eco-platform", oilRequirements: "openai+local-rules" },
      warning: publicResult.warning,
    };
  } catch (error) {
    console.warn("[client-site/vin]", error);
    return emptyVinLookup(vin, "Подбор по VIN временно недоступен. Повторите запрос позже.");
  }
}

export function getClientAppointmentSlots() {
  const busySlotIds = new Set(getAppointmentStore().map((item) => item.slotId));
  return buildSlots().map((slot) => ({
    ...slot,
    available: !busySlotIds.has(slot.id),
  }));
}

export function createClientAppointment(input: Record<string, unknown>) {
  const slots = getClientAppointmentSlots();
  const slotId = String(input.slotId ?? "").trim();
  const slot = slots.find((item) => item.id === slotId);
  const name = String(input.name ?? "").trim();
  const phone = String(input.phone ?? "").trim();
  const vin = normalizePublicVin(input.vin);
  const oilId = String(input.oilId ?? "").trim();

  if (name.length < 2) throw new ClientApiError(422, "Укажите имя.");
  if (phone.replace(/\D/g, "").length < 10) throw new ClientApiError(422, "Укажите телефон.");
  if (vin.length !== 17) throw new ClientApiError(422, "VIN должен состоять из 17 символов.");
  if (!oilId) throw new ClientApiError(422, "Укажите масло.");
  if (!slot) throw new ClientApiError(422, "Выберите свободный слот.");
  if (!slot.available) throw new ClientApiError(422, "Этот слот уже занят.");

  const appointment: ClientAppointment = {
    id: `TGM-${Date.now().toString(36).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    name,
    phone,
    vin,
    oilId,
    slotId,
    slot,
    comment: String(input.comment ?? "").trim(),
  };

  getAppointmentStore().push(appointment);
  return appointment;
}

export function listClientAppointments() {
  return getAppointmentStore();
}

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function loadClientOils(limit = 100) {
  const publicResult = await withTimeout(listPublicOils({ limit }), ECO_OIL_TIMEOUT_MS);
  return uniqueById(publicResult.oils.map(publicOilToClientOil)).sort(compareClientOils);
}

function clientOilLimit(searchParams?: URLSearchParams) {
  const parsed = Number.parseInt(searchParams?.get("limit") ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : 30;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out loading eco-platform oils.")), timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

function filterClientOils(oils: ClientOil[], searchParams?: URLSearchParams) {
  if (!searchParams) return oils;
  const brands = searchParams.getAll("brand").flatMap(splitParam);
  const viscs = searchParams.getAll("visc").flatMap(splitParam);
  const volumes = searchParams.getAll("volume").flatMap(splitParam);
  const types = searchParams.getAll("type").flatMap(splitParam);
  const query = (searchParams.get("q") ?? "").trim().toLowerCase();
  const sort = searchParams.get("sort") ?? "rec";

  const filtered = oils.filter((oil) => {
    if (brands.length && !brands.includes(oil.brand)) return false;
    if (viscs.length && !viscs.includes(oil.visc)) return false;
    if (volumes.length && !volumes.includes(oil.volume)) return false;
    if (types.length && !types.some((type) => oil.type.includes(type))) return false;
    if (query) {
      const haystack = `${oil.brand} ${oil.line} ${oil.visc} ${oil.spec} ${oil.type}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  if (sort === "cheap") return filtered.toSorted((a, b) => compareNullablePrices(a.price, b.price));
  if (sort === "exp") return filtered.toSorted((a, b) => compareNullablePrices(b.price, a.price));
  if (sort === "stock") return filtered.toSorted((a, b) => b.stock - a.stock);
  return filtered;
}

function publicOilToClientOil(card: PublicOilCard, index = 0): ClientOil {
  const brand = normalizeOilBrand(card);
  const visc = extractSae(card.name) || clean(card.sae);
  const nameVolume = extractVolume(card.name);
  const packageVolume = clean(card.packageVolume);
  const volume = (/розлив/i.test(card.name) && nameVolume ? nameVolume : packageVolume) || nameVolume;
  const line = deriveOilLine(card.name, brand, visc, volume) || clean(card.name);
  const stock = Math.max(0, Number(card.available) || 0);

  return {
    id: card.id,
    article: clean(card.article) || undefined,
    brand,
    line,
    visc,
    spec: buildSpec(card),
    type: inferOilType(card),
    volume,
    price: card.pricesDiffer || card.price == null ? null : Number(card.price),
    note: clean(card.description) || (card.article ? `Артикул ${card.article}.` : undefined),
    color: BRAND_COLORS[brand.toLowerCase()] ?? paletteColor(index),
    stock,
    pricesDiffer: card.pricesDiffer,
    offers: card.offers,
    updatedAt: card.updatedAt,
    imageHref: card.imageHref,
    uom: clean(card.uom) || undefined,
  };
}

function compareNullablePrices(left: number | null, right: number | null) {
  if (left == null) return right == null ? 0 : 1;
  if (right == null) return -1;
  return left - right;
}

function emptyVinLookup(vin: string, warning: string) {
  return {
    car: {},
    maintenance: { filters: {} },
    recommended: null,
    alternatives: [],
    source: { vin: vin ? "unavailable" : "empty", oilRequirements: "none" },
    warning,
  };
}

function buildSlots(): ClientSlot[] {
  const weekdayTimes = ["09:00", "10:30", "12:00", "13:30", "16:00", "17:00", "18:30"];
  const saturdayTimes = ["10:00", "11:30", "13:00", "15:00"];
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const groups: { date: Date; times: string[] }[] = [];
  let cursor = today;

  while (groups.length < 3) {
    const dayOfWeek = cursor.getDay();
    if (dayOfWeek !== 0) {
      const times = (dayOfWeek === 6 ? saturdayTimes : weekdayTimes).filter(
        (time) => !isSameDate(cursor, today) || toMinutes(time) > currentMinutes(now)
      );

      if (times.length) groups.push({ date: new Date(cursor), times });
    }
    cursor = addDays(cursor, 1);
  }

  return groups.flatMap(({ date, times }) => {
    const dateIso = toIsoDate(date);
    const dateLabel = formatDate(date);
    const weekday = formatWeekday(date);
    const day = isSameDate(date, today) ? "СЕГ" : isSameDate(date, tomorrow) ? "ЗАВ" : weekday.toUpperCase();

    return times.map((time) => ({
      id: `${dateIso}-${time.replace(":", "")}`,
      day,
      date: dateLabel,
      weekday,
      time,
      available: true,
    }));
  });
}

function getAppointmentStore() {
  globalAppointmentStore.__clientSiteAppointments ??= [];
  return globalAppointmentStore.__clientSiteAppointments;
}

function oilSpecFromRequirements(requirements: unknown) {
  if (!requirements || typeof requirements !== "object") return undefined;
  const data = requirements as Record<string, unknown>;
  return ["sae", "acea", "api", "oem", "ilsac"]
    .flatMap((key) => (Array.isArray(data[key]) ? data[key] : []))
    .map((value) => String(value).trim())
    .filter(Boolean)
    .join(" / ");
}

function compareClientOils(left: ClientOil, right: ClientOil) {
  const stockOrder = Number(right.stock > 0) - Number(left.stock > 0);
  if (stockOrder !== 0) return stockOrder;
  if (right.stock !== left.stock) return right.stock - left.stock;
  return `${left.brand} ${left.line}`.localeCompare(`${right.brand} ${right.line}`, "ru");
}

function splitParam(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueById(items: ClientOil[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeOilBrand(card: PublicOilCard) {
  const rawBrand = clean(card.brand);
  if (rawBrand && !GENERIC_BRANDS.has(rawBrand.toLowerCase())) {
    return knownOilBrand(rawBrand) || rawBrand;
  }
  return rawBrand;
}

function knownOilBrand(value: unknown) {
  const text = clean(value).toLowerCase();
  if (!text) return "";

  for (const brand of KNOWN_OIL_BRANDS) {
    for (const alias of brand.aliases) {
      const escaped = escapeRegExp(alias);
      const pattern = new RegExp(`(^|[^a-zа-яё0-9])${escaped}([^a-zа-яё0-9]|$)`, "i");
      if (pattern.test(text)) return brand.name;
    }
  }

  return "";
}

function buildSpec(card: PublicOilCard) {
  return [
    clean(card.apiSpec) ? `API ${clean(card.apiSpec).replace(/^API\s+/i, "")}` : "",
    clean(card.acea) ? `ACEA ${clean(card.acea).replace(/^ACEA\s+/i, "")}` : "",
  ]
    .filter(Boolean)
    .join(" / ");
}

function inferOilType(card: PublicOilCard) {
  const text = `${card.name ?? ""} ${card.acea ?? ""} ${card.apiSpec ?? ""}`.toLowerCase();
  const parts: string[] = [];
  if (/\bapi\s+s[a-p]\b|бензин|gasoline|petrol/i.test(text)) parts.push("Бензин");
  if (/diesel|диз|\bc\d\b|a3\/b4|\bb\d\b/.test(text)) parts.push("Дизель");
  if (/dpf|c\d|low saps|mid saps/.test(text)) parts.push("DPF");
  return [...new Set(parts)].join(" · ");
}

function deriveOilLine(name: string, brand: string, visc: string, volume: string) {
  let line = clean(name);
  if (!line) return "";
  line = line
    .replace(/масло\s+моторное/gi, "")
    .replace(/моторное\s+масло/gi, "")
    .replace(/\bengine\s+oil\b/gi, "");
  if (brand) {
    line = line.replace(new RegExp(`(^|\\s|,|\\()${escapeRegExp(brand)}(?=\\s|,|\\)|$)`, "i"), " ");
  }
  if (visc) line = line.replace(new RegExp(escapeRegExp(visc).replace("W\\-", "W[- ]?"), "i"), "");
  if (volume) {
    const numericVolume = volume.match(/\d+(?:[.,]\d+)?/)?.[0];
    if (numericVolume) line = line.replace(new RegExp(`${escapeRegExp(numericVolume)}\\s*(?:л|l)`, "i"), "");
  }
  return line
    .replace(/\b[0-9]{1,2}\s*W\s*[- ]?\s*[0-9]{2}\b/gi, "")
    .replace(/\d+(?:[.,]\d+)?\s*(?:л|l|мл|ml)/gi, "")
    .replace(/(^|\s|,)на\s+розлив(?=\s|,|$)/gi, " ")
    .replace(/,\s*\./g, "")
    .replace(/\s+\./g, "")
    .replace(/\s*,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .replace(/[,\s.]+$/g, "")
    .trim();
}

function extractSae(value: string) {
  const match = String(value).match(/\b([0-9]{1,2})\s*W\s*[- ]?\s*([0-9]{2})\b/i);
  return match ? `${Number(match[1])}W-${match[2]}` : "";
}

function extractVolume(value: string) {
  const text = String(value);
  const literMatch = text.match(/(^|[^a-zа-яё0-9])(\d+(?:[.,]\d+)?)\s*(л|l)(?=$|[^a-zа-яё0-9])/i);
  if (literMatch) return `${literMatch[2].replace(".", ",")} л`;

  const milliliterMatch = text.match(/(^|[^a-zа-яё0-9])(\d+(?:[.,]\d+)?)\s*(мл|ml)(?=$|[^a-zа-яё0-9])/i);
  if (!milliliterMatch) return "";

  const milliliters = Number.parseFloat(milliliterMatch[2].replace(",", "."));
  if (!Number.isFinite(milliliters) || milliliters <= 0) return "";
  return `${String(milliliters / 1000).replace(".", ",")} л`;
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function paletteColor(index: number) {
  return ["#C2410C", "#1A4480", "#7A2B2B", "#B43A2B", "#0E4FA0", "#D08A2C"][index % 6];
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isSameDate(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function toIsoDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function formatWeekday(date: Date) {
  const weekday = new Intl.DateTimeFormat("ru-RU", {
    weekday: "short",
  }).format(date).replace(".", "");
  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}

function currentMinutes(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function toMinutes(time: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
