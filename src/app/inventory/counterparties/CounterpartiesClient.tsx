"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Building2,
  Car,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCopy,
  Edit3,
  Eye,
  FileText,
  Loader2,
  Phone,
  Plus,
  Search,
  SlidersHorizontal,
  Truck,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import { EcoBadge, EcoButton, EcoInput, EcoKpi, EcoSelect } from "@/components/platform/EcoUI";
import { formatServiceDate } from "@/lib/date-time";

type CounterpartyRow = {
  id: string;
  moyskladId?: string | null;
  source?: "local" | "snapshot" | "supplier" | string;
  name: string;
  phone: string;
  additionalPhone: string;
  email: string;
  companyType: string;
  counterpartyTypeName: string;
  legalTitle: string;
  legalLastName: string;
  legalFirstName: string;
  legalMiddleName: string;
  legalAddress: string;
  inn: string;
  kpp: string;
  okpo: string;
  fax: string;
  bik: string;
  bankName: string;
  bankLocation: string;
  correspondentAccount: string;
  checkingAccount: string;
  ogrn: string;
  ogrnip: string;
  certificateNumber: string;
  certificateDate: string;
  comment: string;
  vehiclePlate: string;
  vehicleVin: string;
  vehicleModel: string;
  vehicleYear: string;
  vehicleLabel: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  demandCount: number;
  totalDemandSumCents: number;
  lastDemandName: string;
  lastDemandAt: string;
  lastDemandSumCents: number | null;
  recentDemands?: Array<{
    id: string;
    name: string;
    momentAt: string;
    sumCents: number;
    applicable: boolean;
  }>;
  vehicleCount: number;
};

type CounterpartyForm = {
  name: string;
  phone: string;
  additionalPhone: string;
  email: string;
  companyType: string;
  counterpartyTypeName: string;
  legalTitle: string;
  legalLastName: string;
  legalFirstName: string;
  legalMiddleName: string;
  legalAddress: string;
  inn: string;
  kpp: string;
  okpo: string;
  fax: string;
  bik: string;
  bankName: string;
  bankLocation: string;
  correspondentAccount: string;
  checkingAccount: string;
  ogrn: string;
  ogrnip: string;
  certificateNumber: string;
  certificateDate: string;
  comment: string;
  vehiclePlate: string;
  vehicleVin: string;
  vehicleModel: string;
  vehicleYear: string;
};

type CounterpartyStats = {
  total: number;
  active: number;
  archived: number;
  individuals: number;
  companies: number;
  noPhone: number;
  noRequisites: number;
};

type CounterpartyResponse = {
  meta?: { total: number; limit: number; offset: number };
  stats?: CounterpartyStats;
  counterparties?: CounterpartyRow[];
  error?: string;
};

type PresenceFilter = "all" | "with" | "without";
type ClientTypeFilter = "all" | "individual" | "company";
type StatusFilter = "active" | "archive" | "all";
type SortKey = "name" | "createdAt" | "updatedAt" | "lastDemand";

const emptyForm: CounterpartyForm = {
  name: "",
  phone: "",
  additionalPhone: "",
  email: "",
  companyType: "individual",
  counterpartyTypeName: "",
  legalTitle: "",
  legalLastName: "",
  legalFirstName: "",
  legalMiddleName: "",
  legalAddress: "",
  inn: "",
  kpp: "",
  okpo: "",
  fax: "",
  bik: "",
  bankName: "",
  bankLocation: "",
  correspondentAccount: "",
  checkingAccount: "",
  ogrn: "",
  ogrnip: "",
  certificateNumber: "",
  certificateDate: "",
  comment: "",
  vehiclePlate: "",
  vehicleVin: "",
  vehicleModel: "",
  vehicleYear: "",
};

const emptyStats: CounterpartyStats = {
  total: 0,
  active: 0,
  archived: 0,
  individuals: 0,
  companies: 0,
  noPhone: 0,
  noRequisites: 0,
};

const legalFields: Array<{ key: keyof CounterpartyForm; label: string; type?: "date" | "textarea" }> = [
  { key: "legalTitle", label: "Юридическое название" },
  { key: "inn", label: "ИНН" },
  { key: "kpp", label: "КПП" },
  { key: "ogrn", label: "ОГРН" },
  { key: "ogrnip", label: "ОГРНИП" },
  { key: "okpo", label: "ОКПО" },
  { key: "bik", label: "БИК" },
  { key: "bankName", label: "Банк" },
  { key: "checkingAccount", label: "Расчётный счёт" },
  { key: "correspondentAccount", label: "Корреспондентский счёт" },
  { key: "bankLocation", label: "Местонахождение банка", type: "textarea" },
  { key: "legalAddress", label: "Юридический адрес", type: "textarea" },
  { key: "certificateNumber", label: "Номер свидетельства" },
  { key: "certificateDate", label: "Дата свидетельства", type: "date" },
];

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function formFromCounterparty(row: CounterpartyRow): CounterpartyForm {
  return {
    name: row.name,
    phone: row.phone,
    additionalPhone: row.additionalPhone,
    email: row.email,
    companyType: row.companyType || "individual",
    counterpartyTypeName: row.counterpartyTypeName,
    legalTitle: row.legalTitle,
    legalLastName: row.legalLastName,
    legalFirstName: row.legalFirstName,
    legalMiddleName: row.legalMiddleName,
    legalAddress: row.legalAddress,
    inn: row.inn,
    kpp: row.kpp,
    okpo: row.okpo,
    fax: row.fax,
    bik: row.bik,
    bankName: row.bankName,
    bankLocation: row.bankLocation,
    correspondentAccount: row.correspondentAccount,
    checkingAccount: row.checkingAccount,
    ogrn: row.ogrn,
    ogrnip: row.ogrnip,
    certificateNumber: row.certificateNumber,
    certificateDate: row.certificateDate,
    comment: row.comment,
    vehiclePlate: row.vehiclePlate,
    vehicleVin: row.vehicleVin,
    vehicleModel: row.vehicleModel,
    vehicleYear: row.vehicleYear,
  };
}

function companyTypeLabel(value: string) {
  if (value === "individual") return "Физлицо";
  if (value === "entrepreneur") return "ИП";
  if (value === "supplier") return "Поставщик";
  return "Компания";
}

function companyTypeTone(value: string) {
  if (value === "individual") return "info" as const;
  if (value === "supplier") return "warning" as const;
  return "rust" as const;
}

function cleanDisplayText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function isTrashName(value: string) {
  const clean = cleanDisplayText(value);
  return !clean || clean === "." || clean === "/" || clean === "-" || clean === "—";
}

function looksLikePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length >= value.replace(/\s/g, "").length - 4;
}

function displayName(row: CounterpartyRow) {
  const name = cleanDisplayText(row.name);
  const legalTitle = cleanDisplayText(row.legalTitle);
  if (!isTrashName(name)) return name;
  if (!isTrashName(legalTitle)) return legalTitle;
  const phone = cleanDisplayText(row.phone || row.additionalPhone);
  if (phone && looksLikePhone(phone)) return formatPhone(phone);
  return "Без имени";
}

function hasDisplayName(row: CounterpartyRow) {
  return !isTrashName(cleanDisplayText(row.name)) || !isTrashName(cleanDisplayText(row.legalTitle));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (name === "Без имени") return "БИ";
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] ?? "К").slice(0, 2).toUpperCase();
}

function formatPhone(value: string) {
  const raw = value.trim();
  const digits = raw.replace(/\D/g, "");
  if (/^7\d{10}$/.test(digits)) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  if (/^8\d{10}$/.test(digits)) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  return raw;
}

function formatDate(value: string) {
  if (!value) return "нет данных";
  const formatted = formatServiceDate(value);
  return formatted === "—" ? "нет данных" : formatted;
}

function formatMoney(cents: number | null | undefined) {
  if (cents == null || cents === 0) return "без суммы";
  return `${(cents / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽`;
}

function shipmentHref(id: string) {
  return `/shipment/${encodeURIComponent(id)}`;
}

function allClientShipmentsHref(row: CounterpartyRow) {
  const params = new URLSearchParams();
  const phone = row.phone || row.additionalPhone;
  if (hasDisplayName(row)) params.set("counterparty", displayName(row));
  else if (phone) params.set("phone", phone);
  else params.set("counterparty", displayName(row));
  return `/shipment?${params.toString()}`;
}

function demandStatusTone(applicable: boolean) {
  return applicable ? "success" as const : "warning" as const;
}

function demandStatusLabel(applicable: boolean) {
  return applicable ? "Проведена" : "Черновик";
}

function requisitesSummary(row: CounterpartyRow) {
  const main = [row.inn ? `ИНН ${row.inn}` : "", row.kpp ? `КПП ${row.kpp}` : ""].filter(Boolean).join(" · ");
  if (main) return main;
  if (row.ogrn) return `ОГРН ${row.ogrn}`;
  if (row.ogrnip) return `ОГРНИП ${row.ogrnip}`;
  if (row.legalTitle) return "есть юр. название";
  if (row.checkingAccount) return `Р/с ${row.checkingAccount}`;
  return "";
}

function hasRequisites(row: CounterpartyRow) {
  return Boolean(requisitesSummary(row) || row.legalAddress || row.bankName || row.bik);
}

function cleanCounterpartyTypeName(value: string) {
  const clean = cleanDisplayText(value);
  if (!clean || clean === "individual" || clean === "legal" || clean === "company") return "";
  return clean;
}

function clientSubtitle(row: CounterpartyRow) {
  if (row.source === "snapshot") return "клиент из импортированных отгрузок";
  if (row.source === "supplier") return "поставщик из карточек товаров";
  if (!hasDisplayName(row)) return row.phone || row.additionalPhone ? "имя не указано" : companyTypeLabel(row.companyType);
  if (row.comment) return row.comment;
  if (row.legalTitle && row.legalTitle !== row.name) return row.legalTitle;
  const typeName = cleanCounterpartyTypeName(row.counterpartyTypeName);
  if (typeName) return typeName;
  return row.demandCount > 0 ? "клиент из отгрузок" : "локальная карточка клиента";
}

function vehicleLabel(row: CounterpartyRow) {
  if (row.vehicleLabel) return row.vehicleLabel;
  return [
    [row.vehicleModel, row.vehicleYear].filter(Boolean).join(" "),
    row.vehiclePlate,
    row.vehicleVin ? `VIN ${row.vehicleVin}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function vehicleDisplay(row: CounterpartyRow) {
  const model = [row.vehicleModel, row.vehicleYear].filter(Boolean).join(" ").trim();
  const plate = cleanDisplayText(row.vehiclePlate);
  const vin = cleanDisplayText(row.vehicleVin);
  const stored = cleanDisplayText(row.vehicleLabel);
  const primary = [model, plate].filter(Boolean).join(" · ") || stored || (vin ? `VIN ${vin}` : "");
  let secondary = "";
  if (row.vehicleCount > 1) secondary = `ещё ${row.vehicleCount - 1} авто`;
  else if (vin && !primary.includes(vin)) secondary = `VIN ${vin}`;
  return { primary, secondary, title: [primary, secondary].filter(Boolean).join(" · ") };
}

function lastDemandShortName(value: string) {
  const clean = cleanDisplayText(value);
  if (!clean) return "нет истории";
  const match = clean.match(/(?:№\s*)?([A-Za-zА-Яа-я0-9-]{3,})$/);
  return match?.[1] ?? clean;
}

function getRowStatus(row: CounterpartyRow) {
  if (row.archived) return { tone: "warning" as const, label: "Архив" };
  if (!row.phone && !row.additionalPhone) return { tone: "danger" as const, label: "Без телефона" };
  if (row.demandCount === 0) return { tone: "neutral" as const, label: "Без истории" };
  if (!hasRequisites(row) && row.companyType !== "individual") return { tone: "neutral" as const, label: "Нет реквизитов" };
  return { tone: "success" as const, label: "Активен" };
}

function typeLabelForFilter(value: ClientTypeFilter) {
  if (value === "individual") return "Физлица";
  if (value === "company") return "Компании";
  return "Все";
}

function statusLabel(value: StatusFilter) {
  if (value === "archive") return "Архив";
  if (value === "all") return "Все";
  return "Активные";
}

function presenceLabel(value: PresenceFilter, withLabel: string, withoutLabel: string) {
  if (value === "with") return withLabel;
  if (value === "without") return withoutLabel;
  return "Все";
}

function canPersistCounterparty(row: CounterpartyRow) {
  return row.source !== "snapshot" && row.source !== "supplier";
}

export default function CounterpartiesClient() {
  const searchParams = useSearchParams();
  const initialSearch = searchParams.get("search")?.trim() ?? "";
  const initialCounterpartyId = searchParams.get("counterparty")?.trim() ?? "";

  const [rows, setRows] = useState<CounterpartyRow[]>([]);
  const [stats, setStats] = useState<CounterpartyStats>(emptyStats);
  const [meta, setMeta] = useState({ total: 0, limit: 25, offset: 0 });
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [status, setStatus] = useState<StatusFilter>("active");
  const [type, setType] = useState<ClientTypeFilter>("all");
  const [phoneFilter, setPhoneFilter] = useState<PresenceFilter>("all");
  const [requisitesFilter, setRequisitesFilter] = useState<PresenceFilter>("all");
  const [shipmentsFilter, setShipmentsFilter] = useState<PresenceFilter>("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CounterpartyForm>(emptyForm);
  const [detailRow, setDetailRow] = useState<CounterpartyRow | null>(null);
  const [openedCounterpartyId, setOpenedCounterpartyId] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<{ row: CounterpartyRow; restore?: boolean } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const selectableRows = useMemo(() => rows.filter(canPersistCounterparty), [rows]);
  const selectedRows = useMemo(() => selectableRows.filter((row) => selectedIds.has(row.id)), [selectableRows, selectedIds]);
  const pageCount = Math.max(1, Math.ceil(meta.total / pageSize));
  const displayStart = meta.total === 0 ? 0 : meta.offset + 1;
  const displayEnd = Math.min(meta.offset + rows.length, meta.total);
  const isFiltered = Boolean(
    debouncedSearch || status !== "active" || type !== "all" || phoneFilter !== "all" || requisitesFilter !== "all" || shipmentsFilter !== "all"
  );

  const loadCounterparties = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: String(pageSize),
          offset: String(page * pageSize),
          status,
          type,
          phone: phoneFilter,
          requisites: requisitesFilter,
          shipments: shipmentsFilter,
          sort,
          direction,
        });
        if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
        const res = await fetch(`/api/local-inventory/counterparties?${params.toString()}`, {
          cache: "no-store",
          signal,
        });
        const data = await readJson<CounterpartyResponse>(res);
        if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить клиентов");
        setRows(Array.isArray(data?.counterparties) ? data.counterparties : []);
        setStats(data?.stats ?? emptyStats);
        setMeta(data?.meta ?? { total: 0, limit: pageSize, offset: page * pageSize });
        setSelectedIds(new Set());
        setLoaded(true);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [debouncedSearch, direction, page, pageSize, phoneFilter, requisitesFilter, shipmentsFilter, sort, status, type]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(0);
      setDebouncedSearch(search.trim());
    }, 320);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    void loadCounterparties(controller.signal);
    return () => controller.abort();
  }, [loadCounterparties]);

  useEffect(() => {
    if (!initialCounterpartyId || openedCounterpartyId === initialCounterpartyId) return;
    const existingRow = rows.find((row) => row.id === initialCounterpartyId || row.moyskladId === initialCounterpartyId);
    if (existingRow) {
      setDetailRow(existingRow);
      setOpenedCounterpartyId(initialCounterpartyId);
      return;
    }

    let cancelled = false;
    async function openCounterpartyById() {
      try {
        const res = await fetch(`/api/local-inventory/counterparties/${encodeURIComponent(initialCounterpartyId)}`, {
          cache: "no-store",
        });
        const data = await readJson<CounterpartyRow & { error?: string }>(res);
        if (!res.ok) throw new Error(data?.error ?? "Контрагент не найден");
        if (cancelled) return;
        setDetailRow(data);
        setOpenedCounterpartyId(initialCounterpartyId);
      } catch (e) {
        if (cancelled) return;
        setInfo(null);
        setError(e instanceof Error ? e.message : "Не удалось открыть контрагента");
        setOpenedCounterpartyId(initialCounterpartyId);
      }
    }
    void openCounterpartyById();
    return () => {
      cancelled = true;
    };
  }, [initialCounterpartyId, openedCounterpartyId, rows]);

  function updateForm(patch: Partial<CounterpartyForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function resetFilters() {
    setSearch("");
    setDebouncedSearch("");
    setStatus("active");
    setType("all");
    setPhoneFilter("all");
    setRequisitesFilter("all");
    setShipmentsFilter("all");
    setSort("name");
    setDirection("asc");
    setPage(0);
  }

  function openCreate() {
    setForm(emptyForm);
    setEditingId(null);
    setFormMode("create");
    setInfo(null);
    setError(null);
  }

  function openEdit(row: CounterpartyRow) {
    setForm(formFromCounterparty(row));
    setEditingId(canPersistCounterparty(row) ? row.id : null);
    setFormMode(canPersistCounterparty(row) ? "edit" : "create");
    if (!canPersistCounterparty(row)) {
      setInfo("Это клиент из импортированной истории. Сохраните карточку, чтобы закрепить его в CRM.");
    } else {
      setInfo(null);
    }
    setError(null);
  }

  function closeForm() {
    setFormMode(null);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])
      );
      const res = await fetch(
        editingId ? `/api/local-inventory/counterparties/${editingId}` : "/api/local-inventory/counterparties",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await readJson<CounterpartyRow & { error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось сохранить клиента");
      setInfo(editingId ? "Клиент обновлён" : "Клиент создан");
      closeForm();
      await loadCounterparties();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function setArchiveState(row: CounterpartyRow, restore = false) {
    if (!canPersistCounterparty(row)) {
      setConfirmArchive(null);
      setInfo("Сначала сохраните карточку клиента в CRM, затем её можно будет архивировать.");
      return;
    }
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/local-inventory/counterparties/${row.id}`, {
        method: restore ? "PUT" : "DELETE",
        headers: restore ? { "Content-Type": "application/json" } : undefined,
        body: restore ? JSON.stringify({ archived: false }) : undefined,
      });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? (restore ? "Не удалось восстановить клиента" : "Не удалось архивировать клиента"));
      setInfo(restore ? "Клиент восстановлен" : "Клиент перемещён в архив");
      setConfirmArchive(null);
      setDetailRow((current) => (current?.id === row.id ? null : current));
      await loadCounterparties();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function archiveSelected() {
    if (selectedRows.length === 0) return;
    const persistableRows = selectedRows.filter(canPersistCounterparty);
    if (persistableRows.length === 0) {
      setInfo("В выбранных строках только клиенты из импортированной истории. Сначала сохраните их карточки в CRM.");
      return;
    }
    if (!window.confirm(`Переместить в архив выбранных клиентов: ${persistableRows.length}? Связанные отгрузки останутся доступны.`)) return;
    setSaving(true);
    try {
      await Promise.all(
        persistableRows
          .filter((row) => !row.archived)
          .map((row) => fetch(`/api/local-inventory/counterparties/${row.id}`, { method: "DELETE" }))
      );
      setInfo(`Архивировано: ${persistableRows.filter((row) => !row.archived).length}`);
      await loadCounterparties();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить массовое действие");
    } finally {
      setSaving(false);
    }
  }

  async function copyPhone(row: CounterpartyRow) {
    const phone = row.phone || row.additionalPhone;
    if (!phone || !navigator.clipboard) return;
    await navigator.clipboard.writeText(phone);
    setInfo("Телефон скопирован");
  }

  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((row) => selectedIds.has(row.id));

  return (
    <>
      <div className="eco-page-crumbs">
        <Link href="/crm">CRM</Link>
        <span className="sep">/</span>
        <span className="cur">Клиенты</span>
      </div>

      <header className="eco-page-head eco-clients-head">
        <div>
          <div className="eco-page-kicker">Локальная база клиентов</div>
          <h1 className="eco-page-title">Клиенты</h1>
          <p className="eco-page-subtitle">Физлица, компании и контрагенты, используемые в отгрузках и CRM.</p>
        </div>
        <div className="eco-page-actions">
          <Link href="/crm" className="eco-btn">
            <SlidersHorizontal aria-hidden className="eco-icon" />
            Воронка
          </Link>
          <EcoButton type="button" variant="primary" onClick={openCreate}>
            <UserPlus aria-hidden className="eco-icon" />
            Новый клиент
          </EcoButton>
        </div>
      </header>

      <section className="eco-grid eco-grid--kpi eco-clients-metrics" aria-label="Сводка клиентов">
        <EcoKpi label="Всего клиентов" value={stats.total.toLocaleString("ru-RU")} sub={`${stats.active.toLocaleString("ru-RU")} активных`} tone="rust" />
        <EcoKpi label="Физлица" value={stats.individuals.toLocaleString("ru-RU")} sub={typeLabelForFilter(type)} tone="info" />
        <EcoKpi label="Компании" value={stats.companies.toLocaleString("ru-RU")} sub="Юрлица, ИП и поставщики" tone="success" />
        <EcoKpi label="В архиве" value={stats.archived.toLocaleString("ru-RU")} sub={`${stats.noPhone.toLocaleString("ru-RU")} без телефона`} tone="warning" />
      </section>

      {(error || info) && (
        <div className={`eco-clients-alert ${error ? "is-error" : "is-success"}`} role="status">
          {error ? <CircleAlert aria-hidden className="eco-icon" /> : <FileText aria-hidden className="eco-icon" />}
          <span>{error || info}</span>
          <button type="button" onClick={() => (error ? setError(null) : setInfo(null))} aria-label="Закрыть сообщение">
            <X aria-hidden className="eco-icon" />
          </button>
        </div>
      )}

      <section className="eco-card eco-clients-workspace" aria-label="Поиск и список клиентов">
        <div className="eco-clients-search-panel">
          <div className="eco-clients-search">
            <Search aria-hidden className="eco-icon" />
            <EcoInput
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по имени, телефону, госномеру, VIN, ИНН или компании..."
              aria-label="Поиск клиентов"
            />
            {loading && <Loader2 aria-hidden className="eco-icon eco-spin eco-clients-search-state" />}
            {search && !loading && (
              <button type="button" className="eco-clients-search-clear" onClick={() => setSearch("")} aria-label="Очистить поиск">
                <X aria-hidden className="eco-icon" />
              </button>
            )}
          </div>

          <div className="eco-clients-filters" aria-label="Фильтры клиентов">
            <label className="eco-select-chip">
              <span>Тип</span>
              <EcoSelect
                className="eco-select-inline"
                value={type}
                onChange={(event) => {
                  setPage(0);
                  setType(event.target.value as ClientTypeFilter);
                }}
              >
                <option value="all">Все</option>
                <option value="individual">Физлица</option>
                <option value="company">Компании</option>
              </EcoSelect>
            </label>
            <label className="eco-select-chip">
              <span>Статус</span>
              <EcoSelect
                className="eco-select-inline"
                value={status}
                onChange={(event) => {
                  setPage(0);
                  setStatus(event.target.value as StatusFilter);
                }}
              >
                <option value="active">Активные</option>
                <option value="archive">Архив</option>
                <option value="all">Все</option>
              </EcoSelect>
            </label>
            <label className="eco-select-chip">
              <span>Телефон</span>
              <EcoSelect
                className="eco-select-inline"
                value={phoneFilter}
                onChange={(event) => {
                  setPage(0);
                  setPhoneFilter(event.target.value as PresenceFilter);
                }}
              >
                <option value="all">Все</option>
                <option value="with">Есть</option>
                <option value="without">Нет</option>
              </EcoSelect>
            </label>
            <label className="eco-select-chip">
              <span>Реквизиты</span>
              <EcoSelect
                className="eco-select-inline"
                value={requisitesFilter}
                onChange={(event) => {
                  setPage(0);
                  setRequisitesFilter(event.target.value as PresenceFilter);
                }}
              >
                <option value="all">Все</option>
                <option value="with">Есть</option>
                <option value="without">Нет</option>
              </EcoSelect>
            </label>
            <label className="eco-select-chip">
              <span>Отгрузки</span>
              <EcoSelect
                className="eco-select-inline"
                value={shipmentsFilter}
                onChange={(event) => {
                  setPage(0);
                  setShipmentsFilter(event.target.value as PresenceFilter);
                }}
              >
                <option value="all">Все</option>
                <option value="with">Есть</option>
                <option value="without">Нет</option>
              </EcoSelect>
            </label>
            <label className="eco-select-chip">
              <span>Сортировка</span>
              <EcoSelect
                className="eco-select-inline"
                value={sort}
                onChange={(event) => {
                  setPage(0);
                  setSort(event.target.value as SortKey);
                  setDirection(event.target.value === "name" ? "asc" : "desc");
                }}
              >
                <option value="name">По имени</option>
                <option value="createdAt">По дате создания</option>
                <option value="updatedAt">По изменению</option>
                <option value="lastDemand">По последней отгрузке</option>
              </EcoSelect>
            </label>
            {isFiltered && (
              <EcoButton type="button" size="sm" variant="ghost" onClick={resetFilters}>
                Сбросить
              </EcoButton>
            )}
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="eco-clients-bulk" role="toolbar" aria-label="Массовые действия">
            <strong>{selectedIds.size} выбрано</strong>
            <EcoButton type="button" size="sm" onClick={archiveSelected} disabled={saving}>
              <Archive aria-hidden className="eco-icon" />
              В архив
            </EcoButton>
            <EcoButton type="button" size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Снять выбор
            </EcoButton>
          </div>
        )}

        {error && !loading && !loaded ? (
          <ClientState
            tone="error"
            title="Не удалось загрузить клиентов"
            text="Проверьте подключение или повторите попытку."
            action={<EcoButton type="button" onClick={() => void loadCounterparties()}>Повторить</EcoButton>}
          />
        ) : !loading && rows.length === 0 ? (
          <ClientState
            title={isFiltered ? "Ничего не найдено" : "Клиентов пока нет"}
            text={isFiltered ? "Попробуйте изменить запрос или сбросить фильтры." : "В локальной CRM и импортированной истории отгрузок нет клиентов для текущих условий."}
            action={
              isFiltered ? (
                <EcoButton type="button" onClick={resetFilters}>Сбросить фильтры</EcoButton>
              ) : (
                <EcoButton type="button" variant="primary" onClick={openCreate}>
                  <Plus aria-hidden className="eco-icon" />
                  Новый клиент
                </EcoButton>
              )
            }
          />
        ) : (
          <>
            <div className="eco-table-toolbar eco-clients-table-toolbar">
              <div>
                <strong>{loading && !loaded ? "Загружаем клиентов..." : `${rows.length} строк · ${meta.total.toLocaleString("ru-RU")} клиентов`}</strong>
                <span>{statusLabel(status)} · {typeLabelForFilter(type)} · {presenceLabel(shipmentsFilter, "есть отгрузки", "без отгрузок")}</span>
              </div>
              <label className="eco-select-chip eco-clients-page-size">
                <span>Строк</span>
                <EcoSelect
                  className="eco-select-inline"
                  value={pageSize}
                  onChange={(event) => {
                    setPage(0);
                    setPageSize(Number(event.target.value));
                  }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </EcoSelect>
              </label>
            </div>

            <div className="eco-table-wrap eco-clients-table-wrap">
              <table className="eco-table eco-clients-table">
                <thead>
                  <tr>
                    <th className="eco-clients-check-cell">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={(event) =>
                          setSelectedIds(event.target.checked ? new Set(selectableRows.map((row) => row.id)) : new Set())
                        }
                        disabled={selectableRows.length === 0}
                        aria-label="Выбрать всех на странице"
                      />
                    </th>
                    <th>Клиент</th>
                    <th>Телефон</th>
                    <th>Тип</th>
                    <th className="eco-clients-optional-col">Реквизиты</th>
                    <th>Авто</th>
                    <th>Отгрузки</th>
                    <th>Активность</th>
                    <th>Статус</th>
                    <th className="eco-clients-actions-head">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !loaded
                    ? Array.from({ length: 7 }, (_, index) => <SkeletonRow key={index} />)
                    : rows.map((row) => {
                        const statusInfo = getRowStatus(row);
                        const reqs = requisitesSummary(row);
                        const vehicle = vehicleDisplay(row);
                        const name = displayName(row);
                        const phone = row.phone || row.additionalPhone;
                        return (
                          <tr key={row.id} onClick={() => setDetailRow(row)} className="eco-clients-row">
                            <td className="eco-clients-check-cell" onClick={(event) => event.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedIds.has(row.id)}
                                disabled={!canPersistCounterparty(row)}
                                onChange={(event) =>
                                  setSelectedIds((prev) => {
                                    const next = new Set(prev);
                                    if (event.target.checked) next.add(row.id);
                                    else next.delete(row.id);
                                    return next;
                                  })
                                }
                                aria-label={`Выбрать ${displayName(row)}`}
                              />
                            </td>
                            <td className="eco-clients-name-cell">
                              <div className="eco-clients-name-layout">
                                <span className="eco-client-avatar" aria-hidden>
                                  {row.companyType === "individual" ? <UserRound className="eco-icon" /> : <Building2 className="eco-icon" />}
                                </span>
                                <span>
                                  <strong title={name}>{name}</strong>
                                  <em title={clientSubtitle(row)}>{clientSubtitle(row)}</em>
                                </span>
                              </div>
                            </td>
                            <td className="eco-clients-phone-cell">
                              {phone ? (
                                <button type="button" title={formatPhone(phone)} onClick={(event) => { event.stopPropagation(); void copyPhone(row); }}>
                                  <Phone aria-hidden className="eco-icon" />
                                  <span>{formatPhone(phone)}</span>
                                  <ClipboardCopy aria-hidden className="eco-icon eco-copy-icon" />
                                </button>
                              ) : (
                                <span className="eco-muted-value">не указан</span>
                              )}
                              {row.email && <em>{row.email}</em>}
                            </td>
                            <td>
                              <EcoBadge tone={companyTypeTone(row.companyType)}>{companyTypeLabel(row.companyType)}</EcoBadge>
                            </td>
                            <td className="eco-clients-requisites-cell eco-clients-optional-col">
                              {reqs ? <strong title={reqs}>{reqs}</strong> : <span className="eco-muted-value">нет реквизитов</span>}
                              {row.bankName && <em>{row.bankName}</em>}
                            </td>
                            <td className="eco-clients-vehicle-cell">
                              {vehicle.primary ? (
                                <>
                                  <strong title={vehicle.title}>{vehicle.primary}</strong>
                                  {vehicle.secondary && <em title={vehicle.title}>{vehicle.secondary}</em>}
                                </>
                              ) : (
                                <span className="eco-muted-value">—</span>
                              )}
                            </td>
                            <td className="eco-clients-shipments-cell">
                              <strong>{row.demandCount}</strong>
                              <em>{row.lastDemandSumCents ? formatMoney(row.lastDemandSumCents) : "история"}</em>
                            </td>
                            <td className="eco-clients-date-cell">
                              <strong>{formatDate(row.lastDemandAt || row.updatedAt || row.createdAt)}</strong>
                              <em title={row.lastDemandName || undefined}>{row.lastDemandName ? lastDemandShortName(row.lastDemandName) : "изменение карточки"}</em>
                            </td>
                            <td>
                              <EcoBadge tone={statusInfo.tone} dot>{statusInfo.label}</EcoBadge>
                            </td>
                            <td className="eco-clients-row-actions" onClick={(event) => event.stopPropagation()}>
                              <button type="button" className="eco-icon-btn" title="Открыть клиента" onClick={() => setDetailRow(row)}>
                                <Eye aria-hidden className="eco-icon" />
                              </button>
                              <button type="button" className="eco-icon-btn" title="Редактировать" onClick={() => openEdit(row)}>
                                <Edit3 aria-hidden className="eco-icon" />
                              </button>
                              {row.archived ? (
                                <button
                                  type="button"
                                  className="eco-icon-btn"
                                  title={canPersistCounterparty(row) ? "Восстановить" : "Сначала сохраните карточку в CRM"}
                                  disabled={!canPersistCounterparty(row)}
                                  onClick={() => setConfirmArchive({ row, restore: true })}
                                >
                                  <ArchiveRestore aria-hidden className="eco-icon" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="eco-icon-btn"
                                  title={canPersistCounterparty(row) ? "В архив" : "Сначала сохраните карточку в CRM"}
                                  disabled={!canPersistCounterparty(row)}
                                  onClick={() => setConfirmArchive({ row })}
                                >
                                  <Archive aria-hidden className="eco-icon" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>

            <div className="eco-clients-cards">
              {loading && !loaded
                ? Array.from({ length: 5 }, (_, index) => <SkeletonCard key={index} />)
                : rows.map((row) => {
                    const statusInfo = getRowStatus(row);
                    const vehicle = vehicleLabel(row);
                    return (
                      <article key={row.id} className="eco-client-mobile-card" onClick={() => setDetailRow(row)}>
                        <div className="eco-client-mobile-card__head">
                          <span className="eco-client-avatar" aria-hidden>{initials(displayName(row))}</span>
                          <div>
                            <strong>{displayName(row)}</strong>
                            <em>{clientSubtitle(row)}</em>
                          </div>
                          <EcoBadge tone={statusInfo.tone}>{statusInfo.label}</EcoBadge>
                        </div>
                        <div className="eco-client-mobile-card__meta">
                          <span>{row.phone || row.additionalPhone ? formatPhone(row.phone || row.additionalPhone) : "телефон не указан"}</span>
                          <span>{companyTypeLabel(row.companyType)}</span>
                          <span>{vehicle || "авто не привязано"}</span>
                          <span>{row.demandCount} отгрузок</span>
                        </div>
                        <div className="eco-client-mobile-card__actions" onClick={(event) => event.stopPropagation()}>
                          <EcoButton type="button" size="sm" onClick={() => setDetailRow(row)}>Открыть</EcoButton>
                          <EcoButton type="button" size="sm" variant="ghost" onClick={() => openEdit(row)}>Редактировать</EcoButton>
                        </div>
                      </article>
                    );
                  })}
            </div>

            <footer className="eco-clients-pagination">
              <span>Показано {displayStart}–{displayEnd} из {meta.total.toLocaleString("ru-RU")}</span>
              <div>
                <EcoButton type="button" size="sm" onClick={() => setPage((prev) => Math.max(0, prev - 1))} disabled={page === 0}>
                  <ChevronLeft aria-hidden className="eco-icon" />
                </EcoButton>
                <strong>{page + 1} / {pageCount}</strong>
                <EcoButton type="button" size="sm" onClick={() => setPage((prev) => Math.min(pageCount - 1, prev + 1))} disabled={page >= pageCount - 1}>
                  <ChevronRight aria-hidden className="eco-icon" />
                </EcoButton>
              </div>
            </footer>
          </>
        )}
      </section>

      {detailRow && (
        <ClientDrawer
          row={detailRow}
          onClose={() => setDetailRow(null)}
          onEdit={() => openEdit(detailRow)}
          canArchive={canPersistCounterparty(detailRow)}
          onArchive={() => {
            if (!canPersistCounterparty(detailRow)) {
              setInfo("Это клиент из импортированной истории. Сохраните карточку, чтобы архивировать её в CRM.");
              return;
            }
            setConfirmArchive({ row: detailRow, restore: detailRow.archived });
          }}
        />
      )}

      {formMode && (
        <FormDrawer
          mode={formMode}
          form={form}
          saving={saving}
          onClose={closeForm}
          onChange={updateForm}
          onSubmit={submit}
        />
      )}

      {confirmArchive && (
        <div className="eco-client-confirm-backdrop" role="presentation" onMouseDown={() => setConfirmArchive(null)}>
          <section role="dialog" aria-modal="true" className="eco-client-confirm" onMouseDown={(event) => event.stopPropagation()}>
            <div className="eco-client-confirm__icon">
              {confirmArchive.restore ? <ArchiveRestore aria-hidden className="eco-icon" /> : <Archive aria-hidden className="eco-icon" />}
            </div>
            <h2>{confirmArchive.restore ? "Восстановить клиента?" : "Переместить клиента в архив?"}</h2>
            <p>
              {confirmArchive.restore
                ? "Клиент снова появится в активном списке."
                : "Связанные отгрузки останутся доступны, а клиент будет скрыт из активного списка."}
            </p>
            <strong>{displayName(confirmArchive.row)}</strong>
            <div className="eco-client-confirm__actions">
              <EcoButton type="button" variant={confirmArchive.restore ? "primary" : "secondary"} onClick={() => void setArchiveState(confirmArchive.row, confirmArchive.restore)}>
                {confirmArchive.restore ? "Восстановить" : "В архив"}
              </EcoButton>
              <EcoButton type="button" variant="ghost" onClick={() => setConfirmArchive(null)}>Отмена</EcoButton>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ClientState({
  title,
  text,
  action,
  tone = "empty",
}: {
  title: string;
  text: string;
  action: ReactNode;
  tone?: "empty" | "error";
}) {
  return (
    <div className={`eco-clients-state ${tone === "error" ? "is-error" : ""}`}>
      <CircleAlert aria-hidden className="eco-icon" />
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="eco-clients-skeleton-row">
      <td colSpan={10}>
        <span className="eco-skeleton-line is-title" />
        <span className="eco-skeleton-line is-code" />
      </td>
    </tr>
  );
}

function SkeletonCard() {
  return (
    <article className="eco-client-mobile-card eco-client-mobile-card--skeleton">
      <span className="eco-skeleton-line is-title" />
      <span className="eco-skeleton-line is-code" />
      <span className="eco-skeleton-pill" />
    </article>
  );
}

function ClientDrawer({
  row,
  onClose,
  onEdit,
  canArchive,
  onArchive,
}: {
  row: CounterpartyRow;
  onClose: () => void;
  onEdit: () => void;
  canArchive: boolean;
  onArchive: () => void;
}) {
  const statusInfo = getRowStatus(row);
  const vehicle = vehicleLabel(row);
  const recentDemands = row.recentDemands ?? [];
  return (
    <div className="eco-client-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="eco-client-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="eco-client-drawer__header">
          <div>
            <span className="eco-page-kicker">Карточка клиента</span>
            <h2>{displayName(row)}</h2>
            <div className="eco-client-drawer__badges">
              <EcoBadge tone={companyTypeTone(row.companyType)}>{companyTypeLabel(row.companyType)}</EcoBadge>
              <EcoBadge tone={statusInfo.tone} dot>{statusInfo.label}</EcoBadge>
            </div>
          </div>
          <button type="button" className="eco-icon-btn" onClick={onClose} aria-label="Закрыть карточку">
            <X aria-hidden className="eco-icon" />
          </button>
        </header>

        <div className="eco-client-drawer__actions">
          <Link href="/shipment/new" className="eco-btn eco-btn--primary">
            <Truck aria-hidden className="eco-icon" />
            Создать отгрузку
          </Link>
          <EcoButton type="button" onClick={onEdit}>
            <Edit3 aria-hidden className="eco-icon" />
            Редактировать
          </EcoButton>
          <EcoButton type="button" variant="ghost" onClick={onArchive} disabled={!canArchive}>
            {row.archived ? <ArchiveRestore aria-hidden className="eco-icon" /> : <Archive aria-hidden className="eco-icon" />}
            {row.archived ? "Восстановить" : "В архив"}
          </EcoButton>
        </div>

        <div className="eco-client-drawer__body">
          <InfoBlock title="Контакты" icon={<Phone aria-hidden className="eco-icon" />}>
            <InfoLine label="Основной телефон" value={row.phone ? formatPhone(row.phone) : "не указан"} muted={!row.phone} />
            <InfoLine label="Доп. телефон" value={row.additionalPhone ? formatPhone(row.additionalPhone) : "не указан"} muted={!row.additionalPhone} />
            <InfoLine label="Email" value={row.email || "не указан"} muted={!row.email} />
          </InfoBlock>

          <InfoBlock title="Автомобили" icon={<Car aria-hidden className="eco-icon" />}>
            <InfoLine label="Связано авто" value={vehicle || "нет привязанных авто"} muted={!vehicle} />
            <InfoLine label="Госномер" value={row.vehiclePlate || "не указан"} muted={!row.vehiclePlate} />
            <InfoLine label="VIN" value={row.vehicleVin || "не указан"} muted={!row.vehicleVin} mono />
          </InfoBlock>

          <InfoBlock title="Отгрузки" icon={<Truck aria-hidden className="eco-icon" />} className="eco-client-shipments-block">
            <div className="eco-client-shipments-summary">
              <InfoLine label="Всего отгрузок" value={String(row.demandCount)} />
              <Link href={allClientShipmentsHref(row)} className="eco-client-shipments-all">
                Все отгрузки клиента
                <ChevronRight aria-hidden className="eco-icon" />
              </Link>
            </div>
            {recentDemands.length > 0 ? (
              <div className="eco-client-shipment-list">
                {recentDemands.slice(0, 5).map((demand) => (
                  <Link key={demand.id} href={shipmentHref(demand.id)} className="eco-client-shipment-row">
                    <span>
                      <strong>{demand.name}</strong>
                      <em>{formatDate(demand.momentAt)} · {formatMoney(demand.sumCents)}</em>
                    </span>
                    <EcoBadge tone={demandStatusTone(demand.applicable)}>{demandStatusLabel(demand.applicable)}</EcoBadge>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="eco-muted-value">История отгрузок пока не найдена.</p>
            )}
          </InfoBlock>

          <InfoBlock title="Реквизиты" icon={<FileText aria-hidden className="eco-icon" />}>
            <InfoLine label="Юр. название" value={row.legalTitle || "не указано"} muted={!row.legalTitle} />
            <InfoLine label="ИНН / КПП" value={[row.inn ? `ИНН ${row.inn}` : "", row.kpp ? `КПП ${row.kpp}` : ""].filter(Boolean).join(" · ") || "нет реквизитов"} muted={!row.inn && !row.kpp} mono />
            <InfoLine label="Банк" value={row.bankName || "не указан"} muted={!row.bankName} />
            <InfoLine label="Адрес" value={row.legalAddress || "не указан"} muted={!row.legalAddress} />
          </InfoBlock>

          <InfoBlock title="Комментарии" icon={<FileText aria-hidden className="eco-icon" />}>
            <p className={row.comment ? "" : "eco-muted-value"}>{row.comment || "Комментариев пока нет."}</p>
          </InfoBlock>

          <InfoBlock title="История изменений" icon={<FileText aria-hidden className="eco-icon" />}>
            <InfoLine label="Создан" value={formatDate(row.createdAt)} />
            <InfoLine label="Изменён" value={formatDate(row.updatedAt)} />
          </InfoBlock>
        </div>
      </aside>
    </div>
  );
}

function InfoBlock({ title, icon, children, className = "" }: { title: string; icon: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`eco-client-info-block ${className}`}>
      <h3>{icon}{title}</h3>
      {children}
    </section>
  );
}

function InfoLine({ label, value, muted = false, mono = false }: { label: string; value: string; muted?: boolean; mono?: boolean }) {
  return (
    <div className="eco-client-info-line">
      <span>{label}</span>
      <strong className={`${muted ? "eco-muted-value" : ""} ${mono ? "eco-mono-value" : ""}`}>{value}</strong>
    </div>
  );
}

function FormDrawer({
  mode,
  form,
  saving,
  onClose,
  onChange,
  onSubmit,
}: {
  mode: "create" | "edit";
  form: CounterpartyForm;
  saving: boolean;
  onClose: () => void;
  onChange: (patch: Partial<CounterpartyForm>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="eco-client-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="eco-client-drawer eco-client-form-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="eco-client-drawer__header">
          <div>
            <span className="eco-page-kicker">{mode === "edit" ? "Редактирование" : "Создание"}</span>
            <h2>{mode === "edit" ? "Редактировать клиента" : "Новый клиент"}</h2>
            <p>Контакт, реквизиты и базовые данные для отгрузок.</p>
          </div>
          <button type="button" className="eco-icon-btn" onClick={onClose} aria-label="Закрыть форму">
            <X aria-hidden className="eco-icon" />
          </button>
        </header>

        <form id="counterparty-form" className="eco-client-form" onSubmit={onSubmit}>
          <section className="eco-client-form-section">
            <h3>Основное</h3>
            <div className="eco-client-type-seg eco-seg" aria-label="Тип клиента">
              {[
                ["individual", "Физлицо"],
                ["legal", "Компания"],
                ["entrepreneur", "ИП"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`eco-seg-btn ${form.companyType === value ? "is-active" : ""}`}
                  onClick={() => onChange({ companyType: value })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="eco-client-form-grid">
              <ClientField label="Имя или название *" value={form.name} onChange={(value) => onChange({ name: value })} autoFocus />
              <ClientField label="Телефон" value={form.phone} onChange={(value) => onChange({ phone: value })} />
              <ClientField label="Дополнительный телефон" value={form.additionalPhone} onChange={(value) => onChange({ additionalPhone: value })} />
              <ClientField label="Email" value={form.email} onChange={(value) => onChange({ email: value })} type="email" />
              <ClientField label="Комментарий" value={form.comment} onChange={(value) => onChange({ comment: value })} textarea full />
            </div>
          </section>

          <section className="eco-client-form-section">
            <h3>Автомобиль</h3>
            <div className="eco-client-form-grid">
              <ClientField label="Госномер" value={form.vehiclePlate} onChange={(value) => onChange({ vehiclePlate: value })} />
              <ClientField label="VIN" value={form.vehicleVin} onChange={(value) => onChange({ vehicleVin: value.toUpperCase() })} />
              <ClientField label="Модель" value={form.vehicleModel} onChange={(value) => onChange({ vehicleModel: value })} />
              <ClientField label="Год" value={form.vehicleYear} onChange={(value) => onChange({ vehicleYear: value })} />
            </div>
          </section>

          <section className="eco-client-form-section">
            <h3>Реквизиты</h3>
            <div className="eco-client-form-grid">
              <ClientField label="Тип контрагента" value={form.counterpartyTypeName} onChange={(value) => onChange({ counterpartyTypeName: value })} full />
              {legalFields.map((field) => (
                <ClientField
                  key={field.key}
                  label={field.label}
                  value={form[field.key]}
                  onChange={(value) => onChange({ [field.key]: value } as Partial<CounterpartyForm>)}
                  type={field.type === "date" ? "date" : "text"}
                  textarea={field.type === "textarea"}
                  full={field.type === "textarea"}
                />
              ))}
            </div>
          </section>
        </form>

        <footer className="eco-client-drawer__footer">
          <span>{saving ? "Сохраняем..." : "Изменения попадут в локальную базу клиентов."}</span>
          <div>
            <EcoButton type="submit" form="counterparty-form" variant="primary" disabled={saving || !form.name.trim()}>
              {saving && <Loader2 aria-hidden className="eco-icon eco-spin" />}
              {mode === "edit" ? "Сохранить" : "Создать клиента"}
            </EcoButton>
            <EcoButton type="button" variant="ghost" onClick={onClose}>Отмена</EcoButton>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function ClientField({
  label,
  value,
  onChange,
  type = "text",
  textarea = false,
  full = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  textarea?: boolean;
  full?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className={`eco-client-field ${full ? "is-full" : ""}`}>
      <span>{label}</span>
      {textarea ? (
        <textarea className="eco-input" value={value} onChange={(event) => onChange(event.target.value)} rows={3} />
      ) : (
        <EcoInput type={type} value={value} onChange={(event) => onChange(event.target.value)} autoFocus={autoFocus} />
      )}
    </label>
  );
}
