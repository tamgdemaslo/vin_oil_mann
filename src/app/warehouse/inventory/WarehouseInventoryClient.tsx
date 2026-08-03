"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ClipboardList,
  FileDown,
  HelpCircle,
  Loader2,
  MoreHorizontal,
  PackagePlus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  ScanLine,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Undo2,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { EcoBadge, EcoButton, EcoCard, EcoInput, EcoKpi, EcoSelect, EcoTable } from "@/components/platform/EcoUI";
import { safeReadJson } from "@/lib/http-json";

const INVENTORY_CATEGORIES = [
  "Моторное масло",
  "Трансмиссионное масло",
  "Масляные фильтры",
  "Воздушные фильтры",
  "Салонные фильтры",
  "Топливные фильтры",
  "Прочее",
];

const SESSION_TABS = [
  { id: "active", label: "Активные", statuses: ["DRAFT", "COUNTING", "PAUSED", "RECOUNT_REQUIRED"] },
  { id: "review", label: "На проверке", statuses: ["REVIEW", "AWAITING_APPROVAL"] },
  { id: "posted", label: "Проведённые", statuses: ["POSTED"] },
  { id: "cancelled", label: "Отменённые", statuses: ["CANCELLED", "REVERSED"] },
  { id: "all", label: "Все", statuses: [] },
];

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Черновик",
  COUNTING: "Идёт подсчёт",
  PAUSED: "Пауза",
  RECOUNT_REQUIRED: "Нужен пересчёт",
  REVIEW: "Сверка",
  AWAITING_APPROVAL: "Ожидает владельца",
  POSTED: "Проведена",
  REVERSED: "Обратная операция",
  CANCELLED: "Отменена",
};

const LINE_STATUS_LABELS: Record<string, string> = {
  NOT_COUNTED: "Не посчитано",
  COUNTED: "Посчитано",
  ZERO_CONFIRMED: "Фактически 0",
  FOUND_OTHER_CELL: "Найден дополнительно",
  RECOUNT_REQUIRED: "Требуется пересчёт",
  PROBLEM: "Проблема",
  EXCLUDED: "Исключено",
};

const FINAL_ACTIONS = [
  { value: "NO_ACTION", label: "Никаких движений" },
  { value: "SHORTAGE_EXPENSE", label: "Обычное списание" },
  { value: "SHORTAGE_TECHNICAL", label: "Техническая корректировка" },
  { value: "SURPLUS_RECEIPT", label: "Оприходование излишка" },
  { value: "SURPLUS_TECHNICAL", label: "Техническая корректировка" },
  { value: "CELL_TRANSFER", label: "Перемещение между ячейками" },
  { value: "RECOUNT", label: "Повторный пересчёт" },
  { value: "SKIP", label: "Не проводить строку" },
];

const ACTION_HINTS: Record<string, string> = {
  SHORTAGE_EXPENSE: "Остаток уменьшится, сумма попадёт в управленческий расход.",
  SHORTAGE_TECHNICAL: "Остаток изменится, но прибыль не изменится. Используйте для исправления старых ошибок учёта.",
  SURPLUS_RECEIPT: "Остаток увеличится, товар будет оприходован на склад.",
  SURPLUS_TECHNICAL: "Остаток изменится, но прибыль не изменится. Используйте для исправления старых ошибок учёта.",
  RECOUNT: "Строка вернётся на повторный подсчёт.",
  SKIP: "По этой строке складское движение не будет создано.",
  NO_ACTION: "Расхождений нет, движение не требуется.",
  CELL_TRANSFER: "Будет оформлено перемещение между ячейками.",
};

const REASONS = [
  "Ошибка начальных остатков",
  "Ошибка импорта",
  "Ошибка миграции",
  "Товар продан, но не списан",
  "Порча",
  "Утрата",
  "Внутреннее использование",
  "Не проведена приёмка",
  "Возврат не был оформлен",
  "Перемещение без документа",
  "Ошибка единицы измерения",
  "Другое",
];

type Organization = { id: string; name: string; isDefault?: boolean };
type Store = { id: string; name: string };

type InventorySession = {
  id: string;
  number: string;
  status: string;
  countMode: "BLIND" | "QUICK";
  warehouseMode: "LOCKED" | "LIVE";
  scopeType: string;
  scope: unknown;
  options: unknown;
  organizationId: string;
  organizationName: string;
  warehouseId: string;
  warehouseName: string;
  responsibleId: string;
  createdByName: string;
  comment: string;
  totalLines: number;
  countedLines: number;
  matchingLines: number;
  shortageLines: number;
  surplusLines: number;
  recountRequiredLines: number;
  totalShortageCostCents: number;
  totalSurplusCostCents: number;
  managementExpenseCents: number;
  technicalAdjustmentCents: number;
  snapshotAt: string | null;
  startedAt: string | null;
  countingCompletedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  reversedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type InventoryLine = {
  id: string;
  inventorySessionId: string;
  productId: string | null;
  name: string;
  article: string;
  code: string;
  ean: string;
  brand: string;
  category: string;
  groupPath: string;
  imageHref: string;
  cellId: string;
  unitId: string;
  snapshotQuantity: number;
  snapshotReservedQuantity: number;
  snapshotAvailableQuantity: number;
  expectedQuantityAtCount: number;
  firstCountQuantity: number | null;
  secondCountQuantity: number | null;
  finalQuantity: number | null;
  differenceQuantity: number | null;
  unitCostSnapshotCents: number | null;
  differenceCostCents: number | null;
  countedAt: string | null;
  status: string;
  proposedAction: string;
  finalAction: string;
  reasonCode: string;
  comment: string;
  requiresRecount: boolean;
  affectsManagementProfit: boolean;
  isUnexpected: boolean;
  stockVersion: number;
};

type SessionsResponse = {
  sessions: InventorySession[];
  total: number;
  statusCounts: Record<string, number>;
  summary: {
    shortageLines: number;
    surplusLines: number;
    discrepancyCostCents: number;
    totalShortageCostCents: number;
    totalSurplusCostCents: number;
    technicalAdjustmentCents: number;
    managementExpenseCents: number;
  };
  recentDifferences: InventoryLine[];
};

type LinesResponse = { lines: InventoryLine[]; total: number };
type ReconciliationResponse = { session: InventorySession; lines: InventoryLine[]; movements: unknown[] };

type WizardState = {
  organizationId: string;
  warehouseId: string;
  startedAt: string;
  responsibleId: string;
  comment: string;
  scopeType: "WAREHOUSE" | "CATEGORIES" | "GROUPS" | "BRANDS" | "CELLS" | "PRODUCTS";
  categorySearch: string;
  categories: string[];
  groups: string;
  brands: string;
  cells: string;
  productIds: string;
  countMode: "BLIND" | "QUICK";
  warehouseMode: "LOCKED" | "LIVE";
  includeZeroStock: boolean;
  includeArchivedWithStock: boolean;
  includeUncategorized: boolean;
  includeWithoutCell: boolean;
  excludeDisabledStockTracking: boolean;
};

type SaveState = Record<string, "idle" | "saving" | "saved" | "error">;

function money(cents: number | null | undefined) {
  const value = (cents ?? 0) / 100;
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(value);
}

function qty(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if ((char === ";" || char === ",") && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCountSheetCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function statusTone(status: string): "neutral" | "rust" | "success" | "warning" | "danger" | "info" {
  if (status === "POSTED") return "success";
  if (status === "CANCELLED" || status === "REVERSED") return "neutral";
  if (status === "RECOUNT_REQUIRED" || status === "PROBLEM") return "warning";
  if (status === "AWAITING_APPROVAL" || status === "REVIEW") return "info";
  return "rust";
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = await safeReadJson<T & { error?: string }>(response);
  if (!response.ok) throw new Error(data?.error || "Запрос не выполнен");
  return data as T;
}

function defaultWizard(): WizardState {
  const local = new Date();
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return {
    organizationId: "",
    warehouseId: "",
    startedAt: local.toISOString().slice(0, 16),
    responsibleId: "",
    comment: "",
    scopeType: "CATEGORIES",
    categorySearch: "",
    categories: ["Воздушные фильтры"],
    groups: "",
    brands: "",
    cells: "",
    productIds: "",
    countMode: "BLIND",
    warehouseMode: "LOCKED",
    includeZeroStock: false,
    includeArchivedWithStock: true,
    includeUncategorized: false,
    includeWithoutCell: true,
    excludeDisabledStockTracking: true,
  };
}

type WarehouseInventoryClientProps = {
  sessionId?: string;
};

type InventoryFilters = {
  organizationId: string;
  warehouseId: string;
  status: string;
  category: string;
  onlyWithDiscrepancies: boolean;
  period: string;
  search: string;
};

const WORKFLOW_STAGES = ["Настройка", "Подсчёт", "Сверка", "Проведение"];

function sessionStage(session: InventorySession | null) {
  if (!session) return 1;
  if (session.status === "DRAFT") return 1;
  if (["COUNTING", "PAUSED", "RECOUNT_REQUIRED"].includes(session.status)) return 2;
  if (["REVIEW", "AWAITING_APPROVAL"].includes(session.status)) return 3;
  if (["POSTED", "REVERSED"].includes(session.status)) return 4;
  return 1;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(value));
}

function periodRange(period: string) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  if (period === "today") {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (period === "week") {
    const day = (now.getDay() + 6) % 7;
    start.setDate(now.getDate() - day);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (period === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(now.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  } else {
    return null;
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

function isCurrentMonth(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function scopeLabel(session: InventorySession) {
  const scope = session.scope && typeof session.scope === "object" ? session.scope as Record<string, unknown> : {};
  const type = String(scope.type || session.scopeType || "WAREHOUSE");
  if (type === "WAREHOUSE") return "Весь склад";
  if (type === "CATEGORIES") {
    const categories = Array.isArray(scope.categories) ? scope.categories.filter(Boolean).join(", ") : "";
    return categories || "Категории";
  }
  if (type === "GROUPS") return "Группы товаров";
  if (type === "BRANDS") return "Бренды";
  if (type === "CELLS") return "Ячейки";
  if (type === "PRODUCTS") return "Выбранные товары";
  return type;
}

function documentAction(session: InventorySession) {
  if (session.status === "DRAFT") return "Настроить";
  if (session.status === "PAUSED") return "Продолжить";
  if (session.status === "COUNTING" || session.status === "RECOUNT_REQUIRED") return "Продолжить подсчёт";
  if (session.status === "REVIEW" || session.status === "AWAITING_APPROVAL") return "Открыть сверку";
  if (session.status === "POSTED" || session.status === "REVERSED") return "Открыть ведомость";
  if (session.status === "CANCELLED") return "Открыть историю";
  return "Открыть";
}

function stageHint(session: InventorySession, index: number) {
  const current = sessionStage(session);
  if (index < current) return "готово";
  if (index > current) return "ожидает";
  if (index === 1) return session.status === "DRAFT" ? "сейчас" : "готово";
  if (index === 2) {
    if (session.status === "PAUSED") return "на паузе";
    if (session.status === "RECOUNT_REQUIRED") return "нужен пересчёт";
    return "сейчас";
  }
  if (index === 3) return session.status === "AWAITING_APPROVAL" ? "на подтверждении" : "сейчас";
  if (index === 4) return session.status === "POSTED" ? "проведено" : "сейчас";
  return "сейчас";
}

function nextStepText(session: InventorySession) {
  if (session.status === "DRAFT") return "Проверьте склад, область товаров и начните подсчёт.";
  if (session.status === "PAUSED") return "Подсчёт приостановлен. Можно продолжить с того же места.";
  if (session.status === "COUNTING") return "Введите фактическое количество по всем строкам и завершите подсчёт.";
  if (session.status === "RECOUNT_REQUIRED") return "Проверьте строки с проблемами и сохраните повторный пересчёт.";
  if (session.status === "REVIEW") return "Выберите действия и причины по строкам с расхождениями.";
  if (session.status === "AWAITING_APPROVAL") return session.approvedAt ? "Инвентаризация подтверждена. Осталось провести складские движения." : "Нужно подтверждение владельца перед проведением.";
  if (session.status === "POSTED") return "Инвентаризация проведена. Можно открыть ведомость или сделать обратную операцию.";
  if (session.status === "CANCELLED") return "Инвентаризация отменена. Доступна только история документа.";
  if (session.status === "REVERSED") return "По документу создана обратная операция.";
  return "Откройте следующий этап.";
}

export default function WarehouseInventoryClient({ sessionId }: WarehouseInventoryClientProps = {}) {
  const router = useRouter();
  const isDetail = Boolean(sessionId);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [sessionsData, setSessionsData] = useState<SessionsResponse | null>(null);
  const [current, setCurrent] = useState<InventorySession | null>(null);
  const [lines, setLines] = useState<InventoryLine[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationResponse | null>(null);
  const [tab, setTab] = useState("active");
  const [filters, setFilters] = useState<InventoryFilters>({
    organizationId: "",
    warehouseId: "",
    status: "",
    category: "",
    onlyWithDiscrepancies: false,
    period: "month",
    search: "",
  });
  const [lineFilters, setLineFilters] = useState({ search: "", status: "ALL", cell: "" });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizard, setWizard] = useState<WizardState>(() => defaultWizard());
  const [draftSession, setDraftSession] = useState<InventorySession | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [scanner, setScanner] = useState({ barcode: "", mode: "FIND" });
  const [foundProduct, setFoundProduct] = useState({ productId: "", ean: "", name: "", category: "", cellId: "", quantity: "" });
  const [helpOpen, setHelpOpen] = useState(false);

  const activeTab = SESSION_TABS.find((item) => item.id === tab) ?? SESSION_TABS[0];
  const currentId = current?.id ?? "";
  const currentStatus = current?.status ?? "";

  const loadDictionaries = useCallback(async () => {
    const [orgData, storesData] = await Promise.all([
      requestJson<{ organizations?: Organization[] }>("/api/moysklad/organizations"),
      requestJson<{ stores?: Store[] }>("/api/local-inventory/stores"),
    ]);
    setOrganizations(orgData.organizations ?? []);
    setStores(storesData.stores ?? []);
    setWizard((prev) => ({
      ...prev,
      organizationId: prev.organizationId || orgData.organizations?.find((item) => item.isDefault)?.id || orgData.organizations?.[0]?.id || "",
      warehouseId: prev.warehouseId || storesData.stores?.[0]?.id || "",
    }));
  }, []);

  const loadSessions = useCallback(async () => {
    const params = new URLSearchParams();
    if (filters.organizationId) params.set("organizationId", filters.organizationId);
    if (filters.warehouseId) params.set("warehouseId", filters.warehouseId);
    if (filters.onlyWithDiscrepancies) params.set("onlyWithDiscrepancies", "1");
    if (filters.category) params.set("category", filters.category);
    const range = periodRange(filters.period);
    if (range) {
      params.set("dateFrom", range.from);
      params.set("dateTo", range.to);
    }
    if (activeTab.statuses.length === 1) params.set("status", activeTab.statuses[0]);
    if (filters.status) params.set("status", filters.status);
    params.set("limit", "80");
    const data = await requestJson<SessionsResponse>(`/api/inventory/sessions?${params.toString()}`);
    setSessionsData(data);
  }, [activeTab.statuses, filters]);

  const loadCurrent = useCallback(async () => {
    if (!sessionId) return;
    const data = await requestJson<{ session: InventorySession }>(`/api/inventory/sessions/${sessionId}`);
    setCurrent(data.session);
  }, [sessionId]);

  const loadLines = useCallback(async (sessionId: string) => {
    const params = new URLSearchParams();
    if (lineFilters.search) params.set("search", lineFilters.search);
    if (lineFilters.status && lineFilters.status !== "ALL") params.set("status", lineFilters.status);
    if (lineFilters.cell) params.set("cell", lineFilters.cell);
    params.set("limit", "250");
    const data = await requestJson<LinesResponse>(`/api/inventory/sessions/${sessionId}/lines?${params.toString()}`);
    setLines(data.lines);
    setInputValues((prev) => {
      const next = { ...prev };
      for (const line of data.lines) {
        if (next[line.id] === undefined && line.finalQuantity != null) next[line.id] = String(line.finalQuantity);
      }
      return next;
    });
  }, [lineFilters]);

  const loadReconciliation = useCallback(async (sessionId: string) => {
    const data = await requestJson<ReconciliationResponse>(`/api/inventory/sessions/${sessionId}/reconciliation`);
    setReconciliation(data);
    setCurrent(data.session);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setLoading(true);
      try {
        await loadDictionaries();
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Не удалось загрузить справочники");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    return () => { cancelled = true; };
  }, [loadDictionaries]);

  useEffect(() => {
    if (isDetail) return;
    let cancelled = false;
    setLoading(true);
    void loadSessions()
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Не удалось обновить список");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isDetail, loadSessions]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    void loadCurrent()
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Не удалось загрузить инвентаризацию");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [loadCurrent, sessionId]);

  useEffect(() => {
    if (!currentId) return;
    if (["COUNTING", "RECOUNT_REQUIRED", "PAUSED"].includes(currentStatus)) {
      void loadLines(currentId).catch((error) => setMessage(error instanceof Error ? error.message : "Не удалось загрузить строки"));
    } else {
      void loadReconciliation(currentId).catch((error) => setMessage(error instanceof Error ? error.message : "Не удалось загрузить сверку"));
    }
  }, [currentId, currentStatus, lineFilters, loadLines, loadReconciliation]);

  const filteredSessions = useMemo(() => {
    const rows = sessionsData?.sessions ?? [];
    const byTab = activeTab.statuses.length === 0 ? rows : rows.filter((row) => activeTab.statuses.includes(row.status));
    const query = filters.search.trim().toLowerCase();
    if (!query) return byTab;
    return byTab.filter((row) => {
      const haystack = [
        row.number,
        row.organizationName,
        row.warehouseName,
        row.createdByName,
        scopeLabel(row),
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [activeTab.statuses, filters.search, sessionsData?.sessions]);

  const currentStage = sessionStage(current);

  const showAccounting = !!current && (current.countMode === "QUICK" || !["COUNTING", "RECOUNT_REQUIRED", "PAUSED"].includes(current.status));
  const lineCells = useMemo(() => [...new Set(lines.map((line) => line.cellId).filter(Boolean))].sort(), [lines]);
  const activeCount = (sessionsData?.statusCounts.DRAFT ?? 0)
    + (sessionsData?.statusCounts.COUNTING ?? 0)
    + (sessionsData?.statusCounts.PAUSED ?? 0)
    + (sessionsData?.statusCounts.RECOUNT_REQUIRED ?? 0);
  const reviewCount = (sessionsData?.statusCounts.REVIEW ?? 0) + (sessionsData?.statusCounts.AWAITING_APPROVAL ?? 0);
  const postedThisMonth = (sessionsData?.sessions ?? []).filter((item) => item.status === "POSTED" && isCurrentMonth(item.postedAt ?? item.createdAt)).length;

  function wizardPayload() {
    return {
      organizationId: wizard.organizationId,
      warehouseId: wizard.warehouseId,
      startedAt: wizard.startedAt ? new Date(wizard.startedAt).toISOString() : undefined,
      responsibleId: wizard.responsibleId,
      comment: wizard.comment,
      countMode: wizard.countMode,
      warehouseMode: wizard.warehouseMode,
      scope: {
        type: wizard.scopeType,
        categories: wizard.categories,
        groups: splitList(wizard.groups),
        brands: splitList(wizard.brands),
        cells: splitList(wizard.cells),
        productIds: splitList(wizard.productIds),
      },
      options: {
        includeZeroStock: wizard.includeZeroStock,
        includeArchivedWithStock: wizard.includeArchivedWithStock,
        includeUncategorized: wizard.includeUncategorized,
        includeWithoutCell: wizard.includeWithoutCell,
        excludeDisabledStockTracking: wizard.excludeDisabledStockTracking,
      },
    };
  }

  async function ensureDraft() {
    if (draftSession) {
      const data = await requestJson<{ session: InventorySession }>(`/api/inventory/sessions/${draftSession.id}`, {
        method: "PATCH",
        body: JSON.stringify(wizardPayload()),
      });
      setDraftSession(data.session);
      return data.session;
    }
    const data = await requestJson<{ session: InventorySession }>("/api/inventory/sessions", {
      method: "POST",
      body: JSON.stringify(wizardPayload()),
    });
    setDraftSession(data.session);
    return data.session;
  }

  async function previewScope() {
    setWorking(true);
    setMessage("");
    try {
      const draft = await ensureDraft();
      const data = await requestJson<{ total: number }>(`/api/inventory/sessions/${draft.id}/preview-scope`, { method: "POST", body: "{}" });
      setPreviewCount(data.total);
      setWizardStep(4);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сформировать область");
    } finally {
      setWorking(false);
    }
  }

  async function startInventory() {
    setWorking(true);
    setMessage("");
    try {
      const draft = await ensureDraft();
      const data = await requestJson<{ session: InventorySession }>(`/api/inventory/sessions/${draft.id}/start`, { method: "POST", body: "{}" });
      setCurrent(data.session);
      setWizardOpen(false);
      setDraftSession(null);
      setPreviewCount(null);
      await loadSessions();
      if (isDetail) {
        setCurrent(data.session);
        await loadLines(data.session.id);
      } else {
        router.push(`/warehouse/inventory/${data.session.id}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось начать инвентаризацию");
    } finally {
      setWorking(false);
    }
  }

  async function openSession(session: InventorySession) {
    router.push(`/warehouse/inventory/${session.id}`);
  }

  function openWizard() {
    const next = defaultWizard();
    next.organizationId = filters.organizationId || organizations.find((org) => org.isDefault)?.id || organizations[0]?.id || "";
    next.warehouseId = filters.warehouseId || stores[0]?.id || "";
    setWizard(next);
    setWizardOpen(true);
    setWizardStep(1);
    setDraftSession(null);
    setPreviewCount(null);
  }

  async function mutateSession(path: string, body: unknown = {}) {
    if (!current) return;
    setWorking(true);
    setMessage("");
    try {
      const data = await requestJson<{ session?: InventorySession; alreadyPosted?: boolean; alreadyReversed?: boolean }>(`/api/inventory/sessions/${current.id}/${path}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (data.session) setCurrent(data.session);
      if (!isDetail) await loadSessions();
      if (path === "complete-counting" || path === "submit-review" || path === "approve" || path === "post" || path === "reverse") {
        await loadReconciliation(current.id);
      } else {
        await loadLines(current.id);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Действие не выполнено");
    } finally {
      setWorking(false);
    }
  }

  function runPrimaryDetailAction() {
    if (!current) return;
    if (current.status === "DRAFT") {
      void mutateSession("start");
      return;
    }
    if (current.status === "PAUSED") {
      void mutateSession("resume");
      return;
    }
    if (current.status === "COUNTING" || current.status === "RECOUNT_REQUIRED") {
      document.getElementById("inventory-counting-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (current.status === "REVIEW") {
      document.getElementById("inventory-reconciliation-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (current.status === "AWAITING_APPROVAL" && !current.approvedAt) {
      void mutateSession("approve");
      return;
    }
    if (current.status === "AWAITING_APPROVAL" && current.approvedAt) {
      void mutateSession("post", { idempotencyKey: crypto.randomUUID() });
      return;
    }
    window.open(`/api/inventory/sessions/${current.id}/report?format=html`, "_blank", "noopener,noreferrer");
  }

  async function saveCount(line: InventoryLine, confirmZero = false, source = "MANUAL") {
    if (!current) return;
    const value = inputValues[line.id];
    setSaveState((prev) => ({ ...prev, [line.id]: "saving" }));
    try {
      const data = await requestJson<{ line: InventoryLine }>(`/api/inventory/sessions/${current.id}/lines/${line.id}/count`, {
        method: "POST",
        body: JSON.stringify({ quantity: value, confirmZero, source, comment: inputValues[`comment:${line.id}`] ?? line.comment }),
      });
      setLines((prev) => prev.map((item) => (item.id === line.id ? data.line : item)));
      setSaveState((prev) => ({ ...prev, [line.id]: "saved" }));
      window.setTimeout(() => setSaveState((prev) => ({ ...prev, [line.id]: "idle" })), 1400);
    } catch (error) {
      setSaveState((prev) => ({ ...prev, [line.id]: "error" }));
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить количество");
    }
  }

  async function saveResolution(line: InventoryLine, patch: Partial<InventoryLine>) {
    if (!current) return;
    setSaveState((prev) => ({ ...prev, [line.id]: "saving" }));
    try {
      const data = await requestJson<{ line: InventoryLine }>(`/api/inventory/sessions/${current.id}/lines/${line.id}/resolution`, {
        method: "PATCH",
        body: JSON.stringify({
          finalAction: patch.finalAction ?? line.finalAction,
          reasonCode: patch.reasonCode ?? line.reasonCode,
          comment: patch.comment ?? line.comment,
          affectsManagementProfit: patch.affectsManagementProfit ?? line.affectsManagementProfit,
        }),
      });
      setReconciliation((prev) => prev ? { ...prev, lines: prev.lines.map((item) => (item.id === line.id ? data.line : item)) } : prev);
      setSaveState((prev) => ({ ...prev, [line.id]: "saved" }));
      window.setTimeout(() => setSaveState((prev) => ({ ...prev, [line.id]: "idle" })), 1400);
    } catch (error) {
      setSaveState((prev) => ({ ...prev, [line.id]: "error" }));
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить решение");
    }
  }

  async function scanBarcode() {
    if (!current || !scanner.barcode.trim()) return;
    setWorking(true);
    try {
      const data = await requestJson<{
        status: string;
        line?: InventoryLine;
        product?: { id: string; name: string; category: string };
        products?: Array<{ id: string; name: string; article?: string }>;
      }>(`/api/inventory/sessions/${current.id}/scan`, {
        method: "POST",
        body: JSON.stringify({ barcode: scanner.barcode, mode: scanner.mode === "INCREMENT" ? "INCREMENT" : "FIND" }),
      });
      if (data.status === "COUNTED" && data.line) {
        setLines((prev) => prev.map((line) => (line.id === data.line!.id ? data.line! : line)));
        setMessage("Штрихкод найден, количество увеличено на 1");
      } else if (data.status === "FOUND" && data.line) {
        setInputValues((prev) => ({ ...prev, [data.line!.id]: data.line!.finalQuantity == null ? "" : String(data.line!.finalQuantity) }));
        setMessage(`Найдена строка: ${data.line.name}`);
      } else if (data.status === "OUT_OF_SCOPE" && data.product) {
        setFoundProduct((prev) => ({ ...prev, productId: data.product!.id, name: data.product!.name, category: data.product!.category, ean: scanner.barcode }));
        setMessage("Товар найден вне выбранной области. Его можно добавить как найденный дополнительно.");
      } else if (data.status === "CONFLICT") {
        setMessage(`Один штрихкод у нескольких товаров: ${data.products?.map((item) => item.name).join(", ")}`);
      } else {
        setFoundProduct((prev) => ({ ...prev, ean: scanner.barcode }));
        setMessage("Штрихкод не найден. Можно найти товар вручную или создать черновик.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Сканирование не выполнено");
    } finally {
      setWorking(false);
    }
  }

  async function addFoundProduct() {
    if (!current) return;
    setWorking(true);
    try {
      const data = await requestJson<{ line: InventoryLine }>(`/api/inventory/sessions/${current.id}/add-product`, {
        method: "POST",
        body: JSON.stringify(foundProduct),
      });
      setLines((prev) => [data.line, ...prev]);
      setFoundProduct({ productId: "", ean: "", name: "", category: "", cellId: "", quantity: "" });
      setMessage("Товар добавлен как найденный дополнительно");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось добавить товар");
    } finally {
      setWorking(false);
    }
  }

  const summary = sessionsData?.summary;

  if (isDetail) {
    const isCounting = !!current && ["COUNTING", "PAUSED", "RECOUNT_REQUIRED"].includes(current.status);
    const isReview = !!current && ["REVIEW", "AWAITING_APPROVAL", "POSTED", "REVERSED", "CANCELLED"].includes(current.status);

    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => router.push("/warehouse/inventory")}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-950"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          К списку инвентаризаций
        </button>

        {message && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{message}</span>
          </div>
        )}

        {loading && !current ? (
          <EcoCard>
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Загружаю инвентаризацию
            </div>
          </EcoCard>
        ) : current ? (
          <>
            <EcoCard>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold text-zinc-950">{current.number}</h1>
                    <span title={current.status === "PAUSED" ? "Подсчёт приостановлен. Можно продолжить с того же места." : undefined}>
                      <EcoBadge tone={statusTone(current.status)}>{STATUS_LABELS[current.status] ?? current.status}</EcoBadge>
                    </span>
                    <span title={current.countMode === "BLIND" ? "Во время подсчёта сотрудник не видит учётный остаток, чтобы не подгонять фактическое количество." : "Учётный остаток и разница видны сразу."}>
                      <EcoBadge tone={current.countMode === "BLIND" ? "info" : "warning"}>{current.countMode === "BLIND" ? "Слепой подсчёт" : "Быстрая сверка"}</EcoBadge>
                    </span>
                    <span title={current.warehouseMode === "LOCKED" ? "Товары из этой инвентаризации нельзя отгружать, принимать или перемещать до завершения подсчёта." : "Склад продолжает работать, движения учитываются при сверке."}>
                      <EcoBadge tone={current.warehouseMode === "LOCKED" ? "success" : "warning"}>{current.warehouseMode === "LOCKED" ? "Движения заблокированы" : "Склад работает"}</EcoBadge>
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-600">{current.organizationName} · {current.warehouseName}</p>
                  <p className="mt-2 text-sm text-zinc-500">Область: {scopeLabel(current)} · ответственный: {current.createdByName || current.responsibleId || "не указан"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <EcoButton variant="primary" onClick={runPrimaryDetailAction} disabled={working || current.status === "CANCELLED"}>
                    {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                    {documentAction(current)}
                  </EcoButton>
                  {current.status === "COUNTING" && <EcoButton onClick={() => void mutateSession("pause")} disabled={working}><Pause className="h-4 w-4" aria-hidden />Пауза</EcoButton>}
                  {current.status === "PAUSED" && <EcoButton onClick={() => void mutateSession("resume")} disabled={working}><Play className="h-4 w-4" aria-hidden />Продолжить</EcoButton>}
                  <a className="eco-btn eco-btn--secondary" href={`/api/inventory/sessions/${current.id}/export-count-sheet`}>
                    <FileDown className="h-4 w-4" aria-hidden />Лист подсчёта
                  </a>
                  <a className="eco-btn eco-btn--secondary" href={`/api/inventory/sessions/${current.id}/report?format=html`} target="_blank" rel="noreferrer">
                    <FileDown className="h-4 w-4" aria-hidden />Ведомость
                  </a>
                  <details className="relative">
                    <summary className="eco-btn eco-btn--secondary cursor-pointer list-none">
                      <MoreHorizontal className="h-4 w-4" aria-hidden />Ещё
                    </summary>
                    <div className="absolute right-0 z-20 mt-2 w-64 rounded-md border border-zinc-200 bg-white p-2 shadow-lg">
                      {!["POSTED", "REVERSED", "CANCELLED"].includes(current.status) && (
                        <button type="button" className="w-full rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => void mutateSession("cancel", { reason: window.prompt("Причина отмены") || "" })}>
                          Отменить инвентаризацию
                        </button>
                      )}
                      {current.status === "POSTED" && (
                        <button type="button" className="w-full rounded-md px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50" onClick={() => void mutateSession("reverse", { reason: window.prompt("Причина обратной операции") || "" })}>
                          Создать обратную операцию
                        </button>
                      )}
                      <button type="button" className="w-full rounded-md px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50" onClick={() => void loadCurrent()}>
                        Обновить документ
                      </button>
                    </div>
                  </details>
                </div>
              </div>
            </EcoCard>

            <EcoCard>
              <div className="grid gap-2 md:grid-cols-4">
                {WORKFLOW_STAGES.map((stage, index) => {
                  const number = index + 1;
                  const state = number < currentStage ? "done" : number === currentStage ? "current" : "wait";
                  return (
                    <div
                      key={stage}
                      className={`rounded-md border px-3 py-3 ${state === "current" ? "border-zinc-950 bg-zinc-950 text-white" : state === "done" ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-zinc-200 bg-white text-zinc-600"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{number}. {stage}</span>
                        <span className="text-xs">{stageHint(current, number)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-col gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-950">Следующее действие</div>
                  <p className="mt-1 text-sm text-zinc-600">{nextStepText(current)}</p>
                </div>
                <EcoButton variant="primary" onClick={runPrimaryDetailAction} disabled={working || current.status === "CANCELLED"}>
                  {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                  {documentAction(current)}
                </EcoButton>
              </div>
            </EcoCard>

            <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
              <MiniMetric label="Всего" value={current.totalLines} />
              <MiniMetric label="Посчитано" value={current.countedLines} sub={`осталось ${Math.max(0, current.totalLines - current.countedLines)}`} tone="info" />
              <MiniMetric label="Недостача" value={current.shortageLines} sub={money(current.totalShortageCostCents)} tone="danger" />
              <MiniMetric label="Излишек" value={current.surplusLines} sub={money(current.totalSurplusCostCents)} tone="success" />
              <MiniMetric label="Тех. корректировки" value={money(current.technicalAdjustmentCents)} tone="info" />
              <MiniMetric label="Обычные списания" value={money(current.managementExpenseCents)} tone="rust" />
            </section>

            {current.status === "DRAFT" && (
              <DraftInventoryWorkspace current={current} working={working} onStart={() => void mutateSession("start")} />
            )}

            {isCounting && (
              <div id="inventory-counting-workspace">
                <CountingWorkspace
                  current={current}
                  lines={lines}
                  lineFilters={lineFilters}
                  setLineFilters={setLineFilters}
                  lineCells={lineCells}
                  inputValues={inputValues}
                  setInputValues={setInputValues}
                  saveState={saveState}
                  saveCount={saveCount}
                  scanner={scanner}
                  setScanner={setScanner}
                  scanBarcode={scanBarcode}
                  foundProduct={foundProduct}
                  setFoundProduct={setFoundProduct}
                  addFoundProduct={addFoundProduct}
                  onImported={() => loadLines(current.id)}
                  showAccounting={showAccounting}
                  working={working}
                />
              </div>
            )}

            {isReview && (
              <div id="inventory-reconciliation-workspace">
                <ReconciliationWorkspace
                  current={current}
                  data={reconciliation}
                  saveState={saveState}
                  saveResolution={saveResolution}
                  mutateSession={mutateSession}
                  working={working}
                />
              </div>
            )}
          </>
        ) : (
          <EcoCard>
            <div className="flex min-h-48 flex-col items-center justify-center text-center">
              <AlertTriangle className="h-8 w-8 text-amber-600" aria-hidden />
              <h1 className="mt-3 text-lg font-semibold text-zinc-950">Инвентаризация не найдена</h1>
              <p className="mt-1 text-sm text-zinc-500">Проверьте ссылку или вернитесь к списку документов.</p>
            </div>
          </EcoCard>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">Инвентаризация</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-600">
            Сверка фактических остатков со складом. Создайте инвентаризацию, посчитайте товары и проведите корректировки.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <EcoButton onClick={() => setHelpOpen((value) => !value)}>
            <HelpCircle className="h-4 w-4" aria-hidden />
            Как это работает?
          </EcoButton>
          <EcoButton variant="primary" onClick={openWizard}>
            <Plus className="h-4 w-4" aria-hidden />
            Новая инвентаризация
          </EcoButton>
        </div>
      </header>

      {helpOpen && (
        <EcoCard>
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">Как работает инвентаризация</h2>
              <ol className="mt-3 grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
                <li>1. Вы выбираете склад и группу товаров.</li>
                <li>2. Система создаёт список товаров для проверки.</li>
                <li>3. Вы вводите фактическое количество.</li>
                <li>4. Система сравнивает факт с учётом.</li>
                <li>5. Недостачи можно списать или провести как техническую корректировку.</li>
                <li>6. Излишки можно оприходовать.</li>
                <li>7. После проведения создаются складские движения.</li>
              </ol>
            </div>
            <div className="space-y-2 text-sm text-zinc-700">
              <div className="rounded-md border border-zinc-200 p-3"><b>Слепой подсчёт:</b> сотрудник не видит учётный остаток во время подсчёта.</div>
              <div className="rounded-md border border-zinc-200 p-3"><b>Техническая корректировка:</b> исправляет остатки без влияния на прибыль.</div>
              <div className="rounded-md border border-zinc-200 p-3"><b>Обычное списание:</b> уменьшает остаток и влияет на управленческую прибыль.</div>
            </div>
          </div>
        </EcoCard>
      )}

      {message && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{message}</span>
        </div>
      )}

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MiniMetric label="Активные" value={activeCount} />
        <MiniMetric label="На проверке" value={reviewCount} tone="info" />
        <MiniMetric label="Проведены за месяц" value={postedThisMonth} tone="success" />
        <MiniMetric label="Расхождения" value={money(summary?.discrepancyCostCents)} tone="warning" />
        <MiniMetric label="Тех. корректировки" value={money(summary?.technicalAdjustmentCents)} tone="info" />
        <MiniMetric label="Обычные списания" value={money(summary?.managementExpenseCents)} tone="rust" />
      </section>

      <EcoCard className="space-y-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-zinc-500" aria-hidden />
          <h2 className="text-sm font-semibold text-zinc-950">Фильтры</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="min-w-48 flex-1 text-xs font-medium text-zinc-500">
            Организация
            <EcoSelect value={filters.organizationId} onChange={(event) => setFilters((prev) => ({ ...prev, organizationId: event.target.value }))}>
              <option value="">Все</option>
              {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
            </EcoSelect>
          </label>
          <label className="min-w-48 flex-1 text-xs font-medium text-zinc-500">
            Склад
            <EcoSelect value={filters.warehouseId} onChange={(event) => setFilters((prev) => ({ ...prev, warehouseId: event.target.value }))}>
              <option value="">Все</option>
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </EcoSelect>
          </label>
          <label className="text-xs font-medium text-zinc-500">
            Статус
            <EcoSelect value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="">По вкладке</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </EcoSelect>
          </label>
          <label className="text-xs font-medium text-zinc-500">
            Период
            <EcoSelect value={filters.period} onChange={(event) => setFilters((prev) => ({ ...prev, period: event.target.value }))}>
              <option value="month">Текущий месяц</option>
              <option value="week">Текущая неделя</option>
              <option value="today">Сегодня</option>
              <option value="all">Всё время</option>
            </EcoSelect>
          </label>
          <label className="text-xs font-medium text-zinc-500">
            Категория
            <EcoSelect value={filters.category} onChange={(event) => setFilters((prev) => ({ ...prev, category: event.target.value }))}>
              <option value="">Все</option>
              {INVENTORY_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
            </EcoSelect>
          </label>
          <label className="text-xs font-medium text-zinc-500">
            Поиск
            <EcoInput value={filters.search} onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="Номер, склад, ответственный" />
          </label>
          <label className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={filters.onlyWithDiscrepancies}
              onChange={(event) => setFilters((prev) => ({ ...prev, onlyWithDiscrepancies: event.target.checked }))}
            />
            только с расхождениями
          </label>
        </div>
        <div className="flex justify-end">
          <EcoButton size="sm" onClick={() => void loadSessions()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
            Обновить
          </EcoButton>
        </div>
      </EcoCard>

      <div className="flex flex-wrap gap-2">
        {SESSION_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-md border px-3 py-2 text-sm font-medium ${tab === item.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-700"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">Инвентаризации</h2>
            <p className="text-sm text-zinc-500">Выберите документ, чтобы открыть рабочий экран подсчёта, сверки или проведения.</p>
          </div>
          <EcoBadge>{filteredSessions.length} из {sessionsData?.total ?? 0}</EcoBadge>
        </div>

        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {filteredSessions.map((session) => (
            <article key={session.id} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-zinc-950">{session.number}</h3>
                  <p className="mt-1 text-sm text-zinc-600">{session.organizationName} · {session.warehouseName}</p>
                  <p className="mt-1 text-sm text-zinc-500">Область: {scopeLabel(session)}</p>
                </div>
                <EcoBadge tone={statusTone(session.status)}>{STATUS_LABELS[session.status] ?? session.status}</EcoBadge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <span className="rounded-md bg-zinc-100 px-2 py-1 text-zinc-700">Этап: {WORKFLOW_STAGES[sessionStage(session) - 1]}</span>
                <span className="rounded-md bg-zinc-100 px-2 py-1 text-zinc-700">{session.countMode === "BLIND" ? "Слепой подсчёт" : "Быстрая сверка"}</span>
                <span className="rounded-md bg-zinc-100 px-2 py-1 text-zinc-700">{formatDate(session.createdAt)}</span>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2 text-sm text-zinc-600">
                <span><b className="block text-base text-zinc-950">{session.totalLines}</b>позиций</span>
                <span><b className="block text-base text-zinc-950">{session.countedLines}</b>посчитано</span>
                <span><b className="block text-base text-red-700">{session.shortageLines}</b>недостача</span>
                <span><b className="block text-base text-emerald-700">{session.surplusLines}</b>излишек</span>
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-xs text-zinc-500">Ответственный: {session.createdByName || session.responsibleId || "не указан"}</div>
                <EcoButton size="sm" variant="primary" onClick={() => void openSession(session)}>
                  {documentAction(session)}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </EcoButton>
              </div>
            </article>
          ))}
        </div>

        {filteredSessions.length === 0 && (
          <EcoCard>
            <div className="flex min-h-56 flex-col items-center justify-center text-center">
              <ClipboardList className="h-10 w-10 text-zinc-400" aria-hidden />
              <h2 className="mt-3 text-lg font-semibold text-zinc-950">Инвентаризаций по фильтрам нет</h2>
              <p className="mt-1 max-w-lg text-sm text-zinc-500">Создайте новую инвентаризацию или измените фильтры выше.</p>
              <EcoButton className="mt-4" variant="primary" onClick={openWizard}><Plus className="h-4 w-4" aria-hidden />Новая инвентаризация</EcoButton>
            </div>
          </EcoCard>
        )}
      </section>

      {wizardOpen && (
        <InventoryWizard
          wizard={wizard}
          setWizard={setWizard}
          step={wizardStep}
          setStep={setWizardStep}
          organizations={organizations}
          stores={stores}
          previewCount={previewCount}
          working={working}
          onPreview={() => void previewScope()}
          onStart={() => void startInventory()}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

function MiniMetric({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "rust" | "success" | "warning" | "danger" | "info";
}) {
  const toneClass: Record<string, string> = {
    neutral: "border-zinc-200 bg-white text-zinc-950",
    rust: "border-orange-200 bg-orange-50 text-orange-950",
    success: "border-emerald-200 bg-emerald-50 text-emerald-950",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    danger: "border-red-200 bg-red-50 text-red-950",
    info: "border-sky-200 bg-sky-50 text-sky-950",
  };
  return (
    <div className={`rounded-md border px-3 py-2 ${toneClass[tone]}`}>
      <div className="text-xs font-medium text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

function DraftInventoryWorkspace({
  current,
  working,
  onStart,
}: {
  current: InventorySession;
  working: boolean;
  onStart: () => void;
}) {
  return (
    <EcoCard>
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">Настройка готова к запуску</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Проверьте область, режим и склад. После старта система создаст строки подсчёта и переведёт документ на этап «Подсчёт».
          </p>
          <div className="mt-3 grid gap-2 text-sm text-zinc-700 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-md border border-zinc-200 p-3"><b className="block text-zinc-950">Где считаем</b>{current.organizationName} · {current.warehouseName}</div>
            <div className="rounded-md border border-zinc-200 p-3"><b className="block text-zinc-950">Что считаем</b>{scopeLabel(current)}</div>
            <div className="rounded-md border border-zinc-200 p-3"><b className="block text-zinc-950">Как считаем</b>{current.countMode === "BLIND" ? "Слепой подсчёт" : "Быстрая сверка"}</div>
            <div className="rounded-md border border-zinc-200 p-3"><b className="block text-zinc-950">Склад</b>{current.warehouseMode === "LOCKED" ? "движения заблокируются" : "продолжает работать"}</div>
          </div>
        </div>
        <EcoButton variant="primary" onClick={onStart} disabled={working}>
          {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          Начать подсчёт
        </EcoButton>
      </div>
    </EcoCard>
  );
}

function InventoryWizard({
  wizard,
  setWizard,
  step,
  setStep,
  organizations,
  stores,
  previewCount,
  working,
  onPreview,
  onStart,
  onClose,
}: {
  wizard: WizardState;
  setWizard: (updater: WizardState | ((prev: WizardState) => WizardState)) => void;
  step: number;
  setStep: (step: number) => void;
  organizations: Organization[];
  stores: Store[];
  previewCount: number | null;
  working: boolean;
  onPreview: () => void;
  onStart: () => void;
  onClose: () => void;
}) {
  const visibleCategories = INVENTORY_CATEGORIES.filter((category) => category.toLowerCase().includes(wizard.categorySearch.toLowerCase()));
  const toggleCategory = (category: string) => {
    setWizard((prev) => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter((item) => item !== category)
        : [...prev.categories, category],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-black/30 p-4">
      <div className="mx-auto max-w-5xl rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-zinc-200 p-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Новая инвентаризация</h2>
            <p className="text-sm text-zinc-500">4 этапа настройки и предпросмотр перед стартом.</p>
          </div>
          <EcoButton size="sm" variant="ghost" onClick={onClose}><XCircle className="h-4 w-4" aria-hidden />Закрыть</EcoButton>
        </div>
        <div className="grid gap-4 p-4 lg:grid-cols-[220px_1fr]">
          <aside className="space-y-2">
            {["Где считаем?", "Что считаем?", "Как считаем?", "Проверка"].map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => setStep(index + 1)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${step === index + 1 ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-700"}`}
              >
                <span className="mr-2 font-semibold">{index + 1}</span>{label}
              </button>
            ))}
          </aside>
          <section className="min-h-[420px]">
            {step === 1 && (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-xs font-medium text-zinc-500">Организация
                  <EcoSelect value={wizard.organizationId} onChange={(event) => setWizard((prev) => ({ ...prev, organizationId: event.target.value }))}>
                    <option value="">Выберите</option>
                    {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
                  </EcoSelect>
                </label>
                <label className="text-xs font-medium text-zinc-500">Склад
                  <EcoSelect value={wizard.warehouseId} onChange={(event) => setWizard((prev) => ({ ...prev, warehouseId: event.target.value }))}>
                    <option value="">Выберите</option>
                    {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </EcoSelect>
                </label>
                <label className="text-xs font-medium text-zinc-500">Дата и время начала
                  <EcoInput type="datetime-local" value={wizard.startedAt} onChange={(event) => setWizard((prev) => ({ ...prev, startedAt: event.target.value }))} />
                </label>
                <label className="text-xs font-medium text-zinc-500">Ответственный
                  <EcoInput value={wizard.responsibleId} onChange={(event) => setWizard((prev) => ({ ...prev, responsibleId: event.target.value }))} placeholder="логин или имя" />
                </label>
                <label className="md:col-span-2 text-xs font-medium text-zinc-500">Комментарий
                  <textarea className="eco-input min-h-24" value={wizard.comment} onChange={(event) => setWizard((prev) => ({ ...prev, comment: event.target.value }))} />
                </label>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="grid gap-2 md:grid-cols-3">
                  {[
                    ["WAREHOUSE", "Весь склад"],
                    ["CATEGORIES", "По категориям"],
                    ["GROUPS", "По группам товаров"],
                    ["BRANDS", "По брендам"],
                    ["CELLS", "По ячейкам"],
                    ["PRODUCTS", "Выбрать товары вручную"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setWizard((prev) => ({ ...prev, scopeType: value as WizardState["scopeType"] }))}
                      className={`rounded-md border px-3 py-2 text-sm ${wizard.scopeType === value ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-700"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {wizard.scopeType === "CATEGORIES" && (
                  <div className="rounded-md border border-zinc-200 p-3">
                    <EcoInput value={wizard.categorySearch} onChange={(event) => setWizard((prev) => ({ ...prev, categorySearch: event.target.value }))} placeholder="Поиск по категории" />
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {visibleCategories.map((category) => (
                        <label key={category} className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm">
                          <input type="checkbox" checked={wizard.categories.includes(category)} onChange={() => toggleCategory(category)} />
                          {category}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {wizard.scopeType === "GROUPS" && <EcoInput value={wizard.groups} onChange={(event) => setWizard((prev) => ({ ...prev, groups: event.target.value }))} placeholder="Группы через запятую" />}
                {wizard.scopeType === "BRANDS" && <EcoInput value={wizard.brands} onChange={(event) => setWizard((prev) => ({ ...prev, brands: event.target.value }))} placeholder="Бренды через запятую" />}
                {wizard.scopeType === "CELLS" && <EcoInput value={wizard.cells} onChange={(event) => setWizard((prev) => ({ ...prev, cells: event.target.value }))} placeholder="Ячейки через запятую: A-12, B-04" />}
                {wizard.scopeType === "PRODUCTS" && <EcoInput value={wizard.productIds} onChange={(event) => setWizard((prev) => ({ ...prev, productIds: event.target.value }))} placeholder="ID товаров через запятую" />}
                <div className="grid gap-2 md:grid-cols-2">
                  {[
                    ["includeZeroStock", "включить товары с нулевым учётным остатком"],
                    ["includeArchivedWithStock", "включить архивные товары с ненулевым остатком"],
                    ["includeUncategorized", "включить товары без категории"],
                    ["includeWithoutCell", "включить товары без ячейки"],
                    ["excludeDisabledStockTracking", "исключить товары без складского учёта"],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(wizard[key as keyof WizardState])}
                        onChange={(event) => setWizard((prev) => ({ ...prev, [key]: event.target.checked }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950">Режим подсчёта</h3>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <button type="button" onClick={() => setWizard((prev) => ({ ...prev, countMode: "BLIND" }))} className={`rounded-md border p-4 text-left ${wizard.countMode === "BLIND" ? "border-zinc-950 bg-zinc-50" : "border-zinc-200"}`}>
                      <div className="font-semibold">Слепой подсчёт</div>
                      <p className="mt-1 text-sm text-zinc-600">Сотрудник не видит учётный остаток, разницу и стоимость во время подсчёта.</p>
                    </button>
                    <button type="button" onClick={() => setWizard((prev) => ({ ...prev, countMode: "QUICK" }))} className={`rounded-md border p-4 text-left ${wizard.countMode === "QUICK" ? "border-zinc-950 bg-zinc-50" : "border-zinc-200"}`}>
                      <div className="font-semibold">Быстрая сверка</div>
                      <p className="mt-1 text-sm text-zinc-600">Учётный остаток и разница показываются сразу.</p>
                    </button>
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950">Работа склада во время подсчёта</h3>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <button type="button" onClick={() => setWizard((prev) => ({ ...prev, warehouseMode: "LOCKED" }))} className={`rounded-md border p-4 text-left ${wizard.warehouseMode === "LOCKED" ? "border-zinc-950 bg-zinc-50" : "border-zinc-200"}`}>
                      <div className="font-semibold">Заблокировать движения</div>
                      <p className="mt-1 text-sm text-zinc-600">Отгрузка, приёмка, списание, перемещение и резервирование по выбранным товарам блокируются.</p>
                    </button>
                    <button type="button" onClick={() => setWizard((prev) => ({ ...prev, warehouseMode: "LIVE" }))} className={`rounded-md border p-4 text-left ${wizard.warehouseMode === "LIVE" ? "border-zinc-950 bg-zinc-50" : "border-zinc-200"}`}>
                      <div className="font-semibold">Склад продолжает работать</div>
                      <p className="mt-1 text-sm text-zinc-600">Создаётся snapshot, а движения между стартом и подсчётом учитываются при сверке.</p>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <EcoKpi label="Организация" value={organizations.find((org) => org.id === wizard.organizationId)?.name ?? "—"} />
                  <EcoKpi label="Склад" value={stores.find((store) => store.id === wizard.warehouseId)?.name ?? "—"} />
                  <EcoKpi label="Товаров в области" value={previewCount ?? "—"} tone={previewCount ? "success" : "neutral"} />
                </div>
                <div className="rounded-md border border-zinc-200 p-3 text-sm text-zinc-700">
                  <div><b>Область:</b> {wizard.scopeType === "CATEGORIES" ? wizard.categories.join(", ") : wizard.scopeType}</div>
                  <div><b>Режим:</b> {wizard.countMode === "BLIND" ? "слепой подсчёт" : "быстрая сверка"}</div>
                  <div><b>Работа склада:</b> {wizard.warehouseMode === "LOCKED" ? "движения блокируются" : "live-режим"}</div>
                </div>
                <EcoButton onClick={onPreview} disabled={working}>
                  {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
                  Обновить предпросмотр
                </EcoButton>
              </div>
            )}
          </section>
        </div>
        <div className="flex items-center justify-between border-t border-zinc-200 p-4">
          <EcoButton variant="ghost" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}>Назад</EcoButton>
          <div className="flex gap-2">
            {step < 4 && <EcoButton onClick={() => setStep(step + 1)}>Дальше</EcoButton>}
            {step === 4 && (
              <>
                <EcoButton onClick={onPreview} disabled={working}>{working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}Предпросмотр</EcoButton>
                <EcoButton variant="primary" onClick={onStart} disabled={working || previewCount == null || previewCount === 0}>{working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}Начать подсчёт</EcoButton>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CountingWorkspace(props: {
  current: InventorySession;
  lines: InventoryLine[];
  lineFilters: { search: string; status: string; cell: string };
  setLineFilters: (updater: { search: string; status: string; cell: string } | ((prev: { search: string; status: string; cell: string }) => { search: string; status: string; cell: string })) => void;
  lineCells: string[];
  inputValues: Record<string, string>;
  setInputValues: (updater: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) => void;
  saveState: SaveState;
  saveCount: (line: InventoryLine, confirmZero?: boolean, source?: string) => Promise<void>;
  scanner: { barcode: string; mode: string };
  setScanner: (updater: { barcode: string; mode: string } | ((prev: { barcode: string; mode: string }) => { barcode: string; mode: string })) => void;
  scanBarcode: () => Promise<void>;
  foundProduct: { productId: string; ean: string; name: string; category: string; cellId: string; quantity: string };
  setFoundProduct: (updater: { productId: string; ean: string; name: string; category: string; cellId: string; quantity: string } | ((prev: { productId: string; ean: string; name: string; category: string; cellId: string; quantity: string }) => { productId: string; ean: string; name: string; category: string; cellId: string; quantity: string })) => void;
  addFoundProduct: () => Promise<void>;
  onImported: () => Promise<void>;
  showAccounting: boolean;
  working: boolean;
}) {
  const {
    lines,
    lineFilters,
    setLineFilters,
    lineCells,
    inputValues,
    setInputValues,
    saveState,
    saveCount,
    scanner,
    setScanner,
    scanBarcode,
    foundProduct,
    setFoundProduct,
    addFoundProduct,
    onImported,
    showAccounting,
    working,
  } = props;
  const [importState, setImportState] = useState<{ loading: boolean; message: string }>({ loading: false, message: "" });

  async function importCountSheet(file: File | null) {
    if (!file) return;
    setImportState({ loading: true, message: "" });
    try {
      const text = await file.text();
      const rows = parseCountSheetCsv(text);
      const validation = await requestJson<{ ok: boolean; importableRows: number; skippedBlankRows: number; errors: Array<{ row: number; error: string }> }>(
        `/api/inventory/sessions/${props.current.id}/import/validate`,
        { method: "POST", body: JSON.stringify({ rows }) }
      );
      if (!validation.ok) {
        setImportState({ loading: false, message: validation.errors.map((error) => `строка ${error.row}: ${error.error}`).join("; ") });
        return;
      }
      const result = await requestJson<{ importedRows: number; skippedBlankRows: number }>(
        `/api/inventory/sessions/${props.current.id}/import/execute`,
        { method: "POST", body: JSON.stringify({ rows }) }
      );
      await onImported();
      setImportState({
        loading: false,
        message: `Импортировано: ${result.importedRows}. Пустые строки пропущены: ${result.skippedBlankRows}.`,
      });
    } catch (error) {
      setImportState({ loading: false, message: error instanceof Error ? error.message : "Импорт не выполнен" });
    }
  }

  const problemCount = lines.filter((line) => line.status === "PROBLEM" || line.requiresRecount || line.status === "RECOUNT_REQUIRED").length;
  const unexpectedCount = lines.filter((line) => line.isUnexpected).length;

  return (
    <div className="space-y-4">
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <MiniMetric label="Всего" value={props.current.totalLines} />
        <MiniMetric label="Посчитано" value={props.current.countedLines} tone="info" />
        <MiniMetric label="Осталось" value={Math.max(0, props.current.totalLines - props.current.countedLines)} />
        <MiniMetric label="Проблемы" value={problemCount} tone={problemCount ? "warning" : "neutral"} />
        <MiniMetric label="Найдено дополнительно" value={unexpectedCount} tone={unexpectedCount ? "rust" : "neutral"} />
      </section>

      <EcoCard>
        <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Search className="h-4 w-4 text-zinc-500" aria-hidden />
              <h2 className="text-base font-semibold text-zinc-950">Позиции для подсчёта</h2>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="text-xs font-medium text-zinc-500">
                Поиск товара
                <EcoInput value={lineFilters.search} onChange={(event) => setLineFilters((prev) => ({ ...prev, search: event.target.value }))} placeholder="Название, артикул, EAN, OEM" />
              </label>
              <label className="text-xs font-medium text-zinc-500">
                Статус
                <EcoSelect value={lineFilters.status} onChange={(event) => setLineFilters((prev) => ({ ...prev, status: event.target.value }))}>
                  <option value="ALL">Все статусы</option>
                  {Object.entries(LINE_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </EcoSelect>
              </label>
              <label className="text-xs font-medium text-zinc-500">
                Ячейка
                <EcoSelect value={lineFilters.cell} onChange={(event) => setLineFilters((prev) => ({ ...prev, cell: event.target.value }))}>
                  <option value="">Все ячейки</option>
                  {lineCells.map((cell) => <option key={cell} value={cell}>{cell}</option>)}
                </EcoSelect>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <EcoButton size="sm" onClick={() => setLineFilters({ search: "", status: "NOT_COUNTED", cell: "" })}>Не посчитано</EcoButton>
              <EcoButton size="sm" onClick={() => setLineFilters({ search: "", status: "RECOUNT_REQUIRED", cell: "" })}>Требует пересчёта</EcoButton>
              <EcoButton size="sm" onClick={() => setLineFilters({ search: "", status: "PROBLEM", cell: "" })}>Проблемы</EcoButton>
            </div>
          </div>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4">
            <div className="mb-3">
              <div className="flex items-center gap-2 text-base font-semibold text-zinc-950">
                <ScanLine className="h-5 w-5" aria-hidden />
                Сканировать или найти товар
              </div>
              <p className="mt-1 text-sm text-zinc-500">Введите EAN, артикул или внутренний код. Если товар вне области проверки, его можно добавить как найденный.</p>
            </div>
            <div className="grid gap-2">
              <EcoInput value={scanner.barcode} onChange={(event) => setScanner((prev) => ({ ...prev, barcode: event.target.value }))} placeholder="EAN / артикул / код" />
              <EcoSelect value={scanner.mode} onChange={(event) => setScanner((prev) => ({ ...prev, mode: event.target.value }))}>
                <option value="FIND">Найти товар</option>
                <option value="INCREMENT">Каждое сканирование = +1</option>
              </EcoSelect>
              <div className="flex flex-wrap gap-2">
                <EcoButton variant="primary" onClick={() => void scanBarcode()} disabled={working || !scanner.barcode.trim()}>
                  {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
                  Найти
                </EcoButton>
                <EcoButton onClick={() => void scanBarcode()} disabled={working || !scanner.barcode.trim()}>
                  <Camera className="h-4 w-4" aria-hidden />
                  Сканировать камерой
                </EcoButton>
              </div>
            </div>
          </div>
        </div>
      </EcoCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <EcoCard>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="font-semibold text-zinc-950">Импорт результатов</h3>
              <p className="text-sm text-zinc-500">Загрузите заполненный CSV-лист подсчёта. Пустое поле «Фактически» будет пропущено, оно не станет нулём.</p>
            </div>
            <label className="eco-btn eco-btn--secondary eco-btn--sm cursor-pointer">
              {importState.loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileDown className="h-4 w-4" aria-hidden />}
              Импорт CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => void importCountSheet(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          {importState.message && <p className="mt-2 text-sm text-zinc-700">{importState.message}</p>}
        </EcoCard>

        <EcoCard>
          <div className="mb-3 flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-zinc-500" aria-hidden />
            <h3 className="font-semibold text-zinc-950">Найденный вне списка товар</h3>
          </div>
          <div className="grid gap-2 md:grid-cols-6">
            <EcoInput value={foundProduct.productId} onChange={(event) => setFoundProduct((prev) => ({ ...prev, productId: event.target.value }))} placeholder="ID товара" />
            <EcoInput value={foundProduct.ean} onChange={(event) => setFoundProduct((prev) => ({ ...prev, ean: event.target.value }))} placeholder="EAN" />
            <EcoInput className="md:col-span-2" value={foundProduct.name} onChange={(event) => setFoundProduct((prev) => ({ ...prev, name: event.target.value }))} placeholder="Название" />
            <EcoInput value={foundProduct.cellId} onChange={(event) => setFoundProduct((prev) => ({ ...prev, cellId: event.target.value }))} placeholder="Ячейка" />
            <EcoButton onClick={() => void addFoundProduct()} disabled={working}><Plus className="h-4 w-4" aria-hidden />Добавить</EcoButton>
          </div>
        </EcoCard>
      </div>

      <EcoTable className="max-h-[620px]">
        <thead>
          <tr>
            <th>Товар</th>
            <th>Фото</th>
            <th>Артикул / код</th>
            <th>Ячейка</th>
            <th>Учёт</th>
            <th>Факт</th>
            {showAccounting && <th>Разница</th>}
            <th>Статус</th>
            <th>Комментарий</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={line.id}>
              <td>
                <div className="font-medium text-zinc-950">{line.name}</div>
                <div className="text-xs text-zinc-500">{line.brand || "без бренда"} · {line.unitId || "шт"}</div>
                {line.isUnexpected && <EcoBadge tone="rust">найден дополнительно</EcoBadge>}
              </td>
              <td>
                {line.imageHref ? (
                  <img src={line.imageHref} alt="" className="h-12 w-12 rounded-md border border-zinc-200 object-cover" />
                ) : (
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-zinc-200 text-xs text-zinc-400">нет</span>
                )}
              </td>
              <td className="text-xs">
                <div>{line.article || "—"}</div>
                <div>{line.code || line.ean || "—"}</div>
                <div className="mt-1 text-zinc-500">{line.category || "без категории"}</div>
              </td>
              <td>{line.cellId || "без ячейки"}</td>
              <td>
                {showAccounting ? (
                  <>
                    {qty(line.expectedQuantityAtCount)}
                    <div className="text-xs text-zinc-500">резерв {qty(line.snapshotReservedQuantity)}</div>
                  </>
                ) : (
                  <EcoBadge tone="info">скрыт до сверки</EcoBadge>
                )}
              </td>
              <td>
                <div className="flex items-center gap-1">
                  <EcoInput
                    id={`inventory-count-${index}`}
                    className="w-28 text-lg font-semibold"
                    inputMode="decimal"
                    value={inputValues[line.id] ?? ""}
                    onChange={(event) => setInputValues((prev) => ({ ...prev, [line.id]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void saveCount(line).then(() => document.getElementById(`inventory-count-${index + 1}`)?.focus());
                      }
                    }}
                    disabled={props.current.status === "PAUSED"}
                  />
                  <EcoButton size="sm" onClick={() => setInputValues((prev) => ({ ...prev, [line.id]: String(Math.max(0, Number(prev[line.id] || line.finalQuantity || 0) - 1)) }))}>−</EcoButton>
                  <EcoButton size="sm" onClick={() => setInputValues((prev) => ({ ...prev, [line.id]: String(Number(prev[line.id] || line.finalQuantity || 0) + 1) }))}>+</EcoButton>
                </div>
              </td>
              {showAccounting && <td className={line.differenceQuantity && line.differenceQuantity < 0 ? "text-red-700" : line.differenceQuantity && line.differenceQuantity > 0 ? "text-emerald-700" : ""}>{qty(line.differenceQuantity)}<div className="text-xs text-zinc-500">{money(line.differenceCostCents)}</div></td>}
              <td>
                <EcoBadge tone={statusTone(line.status)}>{LINE_STATUS_LABELS[line.status] ?? line.status}</EcoBadge>
                {line.requiresRecount && <div className="mt-1 text-xs text-amber-700">нужен пересчёт</div>}
              </td>
              <td>
                <EcoInput value={inputValues[`comment:${line.id}`] ?? line.comment} onChange={(event) => setInputValues((prev) => ({ ...prev, [`comment:${line.id}`]: event.target.value }))} placeholder="Комментарий" />
              </td>
              <td>
                <div className="flex flex-wrap gap-1">
                  <EcoButton size="sm" onClick={() => void saveCount(line)} disabled={props.current.status === "PAUSED"}>
                    {saveState[line.id] === "saving" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : saveState[line.id] === "saved" ? <Check className="h-4 w-4" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                    {saveState[line.id] === "saving" ? "Сохранение" : saveState[line.id] === "saved" ? "Сохранено" : "Сохранить"}
                  </EcoButton>
                  <EcoButton size="sm" onClick={() => { setInputValues((prev) => ({ ...prev, [line.id]: "0" })); void saveCount(line, true); }} disabled={props.current.status === "PAUSED"}>Фактически 0</EcoButton>
                  <EcoButton size="sm" onClick={() => void saveCount(line, false, "RECOUNT")} disabled={props.current.status === "PAUSED"}><RotateCcw className="h-4 w-4" aria-hidden />Пересчёт</EcoButton>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </EcoTable>
    </div>
  );
}

function actionOptionsForLine(line: InventoryLine) {
  const difference = line.differenceQuantity ?? 0;
  if (difference < 0) {
    return FINAL_ACTIONS.filter((item) => ["SHORTAGE_EXPENSE", "SHORTAGE_TECHNICAL", "RECOUNT", "SKIP"].includes(item.value));
  }
  if (difference > 0) {
    return FINAL_ACTIONS.filter((item) => ["SURPLUS_RECEIPT", "SURPLUS_TECHNICAL", "RECOUNT", "SKIP"].includes(item.value));
  }
  return FINAL_ACTIONS.filter((item) => item.value === "NO_ACTION" || item.value === "CELL_TRANSFER" || item.value === "SKIP");
}

function ReconciliationWorkspace({
  current,
  data,
  saveState,
  saveResolution,
  mutateSession,
  working,
}: {
  current: InventorySession;
  data: ReconciliationResponse | null;
  saveState: SaveState;
  saveResolution: (line: InventoryLine, patch: Partial<InventoryLine>) => Promise<void>;
  mutateSession: (path: string, body?: unknown) => Promise<void>;
  working: boolean;
}) {
  const lines = data?.lines ?? [];
  const shortageRows = lines.filter((line) => (line.differenceQuantity ?? 0) < 0);
  const surplusRows = lines.filter((line) => (line.differenceQuantity ?? 0) > 0);
  const cellTransferRows = lines.filter((line) => (line.finalAction || line.proposedAction) === "CELL_TRANSFER");
  const technicalRows = lines.filter((line) => (line.finalAction || line.proposedAction || "").includes("TECHNICAL"));
  const managementRows = lines.filter((line) => (line.finalAction || line.proposedAction) === "SHORTAGE_EXPENSE");
  const unresolvedReasons = lines.filter((line) => {
    const difference = line.differenceQuantity ?? 0;
    const action = line.finalAction || line.proposedAction;
    return difference !== 0 && action !== "RECOUNT" && action !== "SKIP" && !line.reasonCode;
  }).length;
  const canPost = current.status === "AWAITING_APPROVAL" && Boolean(current.approvedAt) && unresolvedReasons === 0;

  return (
    <div className="space-y-4">
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-7">
        <MiniMetric label="Совпало" value={current.matchingLines} tone="success" />
        <MiniMetric label="Недостача" value={shortageRows.length} sub={money(current.totalShortageCostCents)} tone="danger" />
        <MiniMetric label="Излишек" value={surplusRows.length} sub={money(current.totalSurplusCostCents)} tone="success" />
        <MiniMetric label="Перемещения" value={cellTransferRows.length} />
        <MiniMetric label="Тех. корректировки" value={technicalRows.length} sub={money(current.technicalAdjustmentCents)} tone="info" />
        <MiniMetric label="Обычные списания" value={managementRows.length} sub={money(current.managementExpenseCents)} tone="rust" />
        <MiniMetric label="Влияние на прибыль" value={money(current.managementExpenseCents)} tone="warning" />
      </section>

      <EcoCard>
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">Что произойдёт после проведения</h2>
            <ul className="mt-2 grid gap-1 text-sm text-zinc-700 md:grid-cols-2">
              <li>Будет списано: {shortageRows.length} товаров на сумму {money(current.totalShortageCostCents)}.</li>
              <li>Будет оприходовано: {surplusRows.length} товаров на сумму {money(current.totalSurplusCostCents)}.</li>
              <li>Технических корректировок: {technicalRows.length} на сумму {money(current.technicalAdjustmentCents)}.</li>
              <li>Прибыль уменьшится на {money(current.managementExpenseCents)}.</li>
              <li>Технические корректировки не повлияют на прибыль.</li>
              <li>Складских движений в ведомости: {data?.movements.length ?? 0}.</li>
            </ul>
            {unresolvedReasons > 0 && <p className="mt-3 text-sm font-medium text-red-700">Нельзя провести: {unresolvedReasons} строки без причины расхождения.</p>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
            {current.status === "REVIEW" && <EcoButton onClick={() => void mutateSession("submit-review")} disabled={working}><Send className="h-4 w-4" aria-hidden />На подтверждение</EcoButton>}
            {(current.status === "REVIEW" || (current.status === "AWAITING_APPROVAL" && !current.approvedAt)) && <EcoButton onClick={() => void mutateSession("approve")} disabled={working}><ShieldCheck className="h-4 w-4" aria-hidden />Подтвердить владельцем</EcoButton>}
            {current.status === "AWAITING_APPROVAL" && (
              <EcoButton variant="primary" onClick={() => void mutateSession("post", { idempotencyKey: crypto.randomUUID() })} disabled={working || !canPost}>
                <CheckCircle2 className="h-4 w-4" aria-hidden />Провести инвентаризацию
              </EcoButton>
            )}
            {current.status === "POSTED" && <EcoButton variant="danger" onClick={() => void mutateSession("reverse", { reason: window.prompt("Причина обратной операции") || "" })} disabled={working}><Undo2 className="h-4 w-4" aria-hidden />Создать обратную операцию</EcoButton>}
            {!["POSTED", "REVERSED", "CANCELLED"].includes(current.status) && <EcoButton variant="danger" onClick={() => void mutateSession("cancel", { reason: window.prompt("Причина отмены") || "" })} disabled={working}><XCircle className="h-4 w-4" aria-hidden />Отменить</EcoButton>}
          </div>
        </div>
      </EcoCard>

      <EcoTable className="max-h-[660px]">
        <thead>
          <tr>
            <th>Товар</th>
            <th>Ячейка</th>
            <th>Учёт</th>
            <th>Факт</th>
            <th>Разница</th>
            <th>Резерв</th>
            <th>Себестоимость</th>
            <th>Действие</th>
            <th>Причина</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const action = line.finalAction || line.proposedAction || (line.differenceQuantity && line.differenceQuantity < 0 ? "SHORTAGE_EXPENSE" : line.differenceQuantity && line.differenceQuantity > 0 ? "SURPLUS_RECEIPT" : "NO_ACTION");
            const actionOptions = actionOptionsForLine(line);
            const needsReason = (line.differenceQuantity ?? 0) !== 0 && action !== "RECOUNT" && action !== "SKIP" && !line.reasonCode;
            return (
              <tr key={line.id}>
                <td>
                  <div className="font-medium text-zinc-950">{line.name}</div>
                  <div className="text-xs text-zinc-500">{line.article || line.ean || "—"} · {line.category}</div>
                </td>
                <td>{line.cellId || "без ячейки"}</td>
                <td>{qty(line.expectedQuantityAtCount)}</td>
                <td>{qty(line.finalQuantity)}</td>
                <td className={line.differenceQuantity && line.differenceQuantity < 0 ? "text-red-700" : line.differenceQuantity && line.differenceQuantity > 0 ? "text-emerald-700" : ""}>
                  {qty(line.differenceQuantity)}
                  <div className="text-xs text-zinc-500">{money(line.differenceCostCents)}</div>
                </td>
                <td>{qty(line.snapshotReservedQuantity)}</td>
                <td>{money(line.unitCostSnapshotCents)}</td>
                <td>
                  <EcoSelect value={action} onChange={(event) => void saveResolution(line, { finalAction: event.target.value })}>
                    {actionOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </EcoSelect>
                  <p className="mt-1 text-xs text-zinc-500">{ACTION_HINTS[action] ?? "Выберите, как провести расхождение."}</p>
                  <label className="mt-1 flex items-center gap-2 text-xs text-zinc-600">
                    <input
                      type="checkbox"
                      checked={line.affectsManagementProfit}
                      onChange={(event) => void saveResolution(line, { affectsManagementProfit: event.target.checked })}
                    />
                    влияет на прибыль
                  </label>
                </td>
                <td>
                  <EcoSelect value={line.reasonCode} onChange={(event) => void saveResolution(line, { reasonCode: event.target.value })}>
                    <option value="">Выберите</option>
                    {REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                  </EcoSelect>
                  {needsReason && <p className="mt-1 text-xs text-red-700">Укажите причину</p>}
                </td>
                <td>
                  <EcoBadge tone={statusTone(line.status)}>{LINE_STATUS_LABELS[line.status] ?? line.status}</EcoBadge>
                  {saveState[line.id] === "saving" && <div className="mt-1 text-xs text-zinc-500">Сохранение…</div>}
                  {saveState[line.id] === "saved" && <div className="mt-1 text-xs text-emerald-700">Сохранено</div>}
                  {saveState[line.id] === "error" && <div className="mt-1 text-xs text-red-700">Ошибка сохранения</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </EcoTable>
    </div>
  );
}
