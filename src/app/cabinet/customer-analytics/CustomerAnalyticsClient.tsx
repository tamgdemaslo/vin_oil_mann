"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type ClientStatus =
  | "new"
  | "repeat"
  | "sleeping"
  | "regular"
  | "vip"
  | "sleeping_regular"
  | "sleeping_vip";

type ClientRow = {
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

type Kpis = {
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

type Payload = {
  generatedAt: string;
  dateFrom: string | null;
  dateTo: string | null;
  todayYmd: string;
  sync: { lastSyncedAt: string | null; lastError: string | null; demandsSynced: number };
  services: { id: string; name: string }[];
  kpis: Kpis;
  clients: ClientRow[];
  settings: {
    inactiveDaysThreshold: number;
    regularVisitThreshold: number;
    vipThresholdCents: number | null;
    vipMetric: string;
    vipWindow: string;
  };
};

type SyncStatus = {
  isRunning: boolean;
  mode: "full" | "incremental" | "latest_test" | null;
  phase: "idle" | "scanning" | "syncing" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  processedDemands: number;
  totalDemands: number | null;
  scannedDemands: number;
  lastDemandId: string | null;
  lastDemandName: string | null;
  message: string | null;
  error: string | null;
};

const STORAGE_KEY = "customer-analytics-ui-state";

function readPersisted(userLogin: string): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${userLogin}`);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

type PeriodPreset = "today" | "7d" | "30d" | "90d" | "365d" | "all" | "custom";

type SortField =
  | "lastVisitInPeriod"
  | "firstVisitInPeriod"
  | "visitCount"
  | "revenueCents"
  | "profitCents"
  | "avgRevenuePerVisitCents"
  | "avgProfitPerVisitCents"
  | "daysSinceLastVisit"
  | "displayName"
  | "normalizedPhone"
  | "statuses"
  | "avgDaysBetweenVisits";

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
    case "365d":
      return { from: addDaysYmd(today, -364), to: today };
    case "all":
      return { from: null, to: null };
    case "custom":
      return { from: customFrom.trim() || null, to: customTo.trim() || null };
    default:
      return { from: null, to: null };
  }
}

function formatRub(cents: number): string {
  return (
    new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(cents / 100) + " ₽"
  );
}

function formatPhoneDisplay(key: string): string {
  if (key.length === 11 && key.startsWith("7")) {
    return `+7 ${key.slice(1, 4)} ${key.slice(4, 7)}-${key.slice(7, 9)}-${key.slice(9)}`;
  }
  return key;
}

function statusLabel(s: ClientStatus): string {
  switch (s) {
    case "new":
      return "Новый";
    case "repeat":
      return "Повторный";
    case "sleeping":
      return "Спящий";
    case "regular":
      return "Постоянный";
    case "vip":
      return "VIP";
    case "sleeping_regular":
      return "Спящий, постоянный";
    case "sleeping_vip":
      return "Спящий, VIP";
    default:
      return s;
  }
}

function rowTone(
  daysSince: number | null,
  inactiveThreshold: number
): "green" | "amber" | "red" {
  if (daysSince == null) return "green";
  if (daysSince > inactiveThreshold) return "red";
  if (daysSince > 90) return "amber";
  return "green";
}

function rowClass(tone: "green" | "amber" | "red"): string {
  if (tone === "red") return "bg-red-50/90 dark:bg-red-950/30";
  if (tone === "amber") return "bg-amber-50/90 dark:bg-amber-950/25";
  return "bg-emerald-50/60 dark:bg-emerald-950/20";
}

function syncPhaseLabel(sync: SyncStatus | null): string {
  if (!sync) return "—";
  if (sync.isRunning && sync.phase === "idle") return "Запуск";
  if (sync.isRunning && sync.phase === "scanning") return "Поиск изменений";
  if (sync.isRunning && sync.phase === "syncing") return "Синхронизация";
  if (sync.phase === "done") return "Завершено";
  if (sync.phase === "error") return "Ошибка";
  return "Ожидание";
}

function downloadCsv(filename: string, rows: string[][]) {
  const bom = "\uFEFF";
  const esc = (cell: string) => {
    if (/[",\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
    return cell;
  };
  const body = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob([bom + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CustomerAnalyticsClient({ userLogin }: { userLogin: string }) {
  const [mounted, setMounted] = useState(false);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);

  const [phoneSearch, setPhoneSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [visitsMin, setVisitsMin] = useState("");
  const [visitsMax, setVisitsMax] = useState("");
  const [daysSinceMin, setDaysSinceMin] = useState("");
  const [daysSinceMax, setDaysSinceMax] = useState("");
  const [revenueMin, setRevenueMin] = useState("");
  const [revenueMax, setRevenueMax] = useState("");
  const [profitMin, setProfitMin] = useState("");
  const [profitMax, setProfitMax] = useState("");

  const [sortField, setSortField] = useState<SortField>("revenueCents");
  const [sortDesc, setSortDesc] = useState(true);

  const [drawerPhone, setDrawerPhone] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyDemands, setHistoryDemands] = useState<
    {
      id: string;
      name: string;
      documentDate: string;
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
    }[]
  >([]);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(() => new Set());

  const skipNextPersist = useRef(true);
  const syncWasRunningRef = useRef(false);
  useEffect(() => {
    setMounted(true);
    skipNextPersist.current = false;
  }, []);

  useEffect(() => {
    const persisted = readPersisted(userLogin);
    if (typeof persisted.periodPreset === "string") setPeriodPreset(persisted.periodPreset as PeriodPreset);
    if (typeof persisted.customFrom === "string") setCustomFrom(persisted.customFrom);
    if (typeof persisted.customTo === "string") setCustomTo(persisted.customTo);
    if (Array.isArray(persisted.selectedServices)) setSelectedServices(persisted.selectedServices as string[]);
    if (typeof persisted.phoneSearch === "string") setPhoneSearch(persisted.phoneSearch);
    if (Array.isArray(persisted.statusFilter)) setStatusFilter(persisted.statusFilter as string[]);
    if (typeof persisted.visitsMin === "string") setVisitsMin(persisted.visitsMin);
    if (typeof persisted.visitsMax === "string") setVisitsMax(persisted.visitsMax);
    if (typeof persisted.daysSinceMin === "string") setDaysSinceMin(persisted.daysSinceMin);
    if (typeof persisted.daysSinceMax === "string") setDaysSinceMax(persisted.daysSinceMax);
    if (typeof persisted.revenueMin === "string") setRevenueMin(persisted.revenueMin);
    if (typeof persisted.revenueMax === "string") setRevenueMax(persisted.revenueMax);
    if (typeof persisted.profitMin === "string") setProfitMin(persisted.profitMin);
    if (typeof persisted.profitMax === "string") setProfitMax(persisted.profitMax);
    if (typeof persisted.sortField === "string") setSortField(persisted.sortField as SortField);
    if (typeof persisted.sortDesc === "boolean") setSortDesc(persisted.sortDesc);
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
      const res = await fetch(`/api/analytics/customers?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        const hint = typeof data.hint === "string" ? data.hint : "";
        setLoadError([data.error ?? "Ошибка загрузки", hint].filter(Boolean).join(" "));
        setPayload(null);
        return;
      }
      setPayload(data as Payload);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Ошибка сети");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, servicesQuery]);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics/customers/sync-status", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data?.sync) {
        setSyncStatus(data.sync as SyncStatus);
      }
    } catch {
      /* ignore status polling errors */
    }
  }, []);

  useEffect(() => {
    void fetchPayload();
  }, [fetchPayload]);

  useEffect(() => {
    void fetchSyncStatus();
  }, [fetchSyncStatus]);

  useEffect(() => {
    if (!syncStatus?.isRunning) {
      if (syncWasRunningRef.current) {
        syncWasRunningRef.current = false;
        setSyncing(false);
        void fetchPayload();
      }
      return;
    }
    syncWasRunningRef.current = true;
    setSyncing(true);
    const timer = window.setInterval(() => {
      void fetchSyncStatus();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [syncStatus?.isRunning, fetchPayload, fetchSyncStatus]);

  useEffect(() => {
    if (skipNextPersist.current) return;
    const state = {
      periodPreset,
      customFrom,
      customTo,
      selectedServices,
      phoneSearch,
      statusFilter,
      visitsMin,
      visitsMax,
      daysSinceMin,
      daysSinceMax,
      revenueMin,
      revenueMax,
      profitMin,
      profitMax,
      sortField,
      sortDesc,
    };
    try {
      localStorage.setItem(`${STORAGE_KEY}:${userLogin}`, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [
    userLogin,
    periodPreset,
    customFrom,
    customTo,
    selectedServices,
    phoneSearch,
    statusFilter,
    visitsMin,
    visitsMax,
    daysSinceMin,
    daysSinceMax,
    revenueMin,
    revenueMax,
    profitMin,
    profitMax,
    sortField,
    sortDesc,
  ]);

  async function runSync(forceFull = false, latestLimit?: number) {
    setSyncing(true);
    setLoadError(null);
    setSyncStatus({
      isRunning: true,
      mode: latestLimit != null ? "latest_test" : forceFull ? "full" : null,
      phase: "idle",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      processedDemands: 0,
      totalDemands: null,
      scannedDemands: 0,
      lastDemandId: null,
      lastDemandName: null,
      message:
        latestLimit != null
          ? `Запуск тестовой синхронизации последних ${latestLimit} отгрузок…`
          : forceFull
            ? "Запуск полной пересинхронизации…"
            : "Запуск синхронизации…",
      error: null,
    });
    try {
      const res = await fetch("/api/analytics/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceFull, latestLimit }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error ?? "Ошибка синхронизации");
        setSyncing(false);
        return;
      }
      if (data?.sync) {
        setSyncStatus(data.sync as SyncStatus);
      }
      if (data?.started === false && data?.sync?.isRunning) {
        setLoadError("Синхронизация уже выполняется");
      } else if (latestLimit != null) {
        setLoadError(`Запущен тестовый режим: последние ${latestLimit} отгрузок заменят текущий слепок аналитики.`);
      } else if (forceFull) {
        setLoadError("Запущена полная пересинхронизация. Это может занять заметно больше времени.");
      }
      void fetchSyncStatus();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Ошибка сети");
      setSyncing(false);
    }
  }

  const inactiveThreshold = payload?.settings.inactiveDaysThreshold ?? 365;

  const filteredSorted = useMemo(() => {
    if (!payload) return [];
    const phoneNorm = phoneSearch.replace(/\D/g, "");
    const vmin = visitsMin.trim() ? parseInt(visitsMin, 10) : null;
    const vmax = visitsMax.trim() ? parseInt(visitsMax, 10) : null;
    const dmin = daysSinceMin.trim() ? parseInt(daysSinceMin, 10) : null;
    const dmax = daysSinceMax.trim() ? parseInt(daysSinceMax, 10) : null;
    const rminRub = revenueMin.trim() ? parseFloat(revenueMin.replace(",", ".")) : null;
    const rmaxRub = revenueMax.trim() ? parseFloat(revenueMax.replace(",", ".")) : null;
    const pminRub = profitMin.trim() ? parseFloat(profitMin.replace(",", ".")) : null;
    const pmaxRub = profitMax.trim() ? parseFloat(profitMax.replace(",", ".")) : null;

    let list = payload.clients.filter((c) => {
      if (phoneNorm && !c.normalizedPhone.includes(phoneNorm)) return false;
      if (statusFilter.length > 0 && !c.statuses.some((s) => statusFilter.includes(s))) return false;
      if (vmin != null && !Number.isNaN(vmin) && c.visitCount < vmin) return false;
      if (vmax != null && !Number.isNaN(vmax) && c.visitCount > vmax) return false;
      const ds = c.daysSinceLastVisit;
      if (dmin != null && !Number.isNaN(dmin) && (ds == null || ds < dmin)) return false;
      if (dmax != null && !Number.isNaN(dmax) && (ds == null || ds > dmax)) return false;
      const revRub = c.revenueCents / 100;
      const profRub = c.profitCents / 100;
      if (rminRub != null && !Number.isNaN(rminRub) && revRub < rminRub) return false;
      if (rmaxRub != null && !Number.isNaN(rmaxRub) && revRub > rmaxRub) return false;
      if (pminRub != null && !Number.isNaN(pminRub) && profRub < pminRub) return false;
      if (pmaxRub != null && !Number.isNaN(pmaxRub) && profRub > pmaxRub) return false;
      return true;
    });

    const mul = sortDesc ? -1 : 1;
    list = [...list].sort((a, b) => {
      if (sortField === "statuses") {
        const as = a.statuses.map(statusLabel).join(", ");
        const bs = b.statuses.map(statusLabel).join(", ");
        return as.localeCompare(bs, "ru") * mul;
      }
      if (sortField === "avgDaysBetweenVisits") {
        const av = a.avgDaysBetweenVisits;
        const bv = b.avgDaysBetweenVisits;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return av < bv ? -mul : av > bv ? mul : 0;
      }
      const av = a[sortField];
      const bv = b[sortField];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return av < bv ? -mul : av > bv ? mul : 0;
      return String(av).localeCompare(String(bv), "ru") * mul;
    });

    return list;
  }, [
    payload,
    phoneSearch,
    statusFilter,
    visitsMin,
    visitsMax,
    daysSinceMin,
    daysSinceMax,
    revenueMin,
    revenueMax,
    profitMin,
    profitMax,
    sortField,
    sortDesc,
  ]);

  const kpiFromFiltered = useMemo(() => {
    const totalClients = filteredSorted.length;
    const totalVisits = filteredSorted.reduce((s, c) => s + c.visitCount, 0);
    const totalRevenueCents = filteredSorted.reduce((s, c) => s + c.revenueCents, 0);
    const totalProfitCents = filteredSorted.reduce((s, c) => s + c.profitCents, 0);
    const newC = filteredSorted.filter((c) => c.visitCount === 1).length;
    const rep = filteredSorted.filter((c) => c.visitCount >= 2).length;
    const sleep = filteredSorted.filter(
      (c) => c.daysSinceLastVisit != null && c.daysSinceLastVisit > inactiveThreshold
    ).length;
    return {
      totalClients,
      newClients: newC,
      repeatClients: rep,
      sleepingClients: sleep,
      avgVisitsPerClient: totalClients > 0 ? Math.round((totalVisits / totalClients) * 100) / 100 : 0,
      totalRevenueCents,
      totalProfitCents,
      avgRevenuePerClientCents: totalClients > 0 ? Math.round(totalRevenueCents / totalClients) : 0,
      avgProfitPerClientCents: totalClients > 0 ? Math.round(totalProfitCents / totalClients) : 0,
    };
  }, [filteredSorted, inactiveThreshold]);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDesc((d) => !d);
    else {
      setSortField(field);
      setSortDesc(field === "displayName" || field === "normalizedPhone" ? false : true);
    }
  }

  async function openDrawer(phone: string) {
    setDrawerPhone(phone);
    setHistoryLoading(true);
    setHistoryDemands([]);
    setExpandedDocs(new Set());
    try {
      const qs = new URLSearchParams({ phone });
      if (dateFrom) qs.set("dateFrom", dateFrom);
      if (dateTo) qs.set("dateTo", dateTo);
      if (servicesQuery) qs.set("services", servicesQuery);
      const res = await fetch(`/api/analytics/customers/history?${qs.toString()}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.demands)) {
        setHistoryDemands(data.demands);
      }
    } finally {
      setHistoryLoading(false);
    }
  }

  function exportCsv() {
    const header = [
      "Клиент",
      "Телефон",
      "Первый визит",
      "Последний визит",
      "Дней с визита",
      "Визитов",
      "Выручка",
      "Прибыль",
      "Ср. выручка за визит",
      "Ср. прибыль за визит",
      "Ср. интервал дней",
      "Статусы",
      "Неполные данные себестоимости",
    ];
    const rows = filteredSorted.map((c) => [
      c.displayName,
      c.normalizedPhone,
      c.firstVisitInPeriod ?? "",
      c.lastVisitInPeriod ?? "",
      c.daysSinceLastVisit != null ? String(c.daysSinceLastVisit) : "",
      String(c.visitCount),
      String(c.revenueCents / 100),
      String(c.profitCents / 100),
      String(c.avgRevenuePerVisitCents / 100),
      String(c.avgProfitPerVisitCents / 100),
      c.avgDaysBetweenVisits != null ? String(c.avgDaysBetweenVisits) : "",
      c.statuses.map(statusLabel).join("; "),
      c.hasIncompleteCost ? "да" : "нет",
    ]);
    downloadCsv(`clients-analytics-${localYmd(new Date())}.csv`, [header, ...rows]);
  }

  const drawerClient = drawerPhone ? payload?.clients.find((c) => c.normalizedPhone === drawerPhone) : null;
  const visibleSyncStatus =
    syncStatus ??
    (syncing
      ? {
          isRunning: true,
          mode: null,
          phase: "idle",
          startedAt: null,
          finishedAt: null,
          processedDemands: 0,
          totalDemands: null,
          scannedDemands: 0,
          lastDemandId: null,
          lastDemandName: null,
          message: "Запуск синхронизации…",
          error: null,
        }
      : null);
  const syncProgressPercent =
    visibleSyncStatus?.totalDemands && visibleSyncStatus.totalDemands > 0
      ? Math.max(
          0,
          Math.min(100, Math.round((visibleSyncStatus.processedDemands / visibleSyncStatus.totalDemands) * 100))
        )
      : null;

  if (!mounted) {
    return <div className="min-h-[320px]" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Аналитика по клиентам</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Данные из МойСклад: отгрузки и контрагенты. Клиент = нормализованный телефон. Обновите синхронизацию перед
            отчётом.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runSync(false)}
            disabled={syncing}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-700"
          >
            {syncing ? "Синхронизация…" : "Обновить из МойСклад"}
          </button>
          <button
            type="button"
            onClick={() => void runSync(true)}
            disabled={syncing}
            className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-50 disabled:opacity-60 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
          >
            Полная пересинхронизация
          </button>
          <button
            type="button"
            onClick={() => void runSync(false, 100)}
            disabled={syncing}
            className="rounded-lg border border-sky-300 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50 disabled:opacity-60 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/40"
          >
            Тест: последние 100
          </button>
          <button
            type="button"
            onClick={() => void fetchPayload()}
            disabled={loading}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Перезагрузить
          </button>
        </div>
      </div>

      {payload?.sync && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Последняя синхронизация:{" "}
          {payload.sync.lastSyncedAt ? new Date(payload.sync.lastSyncedAt).toLocaleString("ru-RU") : "—"}
          {payload.sync.lastError ? ` · Ошибка: ${payload.sync.lastError}` : ""}
        </p>
      )}

      {visibleSyncStatus &&
        (syncing ||
          visibleSyncStatus.isRunning ||
          visibleSyncStatus.phase === "done" ||
          visibleSyncStatus.phase === "error") && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {syncPhaseLabel(visibleSyncStatus)}
                {visibleSyncStatus.mode
                  ? ` · ${
                      visibleSyncStatus.mode === "incremental"
                        ? "Инкрементальная"
                        : visibleSyncStatus.mode === "latest_test"
                          ? "Тест: последние 100"
                          : "Полная"
                    }`
                  : ""}
              </h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {visibleSyncStatus.message ?? "Состояние синхронизации обновится автоматически"}
              </p>
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {visibleSyncStatus.startedAt ? `Старт: ${new Date(visibleSyncStatus.startedAt).toLocaleString("ru-RU")}` : ""}
            </div>
          </div>

          <div className="mt-3 grid gap-2 text-sm text-zinc-700 dark:text-zinc-300 sm:grid-cols-3">
            <div>Обработано: {visibleSyncStatus.processedDemands}</div>
            <div>
              Всего: {visibleSyncStatus.totalDemands != null ? visibleSyncStatus.totalDemands : "уточняется"}
            </div>
            <div>Просмотрено: {visibleSyncStatus.scannedDemands}</div>
          </div>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all ${
                visibleSyncStatus.phase === "error"
                  ? "bg-red-500"
                  : visibleSyncStatus.phase === "done"
                    ? "bg-emerald-500"
                    : "bg-amber-500"
              } ${syncProgressPercent == null && visibleSyncStatus.isRunning ? "animate-pulse" : ""}`}
              style={{ width: `${syncProgressPercent ?? (visibleSyncStatus.isRunning ? 35 : 0)}%` }}
            />
          </div>

          {visibleSyncStatus.lastDemandName && (
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Последняя отгрузка: {visibleSyncStatus.lastDemandName}
            </p>
          )}

          {visibleSyncStatus.error && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">Ошибка: {visibleSyncStatus.error}</p>
          )}
        </section>
      )}

      {loadError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {loadError}
        </div>
      )}

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80 sm:p-5">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Период и услуги</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ["today", "Сегодня"],
              ["7d", "7 дней"],
              ["30d", "30 дней"],
              ["90d", "90 дней"],
              ["365d", "365 дней"],
              ["all", "Всё время"],
              ["custom", "Свой"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriodPreset(key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                periodPreset === key
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {periodPreset === "custom" && (
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
              С
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
              />
            </label>
            <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
              По
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
              />
            </label>
          </div>
        )}
        <div className="mt-4">
          <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Типы услуг (мультивыбор)</label>
          <select
            multiple
            value={selectedServices}
            onChange={(e) => {
              const opts = [...e.target.selectedOptions].map((o) => o.value);
              setSelectedServices(opts);
            }}
            className="mt-1 h-28 w-full max-w-xl rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            size={6}
          >
            {(payload?.services ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">Удерживайте Cmd/Ctrl для выбора нескольких. Пусто = все услуги.</p>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Клиентов в выборке", String(kpiFromFiltered.totalClients)],
          ["Новых (1 визит)", String(kpiFromFiltered.newClients)],
          ["Повторных (2+)", String(kpiFromFiltered.repeatClients)],
          ["Спящих", String(kpiFromFiltered.sleepingClients)],
          ["Среднее визитов", String(kpiFromFiltered.avgVisitsPerClient)],
          ["Суммарная выручка", formatRub(kpiFromFiltered.totalRevenueCents)],
          ["Суммарная прибыль", formatRub(kpiFromFiltered.totalProfitCents)],
          ["Ср. выручка на клиента", formatRub(kpiFromFiltered.avgRevenuePerClientCents)],
          ["Ср. прибыль на клиента", formatRub(kpiFromFiltered.avgProfitPerClientCents)],
        ].map(([k, v]) => (
          <div
            key={k}
            className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80"
          >
            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{k}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">{v}</div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/80 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Быстрые выборки</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
              onClick={() => {
                setSortField("revenueCents");
                setSortDesc(true);
              }}
            >
              Топ по выручке
            </button>
            <button
              type="button"
              className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
              onClick={() => {
                setSortField("profitCents");
                setSortDesc(true);
              }}
            >
              Топ по прибыли
            </button>
            <button
              type="button"
              className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
              onClick={() => {
                setSortField("visitCount");
                setSortDesc(true);
              }}
            >
              Топ по визитам
            </button>
            <button
              type="button"
              className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
              onClick={() => {
                setDaysSinceMin(String(inactiveThreshold + 1));
                setDaysSinceMax("");
              }}
            >
              Давно не было
            </button>
            <button
              type="button"
              className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
              onClick={() => {
                setVisitsMin("1");
                setVisitsMax("1");
                setDaysSinceMin("");
                setDaysSinceMax("");
              }}
            >
              Только новые
            </button>
            <button
              type="button"
              className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
              onClick={() => {
                setVisitsMin("2");
                setVisitsMax("");
              }}
            >
              Только повторные
            </button>
            <button
              type="button"
              className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
              onClick={() => {
                setDaysSinceMin(String(inactiveThreshold + 1));
                setVisitsMin("");
                setVisitsMax("");
              }}
            >
              Только спящие
            </button>
            <button
              type="button"
              className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
              onClick={() => {
                setVisitsMin("");
                setVisitsMax("");
                setDaysSinceMin("");
                setDaysSinceMax("");
                setRevenueMin("");
                setRevenueMax("");
                setProfitMin("");
                setProfitMax("");
                setStatusFilter([]);
                setPhoneSearch("");
              }}
            >
              Сбросить фильтры
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/80 sm:p-5">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Фильтры таблицы</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
            Поиск по телефону
            <input
              value={phoneSearch}
              onChange={(e) => setPhoneSearch(e.target.value)}
              placeholder="Цифры номера"
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
            Статусы (Ctrl/Cmd + клик)
            <select
              multiple
              value={statusFilter}
              onChange={(e) => setStatusFilter([...e.target.selectedOptions].map((o) => o.value))}
              className="mt-1 h-24 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-950"
              size={4}
            >
              {(["new", "repeat", "sleeping", "regular", "vip", "sleeping_regular", "sleeping_vip"] as ClientStatus[]).map(
                (s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                )
              )}
            </select>
          </label>
          <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
            Визитов от
            <input
              value={visitsMin}
              onChange={(e) => setVisitsMin(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
            Визитов до
            <input
              value={visitsMax}
              onChange={(e) => setVisitsMax(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
            Дней с визита от
            <input
              value={daysSinceMin}
              onChange={(e) => setDaysSinceMin(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
            Дней с визита до
            <input
              value={daysSinceMax}
              onChange={(e) => setDaysSinceMax(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
            Выручка от (₽)
            <input
              value={revenueMin}
              onChange={(e) => setRevenueMin(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
            Выручка до (₽)
            <input
              value={revenueMax}
              onChange={(e) => setRevenueMax(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
            Прибыль от (₽)
            <input
              value={profitMin}
              onChange={(e) => setProfitMin(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
          <label className="flex flex-col text-xs text-zinc-600 dark:text-zinc-400">
            Прибыль до (₽)
            <input
              value={profitMax}
              onChange={(e) => setProfitMax(e.target.value)}
              className="mt-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-950"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="mt-4 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 dark:border-zinc-600 dark:text-zinc-100"
        >
          Экспорт CSV (текущая таблица)
        </button>
      </section>

      <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/80">
        <table className="min-w-[1200px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-400">
              {(
                [
                  ["displayName", "Клиент"],
                  ["normalizedPhone", "Телефон"],
                  ["firstVisitInPeriod", "Первый визит"],
                  ["lastVisitInPeriod", "Последний визит"],
                  ["daysSinceLastVisit", "Дней с визита"],
                  ["visitCount", "Визитов"],
                  ["revenueCents", "Выручка"],
                  ["profitCents", "Прибыль"],
                  ["avgRevenuePerVisitCents", "Ср. выручка"],
                  ["avgProfitPerVisitCents", "Ср. прибыль"],
                  ["avgDaysBetweenVisits", "Ср. интервал"],
                  ["statuses", "Статусы"],
                  ["_", "Действие"],
                ] as const
              ).map(([field, label]) => (
                <th key={label} className="px-3 py-2">
                  {field === "_" ? (
                    label
                  ) : (
                    <button type="button" className="font-semibold hover:underline" onClick={() => toggleSort(field)}>
                      {label}
                      {sortField === field ? (sortDesc ? " ▼" : " ▲") : ""}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-zinc-500">
                  Загрузка…
                </td>
              </tr>
            )}
            {!loading &&
              filteredSorted.map((c) => {
                const tone = rowTone(c.daysSinceLastVisit, inactiveThreshold);
                return (
                  <tr key={c.normalizedPhone} className={`border-b border-zinc-100 dark:border-zinc-800 ${rowClass(tone)}`}>
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-zinc-900 dark:text-zinc-50">{c.displayName}</div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-zinc-600 dark:text-zinc-400">
                        <span className="rounded bg-white/80 px-1.5 py-0.5 dark:bg-zinc-950/50">
                          {c.visitCount} визит(ов)
                        </span>
                        {c.daysSinceLastVisit != null && (
                          <span className="rounded bg-white/80 px-1.5 py-0.5 dark:bg-zinc-950/50">
                            не был {c.daysSinceLastVisit} дн.
                          </span>
                        )}
                        <span className="rounded bg-white/80 px-1.5 py-0.5 dark:bg-zinc-950/50">
                          прибыль {formatRub(c.profitCents)}
                        </span>
                        {c.hasIncompleteCost && (
                          <span className="rounded bg-amber-200/90 px-1.5 py-0.5 text-amber-950 dark:bg-amber-900/60 dark:text-amber-100">
                            себестоимость неполная
                          </span>
                        )}
                      </div>
                      {(c.primaryServiceName || c.lastServiceName) && (
                        <div className="mt-1 text-xs text-zinc-500">
                          {c.primaryServiceName && (
                            <span>
                              Осн. услуга: {c.primaryServiceName}
                              {c.primaryServiceVisitShare != null ? ` (${c.primaryServiceVisitShare}% визитов)` : ""}
                            </span>
                          )}
                          {c.lastServiceName && (
                            <span className="ml-2">Последняя: {c.lastServiceName}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">{formatPhoneDisplay(c.normalizedPhone)}</td>
                    <td className="px-3 py-2 align-top">{c.firstVisitInPeriod ?? "—"}</td>
                    <td className="px-3 py-2 align-top">{c.lastVisitInPeriod ?? "—"}</td>
                    <td className="px-3 py-2 align-top">{c.daysSinceLastVisit ?? "—"}</td>
                    <td className="px-3 py-2 align-top">{c.visitCount}</td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">{formatRub(c.revenueCents)}</td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">{formatRub(c.profitCents)}</td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">{formatRub(c.avgRevenuePerVisitCents)}</td>
                    <td className="px-3 py-2 align-top whitespace-nowrap">{formatRub(c.avgProfitPerVisitCents)}</td>
                    <td className="px-3 py-2 align-top">{c.avgDaysBetweenVisits ?? "—"}</td>
                    <td className="px-3 py-2 align-top text-xs">
                      {c.statuses.map((s) => (
                        <span
                          key={s}
                          className="mb-1 mr-1 inline-block rounded-full bg-zinc-200/90 px-2 py-0.5 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100"
                        >
                          {statusLabel(s)}
                        </span>
                      ))}
                    </td>
                    <td className="px-3 py-2 align-top">
                      <button
                        type="button"
                        onClick={() => void openDrawer(c.normalizedPhone)}
                        className="text-amber-700 underline hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-300"
                      >
                        История
                      </button>
                    </td>
                  </tr>
                );
              })}
            {!loading && filteredSorted.length === 0 && (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-zinc-500">
                  Нет данных. Выполните синхронизацию или ослабьте фильтры.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {drawerPhone && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 p-2 sm:p-4"
          role="dialog"
          aria-modal
          onClick={() => setDrawerPhone(null)}
        >
          <div
            className="flex h-full w-full max-w-lg flex-col rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-950"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div>
                <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                  {drawerClient?.displayName ?? "Клиент"}
                </h3>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{formatPhoneDisplay(drawerPhone)}</p>
                {drawerClient && (
                  <p className="mt-2 text-xs text-zinc-500">
                    Визитов в периоде: {drawerClient.visitCount} · Выручка: {formatRub(drawerClient.revenueCents)} ·
                    Прибыль: {formatRub(drawerClient.profitCents)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDrawerPhone(null)}
                className="rounded-lg px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Закрыть
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {historyLoading && <p className="text-sm text-zinc-500">Загрузка отгрузок…</p>}
              {!historyLoading &&
                historyDemands.map((d) => {
                  const open = expandedDocs.has(d.id);
                  return (
                    <div
                      key={d.id}
                      className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-700 dark:bg-zinc-900/50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-medium text-zinc-900 dark:text-zinc-50">{d.documentDate}</div>
                          <div className="text-xs text-zinc-500">{d.name}</div>
                        </div>
                        <div className="text-right text-sm">
                          <div>{formatRub(d.sumCents)}</div>
                          <div className="text-zinc-600 dark:text-zinc-400">прибыль {formatRub(d.profitCents)}</div>
                          {d.hasIncompleteCost && (
                            <div className="text-xs text-amber-700 dark:text-amber-400">неполная себестоимость</div>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Link
                          href={`/shipment/${d.id}`}
                          className="text-xs font-medium text-amber-700 underline dark:text-amber-400"
                        >
                          Открыть отгрузку
                        </Link>
                        <button
                          type="button"
                          className="text-xs font-medium text-zinc-700 underline dark:text-zinc-300"
                          onClick={() => {
                            setExpandedDocs((prev) => {
                              const n = new Set(prev);
                              if (n.has(d.id)) n.delete(d.id);
                              else n.add(d.id);
                              return n;
                            });
                          }}
                        >
                          {open ? "Скрыть состав" : "Состав документа"}
                        </button>
                      </div>
                      {open && (
                        <ul className="mt-2 space-y-1 border-t border-zinc-200 pt-2 text-xs dark:border-zinc-700">
                          {d.positions.map((p, i) => (
                            <li key={i} className="flex justify-between gap-2 text-zinc-700 dark:text-zinc-300">
                              <span>
                                {p.name}{" "}
                                <span className="text-zinc-500">
                                  ({p.assortmentType}) ×{p.quantity}
                                </span>
                                {p.lineIncompleteCost && (
                                  <span className="ml-1 text-amber-700 dark:text-amber-400">· нет закупки</span>
                                )}
                              </span>
                              <span className="shrink-0 whitespace-nowrap">
                                {formatRub(p.revenueCents)} − {formatRub(p.costCents)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
