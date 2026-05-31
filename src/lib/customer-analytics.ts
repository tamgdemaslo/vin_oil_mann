import type { Prisma } from "@prisma/client";
import {
  documentProfitFromComputedPositions,
  type ComputedPositionForProfit,
} from "@/lib/customer-analytics-profit";
import { prisma } from "@/lib/db";
import type { CustomerAnalyticsResolvedSettings } from "@/lib/customer-analytics-settings";
import { normalizePhoneKey } from "@/lib/phone-normalize";

export type { ComputedPositionForProfit };
export { documentProfitFromComputedPositions };

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_DAYS_THRESHOLD = 60;

const demandSelect = {
  id: true,
  name: true,
  momentAt: true,
  documentDate: true,
  sumCents: true,
  agentNameSnapshot: true,
  counterpartyId: true,
  attributes: true,
  counterparty: {
    select: {
      id: true,
      name: true,
      phone: true,
      normalizedPhone: true,
    },
  },
  positions: {
    select: {
      id: true,
      productId: true,
      product: { select: { name: true } },
      assortmentMoyskladId: true,
      assortmentType: true,
      name: true,
      quantity: true,
      priceCentsPerUnit: true,
      discount: true,
      buyPriceCentsPerUnit: true,
    },
  },
} satisfies Prisma.LocalDemandSelect;

const counterpartySelect = {
  id: true,
  name: true,
  phone: true,
  normalizedPhone: true,
} satisfies Prisma.LocalCounterpartySelect;

type LocalDemandWithRelations = Prisma.LocalDemandGetPayload<{ select: typeof demandSelect }>;
type LocalDemandPositionWithProduct = LocalDemandWithRelations["positions"][number];
type CounterpartyAnalyticsRow = Prisma.LocalCounterpartyGetPayload<{ select: typeof counterpartySelect }>;

type CrmDealAnalyticsRow = {
  id: string;
  title: string;
  customerName: string | null;
  phoneNormalized: string | null;
  vehicle: string | null;
  source: string | null;
  responsibleLogin: string | null;
  moyskladCounterpartyName: string | null;
  yclientsRecordId: string | null;
  nextContactAt: Date | null;
  status: string;
  notes: string | null;
  nextAction: string | null;
  suppliesNote: string | null;
  suppliesSupplier: string | null;
  suppliesExpectedAt: Date | null;
};

export function getAnalyticsTodayYmd(): string {
  const tz = process.env.CUSTOMER_ANALYTICS_TZ?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
}

export function daysBetweenUtcDates(fromYmd: string, toYmd: string): number {
  const a = Date.parse(`${fromYmd}T12:00:00Z`);
  const b = Date.parse(`${toYmd}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / DAY_MS);
}

function addDaysYmd(ymd: string, delta: number): string {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  const maybeDecimal = value as { toNumber?: () => number; toString?: () => string };
  if (typeof maybeDecimal.toNumber === "function") return maybeDecimal.toNumber();
  const n = Number(maybeDecimal.toString?.() ?? value);
  return Number.isFinite(n) ? n : 0;
}

function ymdInRange(ymd: string, from: string | null, to: string | null): boolean {
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

export function lineRevenueAndCostCents(p: {
  quantity: Prisma.Decimal | number | string;
  discount: Prisma.Decimal | number | string;
  priceCentsPerUnit: number;
  buyPriceCentsPerUnit: number | null;
}): { revenueCents: number; costCents: number; lineIncompleteCost: boolean } {
  const qty = decimalToNumber(p.quantity);
  const disc = decimalToNumber(p.discount);
  const factor = (100 - disc) / 100;
  const revenueCents = Math.round(p.priceCentsPerUnit * qty * factor);
  const costCents = p.buyPriceCentsPerUnit != null ? Math.round(p.buyPriceCentsPerUnit * qty) : 0;
  return { revenueCents, costCents, lineIncompleteCost: p.buyPriceCentsPerUnit == null && revenueCents > 0 };
}

export function documentProfitCents(positions: Array<{
  quantity: Prisma.Decimal | number | string;
  discount: Prisma.Decimal | number | string;
  priceCentsPerUnit: number;
  buyPriceCentsPerUnit: number | null;
}>): number {
  return documentProfitFromComputedPositions(
    positions.map((p) => ({
      priceCentsPerUnit: p.priceCentsPerUnit,
      quantity: decimalToNumber(p.quantity),
      discount: decimalToNumber(p.discount),
      buyPriceCentsPerUnit: p.buyPriceCentsPerUnit,
    }))
  );
}

function documentHasIncompleteCost(positions: LocalDemandPositionWithProduct[]): boolean {
  return positions.some((p) => lineRevenueAndCostCents(p).lineIncompleteCost);
}

export type CustomerSource = "shipments" | "crm" | "yclients" | "manual";

export type ClientStatus = "new" | "repeat" | "regular" | "sleeping" | "active" | "no_history";

export type VehicleSummary = {
  id: string;
  label: string;
  model: string | null;
  plate: string | null;
  vin: string | null;
  source: CustomerSource;
};

export type CustomerCrmCase = {
  id: string;
  title: string;
  status: string;
  nextAction: string | null;
  nextContactAt: string | null;
  responsibleLogin: string | null;
  source: string | null;
};

export type CustomerAnalyticsRow = {
  clientKey: string;
  normalizedPhone: string | null;
  displayName: string;
  phone: string | null;
  phoneMissing: boolean;
  sources: CustomerSource[];
  primarySource: CustomerSource;
  counterpartyIds: string[];
  crmDealIds: string[];
  vehicleLabel: string | null;
  vehicleCount: number;
  vehicles: VehicleSummary[];
  visitCount: number;
  visitCountAllTime: number;
  visitsLast12Months: number;
  firstVisitInPeriod: string | null;
  firstVisitGlobal: string | null;
  lastVisitInPeriod: string | null;
  lastVisitGlobal: string | null;
  lastDemandId: string | null;
  lastDemandName: string | null;
  lastServiceId: string | null;
  lastServiceName: string | null;
  primaryServiceId: string | null;
  primaryServiceName: string | null;
  primaryServiceVisitShare: number | null;
  daysSinceLastVisit: number | null;
  revenueCents: number;
  revenueAllTimeCents: number;
  profitCents: number;
  profitAllTimeCents: number;
  avgRevenuePerVisitCents: number;
  avgProfitPerVisitCents: number;
  avgCheckAllTimeCents: number;
  avgDaysBetweenVisits: number | null;
  hasIncompleteCost: boolean;
  statuses: ClientStatus[];
  segment: ClientStatus;
  openCrmCases: number;
  closedCrmCases: number;
  responsibleLogins: string[];
  waitingCalculation: boolean;
  waitingSupplies: boolean;
  highAverageCheck: boolean;
};

export type CustomerAnalyticsKpis = {
  totalClients: number;
  clientsInPeriod: number;
  newClients: number;
  repeatClients: number;
  regularClients: number;
  sleepingClients: number;
  activeClients: number;
  noHistoryClients: number;
  visits: number;
  totalRevenueCents: number;
  totalProfitCents: number;
  avgCheckCents: number;
  avgProfitPerVisitCents: number;
  avgDaysBetweenVisits: number | null;
};

export type CustomerAnalyticsInsight = {
  id: string;
  label: string;
  value: number;
  tone: "neutral" | "good" | "warning";
  quickFilter:
    | "sleeping"
    | "open_cases"
    | "without_vehicle"
    | "without_phone"
    | "high_avg_check"
    | "waiting_calculation"
    | "waiting_supplies";
};

export type CustomerAnalyticsDuplicate = {
  id: string;
  title: string;
  subtitle: string;
  sources: CustomerSource[];
  clientKeys: string[];
};

export type CustomerTrendPoint = {
  bucket: string;
  label: string;
  newClients: number;
  repeatClients: number;
  revenueCents: number;
};

export type CustomerSegmentPoint = {
  segment: ClientStatus;
  label: string;
  count: number;
};

export type CustomerServicePoint = {
  id: string;
  name: string;
  visits: number;
  revenueCents: number;
};

export type CustomerAnalyticsPayload = {
  generatedAt: string;
  dateFrom: string | null;
  dateTo: string | null;
  todayYmd: string;
  visitDefinition: string;
  revenueDefinition: string;
  sync: {
    lastSyncedAt: string | null;
    lastError: string | null;
    demandsSynced: number;
    localLastSyncedAt: string | null;
    localLastError: string | null;
    localDemandsSynced: number;
  };
  services: { id: string; name: string }[];
  sources: { id: CustomerSource; name: string }[];
  responsibles: { id: string; name: string }[];
  kpis: CustomerAnalyticsKpis;
  insights: CustomerAnalyticsInsight[];
  duplicates: CustomerAnalyticsDuplicate[];
  trend: CustomerTrendPoint[];
  segments: CustomerSegmentPoint[];
  topServices: CustomerServicePoint[];
  clients: CustomerAnalyticsRow[];
};

function safeString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return null;
}

function normalizeTextKey(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function attributeValueByName(raw: unknown, matcher: RegExp): string | null {
  if (!Array.isArray(raw)) return null;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const attr = item as { name?: unknown; value?: unknown };
    const name = safeString(attr.name);
    if (!name || !matcher.test(name.toLowerCase())) continue;
    const value = safeString(attr.value);
    if (value) return value;
  }
  return null;
}

function vehicleFromParts(params: {
  id: string;
  model?: string | null;
  plate?: string | null;
  vin?: string | null;
  source: CustomerSource;
}): VehicleSummary | null {
  const model = params.model?.trim() || null;
  const plate = params.plate?.trim() || null;
  const vin = params.vin?.trim() || null;
  const label = [model, plate, vin ? `VIN ${vin}` : ""].filter(Boolean).join(" · ");
  if (!label) return null;
  return { id: params.id, label, model, plate, vin, source: params.source };
}

function vehicleFromDemand(demand: LocalDemandWithRelations): VehicleSummary | null {
  const model = attributeValueByName(demand.attributes, /модель|авто|vehicle|car/);
  const plate = attributeValueByName(demand.attributes, /гос|г\/н|номер|plate/);
  const vin = attributeValueByName(demand.attributes, /vin/);
  return vehicleFromParts({ id: `demand:${demand.id}`, model, plate, vin, source: "shipments" });
}

function vehicleFromCrmDeal(deal: { id: string; vehicle: string | null; source: string | null }): VehicleSummary | null {
  const raw = deal.vehicle?.trim();
  if (!raw) return null;
  const vinMatch = raw.match(/\b[A-HJ-NPR-Z0-9]{11,17}\b/i);
  const vin = vinMatch?.[0] ?? null;
  const parts = raw
    .split(/[·,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const plate = parts.find((part) => /[а-яa-z]\s?\d{3}\s?[а-яa-z]{2}/i.test(part)) ?? null;
  const model = parts.find((part) => part !== plate && part !== vin) ?? raw;
  return vehicleFromParts({
    id: `crm:${deal.id}`,
    model,
    plate,
    vin,
    source: deal.source === "yclients" || deal.source === "online" ? "yclients" : "crm",
  });
}

function clientKeyFromPhone(phone: string | null): string | null {
  return phone ? `phone:${phone}` : null;
}

function clientKeyFromCounterparty(counterparty: {
  id: string;
  normalizedPhone: string | null;
  phone: string | null;
  name: string;
}): string {
  const normalized = counterparty.normalizedPhone ?? normalizePhoneKey(counterparty.phone);
  return clientKeyFromPhone(normalized) ?? `counterparty:${counterparty.id}`;
}

function clientKeyFromDemand(demand: LocalDemandWithRelations): string {
  if (demand.counterparty) return clientKeyFromCounterparty(demand.counterparty);
  const name = normalizeTextKey(demand.agentNameSnapshot);
  return `demand:${demand.id}:${name || "unknown"}`;
}

function crmSource(deal: { source: string | null; yclientsRecordId: string | null }): CustomerSource {
  const source = deal.source?.toLowerCase() ?? "";
  if (deal.yclientsRecordId || source.includes("yclients") || source.includes("online")) return "yclients";
  return "crm";
}

function clientKeyFromCrmDeal(deal: {
  id: string;
  phoneNormalized: string | null;
  customerName: string | null;
  vehicle: string | null;
}): string {
  const phone = deal.phoneNormalized ?? null;
  return clientKeyFromPhone(phone) ?? `crm:${deal.id}`;
}

type ClientAccumulator = {
  key: string;
  normalizedPhone: string | null;
  phone: string | null;
  names: Map<string, number>;
  sources: Set<CustomerSource>;
  counterpartyIds: Set<string>;
  crmDealIds: Set<string>;
  demands: LocalDemandWithRelations[];
  crmDeals: Array<{
    id: string;
    title: string;
    status: string;
    nextAction: string | null;
    nextContactAt: Date | null;
    responsibleLogin: string | null;
    source: string | null;
    vehicle: string | null;
    notes: string | null;
    suppliesNote: string | null;
    suppliesSupplier: string | null;
    suppliesExpectedAt: Date | null;
  }>;
  vehicles: Map<string, VehicleSummary>;
};

function createAccumulator(key: string, normalizedPhone: string | null, phone: string | null): ClientAccumulator {
  return {
    key,
    normalizedPhone,
    phone,
    names: new Map(),
    sources: new Set(),
    counterpartyIds: new Set(),
    crmDealIds: new Set(),
    demands: [],
    crmDeals: [],
    vehicles: new Map(),
  };
}

function getOrCreateAccumulator(
  map: Map<string, ClientAccumulator>,
  key: string,
  normalizedPhone: string | null,
  phone: string | null
): ClientAccumulator {
  const existing = map.get(key);
  if (existing) {
    if (!existing.normalizedPhone && normalizedPhone) existing.normalizedPhone = normalizedPhone;
    if (!existing.phone && phone) existing.phone = phone;
    return existing;
  }
  const created = createAccumulator(key, normalizedPhone, phone);
  map.set(key, created);
  return created;
}

function addName(acc: ClientAccumulator, name: string | null | undefined, weight = 1) {
  const value = name?.trim();
  if (!value) return;
  acc.names.set(value, (acc.names.get(value) ?? 0) + weight);
}

function addVehicle(acc: ClientAccumulator, vehicle: VehicleSummary | null) {
  if (!vehicle) return;
  const identity = [vehicle.model, vehicle.plate, vehicle.vin].filter(Boolean).join("|").toLowerCase();
  acc.vehicles.set(identity || vehicle.id, vehicle);
}

function serviceRefFromPosition(p: LocalDemandPositionWithProduct): { id: string; name: string } | null {
  if (p.assortmentType !== "service") return null;
  const id = p.productId ?? (p.assortmentMoyskladId ? `ms:${p.assortmentMoyskladId}` : `name:${p.name.toLowerCase()}`);
  return { id, name: p.product?.name ?? p.name };
}

function demandServiceRefs(demand: LocalDemandWithRelations): { id: string; name: string }[] {
  const seen = new Set<string>();
  const services: { id: string; name: string }[] = [];
  for (const p of demand.positions) {
    const service = serviceRefFromPosition(p);
    if (!service || seen.has(service.id)) continue;
    seen.add(service.id);
    services.push(service);
  }
  return services;
}

function demandMatchesServiceFilter(demand: LocalDemandWithRelations, serviceIds: Set<string>): boolean {
  if (serviceIds.size === 0) return true;
  return demandServiceRefs(demand).some((service) => serviceIds.has(service.id));
}

function pickDisplayName(acc: ClientAccumulator): string {
  const names = [...acc.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"));
  return names[0]?.[0] ?? acc.phone ?? acc.normalizedPhone ?? "Клиент без имени";
}

function computeAvgGapDays(documentDatesYmd: string[]): number | null {
  const unique = [...new Set(documentDatesYmd)].sort();
  if (unique.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < unique.length; i++) {
    sum += daysBetweenUtcDates(unique[i - 1]!, unique[i]!);
  }
  return Math.round(sum / (unique.length - 1));
}

function demandFinancials(demand: LocalDemandWithRelations): { revenueCents: number; profitCents: number; hasIncompleteCost: boolean } {
  const profitCents = documentProfitCents(demand.positions);
  return {
    revenueCents: demand.sumCents,
    profitCents,
    hasIncompleteCost: documentHasIncompleteCost(demand.positions),
  };
}

function serviceStatsForPeriod(
  demands: LocalDemandWithRelations[],
  serviceIds: Set<string>
): {
  primaryServiceId: string | null;
  primaryServiceName: string | null;
  primaryServiceVisitShare: number | null;
  lastServiceId: string | null;
  lastServiceName: string | null;
} {
  const visitCounts = new Map<string, { name: string; visits: number }>();
  let lastServiceId: string | null = null;
  let lastServiceName: string | null = null;

  const sortedDesc = [...demands].sort((a, b) => b.momentAt.getTime() - a.momentAt.getTime());
  for (const demand of demands) {
    for (const service of demandServiceRefs(demand)) {
      if (serviceIds.size > 0 && !serviceIds.has(service.id)) continue;
      const current = visitCounts.get(service.id) ?? { name: service.name, visits: 0 };
      current.visits += 1;
      current.name = service.name;
      visitCounts.set(service.id, current);
    }
  }
  outer: for (const demand of sortedDesc) {
    for (const service of demandServiceRefs(demand)) {
      if (serviceIds.size > 0 && !serviceIds.has(service.id)) continue;
      lastServiceId = service.id;
      lastServiceName = service.name;
      break outer;
    }
  }

  let primaryServiceId: string | null = null;
  let primaryServiceName: string | null = null;
  let bestVisits = 0;
  for (const [id, item] of visitCounts) {
    if (item.visits > bestVisits) {
      primaryServiceId = id;
      primaryServiceName = item.name;
      bestVisits = item.visits;
    }
  }

  return {
    primaryServiceId,
    primaryServiceName,
    primaryServiceVisitShare: demands.length > 0 && bestVisits > 0 ? Math.round((bestVisits / demands.length) * 100) : null,
    lastServiceId,
    lastServiceName,
  };
}

function containsAnyNeedle(value: string, needles: RegExp[]): boolean {
  return needles.some((needle) => needle.test(value));
}

function dealSearchText(deal: {
  title: string;
  nextAction: string | null;
  source: string | null;
  notes: string | null;
  suppliesNote: string | null;
  suppliesSupplier: string | null;
}): string {
  return [deal.title, deal.nextAction, deal.source, deal.notes, deal.suppliesNote, deal.suppliesSupplier].filter(Boolean).join(" ").toLowerCase();
}

function resolveSegment(statuses: ClientStatus[]): ClientStatus {
  if (statuses.includes("no_history")) return "no_history";
  if (statuses.includes("sleeping")) return "sleeping";
  if (statuses.includes("new")) return "new";
  if (statuses.includes("regular")) return "regular";
  if (statuses.includes("repeat")) return "repeat";
  return "active";
}

function segmentLabel(segment: ClientStatus): string {
  switch (segment) {
    case "new":
      return "Новые";
    case "repeat":
      return "Повторные";
    case "regular":
      return "Постоянные";
    case "sleeping":
      return "Спящие";
    case "active":
      return "Активные";
    case "no_history":
      return "Без истории";
  }
}

function buildClientRows(params: {
  accumulators: Map<string, ClientAccumulator>;
  dateFrom: string | null;
  dateTo: string | null;
  serviceIds: Set<string>;
  settings: CustomerAnalyticsResolvedSettings;
  todayYmd: string;
}): CustomerAnalyticsRow[] {
  const { accumulators, dateFrom, dateTo, serviceIds, settings, todayYmd } = params;
  const twelveMonthsFrom = addDaysYmd(todayYmd, -365);
  const rows: CustomerAnalyticsRow[] = [];

  for (const acc of accumulators.values()) {
    const displayName = pickDisplayName(acc);
    const allServiceDemands = acc.demands
      .filter((demand) => demandMatchesServiceFilter(demand, serviceIds))
      .sort((a, b) => a.momentAt.getTime() - b.momentAt.getTime());
    const periodDemands = allServiceDemands.filter((demand) => ymdInRange(demand.documentDate, dateFrom, dateTo));
    const datesAll = allServiceDemands.map((demand) => demand.documentDate).sort();
    const datesPeriod = periodDemands.map((demand) => demand.documentDate).sort();
    const firstVisitGlobal = datesAll[0] ?? null;
    const lastVisitGlobal = datesAll[datesAll.length - 1] ?? null;
    const firstVisitInPeriod = datesPeriod[0] ?? null;
    const lastVisitInPeriod = datesPeriod[datesPeriod.length - 1] ?? null;
    const daysSinceLastVisit = lastVisitGlobal ? daysBetweenUtcDates(lastVisitGlobal, todayYmd) : null;
    const visitsLast12Months = allServiceDemands.filter((demand) => demand.documentDate >= twelveMonthsFrom).length;

    let revenueCents = 0;
    let profitCents = 0;
    let revenueAllTimeCents = 0;
    let profitAllTimeCents = 0;
    let hasIncompleteCost = false;

    for (const demand of allServiceDemands) {
      const financials = demandFinancials(demand);
      revenueAllTimeCents += financials.revenueCents;
      profitAllTimeCents += financials.profitCents;
      if (financials.hasIncompleteCost) hasIncompleteCost = true;
    }
    for (const demand of periodDemands) {
      const financials = demandFinancials(demand);
      revenueCents += financials.revenueCents;
      profitCents += financials.profitCents;
    }

    const lastDemand = allServiceDemands[allServiceDemands.length - 1] ?? null;
    const visitCount = periodDemands.length;
    const visitCountAllTime = allServiceDemands.length;
    const regular =
      visitCountAllTime >= settings.regularVisitThreshold ||
      visitsLast12Months >= Math.max(3, settings.regularVisitThreshold);
    const sleeping = visitCountAllTime > 0 && daysSinceLastVisit != null && daysSinceLastVisit > settings.inactiveDaysThreshold;
    const noHistory = visitCountAllTime === 0;
    const active = visitCountAllTime > 0 && daysSinceLastVisit != null && daysSinceLastVisit <= ACTIVE_DAYS_THRESHOLD;
    const isNew = firstVisitGlobal != null && ymdInRange(firstVisitGlobal, dateFrom, dateTo);
    const repeat = visitCountAllTime >= 2;

    const statuses: ClientStatus[] = [];
    if (noHistory) statuses.push("no_history");
    if (sleeping) statuses.push("sleeping");
    if (isNew) statuses.push("new");
    if (repeat) statuses.push("repeat");
    if (regular) statuses.push("regular");
    if (active) statuses.push("active");
    if (statuses.length === 0) statuses.push("active");

    const openCrm = acc.crmDeals.filter((deal) => deal.status === "open");
    const closedCrm = acc.crmDeals.filter((deal) => deal.status !== "open");
    const waitingCalculation = openCrm.some((deal) =>
      containsAnyNeedle(dealSearchText(deal), [/расч[её]т/i, /стоимост/i, /\bкп\b/i, /смет/i])
    );
    const waitingSupplies = openCrm.some((deal) =>
      Boolean(deal.suppliesExpectedAt) ||
      containsAnyNeedle(dealSearchText(deal), [/расходник/i, /запчаст/i, /постав/i, /жд[её]м/i])
    );
    const vehicles = [...acc.vehicles.values()];
    const svc = serviceStatsForPeriod(periodDemands.length > 0 ? periodDemands : allServiceDemands.slice(-5), serviceIds);

    rows.push({
      clientKey: acc.key,
      normalizedPhone: acc.normalizedPhone,
      displayName,
      phone: acc.phone ?? acc.normalizedPhone,
      phoneMissing: !acc.normalizedPhone && !acc.phone,
      sources: [...acc.sources],
      primarySource: acc.sources.has("shipments") ? "shipments" : acc.sources.has("yclients") ? "yclients" : acc.sources.has("crm") ? "crm" : "manual",
      counterpartyIds: [...acc.counterpartyIds],
      crmDealIds: [...acc.crmDealIds],
      vehicleLabel: vehicles[0]?.label ?? null,
      vehicleCount: vehicles.length,
      vehicles,
      visitCount,
      visitCountAllTime,
      visitsLast12Months,
      firstVisitInPeriod,
      firstVisitGlobal,
      lastVisitInPeriod,
      lastVisitGlobal,
      lastDemandId: lastDemand?.id ?? null,
      lastDemandName: lastDemand?.name ?? null,
      lastServiceId: svc.lastServiceId,
      lastServiceName: svc.lastServiceName,
      primaryServiceId: svc.primaryServiceId,
      primaryServiceName: svc.primaryServiceName,
      primaryServiceVisitShare: svc.primaryServiceVisitShare,
      daysSinceLastVisit,
      revenueCents,
      revenueAllTimeCents,
      profitCents,
      profitAllTimeCents,
      avgRevenuePerVisitCents: visitCount > 0 ? Math.round(revenueCents / visitCount) : 0,
      avgProfitPerVisitCents: visitCount > 0 ? Math.round(profitCents / visitCount) : 0,
      avgCheckAllTimeCents: visitCountAllTime > 0 ? Math.round(revenueAllTimeCents / visitCountAllTime) : 0,
      avgDaysBetweenVisits: computeAvgGapDays(datesAll),
      hasIncompleteCost,
      statuses,
      segment: resolveSegment(statuses),
      openCrmCases: openCrm.length,
      closedCrmCases: closedCrm.length,
      responsibleLogins: [...new Set(acc.crmDeals.map((deal) => deal.responsibleLogin).filter((login): login is string => Boolean(login)))],
      waitingCalculation,
      waitingSupplies,
      highAverageCheck: false,
    });
  }

  const avgCheck = rows.filter((row) => row.visitCount > 0).reduce((sum, row) => sum + row.avgRevenuePerVisitCents, 0);
  const avgCheckBase = rows.filter((row) => row.visitCount > 0).length;
  const highAvgThreshold = avgCheckBase > 0 ? Math.round((avgCheck / avgCheckBase) * 1.4) : 0;

  return rows
    .map((row) => ({
      ...row,
      highAverageCheck: row.visitCount > 0 && row.avgRevenuePerVisitCents >= highAvgThreshold && row.avgRevenuePerVisitCents > 0,
    }))
    .sort((a, b) => {
      if (b.revenueCents !== a.revenueCents) return b.revenueCents - a.revenueCents;
      const ad = a.lastVisitGlobal ?? "";
      const bd = b.lastVisitGlobal ?? "";
      if (bd !== ad) return bd.localeCompare(ad);
      return a.displayName.localeCompare(b.displayName, "ru");
    });
}

function buildKpis(clients: CustomerAnalyticsRow[]): CustomerAnalyticsKpis {
  const clientsInPeriod = clients.filter((client) => client.visitCount > 0).length;
  const visits = clients.reduce((sum, client) => sum + client.visitCount, 0);
  const totalRevenueCents = clients.reduce((sum, client) => sum + client.revenueCents, 0);
  const totalProfitCents = clients.reduce((sum, client) => sum + client.profitCents, 0);
  const gapValues = clients.map((client) => client.avgDaysBetweenVisits).filter((value): value is number => value != null);

  return {
    totalClients: clients.length,
    clientsInPeriod,
    newClients: clients.filter((client) => client.statuses.includes("new")).length,
    repeatClients: clients.filter((client) => client.visitCount > 0 && client.statuses.includes("repeat")).length,
    regularClients: clients.filter((client) => client.statuses.includes("regular")).length,
    sleepingClients: clients.filter((client) => client.statuses.includes("sleeping")).length,
    activeClients: clients.filter((client) => client.statuses.includes("active")).length,
    noHistoryClients: clients.filter((client) => client.statuses.includes("no_history")).length,
    visits,
    totalRevenueCents,
    totalProfitCents,
    avgCheckCents: visits > 0 ? Math.round(totalRevenueCents / visits) : 0,
    avgProfitPerVisitCents: visits > 0 ? Math.round(totalProfitCents / visits) : 0,
    avgDaysBetweenVisits: gapValues.length > 0 ? Math.round(gapValues.reduce((sum, value) => sum + value, 0) / gapValues.length) : null,
  };
}

function buildInsights(clients: CustomerAnalyticsRow[]): CustomerAnalyticsInsight[] {
  return [
    {
      id: "sleeping",
      label: "клиентов давно не были",
      value: clients.filter((client) => client.statuses.includes("sleeping")).length,
      tone: "warning",
      quickFilter: "sleeping",
    },
    {
      id: "waiting_calculation",
      label: "клиента ждут расчёт",
      value: clients.filter((client) => client.waitingCalculation).length,
      tone: "warning",
      quickFilter: "waiting_calculation",
    },
    {
      id: "open_cases",
      label: "клиента с открытыми CRM-делами",
      value: clients.filter((client) => client.openCrmCases > 0).length,
      tone: "neutral",
      quickFilter: "open_cases",
    },
    {
      id: "without_vehicle",
      label: "клиента без привязанного авто",
      value: clients.filter((client) => client.vehicleCount === 0).length,
      tone: "warning",
      quickFilter: "without_vehicle",
    },
    {
      id: "without_phone",
      label: "клиента без телефона",
      value: clients.filter((client) => client.phoneMissing).length,
      tone: "warning",
      quickFilter: "without_phone",
    },
    {
      id: "high_avg_check",
      label: "клиента с высоким средним чеком",
      value: clients.filter((client) => client.highAverageCheck).length,
      tone: "good",
      quickFilter: "high_avg_check",
    },
    {
      id: "waiting_supplies",
      label: "клиента ждут расходники",
      value: clients.filter((client) => client.waitingSupplies).length,
      tone: "warning",
      quickFilter: "waiting_supplies",
    },
  ];
}

function trendBucketForDate(ymd: string, dateFrom: string | null, dateTo: string | null): { bucket: string; label: string } {
  const span = dateFrom && dateTo ? daysBetweenUtcDates(dateFrom, dateTo) : 366;
  if (span <= 90) return { bucket: ymd, label: ymd.slice(5) };
  return { bucket: ymd.slice(0, 7), label: ymd.slice(0, 7) };
}

function buildTrend(clients: CustomerAnalyticsRow[], dateFrom: string | null, dateTo: string | null): CustomerTrendPoint[] {
  const byBucket = new Map<string, CustomerTrendPoint>();
  for (const client of clients) {
    if (!client.lastVisitInPeriod || client.visitCount === 0) continue;
    const { bucket, label } = trendBucketForDate(client.lastVisitInPeriod, dateFrom, dateTo);
    const current = byBucket.get(bucket) ?? { bucket, label, newClients: 0, repeatClients: 0, revenueCents: 0 };
    if (client.statuses.includes("new")) current.newClients += 1;
    else current.repeatClients += 1;
    current.revenueCents += client.revenueCents;
    byBucket.set(bucket, current);
  }
  return [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket)).slice(-18);
}

function buildSegments(clients: CustomerAnalyticsRow[]): CustomerSegmentPoint[] {
  const order: ClientStatus[] = ["new", "repeat", "regular", "sleeping", "active", "no_history"];
  return order
    .map((segment) => ({
      segment,
      label: segmentLabel(segment),
      count: clients.filter((client) => client.segment === segment).length,
    }))
    .filter((item) => item.count > 0);
}

function buildTopServices(demands: LocalDemandWithRelations[], serviceIds: Set<string>, dateFrom: string | null, dateTo: string | null): CustomerServicePoint[] {
  const serviceMap = new Map<string, CustomerServicePoint>();
  for (const demand of demands) {
    if (!demandMatchesServiceFilter(demand, serviceIds)) continue;
    if (!ymdInRange(demand.documentDate, dateFrom, dateTo)) continue;
    const services = demandServiceRefs(demand);
    for (const service of services) {
      if (serviceIds.size > 0 && !serviceIds.has(service.id)) continue;
      const current = serviceMap.get(service.id) ?? { id: service.id, name: service.name, visits: 0, revenueCents: 0 };
      current.visits += 1;
      current.revenueCents += demand.sumCents;
      serviceMap.set(service.id, current);
    }
  }
  return [...serviceMap.values()].sort((a, b) => b.visits - a.visits || b.revenueCents - a.revenueCents).slice(0, 8);
}

function buildDuplicates(clients: CustomerAnalyticsRow[]): CustomerAnalyticsDuplicate[] {
  const duplicates: CustomerAnalyticsDuplicate[] = [];
  for (const client of clients) {
    if (client.normalizedPhone && client.counterpartyIds.length > 1) {
      duplicates.push({
        id: `phone:${client.normalizedPhone}`,
        title: client.displayName,
        subtitle: `Один телефон связан с ${client.counterpartyIds.length} контрагентами`,
        sources: client.sources,
        clientKeys: [client.clientKey],
      });
    }
  }

  const weak = new Map<string, CustomerAnalyticsRow[]>();
  for (const client of clients) {
    if (!client.phoneMissing || !client.vehicleLabel) continue;
    const key = `${normalizeTextKey(client.displayName)}|${normalizeTextKey(client.vehicleLabel)}`;
    if (!key.trim()) continue;
    const list = weak.get(key) ?? [];
    list.push(client);
    weak.set(key, list);
  }
  for (const list of weak.values()) {
    if (list.length < 2) continue;
    duplicates.push({
      id: `weak:${list.map((client) => client.clientKey).join(":")}`,
      title: list[0]?.displayName ?? "Возможный дубль",
      subtitle: "Похожие имя и авто без телефона. Автоматически не объединяем.",
      sources: [...new Set(list.flatMap((client) => client.sources))],
      clientKeys: list.map((client) => client.clientKey),
    });
  }
  return duplicates.slice(0, 8);
}

function buildAccumulators(params: {
  counterparties: CounterpartyAnalyticsRow[];
  demands: LocalDemandWithRelations[];
  crmDeals: CrmDealAnalyticsRow[];
}): Map<string, ClientAccumulator> {
  const clients = new Map<string, ClientAccumulator>();

  for (const counterparty of params.counterparties) {
    const normalizedPhone = counterparty.normalizedPhone ?? normalizePhoneKey(counterparty.phone);
    const key = clientKeyFromCounterparty(counterparty);
    const acc = getOrCreateAccumulator(clients, key, normalizedPhone, counterparty.phone);
    addName(acc, counterparty.name);
    acc.sources.add("manual");
    acc.counterpartyIds.add(counterparty.id);
  }

  for (const demand of params.demands) {
    const normalizedPhone = demand.counterparty?.normalizedPhone ?? normalizePhoneKey(demand.counterparty?.phone);
    const key = clientKeyFromDemand(demand);
    const acc = getOrCreateAccumulator(clients, key, normalizedPhone, demand.counterparty?.phone ?? null);
    addName(acc, demand.counterparty?.name ?? demand.agentNameSnapshot, 3);
    acc.sources.add("shipments");
    if (demand.counterpartyId) acc.counterpartyIds.add(demand.counterpartyId);
    acc.demands.push(demand);
    addVehicle(acc, vehicleFromDemand(demand));
  }

  for (const deal of params.crmDeals) {
    const normalizedPhone = deal.phoneNormalized ?? null;
    const key = clientKeyFromCrmDeal(deal);
    const acc = getOrCreateAccumulator(clients, key, normalizedPhone, normalizedPhone);
    const source = crmSource(deal);
    addName(acc, deal.customerName ?? deal.moyskladCounterpartyName ?? deal.title, 2);
    acc.sources.add(source);
    acc.crmDealIds.add(deal.id);
    acc.crmDeals.push(deal);
    addVehicle(acc, vehicleFromCrmDeal(deal));
  }

  return clients;
}

function buildServiceOptions(demands: LocalDemandWithRelations[]): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const demand of demands) {
    for (const service of demandServiceRefs(demand)) {
      if (!map.has(service.id)) map.set(service.id, service.name);
    }
  }
  return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function buildResponsibles(crmDeals: CrmDealAnalyticsRow[]): { id: string; name: string }[] {
  return [...new Set(crmDeals.map((deal) => deal.responsibleLogin).filter((login): login is string => Boolean(login)))]
    .sort((a, b) => a.localeCompare(b, "ru"))
    .map((login) => ({ id: login, name: login }));
}

async function loadCrmDealsForAnalytics(): Promise<CrmDealAnalyticsRow[]> {
  const rows = await prisma.crmDeal.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      customerName: true,
      phoneNormalized: true,
      vehicle: true,
      source: true,
      responsibleLogin: true,
      moyskladCounterpartyName: true,
      yclientsRecordId: true,
      nextContactAt: true,
      status: true,
      notes: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    nextAction: null,
    suppliesNote: null,
    suppliesSupplier: null,
    suppliesExpectedAt: null,
  }));
}

export async function loadCustomerAnalyticsPayload(params: {
  dateFrom: string | null;
  dateTo: string | null;
  serviceIds: string[];
  settings: CustomerAnalyticsResolvedSettings;
}): Promise<CustomerAnalyticsPayload> {
  const { dateFrom, dateTo, serviceIds, settings } = params;
  const serviceIdSet = new Set(serviceIds.filter(Boolean));
  const todayYmd = getAnalyticsTodayYmd();

  const [demands, counterparties, crmDeals, localSyncState, moySkladAnalyticsState] = await Promise.all([
    prisma.localDemand.findMany({
      where: { applicable: true },
      select: demandSelect,
      orderBy: { momentAt: "asc" },
    }),
    prisma.localCounterparty.findMany({
      where: { archived: false },
      select: counterpartySelect,
      orderBy: { updatedAt: "desc" },
    }),
    loadCrmDealsForAnalytics(),
    prisma.localInventorySyncState.findUnique({ where: { id: "default" } }).catch(() => null),
    prisma.moySkladAnalyticsSyncState.findUnique({ where: { id: "default" } }).catch(() => null),
  ]);

  const accumulators = buildAccumulators({ counterparties, demands, crmDeals });
  const clients = buildClientRows({
    accumulators,
    dateFrom,
    dateTo,
    serviceIds: serviceIdSet,
    settings,
    todayYmd,
  });

  return {
    generatedAt: new Date().toISOString(),
    dateFrom,
    dateTo,
    todayYmd,
    visitDefinition: "Визит = проведённая локальная отгрузка. Записи CRM и YCLIENTS показываются отдельно и не смешиваются с визитами.",
    revenueDefinition: "Выручка = сумма проведённых локальных отгрузок за выбранный период. Прибыль считается по локальным закупочным ценам позиций, если они заполнены.",
    sync: {
      lastSyncedAt: moySkladAnalyticsState?.lastSyncedAt?.toISOString() ?? null,
      lastError: moySkladAnalyticsState?.lastError ?? null,
      demandsSynced: moySkladAnalyticsState?.demandsSynced ?? 0,
      localLastSyncedAt: localSyncState?.lastSyncedAt?.toISOString() ?? null,
      localLastError: localSyncState?.lastError ?? null,
      localDemandsSynced: localSyncState?.demandsSynced ?? 0,
    },
    services: buildServiceOptions(demands),
    sources: [
      { id: "shipments", name: "Отгрузки" },
      { id: "crm", name: "CRM" },
      { id: "yclients", name: "YCLIENTS" },
      { id: "manual", name: "Вручную" },
    ],
    responsibles: buildResponsibles(crmDeals),
    kpis: buildKpis(clients),
    insights: buildInsights(clients),
    duplicates: buildDuplicates(clients),
    trend: buildTrend(clients, dateFrom, dateTo),
    segments: buildSegments(clients),
    topServices: buildTopServices(demands, serviceIdSet, dateFrom, dateTo),
    clients,
  };
}

function crmCaseFromDeal(deal: ClientAccumulator["crmDeals"][number]): CustomerCrmCase {
  return {
    id: deal.id,
    title: deal.title,
    status: deal.status,
    nextAction: deal.nextAction,
    nextContactAt: deal.nextContactAt?.toISOString() ?? null,
    responsibleLogin: deal.responsibleLogin,
    source: deal.source,
  };
}

export async function loadCustomerDemandHistory(params: {
  clientKey: string;
  normalizedPhone?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  serviceIds: string[];
}): Promise<{
  demands: {
    id: string;
    name: string;
    documentDate: string;
    momentAt: string;
    sumCents: number;
    profitCents: number;
    hasIncompleteCost: boolean;
    services: { id: string; name: string }[];
    positions: {
      name: string;
      assortmentType: string;
      quantity: number;
      revenueCents: number;
      costCents: number;
      lineIncompleteCost: boolean;
    }[];
  }[];
  crmCases: CustomerCrmCase[];
  vehicles: VehicleSummary[];
}> {
  const serviceIdSet = new Set(params.serviceIds.filter(Boolean));
  const [demands, counterparties, crmDeals] = await Promise.all([
    prisma.localDemand.findMany({
      where: { applicable: true },
      select: demandSelect,
      orderBy: { momentAt: "desc" },
    }),
    prisma.localCounterparty.findMany({ where: { archived: false }, select: counterpartySelect }),
    loadCrmDealsForAnalytics(),
  ]);

  const accumulators = buildAccumulators({ counterparties, demands, crmDeals });
  const acc =
    accumulators.get(params.clientKey) ??
    (params.normalizedPhone ? accumulators.get(clientKeyFromPhone(params.normalizedPhone) ?? "") : undefined);
  if (!acc) return { demands: [], crmCases: [], vehicles: [] };

  const filteredDemands = acc.demands
    .filter((demand) => demandMatchesServiceFilter(demand, serviceIdSet))
    .filter((demand) => ymdInRange(demand.documentDate, params.dateFrom ?? null, params.dateTo ?? null))
    .sort((a, b) => b.momentAt.getTime() - a.momentAt.getTime())
    .slice(0, 20);

  return {
    demands: filteredDemands.map((demand) => ({
      id: demand.id,
      name: demand.name,
      documentDate: demand.documentDate,
      momentAt: demand.momentAt.toISOString(),
      sumCents: demand.sumCents,
      profitCents: documentProfitCents(demand.positions),
      hasIncompleteCost: documentHasIncompleteCost(demand.positions),
      services: demandServiceRefs(demand),
      positions: demand.positions.map((position) => {
        const { revenueCents, costCents, lineIncompleteCost } = lineRevenueAndCostCents(position);
        return {
          name: position.name,
          assortmentType: position.assortmentType,
          quantity: decimalToNumber(position.quantity),
          revenueCents,
          costCents,
          lineIncompleteCost,
        };
      }),
    })),
    crmCases: acc.crmDeals.map(crmCaseFromDeal),
    vehicles: [...acc.vehicles.values()],
  };
}
