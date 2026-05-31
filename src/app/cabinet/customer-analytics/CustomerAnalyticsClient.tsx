"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  BellPlus,
  CalendarPlus,
  Car,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  PackagePlus,
  Phone,
  RefreshCw,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";

type CustomerSource = "shipments" | "crm" | "yclients" | "manual";
type ClientStatus = "new" | "repeat" | "regular" | "sleeping" | "active" | "no_history";

type VehicleSummary = {
  id: string;
  label: string;
  model: string | null;
  plate: string | null;
  vin: string | null;
  source: CustomerSource;
};

type CustomerCrmCase = {
  id: string;
  title: string;
  status: string;
  nextAction: string | null;
  nextContactAt: string | null;
  responsibleLogin: string | null;
  source: string | null;
};

type ClientRow = {
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

type Kpis = {
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

type QuickFilter =
  | "top_revenue"
  | "top_profit"
  | "top_visits"
  | "sleeping"
  | "new"
  | "repeat"
  | "regular"
  | "without_phone"
  | "without_vehicle"
  | "open_cases"
  | "waiting_calculation"
  | "waiting_supplies"
  | "high_avg_check"
  | null;

type Payload = {
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
  kpis: Kpis;
  insights: {
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
  }[];
  duplicates: { id: string; title: string; subtitle: string; sources: CustomerSource[]; clientKeys: string[] }[];
  trend: { bucket: string; label: string; newClients: number; repeatClients: number; revenueCents: number }[];
  segments: { segment: ClientStatus; label: string; count: number }[];
  topServices: { id: string; name: string; visits: number; revenueCents: number }[];
  clients: ClientRow[];
  settings: {
    inactiveDaysThreshold: number;
    regularVisitThreshold: number;
    vipThresholdCents: number | null;
    vipMetric: string;
    vipWindow: string;
  };
};

type HistoryPayload = {
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
};

type PeriodPreset = "today" | "7d" | "30d" | "90d" | "year" | "all" | "custom";
type SortField =
  | "displayName"
  | "lastVisitGlobal"
  | "visitCount"
  | "visitCountAllTime"
  | "revenueCents"
  | "profitCents"
  | "avgRevenuePerVisitCents"
  | "daysSinceLastVisit"
  | "segment";
type AnalyticsTab = "overview" | "clients" | "sleeping" | "duplicates" | "services";

const STORAGE_KEY = "customer-analytics-ui-state:v2";
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const QUICK_FILTER_OPTIONS = [
  ["top_revenue", "Топ по выручке"],
  ["top_profit", "Топ по прибыли"],
  ["top_visits", "Топ по визитам"],
  ["sleeping", "Давно не были"],
  ["new", "Только новые"],
  ["repeat", "Только повторные"],
  ["regular", "Постоянные"],
  ["without_phone", "Без телефона"],
  ["without_vehicle", "Без авто"],
  ["open_cases", "С открытыми делами"],
  ["waiting_calculation", "Ждут расчёт"],
  ["waiting_supplies", "Ждём расходники"],
  ["high_avg_check", "Высокий чек"],
] as const satisfies readonly (readonly [Exclude<QuickFilter, null>, string])[];

function readPersisted(userLogin: string): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${userLogin}`);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y!, m! - 1, d!);
  dt.setDate(dt.getDate() + delta);
  return localYmd(dt);
}

function periodToRange(preset: PeriodPreset, customFrom: string, customTo: string): { from: string | null; to: string | null } {
  const today = localYmd(new Date());
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDaysYmd(today, -6), to: today };
    case "30d":
      return { from: addDaysYmd(today, -29), to: today };
    case "90d":
      return { from: addDaysYmd(today, -89), to: today };
    case "year":
      return { from: addDaysYmd(today, -364), to: today };
    case "all":
      return { from: null, to: null };
    case "custom":
      return { from: customFrom.trim() || null, to: customTo.trim() || null };
  }
}

function formatRub(cents: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(cents / 100)} ₽`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatPhoneDisplay(value: string | null): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("7")) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  return value;
}

function statusLabel(s: ClientStatus): string {
  switch (s) {
    case "new":
      return "Новый";
    case "repeat":
      return "Повторный";
    case "regular":
      return "Постоянный";
    case "sleeping":
      return "Спящий";
    case "active":
      return "Активный";
    case "no_history":
      return "Без истории";
  }
}

function segmentClass(segment: ClientStatus): string {
  switch (segment) {
    case "new":
    case "repeat":
    case "regular":
      return "eco-ca-badge eco-ca-badge--accent";
    case "sleeping":
      return "eco-ca-badge eco-ca-badge--warning";
    case "active":
      return "eco-ca-badge eco-ca-badge--success";
    case "no_history":
      return "eco-ca-badge eco-ca-badge--neutral";
  }
}

function sourceLabel(source: CustomerSource): string {
  switch (source) {
    case "shipments":
      return "Отгрузки";
    case "crm":
      return "CRM";
    case "yclients":
      return "YCLIENTS";
    case "manual":
      return "Вручную";
  }
}

function downloadCsv(filename: string, rows: string[][]) {
  const bom = "\uFEFF";
  const esc = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
  const body = rows.map((row) => row.map(esc).join(",")).join("\n");
  const blob = new Blob([bom + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function clientTypeMatches(client: ClientRow, filter: "all" | ClientStatus): boolean {
  if (filter === "all") return true;
  return client.statuses.includes(filter);
}

function quickFilterMatches(client: ClientRow, quickFilter: QuickFilter): boolean {
  switch (quickFilter) {
    case "sleeping":
      return client.statuses.includes("sleeping");
    case "new":
      return client.statuses.includes("new");
    case "repeat":
      return client.statuses.includes("repeat");
    case "regular":
      return client.statuses.includes("regular");
    case "without_phone":
      return client.phoneMissing;
    case "without_vehicle":
      return client.vehicleCount === 0;
    case "open_cases":
      return client.openCrmCases > 0;
    case "waiting_calculation":
      return client.waitingCalculation;
    case "waiting_supplies":
      return client.waitingSupplies;
    case "high_avg_check":
      return client.highAverageCheck;
    case "top_revenue":
    case "top_profit":
    case "top_visits":
    case null:
      return true;
  }
}

function sortForQuickFilter(quickFilter: QuickFilter): { field: SortField; desc: boolean } | null {
  if (quickFilter === "top_revenue") return { field: "revenueCents", desc: true };
  if (quickFilter === "top_profit") return { field: "profitCents", desc: true };
  if (quickFilter === "top_visits") return { field: "visitCountAllTime", desc: true };
  if (quickFilter === "sleeping") return { field: "daysSinceLastVisit", desc: true };
  return null;
}

function createShipmentHref(client: ClientRow): string {
  const params = new URLSearchParams();
  if (client.displayName) params.set("counterparty", client.displayName);
  if (client.phone) params.set("phone", client.phone);
  const vehicle = client.vehicles[0];
  if (vehicle?.model) params.set("vehicle", vehicle.model);
  if (vehicle?.plate) params.set("plate", vehicle.plate);
  if (vehicle?.vin) params.set("vin", vehicle.vin);
  return `/shipment/new?${params.toString()}`;
}

function buildExportRows(clients: ClientRow[]): string[][] {
  const header = [
    "Клиент",
    "Телефон",
    "Авто",
    "Первый визит",
    "Последний визит",
    "Визитов в периоде",
    "Визитов всего",
    "Выручка",
    "Прибыль",
    "Средний чек",
    "Дней с визита",
    "Сегмент",
    "Открытых CRM-дел",
  ];
  const rows = clients.map((client) => [
    client.displayName,
    client.phone ?? "",
    client.vehicleLabel ?? "",
    client.firstVisitGlobal ?? "",
    client.lastVisitGlobal ?? "",
    String(client.visitCount),
    String(client.visitCountAllTime),
    String(client.revenueCents / 100),
    String(client.profitCents / 100),
    String(client.avgRevenuePerVisitCents / 100),
    client.daysSinceLastVisit != null ? String(client.daysSinceLastVisit) : "",
    statusLabel(client.segment),
    String(client.openCrmCases),
  ]);
  return [header, ...rows];
}

function Skeleton() {
  return (
    <div className="eco-ca-skeleton" aria-label="Считаем клиентов, визиты и выручку">
      <div className="eco-card eco-card--padded">
        <p>Считаем клиентов, визиты и выручку...</p>
        <div className="eco-ca-skeleton-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} />
          ))}
        </div>
      </div>
      <div className="eco-ca-skeleton-panels">
        <div />
        <div />
      </div>
    </div>
  );
}

export default function CustomerAnalyticsClient({ userLogin }: { userLogin: string }) {
  const [mounted, setMounted] = useState(false);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [inactiveDays, setInactiveDays] = useState(90);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [clientType, setClientType] = useState<"all" | ClientStatus>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | CustomerSource>("all");
  const [responsibleFilter, setResponsibleFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(null);
  const [sortField, setSortField] = useState<SortField>("revenueCents");
  const [sortDesc, setSortDesc] = useState(true);
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("overview");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(50);
  const [page, setPage] = useState(1);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(() => new Set());
  const [crmCreatingKey, setCrmCreatingKey] = useState<string | null>(null);

  const skipNextPersist = useRef(true);

  useEffect(() => {
    const persisted = readPersisted(userLogin);
    if (typeof persisted.periodPreset === "string") setPeriodPreset(persisted.periodPreset as PeriodPreset);
    if (typeof persisted.customFrom === "string") setCustomFrom(persisted.customFrom);
    if (typeof persisted.customTo === "string") setCustomTo(persisted.customTo);
    if (typeof persisted.inactiveDays === "number") setInactiveDays(persisted.inactiveDays);
    if (Array.isArray(persisted.selectedServices)) setSelectedServices(persisted.selectedServices as string[]);
    if (typeof persisted.clientType === "string") setClientType(persisted.clientType as "all" | ClientStatus);
    if (typeof persisted.sourceFilter === "string") setSourceFilter(persisted.sourceFilter as "all" | CustomerSource);
    if (typeof persisted.responsibleFilter === "string") setResponsibleFilter(persisted.responsibleFilter);
    if (typeof persisted.search === "string") setSearch(persisted.search);
    if (typeof persisted.sortField === "string") setSortField(persisted.sortField as SortField);
    if (typeof persisted.sortDesc === "boolean") setSortDesc(persisted.sortDesc);
    setMounted(true);
    skipNextPersist.current = false;
  }, [userLogin]);

  const { from: dateFrom, to: dateTo } = useMemo(
    () => periodToRange(periodPreset, customFrom, customTo),
    [periodPreset, customFrom, customTo]
  );
  const servicesQuery = useMemo(() => selectedServices.join(","), [selectedServices]);

  const fetchPayload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      if (dateFrom) qs.set("dateFrom", dateFrom);
      if (dateTo) qs.set("dateTo", dateTo);
      if (servicesQuery) qs.set("services", servicesQuery);
      if (inactiveDays > 0) qs.set("inactiveDays", String(inactiveDays));
      const res = await fetch(`/api/analytics/customers?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        const message = [data?.error, data?.hint].filter(Boolean).join(". ");
        setLoadError(message || "Не удалось загрузить аналитику клиентов");
        setPayload(null);
        return;
      }
      setPayload(data as Payload);
    } catch {
      setLoadError("Не удалось загрузить аналитику клиентов. Проверьте локальную базу и повторите попытку.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, servicesQuery, inactiveDays]);

  useEffect(() => {
    if (mounted) void fetchPayload();
  }, [mounted, fetchPayload]);

  useEffect(() => {
    if (skipNextPersist.current || !mounted) return;
    const state = {
      periodPreset,
      customFrom,
      customTo,
      inactiveDays,
      selectedServices,
      clientType,
      sourceFilter,
      responsibleFilter,
      search,
      sortField,
      sortDesc,
    };
    try {
      localStorage.setItem(`${STORAGE_KEY}:${userLogin}`, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [
    mounted,
    userLogin,
    periodPreset,
    customFrom,
    customTo,
    inactiveDays,
    selectedServices,
    clientType,
    sourceFilter,
    responsibleFilter,
    search,
    sortField,
    sortDesc,
  ]);

  function resetFilters() {
    setClientType("all");
    setSourceFilter("all");
    setResponsibleFilter("all");
    setSearch("");
    setQuickFilter(null);
    setPage(1);
  }

  function applyQuickFilter(next: QuickFilter) {
    const active = quickFilter === next ? null : next;
    setQuickFilter(active);
    if (active === "sleeping") setActiveTab("sleeping");
    else if (active) setActiveTab("clients");
    setPage(1);
    const sort = sortForQuickFilter(active);
    if (sort) {
      setSortField(sort.field);
      setSortDesc(sort.desc);
    }
  }

  function openTab(tab: AnalyticsTab) {
    setActiveTab(tab);
    setPage(1);
    if (tab === "sleeping") setQuickFilter(null);
  }

  const filteredClients = useMemo(() => {
    if (!payload) return [];
    const q = search.trim().toLowerCase();
    let list = payload.clients.filter((client) => {
      if (!clientTypeMatches(client, clientType)) return false;
      if (sourceFilter !== "all" && !client.sources.includes(sourceFilter)) return false;
      if (responsibleFilter !== "all" && !client.responsibleLogins.includes(responsibleFilter)) return false;
      if (!quickFilterMatches(client, quickFilter)) return false;
      if (q) {
        const haystack = [
          client.displayName,
          client.phone,
          client.normalizedPhone,
          client.vehicleLabel,
          client.lastDemandName,
          client.primaryServiceName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const mul = sortDesc ? -1 : 1;
    list = [...list].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return av < bv ? -mul : av > bv ? mul : 0;
      return String(av).localeCompare(String(bv), "ru") * mul;
    });
    return list;
  }, [payload, search, clientType, sourceFilter, responsibleFilter, quickFilter, sortField, sortDesc]);

  const sleepingClients = useMemo(() => filteredClients.filter((client) => client.statuses.includes("sleeping")), [filteredClients]);
  const tableClients = useMemo(
    () => (activeTab === "sleeping" ? sleepingClients : filteredClients),
    [activeTab, filteredClients, sleepingClients]
  );
  const pageCount = Math.max(1, Math.ceil(tableClients.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = tableClients.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(tableClients.length, currentPage * pageSize);
  const pagedClients = tableClients.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const topRevenueClients = useMemo(
    () => [...filteredClients].filter((client) => client.revenueCents > 0).sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 5),
    [filteredClients]
  );
  const visibleSegments = useMemo(
    () => (payload?.segments ?? []).filter((point) => ["new", "repeat", "regular", "sleeping", "no_history"].includes(point.segment)),
    [payload?.segments]
  );
  const trendMaxClients = Math.max(1, ...(payload?.trend ?? []).map((point) => point.newClients + point.repeatClients));
  const visibleSegmentMax = Math.max(1, ...visibleSegments.map((point) => point.count));
  const repeatReturned90 = useMemo(
    () => payload?.clients.filter((client) => client.visitCount > 0 && (client.daysSinceLastVisit ?? 9999) <= 90 && client.visitCountAllTime >= 2).length ?? 0,
    [payload?.clients]
  );

  useEffect(() => {
    setPage(1);
  }, [search, clientType, sourceFilter, responsibleFilter, quickFilter, sortField, sortDesc, activeTab, pageSize]);

  const drawerClient = drawerKey ? payload?.clients.find((client) => client.clientKey === drawerKey) ?? null : null;

  async function openDrawer(client: ClientRow) {
    setDrawerKey(client.clientKey);
    setHistory(null);
    setHistoryLoading(true);
    setExpandedDocs(new Set());
    try {
      const qs = new URLSearchParams({ clientKey: client.clientKey });
      if (client.normalizedPhone) qs.set("phone", client.normalizedPhone);
      if (servicesQuery) qs.set("services", servicesQuery);
      const res = await fetch(`/api/analytics/customers/history?${qs.toString()}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setHistory(data as HistoryPayload);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function copyPhone(client: ClientRow) {
    if (!client.phone) return;
    try {
      await navigator.clipboard.writeText(client.phone);
      setToast("Телефон скопирован");
    } catch {
      setToast("Не удалось скопировать телефон");
    }
  }

  async function createReminder(client: ClientRow, action: "callback" | "service" = "callback") {
    setCrmCreatingKey(client.clientKey);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + (action === "service" ? 1 : 0));
    tomorrow.setHours(12, 0, 0, 0);
    try {
      const res = await fetch("/api/crm/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `${action === "service" ? "Напомнить о ТО" : "Перезвонить"}: ${client.displayName}`,
          customerName: client.displayName,
          phone: client.phone ?? client.normalizedPhone,
          vehicle: client.vehicleLabel,
          source: "customer-analytics",
          clientType: client.statuses.includes("regular") ? "regular" : client.statuses.includes("repeat") ? "repeat" : "new_lead",
          nextAction: action === "service" ? "Напомнить о ТО" : "Перезвонить",
          nextContactAt: tomorrow.toISOString(),
          notes: client.daysSinceLastVisit != null ? `Не был ${client.daysSinceLastVisit} дней. Создано из аналитики клиентов.` : "Создано из аналитики клиентов.",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Не удалось создать дело");
      }
      setToast("CRM-дело создано");
      void fetchPayload();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось создать дело");
    } finally {
      setCrmCreatingKey(null);
    }
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDesc((value) => !value);
    else {
      setSortField(field);
      setSortDesc(field !== "displayName" && field !== "segment");
    }
  }

  function exportCsv() {
    downloadCsv(`clients-analytics-${localYmd(new Date())}.csv`, buildExportRows(tableClients));
  }

  async function exportXlsx() {
    const XLSX = await import("xlsx");
    const worksheet = XLSX.utils.aoa_to_sheet(buildExportRows(tableClients));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Клиенты");
    XLSX.writeFile(workbook, `clients-analytics-${localYmd(new Date())}.xlsx`);
  }

  const maxServiceVisits = Math.max(1, ...(payload?.topServices ?? []).map((point) => point.visits));

  if (!mounted) return <div className="min-h-[420px]" />;

  const filtersPanel = (
    <section className="eco-ca-filterbar">
      <div className="eco-ca-filterbar__top">
        <div className="eco-ca-field eco-ca-field--period">
          <span>Период</span>
          <div className="eco-ca-segmented">
            {(
              [
                ["today", "Сегодня"],
                ["7d", "7 дней"],
                ["30d", "30 дней"],
                ["90d", "90 дней"],
                ["year", "Год"],
                ["all", "Всё время"],
                ["custom", "Свой"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setPeriodPreset(key)} className={periodPreset === key ? "is-active" : ""}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="eco-ca-filter-grid">
          <label className="eco-ca-field">
            <span>Сегмент</span>
            <select value={clientType} onChange={(event) => setClientType(event.target.value as "all" | ClientStatus)}>
              <option value="all">Все</option>
              <option value="new">Новые</option>
              <option value="repeat">Повторные</option>
              <option value="regular">Постоянные</option>
              <option value="sleeping">Спящие</option>
              <option value="active">Активные</option>
              <option value="no_history">Без истории</option>
            </select>
          </label>
          <label className="eco-ca-field">
            <span>Источник</span>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as "all" | CustomerSource)}>
              <option value="all">Все</option>
              <option value="shipments">Отгрузки</option>
              <option value="crm">CRM</option>
              <option value="yclients">YCLIENTS</option>
              <option value="manual">Вручную</option>
            </select>
          </label>
          <label className="eco-ca-field">
            <span>Услуга</span>
            <select
              value=""
              onChange={(event) => {
                const value = event.target.value;
                if (value && !selectedServices.includes(value)) setSelectedServices((prev) => [...prev, value]);
              }}
            >
              <option value="">Все услуги</option>
              {(payload?.services ?? []).filter((service) => !selectedServices.includes(service.id)).map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
          <label className="eco-ca-field">
            <span>Ответственный</span>
            <select value={responsibleFilter} onChange={(event) => setResponsibleFilter(event.target.value)}>
              <option value="all">Все</option>
              {(payload?.responsibles ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="eco-ca-field">
            <span>Спящий после</span>
            <input type="number" min={7} max={730} value={inactiveDays} onChange={(event) => setInactiveDays(Math.max(1, Number(event.target.value) || 90))} />
          </label>
        </div>
      </div>

      {periodPreset === "custom" && (
        <div className="eco-ca-custom-period">
          <label className="eco-ca-field">
            <span>С</span>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </label>
          <label className="eco-ca-field">
            <span>По</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </label>
        </div>
      )}

      <div className="eco-ca-filterbar__bottom">
        <label className="eco-ca-search">
          <span className="sr-only">Поиск</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск: имя, телефон, авто, отгрузка" />
        </label>
        <div className="eco-ca-chip-row">
          {QUICK_FILTER_OPTIONS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => applyQuickFilter(id)} className={`eco-ca-chip ${quickFilter === id ? "is-active" : ""}`}>
              {label}
            </button>
          ))}
          <button type="button" onClick={resetFilters} className="eco-ca-chip eco-ca-chip--reset">
            Сбросить
          </button>
        </div>
      </div>

      {selectedServices.length > 0 && (
        <div className="eco-ca-selected-row">
          {selectedServices.map((id) => {
            const service = payload?.services.find((item) => item.id === id);
            return (
              <button key={id} type="button" onClick={() => setSelectedServices((prev) => prev.filter((item) => item !== id))} className="eco-ca-selected-chip">
                {service?.name ?? id}
                <X size={12} />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );

  const tabItems: { id: AnalyticsTab; label: string; count?: number }[] = [
    { id: "overview", label: "Обзор" },
    { id: "clients", label: "Клиенты", count: filteredClients.length },
    { id: "sleeping", label: "Спящие", count: sleepingClients.length },
    { id: "duplicates", label: "Дубли", count: payload?.duplicates.length ?? 0 },
    { id: "services", label: "Услуги", count: payload?.topServices.length ?? 0 },
  ];

  const tableTitle = activeTab === "sleeping" ? "Спящие клиенты" : "Клиенты";

  function renderPaginationControls() {
    return (
      <div className="eco-ca-pagination">
        <div>
          Показано {pageStart}-{pageEnd} из {tableClients.length} клиентов
        </div>
        <div>
          <label>
            Строк
            <select
              value={pageSize}
              onChange={(event) => setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={currentPage <= 1}
          >
            Назад
          </button>
          <span>
            {currentPage} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            disabled={currentPage >= pageCount}
          >
            Вперёд
          </button>
        </div>
      </div>
    );
  }

  function renderClientTable(description: string) {
    return (
      <section className="eco-ca-table-panel">
        <div className="eco-ca-panel-head">
          <div>
            <h2>{tableTitle}</h2>
            <p>{description}</p>
          </div>
          <div className="eco-ca-table-hints">
            <span>Поиск и chips сверху</span>
            <span>Сортировка в заголовках</span>
          </div>
        </div>
        <div className="eco-ca-table-scroller">
          <table className="eco-ca-table">
            <thead>
              <tr>
                {(
                  [
                    ["displayName", "Клиент"],
                    [null, "Телефон"],
                    [null, "Авто"],
                    [null, "Первый визит"],
                    ["lastVisitGlobal", "Последний визит"],
                    ["visitCountAllTime", "Визитов"],
                    ["revenueCents", "Выручка"],
                    ["profitCents", "Прибыль"],
                    ["avgRevenuePerVisitCents", "Средний чек"],
                    ["daysSinceLastVisit", "Дней с визита"],
                    ["segment", "Сегмент"],
                    [null, "Действия"],
                  ] as const
                ).map(([field, label]) => (
                  <th key={label}>
                    {field ? (
                      <button type="button" onClick={() => toggleSort(field)}>
                        {label}{sortField === field ? (sortDesc ? " ↓" : " ↑") : ""}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedClients.map((client) => (
                <tr key={client.clientKey}>
                  <td>
                    <button type="button" onClick={() => void openDrawer(client)} className="eco-ca-table-client-trigger">
                      <div className="eco-ca-table-client-name">{client.displayName}</div>
                      <div className="eco-ca-table-badges">
                        <span className={segmentClass(client.segment)}>{statusLabel(client.segment)}</span>
                        {client.openCrmCases > 0 && <span className="eco-ca-badge eco-ca-badge--warning">CRM {client.openCrmCases}</span>}
                      </div>
                    </button>
                  </td>
                  <td>
                    <div className="eco-ca-table-phone">
                      <span>{formatPhoneDisplay(client.phone)}</span>
                      {client.phone && (
                        <button type="button" onClick={() => void copyPhone(client)} className="eco-icon-btn" title="Скопировать телефон">
                          <Copy size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="eco-ca-table-vehicle">{client.vehicleCount > 1 ? `${client.vehicleCount} авто` : client.vehicleLabel ?? "—"}</div>
                  </td>
                  <td className="eco-ca-table-nowrap">{formatDate(client.firstVisitGlobal)}</td>
                  <td>
                    <div className="eco-ca-table-nowrap">{formatDate(client.lastVisitGlobal)}</div>
                    {client.lastDemandName && <div className="eco-ca-table-muted">{client.lastDemandName}</div>}
                  </td>
                  <td>
                    <div className="eco-ca-table-strong">{client.visitCountAllTime}</div>
                    <div className="eco-ca-table-muted">в периоде {client.visitCount}</div>
                  </td>
                  <td className="eco-ca-table-nowrap eco-ca-table-strong">{formatRub(client.revenueCents)}</td>
                  <td className="eco-ca-table-nowrap">
                    {formatRub(client.profitCents)}
                    {client.hasIncompleteCost && <div className="eco-ca-table-warning">неполная</div>}
                  </td>
                  <td className="eco-ca-table-nowrap">{formatRub(client.avgRevenuePerVisitCents)}</td>
                  <td>{client.daysSinceLastVisit ?? "—"}</td>
                  <td>
                    <span className={segmentClass(client.segment)}>{statusLabel(client.segment)}</span>
                  </td>
                  <td>
                    <div className="eco-ca-row-actions">
                      <button type="button" onClick={() => void openDrawer(client)} className="eco-icon-btn" title="Открыть сводку">
                        <UserRound size={15} />
                      </button>
                      <button type="button" onClick={() => void createReminder(client)} disabled={crmCreatingKey === client.clientKey} className="eco-icon-btn" title="Создать дело">
                        <BellPlus size={15} />
                      </button>
                      <Link href="/records" className="eco-icon-btn" title="Создать запись">
                        <CalendarPlus size={15} />
                      </Link>
                      <Link href={createShipmentHref(client)} className="eco-icon-btn" title="Создать отгрузку">
                        <PackagePlus size={15} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {tableClients.length === 0 && (
                <tr>
                  <td colSpan={12} className="eco-ca-empty-row">
                    Нет данных по текущим фильтрам. Измените период, поиск или быстрые выборки.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {renderPaginationControls()}
      </section>
    );
  }

  function renderDailyChart(compact = false) {
    const points = payload?.trend ?? [];
    if (points.length === 0) {
      return <p className="eco-ca-empty">Нет визитов за период</p>;
    }
    const width = compact ? 760 : 1180;
    const height = compact ? 220 : 260;
    const top = 18;
    const right = 18;
    const bottom = 34;
    const left = 34;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const step = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;
    const barWidth = Math.max(9, Math.min(26, (plotWidth / Math.max(1, points.length)) * 0.52));
    const labelStep = Math.max(1, Math.ceil(points.length / 8));
    const totalLine = points
      .map((point, index) => {
        const total = point.newClients + point.repeatClients;
        const x = left + index * step;
        const y = top + plotHeight - (total / trendMaxClients) * plotHeight;
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <div className="eco-ca-chart">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Новые клиенты, повторные визиты и общее число клиентов по дням">
          <line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className="eco-ca-chart__axis" />
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <line key={ratio} x1={left} x2={width - right} y1={top + plotHeight - plotHeight * ratio} y2={top + plotHeight - plotHeight * ratio} className="eco-ca-chart__grid" />
          ))}
          {points.map((point, index) => {
            const x = left + index * step;
            const newHeight = (point.newClients / trendMaxClients) * plotHeight;
            const repeatHeight = (point.repeatClients / trendMaxClients) * plotHeight;
            const baseline = height - bottom;
            const showLabel = index % labelStep === 0 || index === points.length - 1;
            return (
              <g key={point.bucket}>
                <rect x={x - barWidth / 2} y={baseline - repeatHeight} width={barWidth} height={Math.max(1, repeatHeight)} rx={2} className="eco-ca-chart__bar eco-ca-chart__bar--repeat">
                  <title>{point.label}: повторные {point.repeatClients}</title>
                </rect>
                <rect x={x - barWidth / 2} y={baseline - repeatHeight - newHeight} width={barWidth} height={Math.max(1, newHeight)} rx={2} className="eco-ca-chart__bar eco-ca-chart__bar--new">
                  <title>{point.label}: новые {point.newClients}</title>
                </rect>
                {showLabel && (
                  <text x={x} y={height - 12} textAnchor="middle" className="eco-ca-chart__label">
                    {point.label}
                  </text>
                )}
              </g>
            );
          })}
          <polyline points={totalLine} fill="none" className="eco-ca-chart__line" />
          {points.map((point, index) => {
            const total = point.newClients + point.repeatClients;
            const x = left + index * step;
            const y = top + plotHeight - (total / trendMaxClients) * plotHeight;
            return (
              <circle key={`${point.bucket}-total`} cx={x} cy={y} r={3} className="eco-ca-chart__dot">
                <title>{point.label}: всего {total}</title>
              </circle>
            );
          })}
        </svg>
        <div className="eco-ca-chart-legend">
          <span><i className="is-new" />Новые</span>
          <span><i className="is-repeat" />Повторные</span>
          <span><i className="is-total" />Всего</span>
        </div>
      </div>
    );
  }

  function renderSegmentBars() {
    if (visibleSegments.length === 0) {
      return <p className="eco-ca-empty">Сегменты появятся после локальных данных.</p>;
    }
    return (
      <div className="eco-ca-bars">
        {visibleSegments.map((point) => (
          <div key={point.segment} className="eco-ca-bars__row">
            <div className="eco-ca-bars__meta">
              <span>{point.label}</span>
              <strong>{point.count}</strong>
            </div>
            <div className="eco-ca-bars__track">
              <div style={{ width: `${Math.max(4, (point.count / visibleSegmentMax) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderServiceBars(limit?: number) {
    const services = limit ? (payload?.topServices ?? []).slice(0, limit) : payload?.topServices ?? [];
    if (services.length === 0) {
      return <p className="eco-ca-empty">Услуги появятся после отгрузок с позициями услуг.</p>;
    }
    return (
      <div className="eco-ca-service-bars">
        {services.map((service) => (
          <div key={service.id} className="eco-ca-service-bars__row">
            <div className="eco-ca-service-bars__head">
              <span>{service.name}</span>
              <strong>{service.visits} · {formatRub(service.revenueCents)}</strong>
            </div>
            <div className="eco-ca-bars__track">
              <div style={{ width: `${Math.max(4, (service.visits / maxServiceVisits) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderPreviewClient(client: ClientRow, mode: "sleeping" | "revenue") {
    return (
      <article key={client.clientKey} className="eco-ca-client-row">
        <button type="button" onClick={() => void openDrawer(client)} className="eco-ca-client-row__main">
          <strong>{client.displayName}</strong>
          <span>{formatPhoneDisplay(client.phone)}</span>
          <em><Car size={13} /> {client.vehicleCount > 1 ? `${client.vehicleCount} авто` : client.vehicleLabel ?? "Авто не указано"}</em>
        </button>
        <div className="eco-ca-client-row__stats">
          <span><strong>{client.visitCountAllTime}</strong>визитов</span>
          <span><strong>{formatRub(mode === "revenue" ? client.revenueCents : client.avgCheckAllTimeCents)}</strong>{mode === "revenue" ? "выручка" : "ср. чек"}</span>
          <span><strong>{client.daysSinceLastVisit ?? "—"}</strong>дней</span>
        </div>
        <span className={segmentClass(client.segment)}>{statusLabel(client.segment)}</span>
        <button
          type="button"
          onClick={() => (mode === "sleeping" ? void createReminder(client) : void openDrawer(client))}
          disabled={mode === "sleeping" && crmCreatingKey === client.clientKey}
          className="eco-ca-client-row__action"
        >
          {mode === "sleeping" ? <BellPlus size={15} /> : <UserRound size={15} />}
          {mode === "sleeping" ? "Создать напоминание" : "Сводка"}
        </button>
      </article>
    );
  }

  return (
    <div className="eco-customer-analytics">
      {toast && (
        <div className="eco-ca-toast">
          <div>
            <span>{toast}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Закрыть уведомление">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <header className="eco-page-head eco-ca-head">
        <div>
          <nav className="eco-page-crumbs">
            <Link href="/cabinet">Кабинет</Link>
            <span className="sep">/</span>
            <span className="cur">Аналитика клиентов</span>
          </nav>
          <h1 className="eco-page-title">Аналитика клиентов</h1>
          <p className="eco-page-subtitle">
            Клиенты, повторные визиты, выручка и активность по локальной базе.
          </p>
        </div>
        <div className="eco-page-actions">
          <button type="button" onClick={() => void fetchPayload()} disabled={loading} className="eco-btn eco-btn--primary">
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            Обновить данные
          </button>
          <button type="button" onClick={exportCsv} disabled={!payload} className="eco-btn">
            <Download size={16} />
            CSV
          </button>
          <button type="button" onClick={() => void exportXlsx()} disabled={!payload} className="eco-btn">
            <FileSpreadsheet size={16} />
            Excel
          </button>
          <button type="button" onClick={() => setShowMobileFilters(true)} className="eco-btn eco-ca-mobile-filter-btn">
            <SlidersHorizontal size={16} />
            Фильтры
          </button>
        </div>
      </header>

      <div className="eco-ca-filter-shell">{filtersPanel}</div>

      {showMobileFilters && (
        <div className="eco-ca-mobile-sheet" role="dialog" aria-modal="true" onClick={() => setShowMobileFilters(false)}>
          <div className="eco-ca-mobile-sheet__panel" onClick={(event) => event.stopPropagation()}>
            <div className="eco-ca-mobile-sheet__head">
              <strong>Фильтры</strong>
              <button type="button" onClick={() => setShowMobileFilters(false)}>
                <X size={18} />
              </button>
            </div>
            {filtersPanel}
          </div>
        </div>
      )}

      {loadError && (
        <section className="eco-ca-alert eco-ca-alert--danger">
          <div>
            <div>
              <h2>Не удалось загрузить аналитику клиентов</h2>
              <p>{loadError}</p>
            </div>
            <button type="button" onClick={() => void fetchPayload()} className="eco-btn eco-btn--primary">
              <RefreshCw size={16} /> Повторить
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <Skeleton />
      ) : payload ? (
        <>
          <nav className="eco-ca-tabs" aria-label="Разделы аналитики клиентов">
            {tabItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openTab(item.id)}
                className={activeTab === item.id ? "is-active" : ""}
              >
                {item.label}
                {typeof item.count === "number" && <span>{item.count}</span>}
              </button>
            ))}
          </nav>

          {payload.kpis.totalClients === 0 ? (
            <section className="eco-ca-empty-state">
              <h2>Локальная база клиентов пока пуста</h2>
              <p>Создайте клиентов вручную или загрузите данные из локальных отгрузок.</p>
            </section>
          ) : payload.kpis.clientsInPeriod === 0 ? (
            <section className="eco-ca-alert eco-ca-alert--warning">
              <h2>Нет данных по клиентам за выбранный период</h2>
              <p>Измените период или проверьте локальные проведённые отгрузки. Спящие и CRM-клиенты всё равно доступны во вкладках.</p>
            </section>
          ) : null}

          {activeTab === "overview" && (
            <div className="eco-ca-dashboard">
              <section className="eco-ca-kpi-grid">
                {[
                  ["Клиентов", String(payload.kpis.clientsInPeriod), "за выбранный период", `${filteredClients.length} в выборке`],
                  ["Новые", String(payload.kpis.newClients), "первый визит", `${payload.kpis.clientsInPeriod > 0 ? Math.round((payload.kpis.newClients / payload.kpis.clientsInPeriod) * 100) : 0}% периода`],
                  ["Повторные", String(payload.kpis.repeatClients), "2+ визита", `${payload.kpis.clientsInPeriod > 0 ? Math.round((payload.kpis.repeatClients / payload.kpis.clientsInPeriod) * 100) : 0}% периода`],
                  ["Постоянные", String(payload.kpis.regularClients), "3+ визита", `${payload.settings.regularVisitThreshold}+ визита`],
                  ["Спящие", String(payload.kpis.sleepingClients), `не были ${inactiveDays}+ дней`, "требуют возврата"],
                  ["Визитов / отгрузок", String(payload.kpis.visits), "проведённые локально", `${payload.kpis.activeClients} активных`],
                  ["Выручка", formatRub(payload.kpis.totalRevenueCents), "за период", `${formatRub(payload.kpis.totalProfitCents)} прибыль`],
                  ["Средний чек", formatRub(payload.kpis.avgCheckCents), "выручка / визиты", "по отгрузкам"],
                  ["Средняя прибыль", formatRub(payload.kpis.avgProfitPerVisitCents), payload.clients.some((client) => client.hasIncompleteCost) ? "есть строки без закупки" : "на визит", "контроль маржи"],
                  ["Интервал", payload.kpis.avgDaysBetweenVisits != null ? `${payload.kpis.avgDaysBetweenVisits} дн.` : "—", "между визитами", "ритм возврата"],
                ].map(([label, value, hint, secondary]) => (
                  <article key={label} className="eco-ca-kpi">
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>{hint}</small>
                    <em>{secondary}</em>
                  </article>
                ))}
              </section>

              <section className="eco-ca-overview-grid">
                <article className="eco-ca-panel eco-ca-panel--chart">
                  <div className="eco-ca-panel-head">
                    <div>
                      <h2>Клиенты по дням</h2>
                      <p>Новые, повторные и общее число клиентов в выбранном периоде.</p>
                    </div>
                    <div className="eco-ca-mini-periods">
                      {(["7d", "30d", "90d", "year"] as const).map((preset) => (
                        <button key={preset} type="button" className={periodPreset === preset ? "is-active" : ""} onClick={() => setPeriodPreset(preset)}>
                          {preset === "year" ? "Год" : preset.replace("d", "д")}
                        </button>
                      ))}
                    </div>
                  </div>
                  {renderDailyChart()}
                </article>

                <article className="eco-ca-panel eco-ca-panel--attention">
                  <div className="eco-ca-panel-head">
                    <div>
                      <h2>На что обратить внимание</h2>
                      <p>Быстрые рабочие сигналы по базе.</p>
                    </div>
                    <BellPlus size={18} />
                  </div>
                  <div className="eco-ca-insight-grid">
                    {payload.insights.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => applyQuickFilter(item.quickFilter)}
                        className={quickFilter === item.quickFilter ? "is-active" : ""}
                      >
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </button>
                    ))}
                  </div>
                </article>

                <article className="eco-ca-panel eco-ca-panel--repeat">
                  <div className="eco-ca-panel-head">
                    <div>
                      <h2>Повторные визиты</h2>
                      <p>Доля возврата и риск ухода.</p>
                    </div>
                    <BarChart3 size={18} />
                  </div>
                  <div className="eco-ca-mini-kpis">
                    <div>
                      <span>Доля повторных</span>
                      <strong>
                        {payload.kpis.clientsInPeriod > 0 ? Math.round((payload.kpis.repeatClients / payload.kpis.clientsInPeriod) * 100) : 0}%
                      </strong>
                    </div>
                    <div>
                      <span>Средний интервал</span>
                      <strong>{payload.kpis.avgDaysBetweenVisits != null ? `${payload.kpis.avgDaysBetweenVisits} дн.` : "—"}</strong>
                    </div>
                    <div>
                      <span>Вернулись за 90 дней</span>
                      <strong>{repeatReturned90}</strong>
                    </div>
                    <div>
                      <span>Давно не возвращались</span>
                      <strong>{payload.kpis.sleepingClients}</strong>
                    </div>
                  </div>
                </article>

                <article className="eco-ca-panel">
                  <div className="eco-ca-panel-head">
                    <div>
                      <h2>Распределение клиентов</h2>
                      <p>Основные сегменты без лишних статусов.</p>
                    </div>
                  </div>
                  {renderSegmentBars()}
                </article>

                <article className="eco-ca-panel">
                  <div className="eco-ca-panel-head">
                    <div>
                      <h2>Частые услуги</h2>
                      <p>Топ-5 по визитам и выручке.</p>
                    </div>
                    <button type="button" onClick={() => openTab("services")}>Все услуги</button>
                  </div>
                  {renderServiceBars(5)}
                </article>

                <article className="eco-ca-panel eco-ca-panel--clients">
                  <div className="eco-ca-panel-head">
                    <div>
                      <h2>Топ клиентов по выручке</h2>
                      <p>5 клиентов с максимальной выручкой в выборке.</p>
                    </div>
                    <button type="button" onClick={() => applyQuickFilter("top_revenue")}>Показать всех</button>
                  </div>
                  <div className="eco-ca-client-list">
                    {topRevenueClients.length === 0 ? <p className="eco-ca-empty">Выручка появится после локальных отгрузок.</p> : topRevenueClients.map((client) => renderPreviewClient(client, "revenue"))}
                  </div>
                </article>

                <article className="eco-ca-panel eco-ca-panel--clients eco-ca-panel--warning">
                  <div className="eco-ca-panel-head">
                    <div>
                      <h2>Спящие клиенты</h2>
                      <p>Первые 5 клиентов, которым нужен возврат.</p>
                    </div>
                    <button type="button" onClick={() => openTab("sleeping")}>Показать всех</button>
                  </div>
                  <div className="eco-ca-client-list">
                    {sleepingClients.length === 0 ? <p className="eco-ca-empty">Нет спящих клиентов по текущим фильтрам.</p> : sleepingClients.slice(0, 5).map((client) => renderPreviewClient(client, "sleeping"))}
                  </div>
                </article>

                <article className="eco-ca-panel eco-ca-panel--duplicates">
                  <div className="eco-ca-panel-head">
                    <div>
                      <h2>Возможные дубли</h2>
                      <p>Найдено {payload.duplicates.length} подозрений.</p>
                    </div>
                    <button type="button" onClick={() => openTab("duplicates")}>Проверить</button>
                  </div>
                  <div className="eco-ca-duplicate-list">
                    {payload.duplicates.length === 0 ? (
                      <p className="eco-ca-empty">Подозрительных дублей нет.</p>
                    ) : (
                      payload.duplicates.slice(0, 6).map((item) => (
                        <div key={item.id}>
                          <strong>{item.title}</strong>
                          <span>{item.subtitle}</span>
                        </div>
                      ))
                    )}
                  </div>
                </article>
              </section>
            </div>
          )}

          {activeTab === "clients" && renderClientTable("Текущая таблица учитывает период, поиск, источники, услуги и быстрые выборки.")}
          {activeTab === "sleeping" && renderClientTable(`Клиенты, которые раньше были, но не приезжали ${inactiveDays}+ дней.`)}

          {activeTab === "duplicates" && (
            <section className="eco-ca-panel eco-ca-panel--wide">
              <div className="eco-ca-panel-head">
                <div>
                  <h2>Возможные дубли клиентов</h2>
                  <p>Проверка по совпадающим телефонам, источникам и похожим карточкам.</p>
                </div>
                <span className="eco-ca-badge eco-ca-badge--warning">{payload.duplicates.length} подозрений</span>
              </div>
              <div className="eco-ca-duplicates-grid">
                {payload.duplicates.length === 0 ? (
                  <div className="eco-ca-empty-state">Возможные дубли не найдены.</div>
                ) : (
                  payload.duplicates.map((item) => (
                    <article key={item.id} className="eco-ca-duplicate-card">
                      <strong>{item.title}</strong>
                      <span>{item.subtitle}</span>
                      <div>
                        {item.sources.map((source) => (
                          <em key={source}>{sourceLabel(source)}</em>
                        ))}
                      </div>
                      <footer>
                        <Link href={`/clients/counterparties?search=${encodeURIComponent(item.title)}`} className="eco-btn eco-btn--primary">
                          Открыть карточки
                        </Link>
                        <button type="button" className="eco-btn">Не дубль</button>
                      </footer>
                    </article>
                  ))
                )}
              </div>
            </section>
          )}

          {activeTab === "services" && (
            <section className="eco-ca-service-layout">
              <article className="eco-ca-panel">
                <div className="eco-ca-panel-head">
                  <div>
                    <h2>Частые услуги</h2>
                    <p>Что чаще всего делают клиенты в выбранном периоде.</p>
                  </div>
                </div>
                {renderServiceBars()}
              </article>
              <article className="eco-ca-panel eco-ca-panel--chart">
                <div className="eco-ca-panel-head">
                  <div>
                    <h2>Клиенты по дням</h2>
                    <p>Новые клиенты, повторные визиты и общий поток.</p>
                  </div>
                </div>
                {renderDailyChart(true)}
              </article>
            </section>
          )}
        </>
      ) : null}

      {drawerClient && (
        <div className="eco-ca-drawer-backdrop" role="dialog" aria-modal="true" onClick={() => setDrawerKey(null)}>
          <aside className="eco-ca-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="eco-ca-drawer__head">
              <div className="eco-ca-drawer-titlebar">
                <div className="eco-ca-drawer__identity">
                  <div className="eco-ca-drawer__name-row">
                    <h2>{drawerClient.displayName}</h2>
                    <span className={segmentClass(drawerClient.segment)}>{statusLabel(drawerClient.segment)}</span>
                  </div>
                  <p>{formatPhoneDisplay(drawerClient.phone)} · последняя активность {formatDate(drawerClient.lastVisitGlobal)}</p>
                </div>
                <button type="button" onClick={() => setDrawerKey(null)} className="eco-icon-btn" aria-label="Закрыть">
                  <X size={18} />
                </button>
              </div>
              <div className="eco-ca-drawer__actions">
                <button type="button" onClick={() => void createReminder(drawerClient)} className="eco-btn eco-btn--primary">
                  <BellPlus size={15} /> Создать дело
                </button>
                <Link href="/records" className="eco-btn">
                  <CalendarPlus size={15} /> Записать клиента
                </Link>
                <Link href={createShipmentHref(drawerClient)} className="eco-btn">
                  <PackagePlus size={15} /> Создать отгрузку
                </Link>
                {drawerClient.phone && (
                  <button type="button" onClick={() => void copyPhone(drawerClient)} className="eco-btn">
                    <Phone size={15} /> Скопировать телефон
                  </button>
                )}
              </div>
            </div>

            <div className="eco-ca-drawer__body">
              <section>
                <h3 className="eco-page-kicker">Сводка</h3>
                <div className="eco-ca-drawer-kpis">
                  {[
                    ["Визитов", String(drawerClient.visitCountAllTime)],
                    ["Выручка", formatRub(drawerClient.revenueAllTimeCents)],
                    ["Прибыль", formatRub(drawerClient.profitAllTimeCents)],
                    ["Средний чек", formatRub(drawerClient.avgCheckAllTimeCents)],
                    ["Последний визит", formatDate(drawerClient.lastVisitGlobal)],
                    ["Дней с визита", drawerClient.daysSinceLastVisit != null ? String(drawerClient.daysSinceLastVisit) : "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="eco-ca-drawer-card">
                      <div>{label}</div>
                      <div className="eco-ca-drawer-value">{value}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="eco-page-kicker">Авто</h3>
                <div className="eco-ca-drawer-stack eco-ca-drawer-stack--compact">
                  {(history?.vehicles.length ? history.vehicles : drawerClient.vehicles).length === 0 ? (
                    <p className="eco-ca-drawer-note">Автомобиль не указан.</p>
                  ) : (
                    (history?.vehicles.length ? history.vehicles : drawerClient.vehicles).map((vehicle) => (
                      <div key={vehicle.id} className="eco-ca-drawer-card">
                        <div className="eco-ca-drawer-title">{vehicle.label}</div>
                        <div className="eco-ca-drawer-muted">
                          {[vehicle.plate ? `Госномер ${vehicle.plate}` : null, vehicle.vin ? `VIN ${vehicle.vin}` : null, sourceLabel(vehicle.source)].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section>
                <h3 className="eco-page-kicker">История</h3>
                {historyLoading ? (
                  <p className="eco-ca-drawer-note">Загружаем историю...</p>
                ) : history?.demands.length ? (
                  <div className="eco-ca-drawer-stack">
                    {history.demands.map((demand) => {
                      const open = expandedDocs.has(demand.id);
                      return (
                        <div key={demand.id} className="eco-ca-drawer-card eco-ca-drawer-card--border">
                          <div className="eco-ca-drawer-doc-head">
                            <div>
                              <div className="eco-ca-drawer-title">{formatDate(demand.documentDate)}</div>
                              <div className="eco-ca-drawer-muted">{demand.name}</div>
                              {demand.services.length > 0 && <div className="eco-ca-drawer-muted">{demand.services.map((service) => service.name).join(", ")}</div>}
                            </div>
                            <div className="eco-ca-drawer-doc-total">
                              <div>{formatRub(demand.sumCents)}</div>
                              <span>прибыль {formatRub(demand.profitCents)}</span>
                            </div>
                          </div>
                          <div className="eco-ca-drawer-link-row">
                            <Link href={`/shipment/${demand.id}`} className="eco-ca-link">
                              Открыть отгрузку <ExternalLink size={12} />
                            </Link>
                            <button type="button" onClick={() => setExpandedDocs((prev) => {
                              const next = new Set(prev);
                              if (next.has(demand.id)) next.delete(demand.id);
                              else next.add(demand.id);
                              return next;
                            })} className="eco-ca-link">
                              {open ? "Скрыть состав" : "Состав документа"}
                            </button>
                          </div>
                          {open && (
                            <ul className="eco-ca-drawer-lines">
                              {demand.positions.map((position, index) => (
                                <li key={`${position.name}-${index}`} className="eco-ca-drawer-line">
                                  <span>{position.name} ×{position.quantity}</span>
                                  <span>{formatRub(position.revenueCents)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="eco-ca-drawer-note">Проведённых локальных отгрузок пока нет.</p>
                )}
              </section>

              <section>
                <h3 className="eco-page-kicker">CRM-дела</h3>
                {historyLoading ? (
                  <p className="eco-ca-drawer-note">Загружаем CRM...</p>
                ) : history?.crmCases.length ? (
                  <div className="eco-ca-drawer-stack eco-ca-drawer-stack--compact">
                    {history.crmCases.map((item) => (
                      <div key={item.id} className="eco-ca-drawer-card">
                        <div className="eco-ca-drawer-case-head">
                          <strong>{item.title}</strong>
                          <span className="eco-ca-badge eco-ca-badge--neutral">{item.status === "open" ? "Открыто" : "Закрыто"}</span>
                        </div>
                        <div className="eco-ca-drawer-case-meta">
                          {[item.nextAction, item.nextContactAt ? formatDateTime(item.nextContactAt) : null, item.responsibleLogin].filter(Boolean).join(" · ") || "Следующий шаг не указан"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="eco-ca-drawer-note">Открытых CRM-дел нет.</p>
                )}
              </section>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
