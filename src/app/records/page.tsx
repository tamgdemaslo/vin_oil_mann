"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type User = { login: string; name: string; role?: "owner" | "admin" | "master" } | null;

type Staff = { id: number; name: string; specialization?: string; bookable?: boolean };
type Service = { id: number; title: string; seance_length?: number };
type RecordItem = {
  id: number;
  staff_id?: number;
  date?: string;
  datetime?: string;
  seance_length?: number;
  length?: number;
  comment?: string;
  attendance?: number;
  confirmed?: number;
  online?: boolean;
  record_from?: string;
  from_url?: string;
  bookform_id?: number;
  services?: Array<{ id?: number; title?: string }>;
  client?: { display_name?: string; name?: string; phone?: string; email?: string; is_new?: boolean };
} & Record<string, unknown>;
type TimeSlot = { time?: string; datetime?: number | string; seance_length?: number; free?: boolean; is_free?: boolean };
type ShipmentLookupRow = {
  id: string;
  name: string;
  documentDate: string;
  momentAt: string;
  sumCents: number;
  applicable: boolean;
  agentName?: string;
};
type TimelineRecord = {
  id: number;
  staffId: number;
  startMinute: number;
  endMinute: number;
  title: string;
  subtitle: string;
  comment?: string;
  statusLabel: string;
  statusTone: "green" | "amber" | "red" | "blue";
  isNewClient?: boolean;
  isClientSelfBooked?: boolean;
  startedAtText: string;
  endedAtText: string;
};

function toDateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateTimeLocalValue(value: Date) {
  const date = toDateInputValue(value);
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${date}T${hours}:${minutes}`;
}

function parseDateTimeLocal(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addSecondsToDateTimeLocal(value: string, seconds: number) {
  const date = parseDateTimeLocal(value);
  if (!date) return "";
  return toDateTimeLocalValue(new Date(date.getTime() + seconds * 1000));
}

function calculateSeanceLengthSeconds(startValue: string, endValue: string): number | null {
  const start = parseDateTimeLocal(startValue);
  const end = parseDateTimeLocal(endValue);
  if (!start || !end) return null;
  const seconds = Math.round((end.getTime() - start.getTime()) / 1000);
  return seconds > 0 ? seconds : null;
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  return digits;
}

function fallbackEmail(phone: string) {
  return `${phone || "client"}@temp.mail`;
}

function getApiErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const response = data as {
    error?: unknown;
    meta?: { message?: unknown; errors?: unknown };
  };
  const details = response.meta?.errors ? JSON.stringify(response.meta.errors) : "";
  const message =
    typeof response.error === "string" && response.error.trim()
      ? response.error
      : typeof response.meta?.message === "string" && response.meta.message.trim()
        ? response.meta.message
        : "";
  if (message && details) return `${message}: ${details}`;
  if (message) return message;
  if (details) return details;
  return fallback;
}

const RU_MONTHS = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];
const DEFAULT_RECORD_DURATION_SECONDS = 40 * 60;

function resolveStatus(record: RecordItem): { label: string; tone: TimelineRecord["statusTone"] } {
  if (record.attendance === 1) return { label: "Пришел", tone: "green" };
  if (record.attendance === -1) return { label: "Не пришел", tone: "red" };
  if (record.confirmed === 1) return { label: "Подтвержден", tone: "blue" };
  return { label: "Ожидание", tone: "amber" };
}

function getClientDisplayName(record: RecordItem): string {
  return record.client?.display_name || record.client?.name || "Клиент";
}

function formatRubles(sumCents: number): string {
  return ((sumCents || 0) / 100).toLocaleString("ru-RU", {
    maximumFractionDigits: 0,
  });
}

function formatShipmentDate(value: string): string {
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }
  return value || "—";
}

export default function RecordsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [staff, setStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [times, setTimes] = useState<TimeSlot[]>([]);
  const [seances, setSeances] = useState<TimeSlot[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [companyTitle, setCompanyTitle] = useState("Там где масло");

  const [staffId, setStaffId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [datetime, setDatetime] = useState("");
  const [datetimeEnd, setDatetimeEnd] = useState("");
  const [comment, setComment] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);
  const [quickCreateHint, setQuickCreateHint] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isRecordDetailsOpen, setIsRecordDetailsOpen] = useState(false);
  const [shipmentLookup, setShipmentLookup] = useState<{
    phone: string;
    loading: boolean;
    rows: ShipmentLookupRow[];
    error: string | null;
  }>({ phone: "", loading: false, rows: [], error: null });
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const [editStaffId, setEditStaffId] = useState("");
  const [editServiceIds, setEditServiceIds] = useState<string[]>([]);
  const [editClientName, setEditClientName] = useState("");
  const [editClientPhone, setEditClientPhone] = useState("");
  const [editClientEmail, setEditClientEmail] = useState("");
  const [editDatetime, setEditDatetime] = useState("");
  const [editDatetimeEnd, setEditDatetimeEnd] = useState("");
  const [editComment, setEditComment] = useState("");
  const [hoveredSlot, setHoveredSlot] = useState<{ staffId: number; minute: number } | null>(null);

  const [scheduleDate, setScheduleDate] = useState(() => toDateInputValue(new Date()));
  const [timelineStaffId, setTimelineStaffId] = useState("");

  const timelineStaff = useMemo(() => {
    if (timelineStaffId) {
      const selected = staff.find((s) => String(s.id) === timelineStaffId);
      return selected ? [selected] : [];
    }
    const bookable = staff.filter((s) => s.bookable !== false);
    return (bookable.length > 0 ? bookable : staff).slice(0, 2);
  }, [staff, timelineStaffId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (cancelled) return;
        if (!data?.user) {
          router.push("/login?from=/records");
          return;
        }
        setUser(data.user);
      } finally {
        if (!cancelled) setCheckingAuth(false);
      }
    }
    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const canAccess = useMemo(
    () => !!user && (user.role === "owner" || user.role === "admin"),
    [user]
  );

  const loadBaseData = useCallback(async () => {
    setError(null);
    try {
      const [staffRes, servicesRes] = await Promise.all([
        fetch(`/api/yclients?action=staff&company_id=${companyId}`, { cache: "no-store" }),
        fetch(`/api/yclients?action=services&company_id=${companyId}`, { cache: "no-store" }),
      ]);
      const staffJson = await staffRes.json();
      const servicesJson = await servicesRes.json();

      const staffError =
        staffJson?.error ??
        staffJson?.meta?.message ??
        staffJson?.meta?.errors?.["[masterId]"]?.[0] ??
        staffJson?.meta?.errors?.["[salon_id]"]?.[0];
      const servicesError =
        servicesJson?.error ??
        servicesJson?.meta?.message ??
        servicesJson?.meta?.errors?.["[masterId]"]?.[0] ??
        servicesJson?.meta?.errors?.["[salon_id]"]?.[0];
      if (!staffRes.ok) throw new Error(staffError ?? "Ошибка загрузки сотрудников");
      if (!servicesRes.ok) throw new Error(servicesError ?? "Ошибка загрузки услуг");

      setStaff(Array.isArray(staffJson.data) ? staffJson.data : []);
      if (!timelineStaffId && Array.isArray(staffJson.data) && staffJson.data.length > 0) {
        const bookable = staffJson.data.find((item: Staff) => item.bookable !== false);
        setTimelineStaffId(String((bookable ?? staffJson.data[0]).id));
      }

      const rawServices = servicesJson.data?.services ?? servicesJson.data ?? [];
      setServices(Array.isArray(rawServices) ? rawServices : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки данных");
    } finally {
      // no-op
    }
  }, [companyId, timelineStaffId]);

  const loadCompanyConfig = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/yclients?action=config", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Ошибка загрузки конфигурации филиала");
      const cfg = data?.data ?? {};
      const id = String(cfg.company_id ?? "").trim();
      if (!id) throw new Error("Не задан YCLIENTS_COMPANY_ID в .env.local");
      setCompanyId(id);
      if (cfg.company_title) setCompanyTitle(String(cfg.company_title));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки конфигурации филиала");
    }
  }, []);

  const loadSchedule = useCallback(async () => {
    const activeStaffId = timelineStaffId || staffId;
    if (!activeStaffId) return;
    setError(null);
    try {
      const serviceIds = serviceId ? serviceId : "";
      const [timesRes, seancesRes] = await Promise.all([
        fetch(
          `/api/yclients?action=times&company_id=${companyId}&staff_id=${activeStaffId}&date=${scheduleDate}&service_ids=${serviceIds}`,
          { cache: "no-store" }
        ),
        fetch(
          `/api/yclients?action=seances&company_id=${companyId}&staff_id=${activeStaffId}&date=${scheduleDate}&service_ids=${serviceIds}`,
          { cache: "no-store" }
        ),
      ]);
      const timesJson = await timesRes.json();
      const seancesJson = await seancesRes.json();

      if (!timesRes.ok) throw new Error(timesJson.error ?? "Ошибка загрузки времени");
      if (!seancesRes.ok) throw new Error(seancesJson.error ?? "Ошибка загрузки сеансов");

      setTimes(Array.isArray(timesJson.data) ? timesJson.data : []);
      const rawSeances = seancesJson.data ?? [];
      setSeances(Array.isArray(rawSeances) ? rawSeances : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки графика");
    }
  }, [companyId, scheduleDate, serviceId, staffId, timelineStaffId]);

  const loadRecords = useCallback(async () => {
    const activeStaffIds =
      timelineStaffId
        ? [timelineStaffId]
        : staff.filter((s) => s.bookable !== false).slice(0, 2).map((s) => String(s.id));
    if (activeStaffIds.length === 0) return;
    setError(null);
    try {
      const responses = await Promise.all(
        activeStaffIds.map(async (staffIdOne) => {
          const params = new URLSearchParams({
            action: "records",
            company_id: companyId,
            start_date: scheduleDate,
            end_date: scheduleDate,
            count: "100",
            staff_id: staffIdOne,
          });
          const res = await fetch(`/api/yclients?${params.toString()}`, { cache: "no-store" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Ошибка загрузки записей");
          return Array.isArray(data.data) ? (data.data as RecordItem[]) : [];
        })
      );
      setRecords(responses.flat());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки записей");
    }
  }, [companyId, scheduleDate, staff, timelineStaffId]);

  const dayTimeline = useMemo(() => {
    const list: TimelineRecord[] = [];
    for (const record of records) {
      const staffIdNum = Number(record.staff_id ?? 0);
      if (!staffIdNum) continue;
      const raw = (record.date ?? record.datetime ?? "").replace(" ", "T");
      if (!raw.startsWith(scheduleDate)) continue;
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) continue;

      const startMinute = date.getHours() * 60 + date.getMinutes();
      const lengthSec = record.seance_length ?? record.length ?? 1800;
      const duration = Math.max(30, Math.round(lengthSec / 60));
      const endMinute = Math.min(24 * 60, startMinute + duration);
      const title = (record.services ?? []).map((s) => s.title).filter(Boolean).join(", ") || "Запись";
      const clientName = record.client?.display_name || record.client?.name || "Клиент";
      const phone = record.client?.phone ? ` · ${record.client.phone}` : "";
      const status = resolveStatus(record);
      const isClientSelfBooked = Boolean(
        record.online || record.bookform_id || (record.record_from && record.record_from !== "manual") || record.from_url
      );

      list.push({
        id: record.id,
        staffId: staffIdNum,
        startMinute,
        endMinute,
        title,
        subtitle: `${clientName}${phone}`,
        comment: record.comment ?? undefined,
        statusLabel: status.label,
        statusTone: status.tone,
        isNewClient: Boolean(record.client?.is_new),
        isClientSelfBooked,
        startedAtText: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
        endedAtText: `${String(Math.floor(endMinute / 60)).padStart(2, "0")}:${String(endMinute % 60).padStart(2, "0")}`,
      });
    }
    return list.sort((a, b) => a.startMinute - b.startMinute);
  }, [records, scheduleDate]);

  const timelineByStaff = useMemo(() => {
    const map = new Map<number, TimelineRecord[]>();
    for (const item of dayTimeline) {
      const arr = map.get(item.staffId) ?? [];
      arr.push(item);
      map.set(item.staffId, arr);
    }
    return map;
  }, [dayTimeline]);

  const selectedTimelineRecord = useMemo(
    () => dayTimeline.find((item) => item.id === selectedRecordId) ?? null,
    [dayTimeline, selectedRecordId]
  );
  const selectedRecordItem = useMemo(
    () => records.find((item) => item.id === selectedRecordId) ?? null,
    [records, selectedRecordId]
  );
  const selectedClientPhone = selectedRecordItem?.client?.phone?.trim() ?? "";
  const selectedClientName = selectedRecordItem ? getClientDisplayName(selectedRecordItem) : "";
  const selectedShipmentPhone = selectedClientPhone ? normalizePhone(selectedClientPhone) : "";
  const createShipmentHref = selectedClientName
    ? `/shipment/new?counterparty=${encodeURIComponent(selectedClientName)}${
        selectedShipmentPhone ? `&phone=${encodeURIComponent(selectedShipmentPhone)}` : ""
      }`
    : "/shipment/new";
  const createServiceLengthSeconds = useMemo(() => {
    const selectedService = services.find((item) => String(item.id) === serviceId);
    return Number(selectedService?.seance_length ?? DEFAULT_RECORD_DURATION_SECONDS) || DEFAULT_RECORD_DURATION_SECONDS;
  }, [serviceId, services]);
  const editServiceLengthSeconds = useMemo(() => {
    const selectedService = services.find((item) => String(item.id) === editServiceIds[0]);
    return Number(selectedService?.seance_length ?? DEFAULT_RECORD_DURATION_SECONDS) || DEFAULT_RECORD_DURATION_SECONDS;
  }, [editServiceIds, services]);

  const timelineStartMinute = 8 * 60;
  const timelineEndMinute = 17 * 60;
  const minutePx = 1.5;
  const timelineHeight = (timelineEndMinute - timelineStartMinute) * minutePx;
  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = timelineStartMinute; m <= timelineEndMinute; m += 60) marks.push(m);
    return marks;
  }, [timelineEndMinute, timelineStartMinute]);
  const halfHourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = timelineStartMinute + 30; m < timelineEndMinute; m += 60) marks.push(m);
    return marks;
  }, [timelineEndMinute, timelineStartMinute]);
  const nowMinute = useMemo(() => {
    if (scheduleDate !== toDateInputValue(new Date())) return null;
    const now = new Date();
    const minute = now.getHours() * 60 + now.getMinutes();
    if (minute < timelineStartMinute || minute > timelineEndMinute) return null;
    return minute;
  }, [scheduleDate, timelineEndMinute, timelineStartMinute]);
  const miniCalendar = useMemo(() => {
    const current = new Date(`${scheduleDate}T00:00:00`);
    const year = current.getFullYear();
    const month = current.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const weekOffset = (firstDay.getDay() + 6) % 7; // Monday first
    const cells: Array<{ date: string | null; day: number | null }> = [];
    for (let i = 0; i < weekOffset; i += 1) cells.push({ date: null, day: null });
    for (let d = 1; d <= daysInMonth; d += 1) {
      const mm = String(month + 1).padStart(2, "0");
      const dd = String(d).padStart(2, "0");
      cells.push({ date: `${year}-${mm}-${dd}`, day: d });
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
    return { title: `${RU_MONTHS[month]} ${year}`, cells };
  }, [scheduleDate]);

  const openQuickCreateFromMinute = useCallback(
    (staffIdValue: number, minute: number) => {
      const clamped = Math.max(timelineStartMinute, Math.min(timelineEndMinute - 5, minute));
      const rounded = Math.floor(clamped / 5) * 5;
      const hh = String(Math.floor(rounded / 60)).padStart(2, "0");
      const mm = String(rounded % 60).padStart(2, "0");
      setStaffId(String(staffIdValue));
      setDatetime(`${scheduleDate}T${hh}:${mm}`);
      setDatetimeEnd(addSecondsToDateTimeLocal(`${scheduleDate}T${hh}:${mm}`, createServiceLengthSeconds));
      setSelectedRecordId(null);
      setIsRecordDetailsOpen(false);
      setQuickCreateHint(`Новая запись: ${hh}:${mm} · ${staff.find((s) => s.id === staffIdValue)?.name ?? "Сотрудник"}`);
      setIsCreateModalOpen(true);
    },
    [createServiceLengthSeconds, scheduleDate, staff, timelineEndMinute, timelineStartMinute]
  );
  const getRoundedMinute = useCallback(
    (minute: number) => {
      const clamped = Math.max(timelineStartMinute, Math.min(timelineEndMinute - 5, minute));
      return Math.floor(clamped / 5) * 5;
    },
    [timelineEndMinute, timelineStartMinute]
  );

  useEffect(() => {
    if (!canAccess || checkingAuth) return;
    void loadCompanyConfig();
  }, [canAccess, checkingAuth, loadCompanyConfig]);

  useEffect(() => {
    if (!canAccess || checkingAuth || !companyId) return;
    void loadBaseData();
  }, [canAccess, checkingAuth, companyId, loadBaseData]);

  useEffect(() => {
    if (!canAccess || checkingAuth || !companyId) return;
    if (!timelineStaffId && !staffId) return;
    void loadSchedule();
    void loadRecords();
  }, [canAccess, checkingAuth, companyId, loadRecords, loadSchedule, scheduleDate, staffId, timelineStaffId]);

  useEffect(() => {
    if (!selectedShipmentPhone) {
      setShipmentLookup({ phone: "", loading: false, rows: [], error: null });
      return;
    }

    const controller = new AbortController();
    setShipmentLookup({ phone: selectedShipmentPhone, loading: true, rows: [], error: null });

    async function loadShipmentsByPhone() {
      try {
        const res = await fetch(
          `/api/demands/by-phone?phone=${encodeURIComponent(selectedShipmentPhone)}&limit=5`,
          { cache: "no-store", signal: controller.signal }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить отгрузки");
        if (controller.signal.aborted) return;
        setShipmentLookup({
          phone: selectedShipmentPhone,
          loading: false,
          rows: Array.isArray(data?.rows) ? data.rows : [],
          error: null,
        });
      } catch (e) {
        if (controller.signal.aborted) return;
        setShipmentLookup({
          phone: selectedShipmentPhone,
          loading: false,
          rows: [],
          error: e instanceof Error ? e.message : "Не удалось загрузить отгрузки",
        });
      }
    }

    void loadShipmentsByPhone();
    return () => controller.abort();
  }, [selectedShipmentPhone]);

  const resetRecordForm = () => {
    setClientName("");
    setClientPhone("");
    setClientEmail("");
    setServiceId("");
    setDatetime("");
    setDatetimeEnd("");
    setComment("");
  };

  const handleSaveRecord = async () => {
    if (!staffId || !serviceId || !datetime) {
      setError("Для записи обязательны сотрудник, услуга и дата/время");
      return;
    }
    if (!clientName.trim() || !clientPhone.trim()) {
      setError("Для записи обязательны имя и телефон клиента");
      return;
    }
    setError(null);

    const phone = normalizePhone(clientPhone);
    if (!phone) {
      setError("Укажите телефон клиента цифрами");
      return;
    }
    const manualSeanceLength = datetimeEnd ? calculateSeanceLengthSeconds(datetime, datetimeEnd) : null;
    if (datetimeEnd && manualSeanceLength == null) {
      setError("Окончание записи должно быть позже начала");
      return;
    }
    const seanceLength = manualSeanceLength ?? createServiceLengthSeconds;
    const payload = {
      phone,
      fullname: clientName.trim(),
      email: clientEmail.trim() || fallbackEmail(phone),
      comment: comment.trim() || undefined,
      appointments: [
        {
          id: 1,
          services: [Number(serviceId)],
          staff_id: Number(staffId),
          datetime: `${datetime.replace("T", " ")}:00`,
          seance_length: seanceLength,
        },
      ],
    };

    const res = await fetch("/api/yclients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-record", company_id: companyId, payload }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(getApiErrorMessage(data, "Ошибка сохранения записи"));
      return;
    }

    resetRecordForm();
    await loadSchedule();
    await loadRecords();
    setIsCreateModalOpen(false);
  };

  const openEditModal = useCallback((record: RecordItem) => {
    const rawDate = String(record.date ?? record.datetime ?? "").replace(" ", "T");
    const normalizedDate = rawDate.length >= 16 ? rawDate.slice(0, 16) : "";
    setEditingRecordId(record.id);
    setEditStaffId(record.staff_id ? String(record.staff_id) : "");
    setEditServiceIds((record.services ?? []).map((s) => String(s.id)).filter(Boolean));
    setEditClientName(record.client?.display_name || record.client?.name || "");
    setEditClientPhone(record.client?.phone || "");
    setEditClientEmail(record.client?.email || "");
    setEditDatetime(normalizedDate);
    setEditDatetimeEnd(
      normalizedDate
        ? addSecondsToDateTimeLocal(
            normalizedDate,
            Number(record.seance_length ?? record.length ?? DEFAULT_RECORD_DURATION_SECONDS) || DEFAULT_RECORD_DURATION_SECONDS
          )
        : ""
    );
    setEditComment(record.comment ?? "");
    setIsEditModalOpen(true);
  }, []);

  const handleUpdateRecord = async () => {
    if (!editingRecordId) {
      setError("Не выбрана запись для редактирования");
      return;
    }
    if (!editStaffId || editServiceIds.length === 0 || !editDatetime) {
      setError("Для редактирования обязательны сотрудник, услуга и дата/время");
      return;
    }
    if (!editClientName.trim() || !editClientPhone.trim()) {
      setError("Для редактирования обязательны имя и телефон клиента");
      return;
    }

    setError(null);
    const recordForEdit = records.find((item) => item.id === editingRecordId);
    const manualSeanceLength = editDatetimeEnd ? calculateSeanceLengthSeconds(editDatetime, editDatetimeEnd) : null;
    if (editDatetimeEnd && manualSeanceLength == null) {
      setError("Окончание записи должно быть позже начала");
      return;
    }
    const fallbackSeanceLength =
      Number(recordForEdit?.seance_length ?? recordForEdit?.length ?? editServiceLengthSeconds) || editServiceLengthSeconds;
    const seanceLength = manualSeanceLength ?? fallbackSeanceLength;
    const editPhone = normalizePhone(editClientPhone);
    if (!editPhone) {
      setError("Укажите телефон клиента цифрами");
      return;
    }
    const payload = {
      staff_id: Number(editStaffId),
      services: editServiceIds.map((id) => ({ id: Number(id) })),
      client: {
        name: editClientName.trim(),
        phone: editPhone,
        email: editClientEmail.trim() || fallbackEmail(editPhone),
      },
      datetime: `${editDatetime.replace("T", " ")}:00`,
      seance_length: seanceLength,
      comment: editComment.trim() || undefined,
      save_if_busy: true,
    };

    const res = await fetch("/api/yclients", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update-record",
        company_id: companyId,
        record_id: editingRecordId,
        payload,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(getApiErrorMessage(data, "Ошибка редактирования записи"));
      return;
    }

    setIsEditModalOpen(false);
    await loadSchedule();
    await loadRecords();
  };

  const toggleEditService = useCallback((id: string) => {
    setEditServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const handleDeleteRecord = async () => {
    if (!selectedRecordId) return;
    const ok = window.confirm("Удалить выбранную запись?");
    if (!ok) return;

    setError(null);
    const res = await fetch("/api/yclients", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete-record",
        company_id: companyId,
        record_id: selectedRecordId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(getApiErrorMessage(data, "Ошибка удаления записи"));
      return;
    }

    setSelectedRecordId(null);
    setIsRecordDetailsOpen(false);
    await loadSchedule();
    await loadRecords();
  };

  if (checkingAuth) {
    return <div className="p-6 text-sm text-zinc-500">Проверка доступа…</div>;
  }

  if (!canAccess) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Доступ к разделу записей есть только у владельца и администратора.
        </div>
      </div>
    );
  }

  return (
    <main
      className="min-h-screen bg-[#ececec] px-4 py-4 dark:bg-zinc-950 sm:px-5"
      style={{ fontFamily: '"Inter", "Open Sans", "Roboto", Arial, sans-serif' }}
    >
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-3">
        <section className="border border-[#d8d8d8] bg-[#f8f8f8] px-3 pb-3 pt-2 dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-[#2b3134] dark:text-zinc-100">Журнал записей</h1>
              <p className="text-xs text-[#838a94] dark:text-zinc-400">
                {companyTitle} ({companyId || "—"})
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2.5">
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Дата</span>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="h-8 rounded border border-[#cfd3d8] bg-white px-2.5 text-sm text-[#2b3134] shadow-[inset_0_1px_0_rgba(255,255,255,.7)] dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Сотрудник</span>
                <select
                  value={timelineStaffId}
                  onChange={(e) => setTimelineStaffId(e.target.value)}
                  className="h-8 rounded border border-[#cfd3d8] bg-white px-2.5 text-sm text-[#2b3134] shadow-[inset_0_1px_0_rgba(255,255,255,.7)] dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="">Все боксы</option>
                  {staff.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => {
                  setQuickCreateHint(null);
                  setIsCreateModalOpen(true);
                }}
                className="h-8 rounded border border-[#0f8c67] bg-[#0f8c67] px-3 text-xs font-semibold text-white"
              >
                Создать
              </button>
              <button
                type="button"
                onClick={() => {
                  void loadSchedule();
                  void loadRecords();
                }}
                className="h-8 rounded border border-[#cfd3d8] bg-white px-3 text-xs font-medium text-[#4f5965] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                Обновить
              </button>
              <div className="ml-1 flex items-center gap-2 text-[10px] text-[#6f7782]">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#24b7a8]" />
                  Админ
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#7f34d9]" />
                  Онлайн клиент
                </span>
              </div>
            </div>
          </div>
          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </section>

        <section className="bg-transparent">
          <div className="grid gap-3 lg:grid-cols-[1fr_292px]">
            <div className="overflow-x-auto border border-[#d2d2d2] bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <div className="min-w-[920px]">
                <div
                  className="grid border-b border-[#d7d7d7] bg-[#f5f5f5] text-xs font-semibold text-[#2b3134] dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200"
                  style={{ gridTemplateColumns: `86px repeat(${Math.max(1, timelineStaff.length)}, minmax(0, 1fr)) 86px` }}
                >
                  <div className="px-3 py-2.5">Время</div>
                  {timelineStaff.map((staffItem, index) => (
                    <div key={`head-${staffItem.id}`} className="border-l border-[#d7d7d7] px-3 py-2.5 dark:border-zinc-700">
                      <span className="rounded-sm bg-[#eceff3] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[#58606b] dark:bg-zinc-800">
                        {index + 1 === 1 ? "Бокс №1" : `Бокс №${index + 1}`}
                      </span>
                      <div className="mt-1 text-[12px] font-semibold tracking-tight">{staffItem.name}</div>
                    </div>
                  ))}
                  <div className="border-l border-[#d7d7d7] px-3 py-2.5 text-right text-[#4f5965] dark:border-zinc-700">Время</div>
                </div>

                <div
                  className="relative grid"
                  style={{ gridTemplateColumns: `86px repeat(${Math.max(1, timelineStaff.length)}, minmax(0, 1fr)) 86px`, height: `${timelineHeight + 8}px` }}
                >
                  <div className="relative border-r border-[#d4d4d4] bg-[#efefef] dark:border-zinc-700 dark:bg-zinc-900/40">
                    {hourMarks.map((m) => (
                      <div
                        key={`mark-${m}`}
                        className="absolute left-0 right-0 -translate-y-1/2 px-3 [font-variant-numeric:tabular-nums] dark:text-zinc-200"
                        style={{
                          top: `${(m - timelineStartMinute) * minutePx}px`,
                          fontFamily: '"Open Sans", "Inter", "Roboto", Arial, sans-serif',
                        }}
                      >
                        <div className="flex items-end justify-between">
                          <span className="text-[16px] font-bold leading-none text-[#2f3742]">
                            {String(Math.floor(m / 60)).padStart(2, "0")}
                          </span>
                          <span className="text-[10px] font-semibold leading-none text-[#9aa1ab]">00</span>
                        </div>
                      </div>
                    ))}
                    {halfHourMarks.map((m) => (
                      <div
                        key={`half-${m}`}
                        className="absolute left-0 right-0 -translate-y-1/2 px-3 text-right text-[10px] font-semibold text-[#9aa1ab] [font-variant-numeric:tabular-nums] dark:text-zinc-500"
                        style={{
                          top: `${(m - timelineStartMinute) * minutePx}px`,
                          fontFamily: '"Open Sans", "Inter", "Roboto", Arial, sans-serif',
                        }}
                      >
                        30
                      </div>
                    ))}
                    {nowMinute !== null ? (
                      <div
                        className="absolute left-0 right-0 border-t border-red-500/90"
                        style={{ top: `${(nowMinute - timelineStartMinute) * minutePx}px` }}
                      >
                        <span className="absolute left-1 top-0 -translate-y-1/2 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                          сейчас
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {timelineStaff.map((staffItem) => {
                    const staffBlocks = timelineByStaff.get(staffItem.id) ?? [];
                    return (
                      <div
                        key={`col-${staffItem.id}`}
                        className="relative cursor-cell border-l border-[#d7d7d7] bg-white dark:border-zinc-700 dark:bg-zinc-950"
                        onMouseMove={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          const y = event.clientY - rect.top;
                          const minute = Math.round(y / minutePx) + timelineStartMinute;
                          setHoveredSlot({ staffId: staffItem.id, minute: getRoundedMinute(minute) });
                        }}
                        onMouseLeave={() => setHoveredSlot((prev) => (prev?.staffId === staffItem.id ? null : prev))}
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          const y = event.clientY - rect.top;
                          const minute = Math.round(y / minutePx) + timelineStartMinute;
                          openQuickCreateFromMinute(staffItem.id, minute);
                        }}
                        title="Кликните по свободному месту для новой записи"
                      >
                        {hourMarks.map((m) => (
                          <div
                            key={`line-${staffItem.id}-${m}`}
                            className="absolute left-0 right-0 border-t border-[#dcdcdc] dark:border-zinc-700"
                            style={{ top: `${(m - timelineStartMinute) * minutePx}px` }}
                          />
                        ))}
                        {halfHourMarks.map((m) => (
                          <div
                            key={`line-half-${staffItem.id}-${m}`}
                            className="absolute left-0 right-0 border-t border-dashed border-[#e9e9e9] dark:border-zinc-800"
                            style={{ top: `${(m - timelineStartMinute) * minutePx}px` }}
                          />
                        ))}
                        {nowMinute !== null ? (
                          <div
                            className="absolute left-0 right-0 border-t border-red-500/90"
                            style={{ top: `${(nowMinute - timelineStartMinute) * minutePx}px` }}
                          />
                        ) : null}
                        {hoveredSlot && hoveredSlot.staffId === staffItem.id ? (
                          <div
                            className="pointer-events-none absolute left-0 right-0 border border-[#7f34d9]/45 bg-[#7f34d9]/10"
                            style={{
                              top: `${Math.max(0, (hoveredSlot.minute - timelineStartMinute) * minutePx)}px`,
                              height: `${Math.max(24, 40 * minutePx)}px`,
                            }}
                          >
                            <span className="absolute right-1 top-1 rounded bg-[#7f34d9] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {`${String(Math.floor(hoveredSlot.minute / 60)).padStart(2, "0")}:${String(hoveredSlot.minute % 60).padStart(2, "0")}`}
                            </span>
                          </div>
                        ) : null}

                        {staffBlocks.map((block) => {
                          const tone = block.isClientSelfBooked
                            ? {
                                card: "bg-[#cfc4e8] text-[#2b3134] border-[#a994d6]",
                                selected: "border-[#5f3ea1]",
                                strip: "bg-[#6a40b5]",
                              }
                            : {
                                card: "bg-[#bfe2dc] text-[#2b3134] border-[#89c8bd]",
                                selected: "border-[#1f847a]",
                                strip: "bg-[#1f8f84]",
                              };
                          const selected = selectedRecordId === block.id;
                          return (
                            <button
                              key={`block-${staffItem.id}-${block.id}`}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedRecordId(block.id);
                              }}
                              className={`absolute left-1.5 right-1.5 overflow-hidden rounded-sm border px-2 py-1.5 text-left ${tone.card} ${
                                selected ? tone.selected : ""
                              }`}
                              style={{
                                top: `${Math.max(0, (block.startMinute - timelineStartMinute) * minutePx)}px`,
                                height: `${Math.max(50, (block.endMinute - block.startMinute) * minutePx - 2)}px`,
                              }}
                            >
                              <div className={`absolute left-0 right-0 top-0 flex h-5 items-center px-2 text-[10px] font-semibold text-white ${tone.strip}`}>
                                {`${block.startedAtText} - ${block.endedAtText}`}
                              </div>
                              <div className="mt-4 truncate text-[11px] font-bold leading-tight">{block.title}</div>
                              <div className="truncate text-[10px] font-normal leading-tight text-[#5f6872]">
                                {block.comment || "Без комментария"}
                              </div>
                              <div className="mt-0.5 truncate text-[10px] font-bold leading-tight text-[#6f7782]">{block.subtitle}</div>
                              {block.isNewClient ? (
                                <div className="mt-1 inline-flex rounded bg-zinc-900 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                                  new
                                </div>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}

                  <div className="relative border-l border-[#d4d4d4] bg-[#efefef] dark:border-zinc-700 dark:bg-zinc-900/40">
                    {hourMarks.map((m) => (
                      <div
                        key={`mark-right-${m}`}
                        className="absolute left-0 right-0 -translate-y-1/2 px-3 [font-variant-numeric:tabular-nums] dark:text-zinc-200"
                        style={{
                          top: `${(m - timelineStartMinute) * minutePx}px`,
                          fontFamily: '"Open Sans", "Inter", "Roboto", Arial, sans-serif',
                        }}
                      >
                        <div className="flex items-end justify-between">
                          <span className="text-[16px] font-bold leading-none text-[#2f3742]">
                            {String(Math.floor(m / 60)).padStart(2, "0")}
                          </span>
                          <span className="text-[10px] font-semibold leading-none text-[#9aa1ab]">00</span>
                        </div>
                      </div>
                    ))}
                    {halfHourMarks.map((m) => (
                      <div
                        key={`half-right-${m}`}
                        className="absolute left-0 right-0 -translate-y-1/2 px-3 text-right text-[10px] font-semibold text-[#9aa1ab] [font-variant-numeric:tabular-nums] dark:text-zinc-500"
                        style={{
                          top: `${(m - timelineStartMinute) * minutePx}px`,
                          fontFamily: '"Open Sans", "Inter", "Roboto", Arial, sans-serif',
                        }}
                      >
                        30
                      </div>
                    ))}
                    {nowMinute !== null ? (
                      <div
                        className="absolute left-0 right-0 border-t border-red-500/90"
                        style={{ top: `${(nowMinute - timelineStartMinute) * minutePx}px` }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <aside className="border border-[#d2d2d2] bg-[#f3f3f3] p-2.5 dark:border-zinc-800 dark:bg-zinc-900/30">
              <div className="border border-[#d2d2d2] bg-white p-2.5 dark:border-zinc-700 dark:bg-zinc-900/70">
                <div className="text-xs font-semibold uppercase text-[#7f8793]">Дата</div>
                <div className="mt-1 text-sm font-semibold text-[#2b3134] dark:text-zinc-100">{miniCalendar.title}</div>
                <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[10px] text-[#8e959f]">
                  {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
                    <div key={`wd-${d}`}>{d}</div>
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {miniCalendar.cells.map((cell, idx) =>
                    cell.date ? (
                      <button
                        key={`day-${cell.date}`}
                        type="button"
                        onClick={() => setScheduleDate(cell.date as string)}
                        className={`h-6 rounded text-[11px] ${
                          cell.date === scheduleDate
                            ? "bg-[#2b3134] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
                            : "text-[#4f5965] hover:bg-[#f1f3f5] dark:text-zinc-200 dark:hover:bg-zinc-800"
                        }`}
                      >
                        {cell.day}
                      </button>
                    ) : (
                      <div key={`empty-${idx}`} className="h-6" />
                    )
                  )}
                </div>
              </div>

              <div className="mt-2 border border-[#d2d2d2] bg-white p-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900/70">
                {selectedTimelineRecord ? (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-[#7f8793]">Выбрана запись</div>
                    <div className="font-semibold text-[#2b3134] dark:text-zinc-100">
                      {selectedTimelineRecord.startedAtText} - {selectedTimelineRecord.endedAtText}
                    </div>
                    <div className="text-[12px] font-medium">{selectedTimelineRecord.title}</div>
                    <div className="text-[11px] text-[#5f6872] dark:text-zinc-300">
                      <span className="font-semibold text-[#0f766e]">{selectedClientName || selectedTimelineRecord.subtitle}</span>
                      {selectedClientPhone ? <span> · {selectedClientPhone}</span> : null}
                    </div>
                    <div className="rounded border border-[#e3e5e8] bg-[#fafafa] px-2 py-1.5 text-[11px] text-[#4f5965] dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                      <div className="font-semibold text-[#7f8793]">Комментарий</div>
                      <div className="mt-0.5 max-h-20 overflow-auto whitespace-pre-wrap">
                        {selectedTimelineRecord.comment || "Комментария нет"}
                      </div>
                    </div>
                    {shipmentLookup.loading && shipmentLookup.phone === selectedShipmentPhone ? (
                      <div className="rounded border border-[#e3e5e8] bg-white px-2 py-1.5 text-[11px] text-[#7f8793] dark:border-zinc-700 dark:bg-zinc-900">
                        Проверяю отгрузки…
                      </div>
                    ) : null}
                    {!shipmentLookup.loading && shipmentLookup.error && shipmentLookup.phone === selectedShipmentPhone ? (
                      <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                        Отгрузки не загрузились
                      </div>
                    ) : null}
                    {!shipmentLookup.loading && shipmentLookup.rows.length > 0 && shipmentLookup.phone === selectedShipmentPhone ? (
                      <div className="rounded border border-[#d9e7e2] bg-[#f7fbf9] px-2 py-1.5 text-[11px] dark:border-zinc-700 dark:bg-zinc-900">
                        <div className="font-semibold text-[#0f766e]">Отгрузки</div>
                        <div className="mt-1 space-y-1">
                          {shipmentLookup.rows.map((shipment) => (
                            <Link
                              key={shipment.id}
                              href={`/shipment/${shipment.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded border border-transparent px-1 py-1 hover:border-[#b7d8cc] hover:bg-white dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                            >
                              <div className="truncate font-semibold text-[#2b3134] dark:text-zinc-100">{shipment.name}</div>
                              <div className="text-[#6f7782] dark:text-zinc-400">
                                {formatShipmentDate(shipment.momentAt || shipment.documentDate)} · {formatRubles(shipment.sumCents)} ₽
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <Link
                      href={createShipmentHref}
                      target="_blank"
                      rel="noreferrer"
                      className="block h-7 rounded border border-[#0f8c67] bg-[#0f8c67] px-2 text-center text-[11px] font-semibold leading-7 text-white hover:bg-[#0d7657]"
                    >
                      Создать отгрузку
                    </Link>
                    <button
                      type="button"
                      onClick={() => setIsRecordDetailsOpen(true)}
                      className="h-7 w-full rounded border border-[#cfd3d8] bg-white text-[11px] font-medium text-[#4f5965] dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      Открыть комментарий
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedRecordItem) openEditModal(selectedRecordItem);
                        }}
                        className="h-7 rounded border border-[#cfd3d8] bg-white text-[11px] font-medium text-[#4f5965] dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        Редактировать
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteRecord}
                        className="h-7 rounded border border-[#cfd3d8] bg-white text-[11px] font-medium text-[#4f5965] dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-[#7f8793]">Записи</div>
                    <p className="text-[12px] text-[#5f6872] dark:text-zinc-300">
                      Нет записи в смене. Кликните по пустому слоту, чтобы создать запись.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setQuickCreateHint(null);
                          setIsCreateModalOpen(true);
                        }}
                        className="h-7 rounded border border-[#0f8c67] bg-[#0f8c67] text-[11px] font-semibold text-white"
                      >
                        Создать
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void loadSchedule();
                          void loadRecords();
                        }}
                        className="h-7 rounded border border-[#cfd3d8] bg-white text-[11px] font-medium text-[#4f5965] dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        Обновить
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </section>

      </div>

      {isRecordDetailsOpen && selectedRecordItem && selectedTimelineRecord ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Комментарий к записи</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {selectedTimelineRecord.startedAtText} - {selectedTimelineRecord.endedAtText} · {selectedClientName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsRecordDetailsOpen(false)}
                className="rounded-lg border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <div className="max-h-72 overflow-auto whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
                {selectedRecordItem.comment?.trim() || "Комментария нет"}
              </div>
            </div>

          </div>
        </div>
      ) : null}

      {isCreateModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Новая запись</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Заполните данные клиента и время записи.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-lg border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
              >
                Закрыть
              </button>
            </div>

            {quickCreateHint ? (
              <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                {quickCreateHint}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Сотрудник</span>
                <select
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <option value="">Выберите сотрудника</option>
                  {staff.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Услуга</span>
                <select
                  value={serviceId}
                  onChange={(e) => {
                    const nextServiceId = e.target.value;
                    setServiceId(nextServiceId);
                    const selectedService = services.find((item) => String(item.id) === nextServiceId);
                    const nextLength =
                      Number(selectedService?.seance_length ?? DEFAULT_RECORD_DURATION_SECONDS) ||
                      DEFAULT_RECORD_DURATION_SECONDS;
                    if (datetime && !datetimeEnd) setDatetimeEnd(addSecondsToDateTimeLocal(datetime, nextLength));
                  }}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <option value="">Выберите услугу</option>
                  {services.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Имя клиента</span>
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                  placeholder="Например: Илья"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Телефон клиента</span>
                <input
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                  placeholder="79990000000"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Email клиента (опц.)</span>
                <input
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                  placeholder="client@example.com"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Начало</span>
                  <input
                    type="datetime-local"
                    value={datetime}
                    onChange={(e) => {
                      const nextStart = e.target.value;
                      setDatetime(nextStart);
                      if (!datetimeEnd || calculateSeanceLengthSeconds(nextStart, datetimeEnd) == null) {
                        setDatetimeEnd(addSecondsToDateTimeLocal(nextStart, createServiceLengthSeconds));
                      }
                    }}
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Окончание</span>
                  <input
                    type="datetime-local"
                    value={datetimeEnd}
                    onChange={(e) => setDatetimeEnd(e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                  />
                </label>
              </div>

              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Комментарий</span>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSaveRecord}
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Создать запись
                </button>
                <button
                  type="button"
                  onClick={resetRecordForm}
                  className="rounded-xl border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
                >
                  Очистить
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isEditModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Редактировать запись</h2>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Измените данные и сохраните запись.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="rounded-lg border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
              >
                Закрыть
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Сотрудник</span>
                <select
                  value={editStaffId}
                  onChange={(e) => setEditStaffId(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                >
                  <option value="">Выберите сотрудника</option>
                  {staff.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Услуги</span>
                <div className="max-h-40 overflow-auto rounded-xl border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-800">
                  <div className="space-y-1">
                    {services.map((item) => {
                      const value = String(item.id);
                      const checked = editServiceIds.includes(value);
                      return (
                        <label
                          key={item.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm ${
                            checked
                              ? "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100"
                              : "hover:bg-zinc-100 dark:hover:bg-zinc-700/40"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleEditService(value)}
                            className="h-4 w-4"
                          />
                          <span className="truncate">{item.title}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Выбрано услуг: {editServiceIds.length}
                </div>
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Имя клиента</span>
                <input
                  value={editClientName}
                  onChange={(e) => setEditClientName(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Телефон клиента</span>
                <input
                  value={editClientPhone}
                  onChange={(e) => setEditClientPhone(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Email клиента (опц.)</span>
                <input
                  value={editClientEmail}
                  onChange={(e) => setEditClientEmail(e.target.value)}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Начало</span>
                  <input
                    type="datetime-local"
                    value={editDatetime}
                    onChange={(e) => {
                      const nextStart = e.target.value;
                      const currentLength =
                        calculateSeanceLengthSeconds(editDatetime, editDatetimeEnd) ?? editServiceLengthSeconds;
                      setEditDatetime(nextStart);
                      setEditDatetimeEnd(addSecondsToDateTimeLocal(nextStart, currentLength));
                    }}
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Окончание</span>
                  <input
                    type="datetime-local"
                    value={editDatetimeEnd}
                    onChange={(e) => setEditDatetimeEnd(e.target.value)}
                    className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                  />
                </label>
              </div>

              <label className="text-sm">
                <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Комментарий</span>
                <textarea
                  value={editComment}
                  onChange={(e) => setEditComment(e.target.value)}
                  rows={3}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleUpdateRecord}
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  Сохранить изменения
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="rounded-xl border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
                >
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
