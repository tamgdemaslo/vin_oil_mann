import type { PublicOilCard } from "@/lib/public-oil";
import {
  getPublicVinOilRecommendation,
  listPublicOils,
  normalizePublicVin,
} from "@/lib/public-oil";
import clientSiteData from "@/lib/client-site-data.json";

type ClientOil = {
  id: string;
  brand: string;
  line: string;
  visc: string;
  spec: string;
  type: string;
  volume: string;
  base?: string;
  price: number;
  workPrice?: number;
  badge?: string;
  note?: string;
  color: string;
  stock: number;
};

type ClientData = {
  DEMO_OILS: ClientOil[];
  CASES: Record<string, unknown>[];
  SERVICES: Record<string, unknown>[];
  VIN_DEMO: Record<string, unknown> & {
    vin?: string;
    brand?: string;
    model?: string;
    generation?: string;
    year?: number;
    engine?: string;
    oilCapacity?: string;
    oilSpec?: string;
    filter?: string;
    airFilter?: string;
    cabinFilter?: string;
    drainPlug?: string;
    recommended?: string;
    alternatives?: string[];
  };
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
const DEMO_OILS = DATA.DEMO_OILS ?? [];
const ECO_OIL_TIMEOUT_MS = 800;
const PRIMARY_FALLBACK_BRANDS = new Set(["Bardahl", "Eurol"]);
const BRAND_COLORS: Record<string, string> = {
  bardahl: "#D08A2C",
  elf: "#003B7A",
  eurol: "#0E4FA0",
  lukoil: "#CC0000",
  mobil: "#1A4480",
  shell: "#C2410C",
  total: "#B43A2B",
  zic: "#7A2B2B",
};

const globalAppointmentStore = globalThis as typeof globalThis & {
  __clientSiteAppointments?: ClientAppointment[];
};

export function getClientSiteData() {
  return DATA;
}

export async function getClientOils(searchParams?: URLSearchParams) {
  const oils = await loadClientOils();
  return filterClientOils(oils, searchParams);
}

export async function getClientOilById(id: string) {
  const oils = await loadClientOils();
  return oils.find((oil) => oil.id === id) ?? null;
}

export async function getClientOilFilters() {
  const oils = await loadClientOils();
  return {
    brands: unique(oils.map((oil) => oil.brand)),
    viscs: unique(oils.map((oil) => oil.visc)),
    volumes: unique(oils.map((oil) => oil.volume)),
    types: ["Бензин", "Дизель", "Гибрид", "DPF"],
  };
}

export async function buildClientVinLookup(rawVin: unknown) {
  const vin = normalizePublicVin(rawVin);
  const fallback = fallbackVinLookup(vin);

  if (vin.length !== 17) {
    return {
      ...fallback,
      warning: "VIN должен состоять из 17 символов. Показываем демо-подбор.",
    };
  }

  try {
    const publicResult = await getPublicVinOilRecommendation({ vin });
    const oils = await loadClientOils();
    const byId = new Map(oils.map((oil) => [oil.id, oil]));
    const recommended = publicResult.recommended
      .map((oil) => byId.get(oil.id) ?? publicOilToClientOil(oil))
      .filter(Boolean);
    const alternatives = publicResult.alternatives
      .map((oil) => byId.get(oil.id) ?? publicOilToClientOil(oil))
      .filter(Boolean);

    if (recommended.length === 0) return fallback;

    return {
      car: {
        brand: publicResult.vehicle?.make ?? fallback.car.brand,
        model: publicResult.vehicle?.model ?? fallback.car.model,
        generation: publicResult.vehicle?.series ?? fallback.car.generation,
        year: publicResult.vehicle?.year ?? fallback.car.year,
        engine: publicResult.vehicle?.engine ?? fallback.car.engine,
      },
      maintenance: {
        ...fallback.maintenance,
        oilSpec: oilSpecFromRequirements(publicResult.requirements) ?? fallback.maintenance.oilSpec,
      },
      recommended: recommended[0],
      alternatives: alternatives.length ? alternatives : recommended.slice(1),
      source: { vin: "eco-platform", oilRequirements: "openai+local-rules" },
      warning: publicResult.warning,
    };
  } catch (error) {
    console.warn("[client-site/vin]", error);
    return fallback;
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

async function loadClientOils() {
  try {
    const publicResult = await withTimeout(listPublicOils({ limit: 1000 }), ECO_OIL_TIMEOUT_MS);
    if (publicResult.oils.length > 0) {
      return uniqueById([
        ...publicResult.oils.map(publicOilToClientOil),
        ...DEMO_OILS.filter((oil) => PRIMARY_FALLBACK_BRANDS.has(oil.brand)),
      ]).sort(compareClientOils);
    }
  } catch (error) {
    console.warn("[client-site/oils]", error);
  }

  return DEMO_OILS;
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

  if (sort === "cheap") return filtered.toSorted((a, b) => a.price - b.price);
  if (sort === "exp") return filtered.toSorted((a, b) => b.price - a.price);
  if (sort === "stock") return filtered.toSorted((a, b) => b.stock - a.stock);
  return filtered;
}

function publicOilToClientOil(card: PublicOilCard, index = 0): ClientOil {
  const brand = clean(card.brand) || firstWord(card.name) || "TGM";
  const visc = extractSae(card.name) || clean(card.sae) || "5W-40";
  const volume = clean(card.packageVolume) || extractVolume(card.name) || "4 л";
  const line = deriveOilLine(card.name, brand, visc, volume) || clean(card.name) || "Motor Oil";
  const stock = Math.max(0, Math.floor(Number(card.available) || 0));

  return {
    id: card.id,
    brand,
    line,
    visc,
    spec: buildSpec(card),
    type: inferOilType(card),
    volume,
    base: "Данные эко-платформы",
    price: Number(card.price) || 0,
    workPrice: 0,
    note: card.article ? `Артикул ${card.article}. Данные из эко-платформы.` : "Данные из эко-платформы.",
    color: BRAND_COLORS[brand.toLowerCase()] ?? paletteColor(index),
    stock,
  };
}

function fallbackVinLookup(vin: string) {
  const recommended = DEMO_OILS.find((oil) => oil.id === DATA.VIN_DEMO.recommended) ?? DEMO_OILS[0];
  const alternatives = (DATA.VIN_DEMO.alternatives ?? [])
    .map((id) => DEMO_OILS.find((oil) => oil.id === id))
    .filter((oil): oil is ClientOil => Boolean(oil));

  return {
    car: {
      brand: DATA.VIN_DEMO.brand ?? "BMW",
      model: DATA.VIN_DEMO.model ?? "X5",
      generation: DATA.VIN_DEMO.generation ?? "G05",
      year: DATA.VIN_DEMO.year ?? 2021,
      engine: DATA.VIN_DEMO.engine ?? "B58B30",
    },
    maintenance: {
      oilCapacity: DATA.VIN_DEMO.oilCapacity ?? "6.5 л",
      oilSpec: DATA.VIN_DEMO.oilSpec ?? "BMW Longlife-01 / 5W-30",
      oilCapacityLiters: parseLiters(DATA.VIN_DEMO.oilCapacity),
      filters: {
        oil: { title: "Масляный фильтр", article: DATA.VIN_DEMO.filter ?? "MANN / OEM по VIN", price: 950 },
        air: { title: "Воздушный фильтр", article: DATA.VIN_DEMO.airFilter ?? "MANN / OEM по VIN", price: 1350 },
        cabin: { title: "Салонный фильтр", article: DATA.VIN_DEMO.cabinFilter ?? "MANN / OEM по VIN", price: 1650 },
      },
      drainPlug: DATA.VIN_DEMO.drainPlug ?? "M14x1.5",
    },
    recommended,
    alternatives,
    source: { vin: vin ? "fallback" : "demo", oilRequirements: "local-demo" },
    warning: undefined,
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

function unique(items: string[]) {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b, "ru"));
}

function uniqueById(items: ClientOil[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function firstWord(value: string) {
  return clean(value).split(/\s+/)[0] ?? "";
}

function buildSpec(card: PublicOilCard) {
  return [
    clean(card.apiSpec) ? `API ${clean(card.apiSpec).replace(/^API\s+/i, "")}` : "",
    clean(card.acea) ? `ACEA ${clean(card.acea).replace(/^ACEA\s+/i, "")}` : "",
  ]
    .filter(Boolean)
    .join(" / ") || "API SP / ACEA";
}

function inferOilType(card: PublicOilCard) {
  const text = `${card.name ?? ""} ${card.acea ?? ""} ${card.apiSpec ?? ""}`.toLowerCase();
  const parts = ["Бензин"];
  if (/diesel|диз|c\d|a3\/b4|b\d/.test(text)) parts.push("Дизель");
  if (/dpf|c\d|low saps|mid saps/.test(text)) parts.push("DPF");
  return [...new Set(parts)].join(" · ");
}

function deriveOilLine(name: string, brand: string, visc: string, volume: string) {
  let line = clean(name);
  if (!line) return "";
  if (brand) line = line.replace(new RegExp(`^${escapeRegExp(brand)}\\s+`, "i"), "");
  if (visc) line = line.replace(new RegExp(escapeRegExp(visc).replace("W\\-", "W[- ]?"), "i"), "");
  if (volume) {
    const numericVolume = volume.match(/\d+(?:[.,]\d+)?/)?.[0];
    if (numericVolume) line = line.replace(new RegExp(`${escapeRegExp(numericVolume)}\\s*(?:л|l)`, "i"), "");
  }
  return line
    .replace(/\b[0-9]{1,2}\s*W\s*[- ]?\s*[0-9]{2}\b/gi, "")
    .replace(/\d+(?:[.,]\d+)?\s*(?:л|l|мл|ml)/gi, "")
    .replace(/масло\s+моторное/gi, "")
    .replace(/моторное\s+масло/gi, "")
    .replace(/\s*,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .replace(/[,\s.]+$/g, "")
    .trim();
}

function parseLiters(value: unknown) {
  const matched = String(value ?? "").match(/\d+(?:[.,]\d+)?/);
  if (!matched) return undefined;
  const parsed = Number.parseFloat(matched[0].replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function extractSae(value: string) {
  const match = String(value).match(/\b([0-9]{1,2})\s*W\s*[- ]?\s*([0-9]{2})\b/i);
  return match ? `${Number(match[1])}W-${match[2]}` : "";
}

function extractVolume(value: string) {
  const match = String(value).match(/\b(\d+(?:[.,]\d+)?)\s*(л|l)\b/i);
  return match ? `${match[1].replace(".", ",")} л` : "";
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
