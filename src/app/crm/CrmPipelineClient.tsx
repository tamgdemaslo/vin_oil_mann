"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  CalendarClock,
  Car,
  ChevronDown,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  GripVertical,
  Link2,
  MessageSquare,
  PackageCheck,
  Phone,
  Plus,
  ReceiptText,
  Search,
  Truck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import MoneyInput from "@/components/MoneyInput";
import { ContactActionButton } from "@/components/messenger/ContactActionButton";
import { EcoBadge, EcoButton, EcoKpi, type EcoBadgeTone } from "@/components/platform/EcoUI";
import {
  CLIENT_CASE_STATUS_META,
  defaultNextActionForCaseStatus,
  isClientCaseClosedStatus,
  normalizeClientCaseStatus,
  primaryActionForCaseStatus,
  type ClientCaseAction,
  type ClientCaseStatus,
} from "@/lib/client-case-shared";
import { formatServiceDateTime, formatServiceTime, toServiceDateInput } from "@/lib/date-time";

type ClientType = "new_lead" | "regular" | "repeat" | "unlinked";
type ViewMode =
  | "all"
  | "calculation_needed"
  | "calculation_sent"
  | "check_response"
  | "client_replied"
  | "waiting_parts"
  | "parts_arrived"
  | "overdue"
  | "today"
  | "closed"
  | "mine"
  | "noDeadline"
  | "noResponsible"
  | "new_lead"
  | "regular"
  | "repeat"
  | "unlinked"
  | "withRecord"
  | "withoutDemand"
  | "waitSupplies"
  | "needsEstimate";
type LinkFilter = "all" | "withRecord" | "withoutRecord" | "withDemand" | "withoutDemand";

type Deal = {
  id: string;
  title: string;
  customerName: string | null;
  phoneNormalized: string | null;
  vehicle: string | null;
  source: string | null;
  amountCents: number | null;
  clientType: string | null;
  nextAction: string | null;
  stageId: string;
  responsibleLogin: string | null;
  moyskladCounterpartyId: string | null;
  moyskladCounterpartyName: string | null;
  moyskladCounterpartyHref: string | null;
  yclientsRecordId: string | null;
  moyskladDemandId: string | null;
  organizationId?: string | null;
  conversationId?: string | null;
  appointmentId?: string | null;
  shipmentId?: string | null;
  precheckId?: string | null;
  diagnosticId?: string | null;
  procurementId?: string | null;
  caseStatus?: string | null;
  caseType?: string | null;
  priority?: number | null;
  caseKey?: string | null;
  suppliesNote: string | null;
  suppliesSupplier: string | null;
  suppliesExpectedAt: string | null;
  nextActionAt?: string | null;
  nextContactAt: string | null;
  snoozeUntil: string | null;
  lastClientMessageAt?: string | null;
  lastOutboundMessageAt?: string | null;
  closedAt?: string | null;
  status: "open" | "won" | "lost" | string;
  closeReason: string | null;
  notes: string | null;
  createdByLogin: string;
  createdAt: string;
  updatedAt: string;
};

type Meta = { href: string; type: string; mediaType: string };
type Counterparty = { id: string; name: string; phone?: string | null; normalizedPhone?: string | null; meta: Meta };

type Stage = {
  id: string;
  name: string;
  sortOrder: number;
  color: string | null;
  deals: Deal[];
};

type PipelineResponse = {
  stages: Stage[];
  error?: string;
  hint?: string;
};

type CreateForm = {
  title: string;
  customerName: string;
  phone: string;
  clientType: ClientType;
  vehicle: string;
  source: string;
  amount: string;
  stageId: string;
  nextAction: string;
  nextContactAt: string;
  responsibleLogin: string;
  notes: string;
  yclientsRecordId: string;
  moyskladDemandId: string;
  suppliesNote: string;
  suppliesSupplier: string;
  suppliesExpectedAt: string;
  createLocalClient: boolean;
  createMoyskladCounterparty: boolean;
};

const EMPTY_FORM: CreateForm = {
  title: "",
  customerName: "",
  phone: "",
  clientType: "new_lead",
  vehicle: "",
  source: "",
  amount: "",
  stageId: "",
  nextAction: "",
  nextContactAt: "",
  responsibleLogin: "",
  notes: "",
  yclientsRecordId: "",
  moyskladDemandId: "",
  suppliesNote: "",
  suppliesSupplier: "",
  suppliesExpectedAt: "",
  createLocalClient: true,
  createMoyskladCounterparty: false,
};

const CLIENT_TYPE_META: Record<ClientType, { label: string; tone: EcoBadgeTone; className: string }> = {
  new_lead: { label: "Новый лид", tone: "info", className: "is-new" },
  regular: { label: "Постоянный клиент", tone: "success", className: "is-regular" },
  repeat: { label: "Повторное обращение", tone: "warning", className: "is-repeat" },
  unlinked: { label: "Без клиента", tone: "neutral", className: "is-unlinked" },
};

const QUICK_FILTERS: Array<{ id: ViewMode; label: string }> = [
  { id: "all", label: "Все актуальные" },
  { id: "calculation_needed", label: "Нужно рассчитать" },
  { id: "check_response", label: "Проверить ответ" },
  { id: "waiting_parts", label: "Ожидает запчасти" },
  { id: "today", label: "Сегодня" },
  { id: "overdue", label: "Просроченные" },
  { id: "closed", label: "Закрытые" },
];

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function formatMoney(amountCents: number | null) {
  if (amountCents == null || amountCents === 0) return "Без суммы";
  return `${(amountCents / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} ₽`;
}

function formatPhone(value: string | null) {
  if (!value) return "Телефон не указан";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("7")) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 10) {
    return `+7 ${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8)}`;
  }
  return value;
}

function formatDateTime(value: string | null) {
  if (!value) return "Без срока";
  const formatted = formatServiceDateTime(value);
  return formatted === "—" ? "Без срока" : formatted;
}

function formatDateShort(date: Date) {
  return formatServiceDateTime(date).replace(/\.\d{4},?/, "");
}

function dateInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function quickReminderInput(kind: "oneHour" | "threeHours" | "today" | "tomorrow" | "twoDays" | "threeDays" | "week") {
  const date = new Date();
  if (kind === "oneHour") date.setHours(date.getHours() + 1, 0, 0, 0);
  if (kind === "threeHours") date.setHours(date.getHours() + 3, 0, 0, 0);
  if (kind === "tomorrow") date.setDate(date.getDate() + 1);
  if (kind === "twoDays") date.setDate(date.getDate() + 2);
  if (kind === "threeDays") date.setDate(date.getDate() + 3);
  if (kind === "week") date.setDate(date.getDate() + 7);
  if (kind !== "oneHour" && kind !== "threeHours") {
    date.setHours(kind === "today" ? Math.max(date.getHours() + 2, 12) : 10, 0, 0, 0);
  }
  return dateInputValue(date);
}

function isSameDay(date: Date, compare: Date) {
  return toServiceDateInput(date) === toServiceDateInput(compare);
}

function isTomorrow(date: Date) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return isSameDay(date, tomorrow);
}

function durationLabel(milliseconds: number) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} ч ${rest} мин`;
  if (hours) return `${hours} ч`;
  return `${rest} мин`;
}

function deadlineInfo(
  value: string | null,
  inactive = false,
  snoozeUntil?: string | null
): { label: string; tone: EcoBadgeTone; overdue: boolean; soon: boolean } {
  if (snoozeUntil) {
    const snoozeDate = new Date(snoozeUntil);
    if (!Number.isNaN(snoozeDate.getTime()) && snoozeDate.getTime() > Date.now()) {
      return { label: `Отложено до ${formatServiceTime(snoozeDate)}`, tone: "neutral", overdue: false, soon: false };
    }
  }
  if (!value) return { label: "Без срока", tone: "neutral", overdue: false, soon: false };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { label: "Без срока", tone: "neutral", overdue: false, soon: false };
  const overdue = !inactive && date.getTime() < Date.now();
  if (overdue) {
    return {
      label: `Просрочено на ${durationLabel(Date.now() - date.getTime())}`,
      tone: "danger",
      overdue: true,
      soon: false,
    };
  }
  const soon = !inactive && date.getTime() - Date.now() <= 60 * 60 * 1000;
  if (soon) {
    return {
      label: `Скоро · через ${durationLabel(date.getTime() - Date.now())}`,
      tone: "warning",
      overdue: false,
      soon: true,
    };
  }
  if (isSameDay(date, new Date())) {
    return {
      label: `Сегодня ${formatServiceTime(date)}`,
      tone: "warning",
      overdue: false,
      soon: false,
    };
  }
  if (isTomorrow(date)) {
    return {
      label: `Завтра ${formatServiceTime(date)}`,
      tone: "info",
      overdue: false,
      soon: false,
    };
  }
  return { label: formatDateShort(date), tone: "neutral", overdue: false, soon: false };
}

function normalizeStageName(value: string) {
  return value.toLowerCase().replace(/ё/g, "е");
}

function stageAccent(color: string | null) {
  if (color === "emerald") return "#059669";
  if (color === "rose") return "#e11d48";
  if (color === "sky" || color === "blue") return "#0284c7";
  if (color === "violet") return "#7c3aed";
  if (color === "orange" || color === "amber") return "#c2410c";
  return "#52525b";
}

function isClosedStage(stage?: Stage | null) {
  if (!stage) return false;
  const name = normalizeStageName(stage.name);
  return name.includes("закры") || name.includes("оплач") || name.includes("потер") || name.includes("отказ") || name.includes("дубль") || name.includes("архив") || name.includes("lost");
}

function isSupplyStage(stage?: Stage | null) {
  if (!stage) return false;
  const name = normalizeStageName(stage.name);
  return name.includes("расход") || name.includes("запчаст");
}

function isQuoteSentStage(stage?: Stage | null) {
  return Boolean(stage && normalizeStageName(stage.name).includes("расчет отправлен"));
}

function isRecordCreatedStage(stage?: Stage | null) {
  return Boolean(stage && normalizeStageName(stage.name).includes("запись создана"));
}

function isVisitDocumentStage(stage?: Stage | null) {
  if (!stage) return false;
  const name = normalizeStageName(stage.name);
  return name.includes("на визите") || name.includes("документ");
}

function caseStatusOf(deal: Deal, stage?: Stage | null): ClientCaseStatus {
  return normalizeClientCaseStatus(deal.caseStatus, stage?.name);
}

function caseDueAt(deal: Deal) {
  return deal.nextActionAt ?? deal.nextContactAt;
}

function isSnoozedFuture(deal: Deal) {
  if (!deal.snoozeUntil) return false;
  const snoozeDate = new Date(deal.snoozeUntil);
  return !Number.isNaN(snoozeDate.getTime()) && snoozeDate.getTime() > Date.now();
}

function isDealInactive(deal: Deal, stage?: Stage | null) {
  return deal.status !== "open" || isClosedStage(stage) || isClientCaseClosedStatus(deal.caseStatus, stage?.name);
}

function loginLabel(value: string | null) {
  return value?.trim() || "Без ответственного";
}

function shortId(value: string) {
  if (value.length <= 8) return value;
  return `CRM-${value.slice(-6).toUpperCase()}`;
}

function resolveClientType(deal: Deal): ClientType {
  if (deal.clientType === "new_lead" || deal.clientType === "regular" || deal.clientType === "repeat" || deal.clientType === "unlinked") {
    return deal.clientType;
  }
  if (!deal.customerName && !deal.phoneNormalized && !deal.moyskladCounterpartyId) return "unlinked";
  if (deal.source?.toLowerCase().includes("повтор")) return "repeat";
  if (deal.moyskladCounterpartyId) return "regular";
  return "new_lead";
}

function matchQuery(deal: Deal, query: string) {
  if (!query) return true;
  const haystack = [
    deal.title,
    deal.customerName,
    deal.phoneNormalized,
    deal.vehicle,
    deal.source,
    deal.responsibleLogin,
    deal.moyskladCounterpartyName,
    deal.nextAction,
    deal.notes,
    deal.suppliesNote,
    deal.suppliesSupplier,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function displayCustomerName(deal: Deal) {
  return deal.customerName || deal.moyskladCounterpartyName || deal.phoneNormalized || "Клиент не привязан";
}

function linkedClientSearch(deal: Deal) {
  return encodeURIComponent(deal.customerName || deal.moyskladCounterpartyName || deal.phoneNormalized || "");
}

function newShipmentHrefFromDeal(deal: Deal) {
  const params = new URLSearchParams();
  params.set("crmDealId", deal.id);
  const clientName = deal.customerName || deal.moyskladCounterpartyName || "";
  if (clientName) params.set("counterparty", clientName);
  if (deal.phoneNormalized) params.set("phone", deal.phoneNormalized);
  if (deal.vehicle) params.set("vehicle", deal.vehicle);
  if (deal.notes) params.set("comment", deal.notes);
  const query = params.toString();
  return query ? `/shipment/new?${query}` : "/shipment/new";
}

function recordsHrefFromDeal(deal: Deal) {
  const params = new URLSearchParams();
  if (deal.yclientsRecordId) {
    params.set("recordId", deal.yclientsRecordId);
    return `/records?${params.toString()}`;
  }
  params.set("new", "1");
  params.set("crmDealId", deal.id);
  params.set("source", "CRM-дело");
  params.set("comment", [deal.title, deal.nextAction, deal.notes].filter(Boolean).join("\n"));
  if (deal.phoneNormalized) params.set("phone", deal.phoneNormalized);
  if (deal.customerName || deal.moyskladCounterpartyName) params.set("client", deal.customerName || deal.moyskladCounterpartyName || "");
  if (deal.vehicle) params.set("vehicle", deal.vehicle);
  if (deal.responsibleLogin) params.set("responsible", deal.responsibleLogin);
  const query = params.toString();
  return query ? `/records?${query}` : "/records";
}

export default function CrmPipelineClient({
  userLogin,
  userName,
}: {
  userLogin: string;
  userName: string;
}) {
  const searchParams = useSearchParams();
  const [stages, setStages] = useState<Stage[]>([]);
  const [form, setForm] = useState<CreateForm>({ ...EMPTY_FORM, responsibleLogin: userLogin });
  const [formOpen, setFormOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"create" | "open">("create");
  const [counterpartySearch, setCounterpartySearch] = useState("");
  const [counterpartyOptions, setCounterpartyOptions] = useState<Counterparty[]>([]);
  const [selectedCounterparty, setSelectedCounterparty] = useState<Counterparty | null>(null);
  const [counterpartyLoading, setCounterpartyLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [movingDealId, setMovingDealId] = useState<string | null>(null);
  const [dragDealId, setDragDealId] = useState<string | null>(null);
  const [dragStageId, setDragStageId] = useState<string | null>(null);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [expandedDealByStage, setExpandedDealByStage] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("all");
  const [query, setQuery] = useState("");
  const [responsibleFilter, setResponsibleFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");

  const stageById = useMemo(() => new Map(stages.map((stage) => [stage.id, stage])), [stages]);
  const allDeals = useMemo(() => stages.flatMap((stage) => stage.deals), [stages]);
  const selectedDeal = useMemo(() => allDeals.find((deal) => deal.id === selectedDealId) ?? null, [allDeals, selectedDealId]);
  const selectedStage = selectedDeal ? stageById.get(selectedDeal.stageId) ?? null : null;

  const responsibleOptions = useMemo(
    () => Array.from(new Set(allDeals.map((deal) => loginLabel(deal.responsibleLogin)))).sort((a, b) => a.localeCompare(b, "ru")),
    [allDeals]
  );

  const sourceOptions = useMemo(
    () =>
      Array.from(new Set(allDeals.map((deal) => deal.source?.trim()).filter((source): source is string => Boolean(source)))).sort(
        (a, b) => a.localeCompare(b, "ru")
      ),
    [allDeals]
  );

  const activeDeals = useMemo(
    () => allDeals.filter((deal) => !isDealInactive(deal, stageById.get(deal.stageId)) && !isSnoozedFuture(deal)),
    [allDeals, stageById]
  );

  const kpi = useMemo(() => {
    const overdue = activeDeals.filter((deal) => deadlineInfo(caseDueAt(deal), false, deal.snoozeUntil).overdue).length;
    const today = activeDeals.filter((deal) => {
      const dueAt = caseDueAt(deal);
      if (!dueAt) return false;
      const date = new Date(dueAt);
      return !Number.isNaN(date.getTime()) && isSameDay(date, new Date());
    }).length;
    const regularClients = new Set(
      activeDeals
        .filter((deal) => {
          const type = resolveClientType(deal);
          return type === "regular" || type === "repeat";
        })
        .map((deal) => deal.moyskladCounterpartyId || deal.phoneNormalized || deal.customerName || deal.id)
    ).size;
    return {
      active: activeDeals.length,
      overdue,
      today,
      checkResponse: activeDeals.filter((deal) => caseStatusOf(deal, stageById.get(deal.stageId)) === "check_response").length,
      clientReplies: activeDeals.filter((deal) => caseStatusOf(deal, stageById.get(deal.stageId)) === "client_replied").length,
      noDeadline: activeDeals.filter((deal) => !caseDueAt(deal)).length,
      newLeads: activeDeals.filter((deal) => resolveClientType(deal) === "new_lead").length,
      regularClients,
      waitEstimate: activeDeals.filter((deal) => caseStatusOf(deal, stageById.get(deal.stageId)) === "calculation_needed").length,
      sentCalculations: activeDeals.filter((deal) => caseStatusOf(deal, stageById.get(deal.stageId)) === "calculation_sent").length,
      waitSupplies: activeDeals.filter((deal) => caseStatusOf(deal, stageById.get(deal.stageId)) === "waiting_parts" || Boolean(deal.suppliesNote)).length,
    };
  }, [activeDeals, stageById]);

  const filteredStages = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return stages.map((stage) => ({
      ...stage,
      deals: stage.deals.filter((deal) => {
        const dealStage = stageById.get(deal.stageId);
        const inactive = isDealInactive(deal, dealStage);
        const clientType = resolveClientType(deal);
        const dealStatus = caseStatusOf(deal, dealStage);
        const deadline = deadlineInfo(caseDueAt(deal), inactive, deal.snoozeUntil);
        const snoozedFuture = isSnoozedFuture(deal);

        if (view === "closed") {
          if (!inactive) return false;
        } else if (inactive) {
          return false;
        }
        if (view === "all" && snoozedFuture) return false;
        if (view === "mine" && deal.responsibleLogin !== userLogin) return false;
        if (view === "overdue" && !deadline.overdue) return false;
        if (view === "noDeadline" && caseDueAt(deal)) return false;
        if (
          (view === "calculation_needed" ||
            view === "calculation_sent" ||
            view === "check_response" ||
            view === "client_replied" ||
            view === "waiting_parts" ||
            view === "parts_arrived") &&
          dealStatus !== view
        ) {
          return false;
        }
        if (view === "today") {
          const dueAt = caseDueAt(deal);
          if (!dueAt) return false;
          const date = new Date(dueAt);
          if (Number.isNaN(date.getTime()) || !isSameDay(date, new Date())) return false;
        }
        if (view === "noResponsible" && deal.responsibleLogin) return false;
        if ((view === "new_lead" || view === "regular" || view === "repeat" || view === "unlinked") && clientType !== view) return false;
        if (view === "withRecord" && !deal.yclientsRecordId) return false;
        if (view === "withoutDemand" && deal.moyskladDemandId) return false;
        if (view === "waitSupplies" && !(dealStatus === "waiting_parts" || Boolean(deal.suppliesNote || deal.suppliesExpectedAt))) return false;
        if (view === "needsEstimate" && dealStatus !== "calculation_needed") return false;
        if (responsibleFilter !== "all" && loginLabel(deal.responsibleLogin) !== responsibleFilter) return false;
        if (sourceFilter !== "all" && deal.source?.trim() !== sourceFilter) return false;
        if (stageFilter !== "all" && deal.stageId !== stageFilter) return false;
        if (linkFilter === "withRecord" && !deal.yclientsRecordId) return false;
        if (linkFilter === "withoutRecord" && deal.yclientsRecordId) return false;
        if (linkFilter === "withDemand" && !deal.moyskladDemandId) return false;
        if (linkFilter === "withoutDemand" && deal.moyskladDemandId) return false;
        return matchQuery(deal, normalizedQuery);
      }),
    }));
  }, [linkFilter, query, responsibleFilter, sourceFilter, stageById, stageFilter, stages, userLogin, view]);

  const filteredDeals = useMemo(
    () =>
      filteredStages
        .flatMap((stage) => stage.deals)
        .sort((a, b) => {
          const aStage = stageById.get(a.stageId);
          const bStage = stageById.get(b.stageId);
          const aRank = CLIENT_CASE_STATUS_META[caseStatusOf(a, aStage)].rank;
          const bRank = CLIENT_CASE_STATUS_META[caseStatusOf(b, bStage)].rank;
          const aTime = caseDueAt(a) ? new Date(caseDueAt(a)!).getTime() : Number.MAX_SAFE_INTEGER;
          const bTime = caseDueAt(b) ? new Date(caseDueAt(b)!).getTime() : Number.MAX_SAFE_INTEGER;
          return aRank - bRank || aTime - bTime;
        }),
    [filteredStages, stageById]
  );

  const loadPipeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch("/api/crm/deals", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as PipelineResponse;
      if (!res.ok) {
        setError(data.error ?? "Не удалось загрузить CRM");
        setHint(data.hint ?? null);
        return;
      }
      setStages(data.stages ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPipeline();
  }, [loadPipeline]);

  useEffect(() => {
    const filter = searchParams.get("filter");
    if (filter === "overdue") setView("overdue");
    if (filter === "today") setView("today");
    if (filter === "check_response") setView("check_response");
    if (filter === "waiting_parts") setView("waiting_parts");
  }, [searchParams]);

  useEffect(() => {
    const focusDealId = searchParams.get("dealId") || searchParams.get("crmDealId") || searchParams.get("deal");
    if (!focusDealId || allDeals.length === 0) return;
    const deal = allDeals.find((item) => item.id === focusDealId);
    if (!deal) return;
    setSelectedDealId(deal.id);
    setExpandedDealByStage((prev) => ({ ...prev, [deal.stageId]: deal.id }));
  }, [allDeals, searchParams]);

  useEffect(() => {
    const queryText = counterpartySearch.trim();
    if (queryText.length < 2 || selectedCounterparty) {
      setCounterpartyOptions([]);
      setCounterpartyLoading(false);
      return;
    }
    const timer = setTimeout(() => {
      setCounterpartyLoading(true);
      fetch(`/api/moysklad/counterparties?search=${encodeURIComponent(queryText)}&limit=10`)
        .then((res) => res.json())
        .then((data) => {
          setCounterpartyOptions(Array.isArray(data.counterparties) ? data.counterparties : []);
        })
        .catch(() => setCounterpartyOptions([]))
        .finally(() => setCounterpartyLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [counterpartySearch, selectedCounterparty]);

  function updateForm<K extends keyof CreateForm>(key: K, value: CreateForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openNewCase(stageId?: string) {
    setError(null);
    setHint(null);
    setSelectedCounterparty(null);
    setCounterpartySearch("");
    setCounterpartyOptions([]);
    setForm({
      ...EMPTY_FORM,
      stageId: stageId ?? stages[0]?.id ?? "",
      responsibleLogin: userLogin,
      nextAction: stageId ? defaultNextAction(stages.find((stage) => stage.id === stageId)?.name) : "",
    });
    setFormOpen(true);
  }

  function selectCounterparty(counterparty: Counterparty) {
    setSelectedCounterparty(counterparty);
    setCounterpartySearch(counterparty.name);
    setCounterpartyOptions([]);
    setForm((prev) => ({
      ...prev,
      customerName: prev.customerName || counterparty.name,
      phone: prev.phone || counterparty.phone || counterparty.normalizedPhone || "",
      clientType: "regular",
      createLocalClient: false,
      createMoyskladCounterparty: false,
    }));
  }

  async function createLocalCounterpartyIfNeeded() {
    if (selectedCounterparty || !form.createLocalClient) return selectedCounterparty;
    const name = form.customerName.trim() || form.title.trim();
    if (!name) return null;
    const res = await fetch("/api/moysklad/counterparties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone: form.phone, companyType: "individual" }),
    });
    const data = (await res.json().catch(() => ({}))) as Counterparty & { error?: string };
    if (!res.ok) throw new Error(data.error || "Не удалось сохранить клиента в локальной CRM");
    return data;
  }

  async function createDeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setHint(null);
    try {
      const counterparty = await createLocalCounterpartyIfNeeded();
      const res = await fetch("/api/crm/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          moyskladCounterpartyName: counterpartySearch.trim() || form.customerName || form.title,
          moyskladCounterparty: counterparty,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as Deal & { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Не удалось создать дело клиента");
        return;
      }
      setForm({ ...EMPTY_FORM, responsibleLogin: userLogin });
      setSelectedCounterparty(null);
      setCounterpartySearch("");
      setCounterpartyOptions([]);
      setFormOpen(false);
      await loadPipeline();
      if (createMode === "open") setSelectedDealId(data.id);
      setCreateMode("create");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать дело клиента");
    } finally {
      setSaving(false);
    }
  }

  async function patchDeal(dealId: string, data: Record<string, unknown>) {
    const res = await fetch(`/api/crm/deals/${dealId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(typeof payload.error === "string" ? payload.error : "Не удалось обновить дело клиента");
  }

  function askControlDeadline(deal: Deal, targetStage: Stage) {
    if (!isQuoteSentStage(targetStage)) return caseDueAt(deal);
    if (caseDueAt(deal)) return caseDueAt(deal);
    const fallback = new Date();
    fallback.setHours(fallback.getHours() + 24, 0, 0, 0);
    return dateInputValue(fallback);
  }

  async function moveDeal(deal: Deal, targetStage: Stage) {
    if (deal.stageId === targetStage.id) return;
    setMovingDealId(deal.id);
    setError(null);
    try {
      const requiredDeadline = askControlDeadline(deal, targetStage);
      if (isQuoteSentStage(targetStage) && !requiredDeadline) return;
      const patch: Record<string, unknown> = {
        stageId: targetStage.id,
        caseStatus: normalizeClientCaseStatus(undefined, targetStage.name),
        status: isClosedStage(targetStage) ? "won" : "open",
      };
      if (!deal.nextAction) patch.nextAction = defaultNextAction(targetStage.name);
      if (isQuoteSentStage(targetStage)) {
        patch.nextAction = "Проконтролировать ответ клиента";
        patch.nextContactAt = requiredDeadline;
        patch.nextActionAt = requiredDeadline;
        patch.lastOutboundMessageAt = new Date().toISOString();
      }
      if (isRecordCreatedStage(targetStage) && !deal.nextAction) patch.nextAction = "Подготовить визит";
      if (isVisitDocumentStage(targetStage) && !deal.nextAction) patch.nextAction = "Проконтролировать документ";
      if (!caseDueAt(deal) && patch.nextContactAt === undefined && shouldSuggestReminder(targetStage.name)) {
        patch.nextContactAt = quickReminderInput(targetStage.name.includes("ответ") ? "tomorrow" : "today");
        patch.nextActionAt = patch.nextContactAt;
      }
      await patchDeal(deal.id, patch);
      await loadPipeline();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось переместить дело");
    } finally {
      setMovingDealId(null);
      setDragDealId(null);
      setDragStageId(null);
    }
  }

  async function updateReminder(deal: Deal, value: string | null) {
    setMovingDealId(deal.id);
    try {
      await patchDeal(deal.id, {
        nextActionAt: value,
        nextContactAt: value,
        snoozeUntil: value,
        caseStatus: value ? "postponed" : caseStatusOf(deal, stageById.get(deal.stageId)),
      });
      await loadPipeline();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить напоминание");
    } finally {
      setMovingDealId(null);
    }
  }

  async function closeDeal(deal: Deal, reason: string) {
    const closeReason =
      window.prompt(
        "Причина закрытия: записан и обслужен / отказался / не отвечает / неактуально / дубль / нет возможности / перенесено",
        reason
      )?.trim() || reason;
    setMovingDealId(deal.id);
    try {
      const closedStage = stages.find(isClosedStage);
      await patchDeal(deal.id, {
        status: "won",
        caseStatus: "closed",
        closeReason,
        nextActionAt: null,
        nextContactAt: null,
        snoozeUntil: null,
        ...(closedStage ? { stageId: closedStage.id } : {}),
      });
      await loadPipeline();
      setSelectedDealId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось закрыть дело");
    } finally {
      setMovingDealId(null);
    }
  }

  async function runCaseAction(deal: Deal, action: ClientCaseAction, body: Record<string, unknown> = {}) {
    setMovingDealId(deal.id);
    setError(null);
    try {
      const res = await fetch(`/api/client-cases/${encodeURIComponent(deal.id)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(payload.error || "Не удалось выполнить действие");
      await loadPipeline();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
    } finally {
      setMovingDealId(null);
    }
  }

  async function copyText(value: string | null) {
    if (!value) return;
    await navigator.clipboard?.writeText(value).catch(() => undefined);
  }

  function toggleDealExpanded(stageId: string, dealId: string) {
    setExpandedDealByStage((prev) => ({
      ...prev,
      [stageId]: prev[stageId] === dealId ? null : dealId,
    }));
  }

  return (
    <main className="eco-page eco-crm-page">
      <section className="eco-page-head eco-crm-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <span>CRM</span>
            <span className="sep">/</span>
            <span className="cur">Дела клиентов</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Дела клиентов</h1>
            <EcoBadge>{kpi.active} активных</EcoBadge>
            <EcoBadge tone={kpi.overdue ? "danger" : "success"} dot>
              {kpi.overdue} просрочено
            </EcoBadge>
            <EcoBadge tone="warning">{kpi.checkResponse} проверить ответ</EcoBadge>
            <EcoBadge tone={kpi.clientReplies ? "success" : "neutral"}>{kpi.clientReplies} с ответом</EcoBadge>
          </div>
          <p className="eco-page-subtitle">
            Рабочая очередь по клиентам: рассчитать, отправить расчёт, проверить ответ, дождаться запчастей, записать или закрыть вопрос.
            Ответственный по умолчанию: {userName || userLogin}.
          </p>
        </div>
        <div className="eco-page-actions">
          <Link href="/records" className="eco-btn">
            <CalendarClock size={15} />
            Журнал записей
          </Link>
          <EcoButton variant="primary" type="button" onClick={() => openNewCase()}>
            <Plus size={15} />
            Новое дело
          </EcoButton>
        </div>
      </section>

      <div className="eco-grid eco-grid--kpi eco-crm-metrics">
        <EcoKpi label="Все актуальные" value={kpi.active} tone="info" />
        <EcoKpi label="Просрочено" value={kpi.overdue} tone={kpi.overdue ? "danger" : "success"} />
        <EcoKpi label="На сегодня" value={kpi.today} tone="warning" />
        <EcoKpi label="Проверить ответ" value={kpi.checkResponse} tone="warning" />
        <EcoKpi label="Клиент ответил" value={kpi.clientReplies} tone="success" />
        <EcoKpi label="Нужно рассчитать" value={kpi.waitEstimate} tone="rust" />
        <EcoKpi label="Расчёт отправлен" value={kpi.sentCalculations} tone="info" />
        <EcoKpi label="Ожидает запчасти" value={kpi.waitSupplies} tone="warning" />
      </div>

      <div className="eco-crm-filter-strip">
        <div className="eco-crm-view-tabs" aria-label="Представление CRM">
          <button type="button" className="is-active">
            Очередь действий
          </button>
          <button type="button" disabled>
            Воронка продаж
          </button>
        </div>
        <div className="eco-search-wrap eco-crm-search">
          <Search className="eco-icon" size={15} />
          <input
            className="eco-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Клиент, телефон, авто, дело, комментарий..."
          />
        </div>
        <div className="eco-crm-filter-pills">
          {QUICK_FILTERS.map((filter) => (
            <button key={filter.id} type="button" className={cx(view === filter.id && "is-active")} onClick={() => setView(filter.id)}>
              {filter.label}
            </button>
          ))}
        </div>
        <label className="eco-select-chip">
          <span>Ответственный:</span>
          <select value={responsibleFilter} onChange={(event) => setResponsibleFilter(event.target.value)} className="eco-select-inline">
            <option value="all">Все</option>
            {responsibleOptions.map((responsible) => (
              <option key={responsible} value={responsible}>
                {responsible}
              </option>
            ))}
          </select>
        </label>
        <label className="eco-select-chip">
          <span>Статус:</span>
          <select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)} className="eco-select-inline">
            <option value="all">Все</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
        <label className="eco-select-chip">
          <span>Источник:</span>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="eco-select-inline">
            <option value="all">Все</option>
            {sourceOptions.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </label>
        <label className="eco-select-chip">
          <span>Связи:</span>
          <select value={linkFilter} onChange={(event) => setLinkFilter(event.target.value as LinkFilter)} className="eco-select-inline">
            <option value="all">Все</option>
            <option value="withRecord">Есть запись</option>
            <option value="withoutRecord">Нет записи</option>
            <option value="withDemand">Есть отгрузка</option>
            <option value="withoutDemand">Нет отгрузки</option>
          </select>
        </label>
      </div>

      {error && <p className="eco-form-error eco-crm-page-error">{error}</p>}
      {hint && <p className="eco-form-hint eco-crm-page-error">{hint}</p>}

      <section className="eco-crm-board-shell" aria-label="Канбан клиентских дел">
        {loading ? (
          <div className="eco-card eco-card--padded muted">Загружаем дела клиентов...</div>
        ) : (
          <div className="eco-crm-board" style={{ gridTemplateColumns: `repeat(${Math.max(stages.length, 1)}, minmax(300px, 320px))` }}>
            {filteredStages.map((stage) => {
              const stageAmount = stage.deals.reduce((sum, deal) => sum + (deal.amountCents ?? 0), 0);
              const overdueCount = stage.deals.filter((deal) => deadlineInfo(caseDueAt(deal), isDealInactive(deal, stage), deal.snoozeUntil).overdue).length;

              return (
                <div
                  key={stage.id}
                  className={cx("eco-crm-column", dragStageId === stage.id && "is-drag-over", stage.deals.length === 0 && "is-empty")}
                  style={{ borderTopColor: stageAccent(stage.color) }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragStageId(stage.id);
                  }}
                  onDragLeave={() => setDragStageId(null)}
                  onDrop={(event) => {
                    event.preventDefault();
                    const deal = allDeals.find((item) => item.id === (dragDealId || event.dataTransfer.getData("text/plain")));
                    if (deal) void moveDeal(deal, stage);
                  }}
                >
                  <div className="eco-crm-column-head">
                    <div>
                      <div className="eco-crm-column-title">
                        <span>{stage.name}</span>
                        <span className="eco-crm-column-count">{stage.deals.length}</span>
                      </div>
                      <div className="eco-crm-column-sub">
                        <span>{stage.deals.length} дел</span>
                        {overdueCount > 0 && <span className="is-danger">{overdueCount} просрочено</span>}
                        {stageAmount > 0 && <span>{formatMoney(stageAmount)}</span>}
                      </div>
                    </div>
                    <button type="button" className="eco-icon-btn" aria-label={`Добавить в ${stage.name}`} onClick={() => openNewCase(stage.id)}>
                      <Plus size={15} />
                    </button>
                  </div>

                  <div className="eco-crm-cards">
                    {stage.deals.length === 0 ? (
                      <div className="eco-crm-empty">Нет дел в этом статусе</div>
                    ) : (
                      stage.deals.map((deal) => (
                        <DealCard
                          key={deal.id}
                          deal={deal}
                          stage={stage}
                          stages={stages}
                          expanded={expandedDealByStage[stage.id] === deal.id}
                          moving={movingDealId === deal.id}
                          onOpen={() => setSelectedDealId(deal.id)}
                          onToggle={() => toggleDealExpanded(stage.id, deal.id)}
                          onMove={(targetStage) => void moveDeal(deal, targetStage)}
                          onAction={(action, body) => void runCaseAction(deal, action, body)}
                          onReminder={(value) => void updateReminder(deal, value)}
                          onCloseCase={(reason) => void closeDeal(deal, reason)}
                          onDragStart={(event) => {
                            setDragDealId(deal.id);
                            event.dataTransfer.setData("text/plain", deal.id);
                            event.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            setDragDealId(null);
                            setDragStageId(null);
                          }}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="eco-crm-mobile-list" aria-label="Список клиентских дел">
        {filteredDeals.length === 0 ? (
          <div className="eco-crm-empty">Нет дел под текущие фильтры</div>
        ) : (
          filteredDeals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              stage={stageById.get(deal.stageId)}
              stages={stages}
              expanded={expandedDealByStage[deal.stageId] === deal.id}
              moving={movingDealId === deal.id}
              onOpen={() => setSelectedDealId(deal.id)}
              onToggle={() => toggleDealExpanded(deal.stageId, deal.id)}
              onMove={(targetStage) => void moveDeal(deal, targetStage)}
              onAction={(action, body) => void runCaseAction(deal, action, body)}
              onReminder={(value) => void updateReminder(deal, value)}
              onCloseCase={(reason) => void closeDeal(deal, reason)}
            />
          ))
        )}
      </section>

      {formOpen && (
        <CaseFormDrawer
          form={form}
          stages={stages}
          saving={saving}
          error={error}
          counterpartySearch={counterpartySearch}
          counterpartyOptions={counterpartyOptions}
          counterpartyLoading={counterpartyLoading}
          selectedCounterparty={selectedCounterparty}
          userLogin={userLogin}
          onClose={() => setFormOpen(false)}
          onSubmit={createDeal}
          onCreateModeChange={setCreateMode}
          onChange={updateForm}
          onCounterpartySearch={(value) => {
            setSelectedCounterparty(null);
            setCounterpartySearch(value);
            updateForm("createMoyskladCounterparty", false);
          }}
          onSelectCounterparty={selectCounterparty}
          onClearCounterparty={() => {
            setSelectedCounterparty(null);
            setCounterpartySearch("");
            updateForm("clientType", "new_lead");
            updateForm("createLocalClient", true);
          }}
        />
      )}

      {selectedDeal && (
        <CaseDrawer
          deal={selectedDeal}
          stage={selectedStage}
          stages={stages}
          moving={movingDealId === selectedDeal.id}
          onClose={() => setSelectedDealId(null)}
          onCopy={copyText}
          onMove={(stage) => void moveDeal(selectedDeal, stage)}
          onAction={(action, body) => void runCaseAction(selectedDeal, action, body)}
          onReminder={(value) => void updateReminder(selectedDeal, value)}
          onCloseCase={(reason) => void closeDeal(selectedDeal, reason)}
        />
      )}
    </main>
  );
}

function defaultNextAction(stageName?: string | null) {
  return defaultNextActionForCaseStatus(undefined, stageName);
}

function shouldSuggestReminder(stageName: string) {
  const name = normalizeStageName(stageName);
  return name.includes("рассчитать") || name.includes("расчет") || name.includes("ответ");
}

function DealCard({
  deal,
  stage,
  stages,
  expanded,
  moving,
  onOpen,
  onToggle,
  onMove,
  onAction,
  onReminder,
  onCloseCase,
  onDragStart,
  onDragEnd,
}: {
  deal: Deal;
  stage?: Stage | null;
  stages: Stage[];
  expanded: boolean;
  moving: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onMove: (stage: Stage) => void;
  onAction: (action: ClientCaseAction, body?: Record<string, unknown>) => void;
  onReminder: (value: string | null) => void;
  onCloseCase: (reason: string) => void;
  onDragStart?: React.DragEventHandler<HTMLElement>;
  onDragEnd?: React.DragEventHandler<HTMLElement>;
}) {
  const inactive = isDealInactive(deal, stage);
  const status = caseStatusOf(deal, stage);
  const statusMeta = CLIENT_CASE_STATUS_META[status];
  const primary = primaryActionForCaseStatus(status);
  const deadline = deadlineInfo(caseDueAt(deal), inactive, deal.snoozeUntil);
  const clientType = CLIENT_TYPE_META[resolveClientType(deal)];
  const hasSupplies = Boolean(deal.suppliesNote || deal.suppliesExpectedAt || isSupplyStage(stage));
  const nextAction = deal.nextAction || defaultNextActionForCaseStatus(status, stage?.name) || "Уточнить следующий шаг";
  const hasComments = Boolean(deal.notes);
  const hasRecord = Boolean(deal.yclientsRecordId);
  const hasDemand = Boolean(deal.moyskladDemandId);
  const hasDiagnostic = Boolean(deal.source?.toLowerCase().includes("diagnostic") || deal.notes?.toLowerCase().includes("диагност"));
  const quoteSentStage = stages.find(isQuoteSentStage);
  const suppliesCheckStage = stages.find((item) => normalizeStageName(item.name).includes("проверить расход"));
  const visitStage = stages.find(isVisitDocumentStage);
  const hasClientReply = status === "client_replied";

  return (
    <article
      className={cx(
        "eco-deal-card",
        expanded && "is-expanded",
        inactive && "is-muted",
        deadline.overdue && "is-overdue",
        deadline.soon && "is-soon",
        moving && "is-moving"
      )}
      draggable={!inactive}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      tabIndex={0}
      role="button"
    >
      <div className="eco-deal-card__top">
        <span className="l-mono">{shortId(deal.id)}</span>
        <div className="eco-deal-card__top-actions">
          <EcoBadge tone={statusMeta.tone}>{statusMeta.shortLabel}</EcoBadge>
          <button type="button" className="eco-deal-card__chevron" aria-label={expanded ? "Свернуть дело" : "Раскрыть дело"} onClick={(event) => { event.stopPropagation(); onToggle(); }}>
            <ChevronDown size={14} />
          </button>
          <span className="eco-deal-card__grab" title="Перетащить в другой статус">
            <GripVertical size={14} />
          </span>
        </div>
      </div>
      <div className="eco-deal-card__client">
        <div>
          <strong>{displayCustomerName(deal)}</strong>
          <span>{formatPhone(deal.phoneNormalized)}</span>
        </div>
        <span className={cx("eco-client-type-badge", clientType.className)}>{clientType.label}</span>
      </div>
      <div className="eco-deal-card__vehicle">
        <Car size={13} />
        <span>{deal.vehicle || "Авто не указано"}</span>
      </div>
      <p className="eco-deal-card__text">{deal.title}</p>
      <div className={cx("eco-deal-card__next", deadline.overdue && "is-overdue")}>
        <span>Следующее:</span>
        <strong>{nextAction}</strong>
      </div>
      <div className="eco-deal-card__status-row">
        <EcoBadge tone={deadline.tone} dot>
          {deadline.label}
        </EcoBadge>
        <span>{loginLabel(deal.responsibleLogin)}</span>
      </div>
      <div className="eco-deal-card__primary" onClick={(event) => event.stopPropagation()}>
        {primary.action === "calculate" ? (
          <Link className="eco-deal-card__primary-btn" href={newShipmentHrefFromDeal(deal)}>
            {primary.label}
          </Link>
        ) : primary.action === "check_response" && status === "check_response" ? (
          <ContactActionButton
            size="sm"
            label="Написать клиенту"
            className="eco-deal-card__primary-contact"
            entityType="crm_case"
            entityId={deal.id}
            counterpartyId={deal.moyskladCounterpartyId}
            phone={deal.phoneNormalized}
            displayName={displayCustomerName(deal)}
            context={{
              entityType: "crm_case",
              entityId: deal.id,
              crmCaseId: deal.id,
              car: deal.vehicle,
              amount: deal.amountCents ? formatMoney(deal.amountCents) : null,
            }}
          />
        ) : primary.action === "create_appointment" ? (
          <Link className="eco-deal-card__primary-btn" href={recordsHrefFromDeal(deal)}>
            {primary.label}
          </Link>
        ) : (
          <button type="button" className="eco-deal-card__primary-btn" onClick={() => onAction(primary.action)}>
            {primary.label}
          </button>
        )}
        {hasClientReply && <EcoBadge tone="success" dot>Есть ответ</EcoBadge>}
      </div>
      <div className="eco-deal-card__links" aria-label="Связи дела">
        <span className={cx(hasRecord && "is-on")} title={hasRecord ? "Есть запись" : "Нет записи"}><CalendarClock size={13} /></span>
        <span className={cx(hasDemand && "is-on")} title={hasDemand ? "Есть отгрузка" : "Нет отгрузки"}><Truck size={13} /></span>
        <span className={cx(hasDiagnostic && "is-on")} title={hasDiagnostic ? "Есть диагностика" : "Нет диагностики"}><ClipboardList size={13} /></span>
        <span className={cx(hasSupplies && "is-on")} title={hasSupplies ? "Есть расходники" : "Нет расходников"}><PackageCheck size={13} /></span>
        <span className={cx(hasComments && "is-on")} title={hasComments ? "Есть комментарии" : "Нет комментариев"}><MessageSquare size={13} /></span>
      </div>

      {expanded && (
        <div className="eco-deal-card__expanded" onClick={(event) => event.stopPropagation()}>
          <div className="eco-deal-card__badges">
            <EcoBadge tone={statusMeta.tone}>{statusMeta.label}</EcoBadge>
            {deal.amountCents ? <EcoBadge tone="rust">{formatMoney(deal.amountCents)}</EcoBadge> : null}
            {hasRecord && <EcoBadge tone="info">Запись</EcoBadge>}
            {hasDemand && <EcoBadge tone="success">Отгрузка</EcoBadge>}
            {hasDiagnostic && <EcoBadge tone="info">Диагностика</EcoBadge>}
            {hasSupplies && <EcoBadge tone="warning">Расходники</EcoBadge>}
          </div>
          {(resolveClientType(deal) === "regular" || resolveClientType(deal) === "repeat") && (
            <div className="eco-deal-card__history">
              <span>История клиента</span>
              <strong>{deal.moyskladDemandId ? `отгрузка ${deal.moyskladDemandId}` : deal.moyskladCounterpartyName || "локальная карточка"}</strong>
            </div>
          )}
          <div className="eco-deal-card__details">
            <span>Источник: {deal.source || "без источника"}</span>
            {deal.suppliesNote && <span>Расходники: {deal.suppliesNote}</span>}
            {deal.suppliesExpectedAt && <span>Ожидаем: {formatDateTime(deal.suppliesExpectedAt)}</span>}
          </div>
          {deal.notes && <p className="eco-deal-card__notes">{deal.notes}</p>}
          <div className="eco-deal-card__actions">
            <button type="button" onClick={onOpen}>Открыть</button>
            <ContactActionButton
              size="sm"
              label="Написать"
              entityType="crm_case"
              entityId={deal.id}
              counterpartyId={deal.moyskladCounterpartyId}
              phone={deal.phoneNormalized}
              displayName={displayCustomerName(deal)}
              context={{
                entityType: "crm_case",
                entityId: deal.id,
                crmCaseId: deal.id,
                car: deal.vehicle,
                amount: deal.amountCents ? formatMoney(deal.amountCents) : null,
              }}
            />
            <details className="eco-deal-card__more">
              <summary>Ещё</summary>
              <div>
                {deal.phoneNormalized && <a href={`tel:${deal.phoneNormalized}`}>Позвонить</a>}
                {quoteSentStage && <button type="button" onClick={() => onAction("mark_calculation_sent")}>Отправить расчёт</button>}
                <button type="button" onClick={() => onAction("client_agreed")}>Клиент согласовал</button>
                <button type="button" onClick={() => onAction("waiting_parts")}>Ожидает запчасти</button>
                <button type="button" onClick={() => onAction("parts_arrived")}>Запчасти пришли</button>
                <Link href={recordsHrefFromDeal(deal)}>{hasRecord ? "Открыть запись" : "Создать запись"}</Link>
                <Link href={newShipmentHrefFromDeal(deal)}>Создать отгрузку</Link>
                {suppliesCheckStage && <button type="button" onClick={() => onMove(suppliesCheckStage)}>Проверить расходники</button>}
                {visitStage && hasDemand && <button type="button" onClick={() => onMove(visitStage)}>В документ</button>}
                <button type="button" onClick={() => onReminder(quickReminderInput("oneHour"))}>Отложить на 1 час</button>
                <button type="button" onClick={() => onReminder(quickReminderInput("threeHours"))}>Отложить на 3 часа</button>
                <button type="button" onClick={() => onReminder(quickReminderInput("tomorrow"))}>Завтра</button>
                <button type="button" onClick={() => onReminder(quickReminderInput("twoDays"))}>Через 2 дня</button>
                <button type="button" onClick={() => onReminder(quickReminderInput("week"))}>Через неделю</button>
                <button type="button" onClick={() => onCloseCase("закрыто вручную")}>Закрыть</button>
                <button type="button" onClick={() => onAction("refused", { reason: "клиент отказался" })}>Отказался</button>
                <button type="button" onClick={() => onAction("duplicate", { reason: "дубль" })}>Дубль</button>
              </div>
            </details>
          </div>
          {!inactive && (
            <div className="eco-deal-card__move">
              <select
                value={deal.stageId}
                disabled={moving}
                aria-label="Переместить дело"
                onChange={(event) => {
                  const target = stages.find((item) => item.id === event.target.value);
                  if (target) onMove(target);
                }}
              >
                {stages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function CaseFormDrawer({
  form,
  stages,
  saving,
  error,
  counterpartySearch,
  counterpartyOptions,
  counterpartyLoading,
  selectedCounterparty,
  userLogin,
  onClose,
  onSubmit,
  onCreateModeChange,
  onChange,
  onCounterpartySearch,
  onSelectCounterparty,
  onClearCounterparty,
}: {
  form: CreateForm;
  stages: Stage[];
  saving: boolean;
  error: string | null;
  counterpartySearch: string;
  counterpartyOptions: Counterparty[];
  counterpartyLoading: boolean;
  selectedCounterparty: Counterparty | null;
  userLogin: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCreateModeChange: (mode: "create" | "open") => void;
  onChange: <K extends keyof CreateForm>(key: K, value: CreateForm[K]) => void;
  onCounterpartySearch: (value: string) => void;
  onSelectCounterparty: (counterparty: Counterparty) => void;
  onClearCounterparty: () => void;
}) {
  return (
    <div className="eco-crm-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="eco-crm-drawer eco-crm-form-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="eco-crm-drawer__header">
          <div>
            <span>Новое дело</span>
            <h2>Дело клиента</h2>
            <p>Одно дело = один вопрос, который нельзя потерять.</p>
          </div>
          <button type="button" className="eco-icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={17} />
          </button>
        </header>

        <form id="crm-case-form" className="eco-crm-form-body" onSubmit={onSubmit}>
          <section className="eco-crm-form-section">
            <h3>
              <UserRound size={16} />
              Клиент
            </h3>
            <div className="eco-crm-client-search">
              <label className="eco-client-field is-full">
                <span>Поиск клиента</span>
                <input
                  value={selectedCounterparty ? selectedCounterparty.name : counterpartySearch}
                  onChange={(event) => onCounterpartySearch(event.target.value)}
                  placeholder="Имя или телефон"
                  className="eco-input"
                />
              </label>
              {selectedCounterparty ? (
                <div className="eco-counterparty-selected">
                  <CheckCircle2 size={15} />
                  <span>{selectedCounterparty.name}</span>
                  <button type="button" onClick={onClearCounterparty}>
                    Сменить
                  </button>
                </div>
              ) : (
                (counterpartyLoading || counterpartyOptions.length > 0 || counterpartySearch.trim().length >= 2) && (
                  <div className="eco-counterparty-dropdown eco-crm-client-dropdown">
                    {counterpartyLoading && <div className="eco-counterparty-empty">Ищем...</div>}
                    {!counterpartyLoading &&
                      counterpartyOptions.map((counterparty) => (
                        <button key={counterparty.id} type="button" onClick={() => onSelectCounterparty(counterparty)}>
                          <strong>{counterparty.name}</strong>
                          {counterparty.phone ? <span>{formatPhone(counterparty.phone)}</span> : null}
                        </button>
                      ))}
                    {!counterpartyLoading && counterpartySearch.trim().length >= 2 && counterpartyOptions.length === 0 && (
                      <div className="eco-counterparty-empty">Клиент не найден</div>
                    )}
                  </div>
                )
              )}
            </div>
            <div className="eco-client-form-grid">
              <label className="eco-client-field">
                <span>Имя</span>
                <input value={form.customerName} onChange={(event) => onChange("customerName", event.target.value)} className="eco-input" />
              </label>
              <label className="eco-client-field">
                <span>Телефон</span>
                <input value={form.phone} onChange={(event) => onChange("phone", event.target.value)} className="eco-input" />
              </label>
              <label className="eco-client-field">
                <span>Тип клиента</span>
                <select value={form.clientType} onChange={(event) => onChange("clientType", event.target.value as ClientType)} className="eco-input">
                  <option value="new_lead">Новый лид</option>
                  <option value="regular">Постоянный клиент</option>
                  <option value="repeat">Повторное обращение</option>
                  <option value="unlinked">Без клиента / не привязан</option>
                </select>
              </label>
              <label className="eco-check-row eco-crm-check-row">
                <input
                  type="checkbox"
                  checked={form.createLocalClient}
                  disabled={Boolean(selectedCounterparty)}
                  onChange={(event) => onChange("createLocalClient", event.target.checked)}
                />
                <span>Сохранить клиента в локальной CRM, если он ещё не выбран</span>
              </label>
            </div>
          </section>

          <section className="eco-crm-form-section">
            <h3>
              <ClipboardList size={16} />
              Дело
            </h3>
            <div className="eco-client-form-grid">
              <label className="eco-client-field is-full">
                <span>Короткое название</span>
                <input
                  value={form.title}
                  onChange={(event) => onChange("title", event.target.value)}
                  placeholder="Рассчитать ТО, перезвонить, заказать расходники..."
                  className="eco-input"
                />
              </label>
              <label className="eco-client-field">
                <span>Статус</span>
                <select
                  value={form.stageId}
                  onChange={(event) => {
                    const stage = stages.find((item) => item.id === event.target.value);
                    onChange("stageId", event.target.value);
                    if (!form.nextAction) onChange("nextAction", defaultNextAction(stage?.name));
                  }}
                  className="eco-input"
                >
                  {stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="eco-client-field">
                <span>Ответственный</span>
                <input value={form.responsibleLogin || userLogin} onChange={(event) => onChange("responsibleLogin", event.target.value)} className="eco-input" />
              </label>
              <label className="eco-client-field is-full">
                <span>Следующее действие</span>
                <input
                  value={form.nextAction}
                  onChange={(event) => onChange("nextAction", event.target.value)}
                  placeholder="Перезвонить сегодня до 15:00"
                  className="eco-input"
                />
              </label>
              <label className="eco-client-field">
                <span>Дедлайн / касание</span>
                <input value={form.nextContactAt} onChange={(event) => onChange("nextContactAt", event.target.value)} type="datetime-local" className="eco-input" />
              </label>
              <label className="eco-client-field">
                <span>Источник</span>
                <input value={form.source} onChange={(event) => onChange("source", event.target.value)} className="eco-input" />
              </label>
              <label className="eco-client-field is-full">
                <span>Комментарий</span>
                <textarea value={form.notes} onChange={(event) => onChange("notes", event.target.value)} className="eco-input" />
              </label>
            </div>
          </section>

          <section className="eco-crm-form-section">
            <h3>
              <Car size={16} />
              Авто
            </h3>
            <div className="eco-client-form-grid">
              <label className="eco-client-field is-full">
                <span>Авто / госномер / VIN</span>
                <input value={form.vehicle} onChange={(event) => onChange("vehicle", event.target.value)} className="eco-input" />
              </label>
            </div>
          </section>

          <section className="eco-crm-form-section">
            <h3>
              <Link2 size={16} />
              Связи и расходники
            </h3>
            <div className="eco-client-form-grid">
              <label className="eco-client-field">
                <span>Запись</span>
                <input value={form.yclientsRecordId} onChange={(event) => onChange("yclientsRecordId", event.target.value)} placeholder="ID записи" className="eco-input" />
              </label>
              <label className="eco-client-field">
                <span>Отгрузка</span>
                <input value={form.moyskladDemandId} onChange={(event) => onChange("moyskladDemandId", event.target.value)} placeholder="ID / номер" className="eco-input" />
              </label>
              <label className="eco-client-field">
                <span>Расчёт, ₽</span>
                <MoneyInput value={form.amount} onValueChange={(_, draft) => onChange("amount", draft)} placeholder="0" className="eco-input" />
              </label>
              <label className="eco-client-field">
                <span>Поставщик</span>
                <input value={form.suppliesSupplier} onChange={(event) => onChange("suppliesSupplier", event.target.value)} className="eco-input" />
              </label>
              <label className="eco-client-field">
                <span>Ожидаемая дата</span>
                <input value={form.suppliesExpectedAt} onChange={(event) => onChange("suppliesExpectedAt", event.target.value)} type="datetime-local" className="eco-input" />
              </label>
              <label className="eco-client-field is-full">
                <span>Расходники / товары</span>
                <textarea value={form.suppliesNote} onChange={(event) => onChange("suppliesNote", event.target.value)} className="eco-input" />
              </label>
            </div>
          </section>

        </form>

        <footer className="eco-crm-drawer__footer">
          <span>{error || "Локальная CRM — основной рабочий сценарий."}</span>
          <div>
            <EcoButton type="button" variant="secondary" onClick={onClose}>
              Отмена
            </EcoButton>
            <EcoButton type="submit" form="crm-case-form" variant="secondary" disabled={saving} onClick={() => onCreateModeChange("open")}>
              Создать и открыть
            </EcoButton>
            <EcoButton type="submit" form="crm-case-form" variant="primary" disabled={saving} onClick={() => onCreateModeChange("create")}>
              <Plus size={15} />
              {saving ? "Создаём..." : "Создать дело"}
            </EcoButton>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function CaseDrawer({
  deal,
  stage,
  stages,
  moving,
  onClose,
  onCopy,
  onMove,
  onAction,
  onReminder,
  onCloseCase,
}: {
  deal: Deal;
  stage?: Stage | null;
  stages: Stage[];
  moving: boolean;
  onClose: () => void;
  onCopy: (value: string | null) => void;
  onMove: (stage: Stage) => void;
  onAction: (action: ClientCaseAction, body?: Record<string, unknown>) => void;
  onReminder: (value: string | null) => void;
  onCloseCase: (reason: string) => void;
}) {
  const clientType = CLIENT_TYPE_META[resolveClientType(deal)];
  const status = caseStatusOf(deal, stage);
  const statusMeta = CLIENT_CASE_STATUS_META[status];
  const primary = primaryActionForCaseStatus(status);
  const deadline = deadlineInfo(caseDueAt(deal), isDealInactive(deal, stage), deal.snoozeUntil);
  const clientSearch = linkedClientSearch(deal);

  return (
    <div className="eco-crm-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="eco-crm-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="eco-crm-drawer__header">
          <div>
            <span>Дело клиента</span>
            <h2>{deal.title}</h2>
            <div className="eco-crm-drawer__badges">
              <EcoBadge tone={statusMeta.tone}>{statusMeta.label}</EcoBadge>
              <EcoBadge tone={clientType.tone}>{clientType.label}</EcoBadge>
              <EcoBadge tone={deadline.tone} dot>
                {deadline.label}
              </EcoBadge>
            </div>
          </div>
          <button type="button" className="eco-icon-btn" onClick={onClose} aria-label="Закрыть">
            <X size={17} />
          </button>
        </header>

        <div className="eco-crm-drawer__actions">
          {primary.action === "calculate" ? (
            <Link className="eco-btn eco-btn--primary eco-btn--sm" href={newShipmentHrefFromDeal(deal)}>
              <ReceiptText size={14} />
              {primary.label}
            </Link>
          ) : primary.action === "create_appointment" ? (
            <Link className="eco-btn eco-btn--primary eco-btn--sm" href={recordsHrefFromDeal(deal)}>
              <CalendarClock size={14} />
              {primary.label}
            </Link>
          ) : (
            <button type="button" className="eco-btn eco-btn--primary eco-btn--sm" disabled={moving} onClick={() => onAction(primary.action)}>
              <CheckCircle2 size={14} />
              {primary.label}
            </button>
          )}
          <ContactActionButton
            size="sm"
            label="Написать"
            entityType="crm_case"
            entityId={deal.id}
            counterpartyId={deal.moyskladCounterpartyId}
            phone={deal.phoneNormalized}
            displayName={displayCustomerName(deal)}
            context={{
              entityType: "crm_case",
              entityId: deal.id,
              crmCaseId: deal.id,
              car: deal.vehicle,
              amount: deal.amountCents ? formatMoney(deal.amountCents) : null,
            }}
          />
          {deal.phoneNormalized && (
            <a className="eco-btn eco-btn--secondary eco-btn--sm" href={`tel:${deal.phoneNormalized}`}>
              <Phone size={14} />
              Перезвонить
            </a>
          )}
          <Link className="eco-btn eco-btn--secondary eco-btn--sm" href={recordsHrefFromDeal(deal)}>
            <CalendarClock size={14} />
            {deal.yclientsRecordId ? "Открыть запись" : "Записать клиента"}
          </Link>
          <Link className="eco-btn eco-btn--secondary eco-btn--sm" href={`/shipment/new?crmDealId=${encodeURIComponent(deal.id)}`}>
            <Truck size={14} />
            Создать отгрузку
          </Link>
          <button type="button" className="eco-btn eco-btn--danger eco-btn--sm" disabled={moving} onClick={() => onCloseCase("вопрос закрыт")}>
            <Archive size={14} />
            Закрыть дело
          </button>
        </div>

        <div className="eco-crm-drawer__body">
          <section className="eco-client-info-block">
            <h3>
              <UserRound size={16} />
              Клиент
            </h3>
            <InfoLine label="Имя" value={displayCustomerName(deal)} />
            <div className="eco-client-info-line">
              <span>Телефон</span>
              <strong className="eco-crm-copy-line">
                {formatPhone(deal.phoneNormalized)}
                {deal.phoneNormalized && (
                  <button type="button" onClick={() => onCopy(deal.phoneNormalized)} title="Скопировать телефон">
                    <Copy size={13} />
                  </button>
                )}
              </strong>
            </div>
            <InfoLine label="Тип" value={clientType.label} />
            <InfoLine label="Ответственный" value={loginLabel(deal.responsibleLogin)} />
            <Link className="eco-crm-related-link" href={`/clients/counterparties?search=${clientSearch}`}>
              Открыть карточку клиента
            </Link>
          </section>

          <section className="eco-client-info-block">
            <h3>
              <Car size={16} />
              Автомобиль
            </h3>
            <InfoLine label="Авто / VIN" value={deal.vehicle || "Не указано"} />
            <InfoLine label="История" value={deal.moyskladCounterpartyName || deal.moyskladCounterpartyId ? "Есть карточка клиента" : "История пока не привязана"} />
          </section>

          <section className="eco-client-info-block eco-crm-wide-block">
            <h3>
              <ClipboardList size={16} />
              Что нужно сделать
            </h3>
            <InfoLine label="Следующее действие" value={deal.nextAction || defaultNextActionForCaseStatus(status, stage?.name) || "Уточнить"} />
            <InfoLine label="Когда всплывёт" value={formatDateTime(caseDueAt(deal))} />
            <div className="eco-crm-reminder-actions">
              <button type="button" onClick={() => onReminder(quickReminderInput("oneHour"))}>1 час</button>
              <button type="button" onClick={() => onReminder(quickReminderInput("threeHours"))}>3 часа</button>
              <button type="button" onClick={() => onReminder(quickReminderInput("today"))}>Сегодня</button>
              <button type="button" onClick={() => onReminder(quickReminderInput("tomorrow"))}>Завтра</button>
              <button type="button" onClick={() => onReminder(quickReminderInput("twoDays"))}>Через 2 дня</button>
              <button type="button" onClick={() => onReminder(quickReminderInput("week"))}>Через неделю</button>
              <button type="button" onClick={() => onReminder(null)}>Без срока</button>
            </div>
            <div className="eco-crm-reminder-actions">
              <button type="button" onClick={() => onAction("mark_calculation_sent")}>Расчёт отправлен</button>
              <button type="button" onClick={() => onAction("client_agreed")}>Клиент согласовал</button>
              <button type="button" onClick={() => onAction("waiting_parts")}>Ожидает запчасти</button>
              <button type="button" onClick={() => onAction("parts_arrived")}>Запчасти пришли</button>
            </div>
            <div className="eco-crm-comment-box">
              <MessageSquare size={15} />
              <p>{deal.notes || "Комментариев пока нет"}</p>
            </div>
          </section>

          <section className="eco-client-info-block">
            <h3>
              <Link2 size={16} />
              Связи
            </h3>
            <RelatedLine icon={<CalendarClock size={15} />} label="Запись" value={deal.yclientsRecordId || "Клиент ещё не записан"} href={recordsHrefFromDeal(deal)} />
            <RelatedLine icon={<Truck size={15} />} label="Отгрузка" value={deal.moyskladDemandId || "Нет отгрузки"} href={deal.moyskladDemandId ? `/shipment/${encodeURIComponent(deal.moyskladDemandId)}` : "/shipment/new"} />
            <RelatedLine icon={<ReceiptText size={15} />} label="Расчёт" value={deal.amountCents ? formatMoney(deal.amountCents) : "Без расчёта"} />
            <RelatedLine icon={<WalletCards size={15} />} label="Оплата" value="Проверить при необходимости" />
          </section>

          <section className="eco-client-info-block">
            <h3>
              <PackageCheck size={16} />
              Расходники
            </h3>
            <InfoLine label="Товары" value={deal.suppliesNote || (isSupplyStage(stage) ? "Уточнить список расходников" : "Не требуются")} />
            <InfoLine label="Поставщик" value={deal.suppliesSupplier || "Не указан"} />
            <InfoLine label="Ожидаем" value={formatDateTime(deal.suppliesExpectedAt)} />
          </section>

          <section className="eco-client-info-block eco-crm-wide-block">
            <h3>
              <Clock3 size={16} />
              История
            </h3>
            <div className="eco-crm-history">
              <div>
                <span>Создано</span>
                <strong>{formatDateTime(deal.createdAt)}</strong>
                <p>{deal.createdByLogin}</p>
              </div>
              <div>
                <span>Обновлено</span>
                <strong>{formatDateTime(deal.updatedAt)}</strong>
                <p>{statusMeta.label}</p>
              </div>
              {deal.lastOutboundMessageAt && (
                <div>
                  <span>Расчёт / сообщение отправлено</span>
                  <strong>{formatDateTime(deal.lastOutboundMessageAt)}</strong>
                  <p>следующая проверка: {formatDateTime(caseDueAt(deal))}</p>
                </div>
              )}
              {deal.lastClientMessageAt && (
                <div>
                  <span>Ответ клиента</span>
                  <strong>{formatDateTime(deal.lastClientMessageAt)}</strong>
                  <p>дело поднято в очередь</p>
                </div>
              )}
              {deal.closeReason && (
                <div>
                  <span>Причина закрытия</span>
                  <strong>{deal.closeReason}</strong>
                  <p>{formatDateTime(deal.closedAt ?? deal.updatedAt)}</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="eco-crm-drawer__footer">
          <span>{shortId(deal.id)}</span>
          <div>
            <select
              className="eco-input eco-crm-drawer-stage"
              value={deal.stageId}
              disabled={moving}
              onChange={(event) => {
                const target = stages.find((item) => item.id === event.target.value);
                if (target) onMove(target);
              }}
            >
              {stages.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <EcoButton type="button" variant="secondary" onClick={onClose}>
              Закрыть
            </EcoButton>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="eco-client-info-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RelatedLine({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href?: string }) {
  const content = (
    <>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );
  if (href) {
    return (
      <Link className="eco-crm-related-row" href={href}>
        {content}
      </Link>
    );
  }
  return <div className="eco-crm-related-row">{content}</div>;
}
