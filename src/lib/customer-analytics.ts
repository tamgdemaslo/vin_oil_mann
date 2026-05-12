import type { MoySkladDemandPositionSync, MoySkladDemandSync } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  documentProfitFromComputedPositions,
  type ComputedPositionForProfit,
} from "@/lib/customer-analytics-profit";
import { prisma } from "@/lib/db";
import type { CustomerAnalyticsResolvedSettings } from "@/lib/customer-analytics-settings";

export type { ComputedPositionForProfit };
export { documentProfitFromComputedPositions };

export type DemandWithPositions = MoySkladDemandSync & { positions: MoySkladDemandPositionSync[] };

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
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

/** Выручка и себестоимость строки (копейки). */
export function lineRevenueAndCostCents(p: MoySkladDemandPositionSync): { revenueCents: number; costCents: number } {
  const qty = p.quantity || 0;
  const disc = p.discount || 0;
  const factor = (100 - disc) / 100;
  const revenueCents = Math.round(p.priceCentsPerUnit * qty * factor);
  const buy = p.buyPriceCentsPerUnit;
  const costCents = buy != null ? Math.round(buy * qty) : 0;
  return { revenueCents, costCents };
}

export function documentProfitCents(positions: MoySkladDemandPositionSync[]): number {
  return documentProfitFromComputedPositions(
    positions.map((p) => ({
      priceCentsPerUnit: p.priceCentsPerUnit,
      quantity: p.quantity,
      discount: p.discount,
      buyPriceCentsPerUnit: p.buyPriceCentsPerUnit,
    }))
  );
}

export type DocumentServiceRef = { id: string; name: string };

function parseDocumentServicesJson(raw: unknown): DocumentServiceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: DocumentServiceRef[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const id = (x as { id?: string }).id;
    const name = (x as { name?: string }).name;
    if (typeof id === "string" && id) out.push({ id, name: typeof name === "string" ? name : "—" });
  }
  return out;
}

/** Агрегат отгрузки без позиций (быстрая выборка для списка клиентов). */
export type DemandAnalyticsHeader = {
  id: string;
  documentDate: string;
  momentAt: Date;
  normalizedPhone: string | null;
  sumCents: number;
  profitCents: number;
  hasIncompleteCost: boolean;
  agentNameSnapshot: string | null;
  name: string;
  documentServices: unknown;
};

function demandMatchesServiceFilterHeader(d: DemandAnalyticsHeader, serviceIds: Set<string>): boolean {
  if (serviceIds.size === 0) return true;
  const services = parseDocumentServicesJson(d.documentServices);
  if (services.length === 0) return false;
  return services.some((s) => serviceIds.has(s.id));
}

function demandMatchesServiceFilter(d: DemandWithPositions, serviceIds: Set<string>): boolean {
  if (serviceIds.size === 0) return true;
  return d.positions.some(
    (p) => p.assortmentType === "service" && p.assortmentId != null && serviceIds.has(p.assortmentId)
  );
}

function ymdInRange(ymd: string, from: string | null, to: string | null): boolean {
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

export type ClientStatus =
  | "new"
  | "repeat"
  | "sleeping"
  | "regular"
  | "vip"
  | "sleeping_regular"
  | "sleeping_vip";

export type CustomerAnalyticsRow = {
  normalizedPhone: string;
  displayName: string;
  visitCount: number;
  visitCountAllTime: number;
  firstVisitInPeriod: string | null;
  lastVisitInPeriod: string | null;
  lastVisitGlobal: string | null;
  daysSinceLastVisit: number | null;
  revenueCents: number;
  profitCents: number;
  avgRevenuePerVisitCents: number;
  avgProfitPerVisitCents: number;
  avgDaysBetweenVisits: number | null;
  hasIncompleteCost: boolean;
  primaryServiceId: string | null;
  primaryServiceName: string | null;
  primaryServiceVisitShare: number | null;
  lastServiceId: string | null;
  lastServiceName: string | null;
  statuses: ClientStatus[];
};

export type CustomerAnalyticsKpis = {
  totalClients: number;
  clientsOneVisit: number;
  clientsTwoPlusVisits: number;
  clientsInactive365: number;
  avgVisitsPerClient: number;
  avgRevenuePerClientCents: number;
  avgProfitPerClientCents: number;
  totalRevenueCents: number;
  totalProfitCents: number;
  newClients: number;
  repeatClients: number;
  sleepingClients: number;
};

export type CustomerAnalyticsPayload = {
  generatedAt: string;
  dateFrom: string | null;
  dateTo: string | null;
  todayYmd: string;
  sync: { lastSyncedAt: string | null; lastError: string | null; demandsSynced: number };
  services: { id: string; name: string }[];
  kpis: CustomerAnalyticsKpis;
  clients: CustomerAnalyticsRow[];
};

function pickDisplayNameForPeriod(demands: DemandAnalyticsHeader[]): string {
  if (demands.length === 0) return "—";
  const sorted = [...demands].sort((a, b) => b.momentAt.getTime() - a.momentAt.getTime());
  return sorted[0]?.agentNameSnapshot?.trim() || sorted[0]?.name || "—";
}

function computeAvgGapDays(documentDatesYmd: string[]): number | null {
  if (documentDatesYmd.length < 2) return null;
  const unique = [...new Set(documentDatesYmd)].sort();
  if (unique.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < unique.length; i++) {
    sum += daysBetweenUtcDates(unique[i - 1]!, unique[i]!);
  }
  return Math.round(sum / (unique.length - 1));
}

function serviceStatsForPeriod(
  demands: DemandAnalyticsHeader[],
  serviceIds: Set<string>
): {
  primaryServiceId: string | null;
  primaryServiceName: string | null;
  primaryServiceVisitShare: number | null;
  lastServiceId: string | null;
  lastServiceName: string | null;
} {
  const serviceVisits = new Map<string, { name: string; visits: Set<string> }>();

  for (const d of demands) {
    const servicesInDoc = parseDocumentServicesJson(d.documentServices).filter(
      (s) => serviceIds.size === 0 || serviceIds.has(s.id)
    );
    for (const s of servicesInDoc) {
      const cur = serviceVisits.get(s.id) ?? { name: s.name, visits: new Set<string>() };
      cur.visits.add(d.id);
      cur.name = s.name;
      serviceVisits.set(s.id, cur);
    }
  }

  let lastServiceId: string | null = null;
  let lastServiceName: string | null = null;
  const sortedDesc = [...demands].sort((a, b) => b.momentAt.getTime() - a.momentAt.getTime());
  outer: for (const d of sortedDesc) {
    const servicesInDoc = parseDocumentServicesJson(d.documentServices).filter(
      (s) => serviceIds.size === 0 || serviceIds.has(s.id)
    );
    for (let i = servicesInDoc.length - 1; i >= 0; i--) {
      const s = servicesInDoc[i]!;
      lastServiceId = s.id;
      lastServiceName = s.name;
      break outer;
    }
  }

  let bestId: string | null = null;
  let bestCount = 0;
  for (const [id, v] of serviceVisits) {
    if (v.visits.size > bestCount) {
      bestCount = v.visits.size;
      bestId = id;
    }
  }

  const primaryServiceVisitShare =
    demands.length > 0 && bestId != null ? Math.round((bestCount / demands.length) * 1000) / 10 : null;

  return {
    primaryServiceId: bestId,
    primaryServiceName: bestId ? serviceVisits.get(bestId)?.name ?? null : null,
    primaryServiceVisitShare,
    lastServiceId,
    lastServiceName,
  };
}

function resolveStatuses(params: {
  visitCount: number;
  visitCountAllTime: number;
  daysSinceLastVisit: number | null;
  settings: CustomerAnalyticsResolvedSettings;
  revenueCents: number;
  profitCents: number;
  revenueForVipCents: number;
  profitForVipCents: number;
}): ClientStatus[] {
  const s: ClientStatus[] = [];
  const { settings } = params;
  const inactive = settings.inactiveDaysThreshold;
  const sleeping = params.daysSinceLastVisit != null && params.daysSinceLastVisit > inactive;

  if (params.visitCount === 1) s.push("new");
  if (params.visitCount >= 2) s.push("repeat");
  if (sleeping) s.push("sleeping");

  if (params.visitCountAllTime >= settings.regularVisitThreshold) {
    s.push(sleeping ? "sleeping_regular" : "regular");
  }

  const vipThreshold = settings.vipThresholdCents;
  if (vipThreshold != null && vipThreshold > 0) {
    const basis = settings.vipMetric === "profit" ? params.profitForVipCents : params.revenueForVipCents;
    if (basis >= vipThreshold) {
      s.push(sleeping ? "sleeping_vip" : "vip");
    }
  }

  return s;
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

  let demandRows: DemandAnalyticsHeader[];
  let syncState: Awaited<ReturnType<typeof prisma.moySkladAnalyticsSyncState.findUnique>>;
  try {
    const [dr, ss] = await Promise.all([
      prisma.moySkladDemandSync.findMany({
        where: { normalizedPhone: { not: null } },
        select: {
          id: true,
          documentDate: true,
          momentAt: true,
          normalizedPhone: true,
          sumCents: true,
          profitCents: true,
          hasIncompleteCost: true,
          agentNameSnapshot: true,
          name: true,
          documentServices: true,
        },
        orderBy: { momentAt: "asc" },
      }),
      prisma.moySkladAnalyticsSyncState.findUnique({ where: { id: "default" } }),
    ]);
    demandRows = dr as DemandAnalyticsHeader[];
    syncState = ss;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2022" || e.code === "P2010")) {
      throw new Error(
        "В БД нет колонок аналитики (profit_cents, document_services). На сервере выполните: npx prisma db push && npx prisma generate, затем пересоберьте приложение."
      );
    }
    throw e;
  }

  const typedDemands = demandRows;

  const serviceMap = new Map<string, string>();
  for (const d of typedDemands) {
    for (const s of parseDocumentServicesJson(d.documentServices)) {
      if (!serviceMap.has(s.id)) serviceMap.set(s.id, s.name);
    }
  }
  const services = [...serviceMap.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  /** Все отгрузки клиента (для последнего визита, all-time счётчиков, VIP за всё время). */
  const byPhoneUnfiltered = new Map<string, DemandAnalyticsHeader[]>();
  for (const d of typedDemands) {
    const phone = d.normalizedPhone;
    if (!phone) continue;
    const list = byPhoneUnfiltered.get(phone) ?? [];
    list.push(d);
    byPhoneUnfiltered.set(phone, list);
  }

  /** Отгрузки с учётом фильтра услуг. */
  const byPhoneService = new Map<string, DemandAnalyticsHeader[]>();
  for (const d of typedDemands) {
    const phone = d.normalizedPhone;
    if (!phone) continue;
    if (!demandMatchesServiceFilterHeader(d, serviceIdSet)) continue;
    const list = byPhoneService.get(phone) ?? [];
    list.push(d);
    byPhoneService.set(phone, list);
  }

  const byPhonePeriod = new Map<string, DemandAnalyticsHeader[]>();
  for (const [phone, list] of byPhoneService) {
    const inPeriod = list.filter((d) => ymdInRange(d.documentDate, dateFrom, dateTo));
    if (inPeriod.length > 0) byPhonePeriod.set(phone, inPeriod);
  }

  const clients: CustomerAnalyticsRow[] = [];

  for (const [phone, periodDemands] of byPhonePeriod) {
    const allForPhone = byPhoneUnfiltered.get(phone) ?? [];
    const visitCount = periodDemands.length;
    const visitCountAllTime = allForPhone.length;

    const datesPeriod = periodDemands.map((d) => d.documentDate).sort();
    const firstVisitInPeriod = datesPeriod[0] ?? null;
    const lastVisitInPeriod = datesPeriod[datesPeriod.length - 1] ?? null;

    const allDates = allForPhone.map((d) => d.documentDate).sort();
    const lastVisitGlobal = allDates.length > 0 ? allDates[allDates.length - 1]! : null;
    const daysSinceLastVisit =
      lastVisitGlobal != null ? daysBetweenUtcDates(lastVisitGlobal, todayYmd) : null;

    let revenueCents = 0;
    let profitCents = 0;
    let hasIncompleteCost = false;
    for (const d of periodDemands) {
      revenueCents += d.sumCents;
      profitCents += d.profitCents;
      if (d.hasIncompleteCost) hasIncompleteCost = true;
    }

    const avgRevenuePerVisitCents = visitCount > 0 ? Math.round(revenueCents / visitCount) : 0;
    const avgProfitPerVisitCents = visitCount > 0 ? Math.round(profitCents / visitCount) : 0;
    const avgDaysBetweenVisits = computeAvgGapDays(periodDemands.map((d) => d.documentDate));

    const serviceFilteredAll = byPhoneService.get(phone) ?? [];
    const revAllTime = serviceFilteredAll.reduce((s, d) => s + d.sumCents, 0);
    const profitAllTime = serviceFilteredAll.reduce((s, d) => s + d.profitCents, 0);

    const revenueForVip = settings.vipWindow === "selected_period" ? revenueCents : revAllTime;
    const profitForVip = settings.vipWindow === "selected_period" ? profitCents : profitAllTime;

    const svc = serviceStatsForPeriod(periodDemands, serviceIdSet);

    const statuses = resolveStatuses({
      visitCount,
      visitCountAllTime,
      daysSinceLastVisit,
      settings,
      revenueCents,
      profitCents,
      revenueForVipCents: revenueForVip,
      profitForVipCents: profitForVip,
    });

    clients.push({
      normalizedPhone: phone,
      displayName: pickDisplayNameForPeriod(periodDemands),
      visitCount,
      visitCountAllTime,
      firstVisitInPeriod,
      lastVisitInPeriod,
      lastVisitGlobal,
      daysSinceLastVisit,
      revenueCents,
      profitCents,
      avgRevenuePerVisitCents,
      avgProfitPerVisitCents,
      avgDaysBetweenVisits,
      hasIncompleteCost,
      primaryServiceId: svc.primaryServiceId,
      primaryServiceName: svc.primaryServiceName,
      primaryServiceVisitShare: svc.primaryServiceVisitShare,
      lastServiceId: svc.lastServiceId,
      lastServiceName: svc.lastServiceName,
      statuses,
    });
  }

  const inactiveDays = settings.inactiveDaysThreshold;
  const totalVisits = clients.reduce((s, c) => s + c.visitCount, 0);
  const totalClients = clients.length;
  const clientsOneVisit = clients.filter((c) => c.visitCount === 1).length;
  const clientsTwoPlusVisits = clients.filter((c) => c.visitCount >= 2).length;
  const clientsInactive365 = clients.filter((c) => c.daysSinceLastVisit != null && c.daysSinceLastVisit > inactiveDays).length;

  const totalRevenueCents = clients.reduce((s, c) => s + c.revenueCents, 0);
  const totalProfitCents = clients.reduce((s, c) => s + c.profitCents, 0);

  const kpis: CustomerAnalyticsKpis = {
    totalClients,
    clientsOneVisit,
    clientsTwoPlusVisits,
    clientsInactive365,
    avgVisitsPerClient: totalClients > 0 ? Math.round((totalVisits / totalClients) * 100) / 100 : 0,
    avgRevenuePerClientCents: totalClients > 0 ? Math.round(totalRevenueCents / totalClients) : 0,
    avgProfitPerClientCents: totalClients > 0 ? Math.round(totalProfitCents / totalClients) : 0,
    totalRevenueCents,
    totalProfitCents,
    newClients: clientsOneVisit,
    repeatClients: clientsTwoPlusVisits,
    sleepingClients: clientsInactive365,
  };

  return {
    generatedAt: new Date().toISOString(),
    dateFrom,
    dateTo,
    todayYmd,
    sync: {
      lastSyncedAt: syncState?.lastSyncedAt?.toISOString() ?? null,
      lastError: syncState?.lastError ?? null,
      demandsSynced: syncState?.demandsSynced ?? 0,
    },
    services,
    kpis,
    clients,
  };
}

export async function loadCustomerDemandHistory(params: {
  normalizedPhone: string;
  dateFrom: string | null;
  dateTo: string | null;
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
    positions: {
      name: string;
      assortmentType: string;
      quantity: number;
      revenueCents: number;
      costCents: number;
      lineIncompleteCost: boolean;
    }[];
  }[];
}> {
  const { normalizedPhone, dateFrom, dateTo, serviceIds } = params;
  const serviceIdSet = new Set(serviceIds.filter(Boolean));

  const rows = await prisma.moySkladDemandSync.findMany({
    where: { normalizedPhone },
    include: { positions: true },
    orderBy: { momentAt: "desc" },
  });

  const out: {
    id: string;
    name: string;
    documentDate: string;
    momentAt: string;
    sumCents: number;
    profitCents: number;
    hasIncompleteCost: boolean;
    positions: {
      name: string;
      assortmentType: string;
      quantity: number;
      revenueCents: number;
      costCents: number;
      lineIncompleteCost: boolean;
    }[];
  }[] = [];

  for (const d of rows) {
    if (!demandMatchesServiceFilter(d as DemandWithPositions, serviceIdSet)) continue;
    if (!ymdInRange(d.documentDate, dateFrom, dateTo)) continue;
    const positions = d.positions.map((p) => {
      const { revenueCents, costCents } = lineRevenueAndCostCents(p);
      return {
        name: p.name,
        assortmentType: p.assortmentType,
        quantity: p.quantity,
        revenueCents,
        costCents,
        lineIncompleteCost: p.lineIncompleteCost,
      };
    });
    out.push({
      id: d.id,
      name: d.name,
      documentDate: d.documentDate,
      momentAt: d.momentAt.toISOString(),
      sumCents: d.sumCents,
      profitCents: documentProfitCents(d.positions),
      hasIncompleteCost: d.hasIncompleteCost,
      positions,
    });
  }

  return { demands: out };
}
