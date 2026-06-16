"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CalendarCheck,
  CalendarDays,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Columns3,
  Copy,
  Edit3,
  List,
  Loader2,
  MessageSquare,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import { SERVICE_TIME_ZONE, formatServiceDate, toServiceDateInput } from "@/lib/date-time";
import { EcoBadge, EcoButton, EcoStatusDot } from "@/components/platform/EcoUI";

type User = { login: string; name: string; role?: "owner" | "admin" | "master" } | null;

type Staff = { id: number; name: string; specialization?: string; bookable?: boolean };
type Service = {
  id: number;
  title: string;
  seance_length?: number;
  price?: number;
  price_min?: number;
  price_max?: number;
  cost?: number;
} & Record<string, unknown>;

type VehicleInfo = {
  model: string;
  plate: string;
  vin: string;
  year?: string;
};

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
  services?: Array<{ id?: number; title?: string; cost?: number; price?: number }>;
  client?: {
    display_name?: string;
    name?: string;
    phone?: string;
    email?: string;
    is_new?: boolean;
  } & Record<string, unknown>;
} & Record<string, unknown>;

type ShipmentLookupRow = {
  id: string;
  name: string;
  documentDate: string;
  momentAt: string;
  sumCents: number;
  applicable: boolean;
  agentName?: string;
};

type ShipmentLookupState = {
  loading: boolean;
  rows: ShipmentLookupRow[];
  error: string | null;
};

type CreateShipmentFromRecordResponse = {
  id?: string;
  name?: string;
  counterpartyId?: string;
  counterpartyCreated?: boolean;
  error?: string;
};

type CrmDealLink = {
  id: string;
  title: string;
  customerName: string | null;
  phoneNormalized: string | null;
  vehicle: string | null;
  source: string | null;
  clientType: string | null;
  nextAction: string | null;
  responsibleLogin: string | null;
  yclientsRecordId: string | null;
  moyskladDemandId: string | null;
  nextContactAt: string | null;
  status: string;
  notes: string | null;
  alreadyExists?: boolean;
};

type CrmDealsResponse = {
  stages?: Array<{ deals?: CrmDealLink[] }>;
  error?: string;
};

type AppointmentStatusKey =
  | "new"
  | "confirmed"
  | "waiting"
  | "arrived"
  | "in_work"
  | "done"
  | "cancelled"
  | "no_show";

type TimelineRecord = {
  id: number;
  staffId: number;
  staffName: string;
  startMinute: number;
  endMinute: number;
  serviceTitle: string;
  serviceTitles: string[];
  clientName: string;
  phone: string;
  email: string;
  vehicle: VehicleInfo;
  comment: string;
  internalComment: string;
  statusKey: AppointmentStatusKey;
  statusLabel: string;
  startedAtText: string;
  endedAtText: string;
  source: "yclients" | "local" | "online";
  sourceLabel: string;
  syncLabel: string;
  isNewClient?: boolean;
  recordDateTime: string;
  clientExternalId: string;
  yclientsClientId: string;
};

type ClientOption = {
  id: string;
  name: string;
  phone: string;
  email: string;
  vehicle: VehicleInfo;
  source: "crm" | "journal";
  subtitle: string;
  matchLabel?: string;
  matchRank?: number;
};

type RecordFormState = {
  staffId: string;
  serviceIds: string[];
  clientSearch: string;
  selectedClientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  vehicleModel: string;
  vehiclePlate: string;
  vehicleVin: string;
  datetime: string;
  datetimeEnd: string;
  comment: string;
  internalComment: string;
  statusKey: AppointmentStatusKey;
  allowOverlap: boolean;
};

type FormMode = "create" | "edit";
type ViewMode = "timeline" | "list";
type TimelineEventMode = "long" | "normal" | "compact" | "mini";
type TimelineInteractionKind = "drag" | "resize";

type TimelineInteraction = {
  kind: TimelineInteractionKind;
  recordId: number;
  staffId: number;
  pointerOffsetMinutes: number;
  startMinute: number;
  endMinute: number;
  targetStartMinute: number;
  targetEndMinute: number;
  columnTop: number;
  moved: boolean;
};

type MonthDayLoad = {
  date: string;
  recordCount: number;
  busyMinutes: number;
  freeMinutes: number;
  freeWindows: number;
  nearestFreeMinute: number | null;
};

const DEFAULT_RECORD_DURATION_SECONDS = 40 * 60;
const DEFAULT_TIMELINE_START = 9 * 60;
const DEFAULT_TIMELINE_END = 21 * 60;
const MIN_SLOT_MINUTES = 30;
const TIMELINE_MINUTE_PX = 1.6;
const TIMELINE_AXIS_WIDTH = 78;
const EVENT_GUTTER_PX = 8;
const EVENT_LANE_GAP_PX = 4;
const TIMELINE_SNAP_MINUTES = 5;

type PositionedTimelineRecord = TimelineRecord & {
  displayMode: TimelineEventMode;
  durationMinutes: number;
  lane: number;
  laneCount: number;
  topPx: number;
  heightPx: number;
};

const STATUS_META: Record<
  AppointmentStatusKey,
  { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral"; dot: string }
> = {
  new: { label: "Новая", tone: "info", dot: "#2563eb" },
  confirmed: { label: "Подтверждена", tone: "success", dot: "#15803d" },
  waiting: { label: "Ожидает", tone: "warning", dot: "#b45309" },
  arrived: { label: "Приехал", tone: "info", dot: "#0f766e" },
  in_work: { label: "В работе", tone: "warning", dot: "#ea580c" },
  done: { label: "Завершена", tone: "neutral", dot: "#64748b" },
  cancelled: { label: "Отменена", tone: "neutral", dot: "#71717a" },
  no_show: { label: "No-show", tone: "danger", dot: "#dc2626" },
};

const emptyVehicle: VehicleInfo = { model: "", plate: "", vin: "" };

const emptyForm: RecordFormState = {
  staffId: "",
  serviceIds: [],
  clientSearch: "",
  selectedClientId: "",
  clientName: "",
  clientPhone: "",
  clientEmail: "",
  vehicleModel: "",
  vehiclePlate: "",
  vehicleVin: "",
  datetime: "",
  datetimeEnd: "",
  comment: "",
  internalComment: "",
  statusKey: "new",
  allowOverlap: false,
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function toDateInputValue(value: Date) {
  return toServiceDateInput(value);
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

function formatTimezoneOffset(value: Date) {
  const offsetMinutes = -value.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function toYclientsDateTime(value: string) {
  const normalized = value.replace(" ", "T").slice(0, 16);
  const date = parseDateTimeLocal(normalized);
  if (!date) return `${value.replace("T", " ")}:00`;
  return `${normalized}:00${formatTimezoneOffset(date)}`;
}

function parseRecordDate(record: RecordItem): Date | null {
  const raw = String(record.date ?? record.datetime ?? "").replace(" ", "T");
  if (!raw) return null;
  const date = new Date(raw);
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

function formatPhone(value: string) {
  const phone = normalizePhone(value);
  if (phone.length !== 11) return value || "—";
  return `+${phone.slice(0, 1)} ${phone.slice(1, 4)} ${phone.slice(4, 7)}-${phone.slice(7, 9)}-${phone.slice(9)}`;
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

function getRecordSaveErrorMessage(data: unknown, fallback: string) {
  const message = getApiErrorMessage(data, fallback);
  if (/нет\s+врем|no\s+time|busy|занят|недоступ/i.test(message)) {
    return "YCLIENTS не подтвердил свободное окно. Проверьте, что выбран именно свободный сотрудник / бокс, услуга доступна этому ресурсу и время совпадает с календарем YCLIENTS.";
  }
  return message;
}

function numberFromUnknown(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function getServiceDurationSeconds(service?: Service | null) {
  return (
    numberFromUnknown(service?.seance_length) ??
    numberFromUnknown(service?.duration) ??
    numberFromUnknown(service?.duration_seconds) ??
    DEFAULT_RECORD_DURATION_SECONDS
  );
}

function getServicePriceLabel(service?: Service | null) {
  const min = numberFromUnknown(service?.price_min);
  const max = numberFromUnknown(service?.price_max);
  const price = numberFromUnknown(service?.price) ?? numberFromUnknown(service?.cost);
  if (min && max && min !== max) return `${formatRubles(min * 100)}–${formatRubles(max * 100)} ₽`;
  if (price) return `${formatRubles(price * 100)} ₽`;
  if (min) return `от ${formatRubles(min * 100)} ₽`;
  return "Стоимость не указана";
}

function formatRubles(sumCents: number): string {
  return ((sumCents || 0) / 100).toLocaleString("ru-RU", {
    maximumFractionDigits: 0,
  });
}

function formatShipmentDate(value: string): string {
  const formatted = formatServiceDate(value);
  return formatted === "—" ? value || "—" : formatted.slice(0, 8);
}

function formatCaseDate(value: string | null): string {
  if (!value) return "Без дедлайна";
  const formatted = formatServiceDate(value);
  return formatted === "—" ? value : formatted;
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return toDateInputValue(new Date());
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function addMonths(value: string, months: number): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return toDateInputValue(new Date());
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return toDateInputValue(date);
}

function monthStart(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return toDateInputValue(new Date());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function monthEnd(value: string): string {
  const date = new Date(`${monthStart(value)}T00:00:00`);
  date.setMonth(date.getMonth() + 1);
  date.setDate(0);
  return toDateInputValue(date);
}

function getMonthGridDays(value: string): string[] {
  const start = new Date(`${monthStart(value)}T00:00:00`);
  const end = new Date(`${monthEnd(value)}T00:00:00`);
  const startOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - startOffset);
  const endOffset = 6 - ((end.getDay() + 6) % 7);
  end.setDate(end.getDate() + endOffset);
  const out: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    out.push(toDateInputValue(cursor));
  }
  return out;
}

function formatScheduleTitle(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value || "Дата";
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    timeZone: SERVICE_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const weekday = new Intl.DateTimeFormat("ru-RU", { timeZone: SERVICE_TIME_ZONE, weekday: "short" }).format(date).replace(".", "");
  return `${dateLabel} · ${weekday}`;
}

function formatMinute(minute: number): string {
  const hour = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function durationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 мин";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

function workloadTone(stat: MonthDayLoad | null | undefined) {
  if (!stat) return "empty";
  if (stat.recordCount === 0) return "free";
  const total = stat.busyMinutes + stat.freeMinutes;
  const load = total > 0 ? stat.busyMinutes / total : 0;
  if (load >= 0.9 || stat.freeWindows === 0) return "full";
  if (load >= 0.6) return "busy";
  return "open";
}

function loadLabel(stat: MonthDayLoad | null | undefined) {
  if (!stat) return "нет данных";
  if (stat.recordCount === 0) return "свободно";
  if (stat.freeWindows === 0) return "полный день";
  return `${stat.freeWindows} ${stat.freeWindows === 1 ? "окно" : stat.freeWindows < 5 ? "окна" : "окон"}`;
}

function getTimelineEventMode(durationMinutes: number): TimelineEventMode {
  if (durationMinutes < 30) return "mini";
  if (durationMinutes < 45) return "compact";
  if (durationMinutes <= 90) return "normal";
  return "long";
}

function getEventMinHeight(mode: TimelineEventMode) {
  if (mode === "mini") return 32;
  if (mode === "compact") return 42;
  if (mode === "normal") return 68;
  return 86;
}

function shortServiceTitle(value: string) {
  return value
    .replace(/\s*\+\s*/g, " + ")
    .replace(/\s+/g, " ")
    .trim();
}

function getResourceKicker(staffName: string, index: number) {
  return /бокс\s*№?\s*\d*/i.test(staffName) ? "Ресурс" : `Бокс №${index + 1}`;
}

function isToday(value: string): boolean {
  return value === toDateInputValue(new Date());
}

function getClientDisplayName(record: RecordItem): string {
  return record.client?.display_name || record.client?.name || "Клиент";
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function objectFromUnknown(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseCommentParts(comment?: string): { clientComment: string; internalComment: string; vehicle: VehicleInfo } {
  const lines = String(comment ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const clientLines: string[] = [];
  let internalComment = "";
  const vehicle: VehicleInfo = { ...emptyVehicle };

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.startsWith("внутренний комментарий:")) {
      internalComment = line.replace(/^внутренний комментарий:/i, "").trim();
      continue;
    }
    if (lower.startsWith("авто:")) {
      const raw = line.replace(/^авто:/i, "").trim();
      const parts = raw.split(" · ").map((part) => part.trim());
      vehicle.model = parts.find((part) => !/^vin\s/i.test(part) && !/^[а-яa-z]\d/i.test(part)) ?? parts[0] ?? "";
      vehicle.plate = parts.find((part) => /^[а-яa-z]\d/i.test(part)) ?? "";
      const vinPart = parts.find((part) => /^vin\s/i.test(part));
      vehicle.vin = vinPart?.replace(/^vin\s*/i, "").trim() ?? "";
      continue;
    }
    clientLines.push(line);
  }

  return { clientComment: clientLines.join("\n"), internalComment, vehicle };
}

function getVehicleInfo(record: RecordItem): VehicleInfo {
  const commentVehicle = parseCommentParts(record.comment).vehicle;
  const client = objectFromUnknown(record.client);
  const candidates = [
    objectFromUnknown(record.vehicle),
    objectFromUnknown(record.car),
    objectFromUnknown(record.auto),
    objectFromUnknown(client.vehicle),
    objectFromUnknown(client.car),
    objectFromUnknown(client.auto),
  ];
  const first = candidates.find((item) => Object.keys(item).length > 0) ?? {};
  return {
    model:
      stringFromUnknown(first.model) ||
      stringFromUnknown(first.title) ||
      stringFromUnknown(first.name) ||
      stringFromUnknown(record.vehicle_model) ||
      commentVehicle.model,
    plate:
      stringFromUnknown(first.plate) ||
      stringFromUnknown(first.number) ||
      stringFromUnknown(first.license_plate) ||
      stringFromUnknown(record.vehicle_plate) ||
      commentVehicle.plate,
    vin:
      stringFromUnknown(first.vin) ||
      stringFromUnknown(first.VIN) ||
      stringFromUnknown(record.vehicle_vin) ||
      commentVehicle.vin,
    year: stringFromUnknown(first.year) || stringFromUnknown(record.vehicle_year),
  };
}

function getClientExternalId(record: RecordItem): string {
  const client = objectFromUnknown(record.client);
  return (
    stringFromUnknown(client.id) ||
    stringFromUnknown(client.client_id) ||
    stringFromUnknown(client.yclients_id) ||
    stringFromUnknown(record.client_id) ||
    stringFromUnknown(record.yclients_client_id)
  );
}

function vehicleLabel(vehicle: VehicleInfo) {
  return [vehicle.model, vehicle.plate, vehicle.vin ? `VIN ${vehicle.vin}` : ""].filter(Boolean).join(" · ");
}

function resolveStatus(record: RecordItem, startMinute: number, endMinute: number): AppointmentStatusKey {
  const rawStatus = String(record.status ?? record.state ?? "").toLowerCase();
  if (/cancel|отмен/.test(rawStatus)) return "cancelled";
  if (/done|finish|complete|заверш/.test(rawStatus)) return "done";
  if (record.attendance === -1) return "no_show";

  const now = new Date();
  const isSameDay = (record.date ?? record.datetime ?? "").startsWith(toDateInputValue(now));
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  if (record.attendance === 1 && isSameDay && nowMinute >= startMinute && nowMinute <= endMinute) return "in_work";
  if (record.attendance === 1) return "arrived";
  if (record.confirmed === 1) return "confirmed";
  if (record.client?.is_new) return "new";
  return "waiting";
}

function sourceInfo(record: RecordItem): Pick<TimelineRecord, "source" | "sourceLabel" | "syncLabel"> {
  if (record.online || record.bookform_id || record.from_url) {
    return { source: "online", sourceLabel: "YCLIENTS online", syncLabel: "Синхронизировано" };
  }
  if (record.record_from && record.record_from !== "manual") {
    return { source: "yclients", sourceLabel: "YCLIENTS", syncLabel: `Источник: ${record.record_from}` };
  }
  if (record.local === true || record.source === "local") {
    return { source: "local", sourceLabel: "Локально", syncLabel: "Локальная запись" };
  }
  return { source: "yclients", sourceLabel: "YCLIENTS", syncLabel: "Синхронизировано" };
}

function composeComment(form: RecordFormState) {
  const lines = [form.comment.trim()].filter(Boolean);
  const vehicle = vehicleLabel({
    model: form.vehicleModel.trim(),
    plate: form.vehiclePlate.trim(),
    vin: form.vehicleVin.trim(),
  });
  if (vehicle) lines.push(`Авто: ${vehicle}`);
  if (form.internalComment.trim()) lines.push(`Внутренний комментарий: ${form.internalComment.trim()}`);
  return lines.join("\n");
}

function replaceDatePart(datetime: string, date: string) {
  const time = datetime.includes("T") ? datetime.slice(11, 16) : "09:00";
  return `${date}T${time}`;
}

function replaceTimePart(datetime: string, time: string, fallbackDate: string) {
  const date = datetime.includes("T") ? datetime.slice(0, 10) : fallbackDate;
  return `${date}T${time || "09:00"}`;
}

function findCreatedRecord(records: RecordItem[], form: RecordFormState): RecordItem | null {
  const phone = normalizePhone(form.clientPhone);
  const targetDate = form.datetime.replace("T", " ").slice(0, 16);
  return (
    records.find((record) => {
      const recordPhone = normalizePhone(record.client?.phone ?? "");
      const recordDate = String(record.date ?? record.datetime ?? "").replace("T", " ").slice(0, 16);
      return recordPhone === phone && recordDate === targetDate;
    }) ?? null
  );
}

function shipmentHref(shipment: ShipmentLookupRow) {
  return shipment.applicable ? `/shipment/${shipment.id}` : `/shipment/${shipment.id}/edit`;
}

function SectionTitle({ icon, title, action }: { icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="eco-records-section-title">
      <span>{icon}</span>
      <strong>{title}</strong>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cx("eco-records-skeleton", className)} />;
}

export default function RecordsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientPickerRef = useRef<HTMLDivElement | null>(null);
  const timelineInteractionRef = useRef<TimelineInteraction | null>(null);
  const crmPrefillAppliedRef = useRef(false);
  const focusedRecordParamRef = useRef<string | null>(null);
  const [user, setUser] = useState<User>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [staff, setStaff] = useState<Staff[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [companyTitle, setCompanyTitle] = useState("Там где масло");

  const [scheduleDate, setScheduleDate] = useState(() => toDateInputValue(new Date()));
  const [timelineStaffId, setTimelineStaffId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("timeline");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | AppointmentStatusKey>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | TimelineRecord["source"]>("all");
  const [shipmentFilter, setShipmentFilter] = useState<"all" | "with" | "without">("all");

  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);
  const [hoveredSlot, setHoveredSlot] = useState<{ staffId: number; minute: number } | null>(null);
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [creatingShipmentRecordId, setCreatingShipmentRecordId] = useState<number | null>(null);
  const [creatingCaseRecordId, setCreatingCaseRecordId] = useState<number | null>(null);
  const [crmDealByRecordId, setCrmDealByRecordId] = useState<Record<string, CrmDealLink>>({});
  const [crmDealsLoading, setCrmDealsLoading] = useState(false);
  const [crmDealsError, setCrmDealsError] = useState<string | null>(null);
  const [linkedCreateDealId, setLinkedCreateDealId] = useState<string | null>(null);
  const [pendingFocusRecordId, setPendingFocusRecordId] = useState<number | null>(null);
  const [timelineInteraction, setTimelineInteraction] = useState<TimelineInteraction | null>(null);
  const [timelineActionSaving, setTimelineActionSaving] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => monthStart(toDateInputValue(new Date())));

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const [form, setForm] = useState<RecordFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  const [localClientOptions, setLocalClientOptions] = useState<ClientOption[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [clientSearchError, setClientSearchError] = useState<string | null>(null);
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [shipmentLookupByPhone, setShipmentLookupByPhone] = useState<Record<string, ShipmentLookupState>>({});
  const [monthRecords, setMonthRecords] = useState<RecordItem[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);

  const [configLoading, setConfigLoading] = useState(false);
  const [baseLoading, setBaseLoading] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

  const canAccess = useMemo(() => !!user && (user.role === "owner" || user.role === "admin"), [user]);

  const timelineStaff = useMemo(() => {
    if (timelineStaffId) {
      const selected = staff.find((s) => String(s.id) === timelineStaffId);
      return selected ? [selected] : [];
    }
    const bookable = staff.filter((s) => s.bookable !== false);
    return (bookable.length > 0 ? bookable : staff).slice(0, 4);
  }, [staff, timelineStaffId]);

  const serviceById = useMemo(() => {
    const map = new Map<string, Service>();
    for (const service of services) map.set(String(service.id), service);
    return map;
  }, [services]);

  const selectedServiceDurationSeconds = useMemo(() => {
    const total = form.serviceIds.reduce((sum, id) => sum + getServiceDurationSeconds(serviceById.get(id)), 0);
    return total || DEFAULT_RECORD_DURATION_SECONDS;
  }, [form.serviceIds, serviceById]);

  const dayTimeline = useMemo(() => {
    const list: TimelineRecord[] = [];
    const staffById = new Map(staff.map((item) => [item.id, item.name]));
    for (const record of records) {
      const staffIdNum = Number(record.staff_id ?? 0);
      if (!staffIdNum) continue;
      const date = parseRecordDate(record);
      if (!date || toDateInputValue(date) !== scheduleDate) continue;

      const startMinute = date.getHours() * 60 + date.getMinutes();
      const lengthSec = Number(record.seance_length ?? record.length ?? DEFAULT_RECORD_DURATION_SECONDS);
      const duration = Math.max(MIN_SLOT_MINUTES, Math.round((Number.isFinite(lengthSec) ? lengthSec : DEFAULT_RECORD_DURATION_SECONDS) / 60));
      const endMinute = Math.min(24 * 60, startMinute + duration);
      const statusKey = resolveStatus(record, startMinute, endMinute);
      const commentParts = parseCommentParts(record.comment);
      const vehicle = getVehicleInfo(record);
      const source = sourceInfo(record);
      const serviceTitles = (record.services ?? []).map((s) => s.title).filter(Boolean) as string[];
      const clientExternalId = getClientExternalId(record);

      list.push({
        id: record.id,
        staffId: staffIdNum,
        staffName: staffById.get(staffIdNum) ?? "Сотрудник",
        startMinute,
        endMinute,
        serviceTitle: serviceTitles.join(", ") || "Запись",
        serviceTitles,
        clientName: getClientDisplayName(record),
        phone: record.client?.phone ?? "",
        email: record.client?.email ?? "",
        vehicle,
        comment: commentParts.clientComment,
        internalComment: commentParts.internalComment,
        statusKey,
        statusLabel: STATUS_META[statusKey].label,
        startedAtText: formatMinute(startMinute),
        endedAtText: formatMinute(endMinute),
        isNewClient: Boolean(record.client?.is_new),
        recordDateTime: String(record.date ?? record.datetime ?? ""),
        clientExternalId,
        yclientsClientId: clientExternalId,
        ...source,
      });
    }
    return list.sort((a, b) => a.startMinute - b.startMinute);
  }, [records, scheduleDate, staff]);

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

  const selectedRecordDeal = useMemo(
    () => (selectedTimelineRecord ? crmDealByRecordId[String(selectedTimelineRecord.id)] ?? null : null),
    [crmDealByRecordId, selectedTimelineRecord]
  );

  const confirmedCount = useMemo(
    () => dayTimeline.filter((record) => ["confirmed", "arrived", "in_work", "done"].includes(record.statusKey)).length,
    [dayTimeline]
  );

  const normalizedShipmentPhones = useMemo(() => {
    const phones = new Set<string>();
    for (const record of dayTimeline) {
      const phone = normalizePhone(record.phone);
      if (phone) phones.add(phone);
    }
    return [...phones].slice(0, 20);
  }, [dayTimeline]);

  const shipmentPhoneKey = normalizedShipmentPhones.join("|");

  const loadCompanyConfig = useCallback(async () => {
    setConfigLoading(true);
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
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const loadBaseData = useCallback(async () => {
    if (!companyId) return;
    setBaseLoading(true);
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
      const rawServices = servicesJson.data?.services ?? servicesJson.data ?? [];
      setServices(Array.isArray(rawServices) ? rawServices : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки данных");
    } finally {
      setBaseLoading(false);
    }
  }, [companyId]);

  const loadRecords = useCallback(async (): Promise<RecordItem[]> => {
    if (!companyId) return [];
    const activeStaffIds = timelineStaffId
      ? [timelineStaffId]
      : (staff.filter((s) => s.bookable !== false).length > 0 ? staff.filter((s) => s.bookable !== false) : staff)
          .slice(0, 4)
          .map((s) => String(s.id));
    if (activeStaffIds.length === 0) return [];
    setRecordsLoading(true);
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
      const next = responses.flat();
      setRecords(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки записей");
      return [];
    } finally {
      setRecordsLoading(false);
    }
  }, [companyId, scheduleDate, staff, timelineStaffId]);

  const refreshRecords = useCallback(async () => {
    setRefreshing(true);
    await loadRecords();
    setRefreshing(false);
  }, [loadRecords]);

  const loadMonthRecords = useCallback(async () => {
    if (!companyId || staff.length === 0) return;
    const bookable = staff.filter((s) => s.bookable !== false);
    const activeStaffIds = timelineStaffId
      ? [timelineStaffId]
      : (bookable.length > 0 ? bookable : staff).slice(0, 4).map((s) => String(s.id));
    if (activeStaffIds.length === 0) return;
    setMonthLoading(true);
    setMonthError(null);
    try {
      const start = monthStart(calendarMonth);
      const end = monthEnd(calendarMonth);
      const responses = await Promise.all(
        activeStaffIds.map(async (staffIdOne) => {
          const params = new URLSearchParams({
            action: "records",
            company_id: companyId,
            start_date: start,
            end_date: end,
            count: "500",
            staff_id: staffIdOne,
          });
          const res = await fetch(`/api/yclients?${params.toString()}`, { cache: "no-store" });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Ошибка загрузки календаря месяца");
          return Array.isArray(data.data) ? (data.data as RecordItem[]) : [];
        })
      );
      setMonthRecords(responses.flat());
    } catch (e) {
      setMonthError(e instanceof Error ? e.message : "Не удалось загрузить календарь месяца");
      setMonthRecords([]);
    } finally {
      setMonthLoading(false);
    }
  }, [calendarMonth, companyId, staff, timelineStaffId]);

  const loadCrmDeals = useCallback(async () => {
    setCrmDealsLoading(true);
    setCrmDealsError(null);
    try {
      const res = await fetch("/api/crm/deals", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as CrmDealsResponse;
      if (!res.ok) throw new Error(data.error ?? "Не удалось загрузить дела клиентов");
      const map: Record<string, CrmDealLink> = {};
      for (const stage of data.stages ?? []) {
        for (const deal of stage.deals ?? []) {
          if (deal.yclientsRecordId && !map[deal.yclientsRecordId]) {
            map[deal.yclientsRecordId] = deal;
          }
        }
      }
      setCrmDealByRecordId(map);
    } catch (e) {
      setCrmDealsError(e instanceof Error ? e.message : "Не удалось загрузить дела клиентов");
      setCrmDealByRecordId({});
    } finally {
      setCrmDealsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canAccess || checkingAuth) return;
    void loadCompanyConfig();
  }, [canAccess, checkingAuth, loadCompanyConfig]);

  useEffect(() => {
    if (!canAccess || checkingAuth || !companyId) return;
    void loadBaseData();
  }, [canAccess, checkingAuth, companyId, loadBaseData]);

  useEffect(() => {
    if (!canAccess || checkingAuth || !companyId || staff.length === 0) return;
    void loadRecords();
  }, [canAccess, checkingAuth, companyId, loadRecords, scheduleDate, staff.length, timelineStaffId]);

  useEffect(() => {
    if (!canAccess || checkingAuth) return;
    void loadCrmDeals();
  }, [canAccess, checkingAuth, loadCrmDeals]);

  useEffect(() => {
    setCalendarMonth(monthStart(scheduleDate));
  }, [scheduleDate]);

  useEffect(() => {
    if (!datePickerOpen || !canAccess || checkingAuth || !companyId || staff.length === 0) return;
    void loadMonthRecords();
  }, [canAccess, checkingAuth, companyId, datePickerOpen, loadMonthRecords, staff.length]);

  useEffect(() => {
    if (!shipmentPhoneKey) {
      setShipmentLookupByPhone({});
      return;
    }
    const controller = new AbortController();
    const phones = shipmentPhoneKey.split("|").filter(Boolean);
    setShipmentLookupByPhone((prev) => {
      const next = { ...prev };
      for (const phone of phones) next[phone] = { loading: true, rows: next[phone]?.rows ?? [], error: null };
      return next;
    });

    async function loadShipments() {
      const entries = await Promise.all(
        phones.map(async (phone) => {
          try {
            const res = await fetch(`/api/demands/by-phone?phone=${encodeURIComponent(phone)}&limit=5`, {
              cache: "no-store",
              signal: controller.signal,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить отгрузки");
            return [phone, { loading: false, rows: Array.isArray(data?.rows) ? (data.rows as ShipmentLookupRow[]) : [], error: null }] as const;
          } catch (e) {
            if (controller.signal.aborted) return null;
            return [
              phone,
              {
                loading: false,
                rows: [] as ShipmentLookupRow[],
                error: e instanceof Error ? e.message : "Не удалось загрузить отгрузки",
              },
            ] as const;
          }
        })
      );
      if (controller.signal.aborted) return;
      setShipmentLookupByPhone((prev) => {
        const next = { ...prev };
        for (const entry of entries) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    }

    void loadShipments();
    return () => controller.abort();
  }, [shipmentPhoneKey]);

  useEffect(() => {
    if (!formOpen) {
      setClientDropdownOpen(false);
      return;
    }
    const query = form.clientSearch.trim();
    if (query.length < 2) {
      setLocalClientOptions([]);
      setClientSearchError(null);
      setClientSearchLoading(false);
      setClientDropdownOpen(false);
      return;
    }

    const controller = new AbortController();
    setClientSearchLoading(true);
    setClientSearchError(null);
    setClientDropdownOpen(true);

    async function searchClients() {
      try {
        const phoneQuery = normalizePhone(query);
        const search = phoneQuery.length >= 7 ? phoneQuery : query;
        const res = await fetch(`/api/local-inventory/counterparties?search=${encodeURIComponent(search)}&limit=12`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? "Не удалось найти клиентов");
        if (controller.signal.aborted) return;
        const rows = Array.isArray(data?.counterparties) ? data.counterparties : [];
        setLocalClientOptions(
          rows.map((row: Record<string, unknown>) => {
            const vehicle = {
              model: stringFromUnknown(row.vehicleModel),
              plate: stringFromUnknown(row.vehiclePlate),
              vin: stringFromUnknown(row.vehicleVin),
              year: stringFromUnknown(row.vehicleYear),
            };
            const phone = stringFromUnknown(row.phone) || stringFromUnknown(row.additionalPhone);
            return {
              id: `crm:${String(row.id ?? row.name ?? "")}`,
              name: stringFromUnknown(row.name) || "Клиент",
              phone,
              email: stringFromUnknown(row.email),
              vehicle,
              source: "crm",
              subtitle: [phone ? formatPhone(phone) : "", vehicleLabel(vehicle)].filter(Boolean).join(" · "),
            };
          })
        );
      } catch (e) {
        if (controller.signal.aborted) return;
        setClientSearchError(e instanceof Error ? e.message : "Не удалось найти клиентов");
        setLocalClientOptions([]);
      } finally {
        if (!controller.signal.aborted) setClientSearchLoading(false);
      }
    }

    const timeout = window.setTimeout(() => void searchClients(), 220);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [form.clientSearch, formOpen]);

  useEffect(() => {
    if (!clientDropdownOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!clientPickerRef.current?.contains(event.target as Node)) setClientDropdownOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [clientDropdownOpen]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const recordClientOptions = useMemo<ClientOption[]>(() => {
    const map = new Map<string, ClientOption>();
    for (const record of records) {
      const name = getClientDisplayName(record);
      const phone = record.client?.phone ?? "";
      const key = normalizePhone(phone) || name.toLowerCase();
      if (!key || map.has(key)) continue;
      const vehicle = getVehicleInfo(record);
      map.set(key, {
        id: `journal:${key}`,
        name,
        phone,
        email: record.client?.email ?? "",
        vehicle,
        source: "journal",
        subtitle: [phone ? formatPhone(phone) : "", vehicleLabel(vehicle), "из журнала"].filter(Boolean).join(" · "),
      });
    }
    return [...map.values()];
  }, [records]);

  const clientOptions = useMemo<ClientOption[]>(() => {
    const queryRaw = form.clientSearch.trim();
    const query = queryRaw.toLowerCase();
    const phoneQuery = normalizePhone(queryRaw);
    const merged = [...localClientOptions, ...recordClientOptions];
    const seen = new Set<string>();
    const ranked = merged
      .map((option) => {
        const optionPhone = normalizePhone(option.phone);
        const searchable = [option.name, option.phone, option.email, vehicleLabel(option.vehicle)].join(" ").toLowerCase();
        const phoneTail = phoneQuery.slice(-10);
        let matchRank = 9;
        let matchLabel = option.source === "crm" ? "CRM" : "Журнал";
        if (phoneQuery && optionPhone && optionPhone === phoneQuery) {
          matchRank = 0;
          matchLabel = "совпадение по телефону";
        } else if (phoneQuery && optionPhone && (optionPhone.includes(phoneQuery) || (phoneTail.length >= 7 && optionPhone.endsWith(phoneTail)))) {
          matchRank = 1;
          matchLabel = "частичное совпадение телефона";
        } else if (query && option.name.toLowerCase().includes(query)) {
          matchRank = 2;
          matchLabel = "совпадение по имени";
        } else if (!query || searchable.includes(query)) {
          matchRank = 3;
          matchLabel = option.source === "crm" ? "CRM" : "из журнала";
        }
        return { ...option, matchRank, matchLabel };
      })
      .filter((option) => {
        const key = normalizePhone(option.phone) || option.name.toLowerCase();
        if (seen.has(key) || option.matchRank === 9) return false;
        seen.add(key);
        return true;
      });
    const exactPhoneMatches = phoneQuery ? ranked.filter((option) => option.matchRank === 0) : [];
    return (exactPhoneMatches.length > 0 ? exactPhoneMatches : ranked)
      .sort((a, b) => (a.matchRank ?? 9) - (b.matchRank ?? 9) || a.name.localeCompare(b.name, "ru"))
      .slice(0, 8);
  }, [form.clientSearch, localClientOptions, recordClientOptions]);

  const calendarDays = useMemo(() => getMonthGridDays(calendarMonth), [calendarMonth]);

  const monthLoadByDate = useMemo(() => {
    const activeStaff = timelineStaff.length > 0 ? timelineStaff : staff.filter((item) => item.bookable !== false).slice(0, 4);
    const staffCount = Math.max(1, activeStaff.length);
    const defaultWorkingMinutes = (DEFAULT_TIMELINE_END - DEFAULT_TIMELINE_START) * staffCount;
    const grouped = new Map<string, RecordItem[]>();
    for (const record of monthRecords) {
      const date = parseRecordDate(record);
      if (!date) continue;
      const key = toDateInputValue(date);
      const arr = grouped.get(key) ?? [];
      arr.push(record);
      grouped.set(key, arr);
    }

    const out = new Map<string, MonthDayLoad>();
    for (const day of calendarDays) {
      const items = grouped.get(day) ?? [];
      const byStaff = new Map<number, Array<{ start: number; end: number }>>();
      for (const record of items) {
        const date = parseRecordDate(record);
        const staffIdNum = Number(record.staff_id ?? 0);
        if (!date || !staffIdNum) continue;
        const start = date.getHours() * 60 + date.getMinutes();
        const lengthSec = Number(record.seance_length ?? record.length ?? DEFAULT_RECORD_DURATION_SECONDS);
        const end = Math.min(DEFAULT_TIMELINE_END, start + Math.max(MIN_SLOT_MINUTES, Math.round((Number.isFinite(lengthSec) ? lengthSec : DEFAULT_RECORD_DURATION_SECONDS) / 60)));
        const arr = byStaff.get(staffIdNum) ?? [];
        arr.push({ start: Math.max(DEFAULT_TIMELINE_START, start), end });
        byStaff.set(staffIdNum, arr);
      }

      let busyMinutes = 0;
      let freeWindows = 0;
      let nearestFreeMinute: number | null = null;
      for (const staffItem of activeStaff) {
        const blocks = (byStaff.get(staffItem.id) ?? [])
          .filter((block) => block.end > block.start)
          .sort((a, b) => a.start - b.start);
        const merged: Array<{ start: number; end: number }> = [];
        for (const block of blocks) {
          const last = merged[merged.length - 1];
          if (last && block.start <= last.end) last.end = Math.max(last.end, block.end);
          else merged.push({ ...block });
        }
        let cursor = DEFAULT_TIMELINE_START;
        for (const block of merged) {
          busyMinutes += block.end - block.start;
          if (block.start - cursor >= MIN_SLOT_MINUTES) {
            freeWindows += 1;
            nearestFreeMinute ??= cursor;
          }
          cursor = Math.max(cursor, block.end);
        }
        if (DEFAULT_TIMELINE_END - cursor >= MIN_SLOT_MINUTES) {
          freeWindows += 1;
          nearestFreeMinute ??= cursor;
        }
      }

      out.set(day, {
        date: day,
        recordCount: items.length,
        busyMinutes,
        freeMinutes: Math.max(0, defaultWorkingMinutes - busyMinutes),
        freeWindows,
        nearestFreeMinute,
      });
    }
    return out;
  }, [calendarDays, monthRecords, staff, timelineStaff]);

  const timelineBounds = useMemo(() => {
    const starts = dayTimeline.map((item) => item.startMinute);
    const ends = dayTimeline.map((item) => item.endMinute);
    const start = Math.max(0, Math.floor(Math.min(DEFAULT_TIMELINE_START, ...starts) / 60) * 60);
    const end = Math.min(24 * 60, Math.ceil(Math.max(DEFAULT_TIMELINE_END, ...ends) / 60) * 60);
    return { start, end };
  }, [dayTimeline]);

  const timelineStartMinute = timelineBounds.start;
  const timelineEndMinute = timelineBounds.end;
  const minutePx = TIMELINE_MINUTE_PX;
  const timelineHeight = Math.max(560, (timelineEndMinute - timelineStartMinute) * minutePx);

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

  const filteredTimeline = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return dayTimeline.filter((record) => {
      const phone = normalizePhone(record.phone);
      const shipments = phone ? shipmentLookupByPhone[phone]?.rows ?? [] : [];
      if (statusFilter !== "all" && record.statusKey !== statusFilter) return false;
      if (sourceFilter !== "all" && record.source !== sourceFilter) return false;
      if (shipmentFilter === "with" && shipments.length === 0) return false;
      if (shipmentFilter === "without" && shipments.length > 0) return false;
      if (!query) return true;
      const haystack = [
        String(record.id),
        record.startedAtText,
        record.endedAtText,
        record.serviceTitle,
        record.clientName,
        record.phone,
        formatPhone(record.phone),
        record.staffName,
        record.statusLabel,
        record.sourceLabel,
        vehicleLabel(record.vehicle),
        ...shipments.map((shipment) => shipment.name),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [dayTimeline, searchQuery, shipmentFilter, shipmentLookupByPhone, sourceFilter, statusFilter]);

  const positionedByStaff = useMemo(() => {
    const source = new Map<number, TimelineRecord[]>();
    for (const item of filteredTimeline) {
      const arr = source.get(item.staffId) ?? [];
      arr.push(item);
      source.set(item.staffId, arr);
    }

    const out = new Map<number, PositionedTimelineRecord[]>();
    const flushGroup = (staffId: number, group: TimelineRecord[]) => {
      if (group.length === 0) return;
      const laneEnds: number[] = [];
      const laneById = new Map<number, number>();

      for (const record of group) {
        let lane = laneEnds.findIndex((end) => record.startMinute >= end);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(record.endMinute);
        } else {
          laneEnds[lane] = record.endMinute;
        }
        laneById.set(record.id, lane);
      }

      const laneCount = Math.max(1, laneEnds.length);
      const positioned = out.get(staffId) ?? [];
      for (const record of group) {
        const durationMinutes = Math.max(1, record.endMinute - record.startMinute);
        const displayMode = getTimelineEventMode(durationMinutes);
        const rawHeight = durationMinutes * minutePx;
        const visualGap = durationMinutes <= 30 ? 2 : EVENT_LANE_GAP_PX;
        const heightPx = Math.max(getEventMinHeight(displayMode), rawHeight - visualGap);
        positioned.push({
          ...record,
          displayMode,
          durationMinutes,
          lane: laneById.get(record.id) ?? 0,
          laneCount,
          topPx: Math.max(0, (record.startMinute - timelineStartMinute) * minutePx + visualGap / 2),
          heightPx,
        });
      }
      out.set(staffId, positioned);
    };

    for (const [staffId, recordsForStaff] of source.entries()) {
      const sorted = [...recordsForStaff].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
      let group: TimelineRecord[] = [];
      let groupEnd = -1;

      for (const record of sorted) {
        if (group.length === 0) {
          group = [record];
          groupEnd = record.endMinute;
          continue;
        }

        if (record.startMinute < groupEnd) {
          group.push(record);
          groupEnd = Math.max(groupEnd, record.endMinute);
        } else {
          flushGroup(staffId, group);
          group = [record];
          groupEnd = record.endMinute;
        }
      }
      flushGroup(staffId, group);
    }

    return out;
  }, [filteredTimeline, minutePx, timelineStartMinute]);

  const getFreeSlots = useCallback(
    (staffIdValue: number, options?: { excludeRecordId?: number | null; fromMinute?: number; durationMinutes?: number }) => {
      const blocks = (timelineByStaff.get(staffIdValue) ?? [])
        .filter((record) => record.id !== options?.excludeRecordId)
        .map((record) => ({ start: record.startMinute, end: record.endMinute }))
        .sort((a, b) => a.start - b.start);
      const merged: Array<{ start: number; end: number }> = [];
      for (const block of blocks) {
        const last = merged[merged.length - 1];
        if (last && block.start <= last.end) {
          last.end = Math.max(last.end, block.end);
        } else {
          merged.push({ ...block });
        }
      }
      const slots: Array<{ start: number; end: number }> = [];
      let cursor = timelineStartMinute;
      for (const block of merged) {
        if (block.start - cursor >= MIN_SLOT_MINUTES) slots.push({ start: cursor, end: block.start });
        cursor = Math.max(cursor, block.end);
      }
      if (timelineEndMinute - cursor >= MIN_SLOT_MINUTES) slots.push({ start: cursor, end: timelineEndMinute });
      const fromMinute = options?.fromMinute ?? timelineStartMinute;
      const durationMinutes = options?.durationMinutes ?? MIN_SLOT_MINUTES;
      return slots
        .map((slot) => ({ start: Math.max(slot.start, fromMinute), end: slot.end }))
        .filter((slot) => slot.end - slot.start >= durationMinutes);
    },
    [timelineByStaff, timelineEndMinute, timelineStartMinute]
  );

  const nextFreeCards = useMemo(() => {
    const fromMinute = nowMinute ?? timelineStartMinute;
    return timelineStaff.map((staffItem, index) => {
      const slots = getFreeSlots(staffItem.id, { fromMinute, durationMinutes: MIN_SLOT_MINUTES });
      const totalFree = slots.reduce((sum, slot) => sum + (slot.end - slot.start), 0);
      return { staffItem, boxLabel: `Бокс №${index + 1}`, next: slots[0] ?? null, totalFree };
    });
  }, [getFreeSlots, nowMinute, timelineStaff, timelineStartMinute]);

  const formConflicts = useMemo(() => {
    const start = parseDateTimeLocal(form.datetime);
    const end = parseDateTimeLocal(form.datetimeEnd);
    const staffIdNum = Number(form.staffId);
    if (!start || !end || !staffIdNum || toDateInputValue(start) !== scheduleDate) return [];
    const startMinute = start.getHours() * 60 + start.getMinutes();
    const endMinute = end.getHours() * 60 + end.getMinutes();
    return (timelineByStaff.get(staffIdNum) ?? []).filter((record) => {
      if (formMode === "edit" && record.id === editingRecordId) return false;
      return startMinute < record.endMinute && endMinute > record.startMinute;
    });
  }, [editingRecordId, form.datetime, form.datetimeEnd, form.staffId, formMode, scheduleDate, timelineByStaff]);

  const formTimeValidation = useMemo(() => {
    const start = parseDateTimeLocal(form.datetime);
    const end = parseDateTimeLocal(form.datetimeEnd);
    if (!form.staffId) return { ok: false, warning: false, message: "Не выбран сотрудник / бокс" };
    if (!start || !end) return { ok: false, warning: false, message: "Укажите дату и время записи" };
    const startMinute = start.getHours() * 60 + start.getMinutes();
    const endMinute = end.getHours() * 60 + end.getMinutes();
    if (endMinute <= startMinute) {
      return { ok: false, warning: false, message: "Окончание записи должно быть позже начала" };
    }
    if (formConflicts.length > 0 && !form.allowOverlap) {
      return { ok: false, warning: false, message: "В это время уже есть запись" };
    }
    if (startMinute < timelineStartMinute || endMinute > timelineEndMinute) {
      return {
        ok: true,
        warning: true,
        message: "Время вне отображаемой сетки. YCLIENTS проверит доступность при сохранении.",
      };
    }
    return { ok: true, warning: false, message: "Время свободно" };
  }, [form.allowOverlap, form.datetime, form.datetimeEnd, form.staffId, formConflicts.length, timelineEndMinute, timelineStartMinute]);

  const nearestFormSlots = useMemo(() => {
    const staffIdNum = Number(form.staffId);
    const start = parseDateTimeLocal(form.datetime);
    const fromMinute = start ? start.getHours() * 60 + start.getMinutes() : nowMinute ?? timelineStartMinute;
    const durationMinutes = Math.max(MIN_SLOT_MINUTES, Math.round(selectedServiceDurationSeconds / 60));
    if (!staffIdNum) return [];
    return getFreeSlots(staffIdNum, {
      excludeRecordId: formMode === "edit" ? editingRecordId : null,
      fromMinute,
      durationMinutes,
    }).slice(0, 3);
  }, [editingRecordId, form.datetime, form.staffId, formMode, getFreeSlots, nowMinute, selectedServiceDurationSeconds, timelineStartMinute]);

  const setFormValue = useCallback(<K extends keyof RecordFormState>(key: K, value: RecordFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const openCreateForm = useCallback(
    (defaults?: Partial<RecordFormState>) => {
      const now = new Date(`${scheduleDate}T09:00:00`);
      const baseStart = defaults?.datetime || toDateTimeLocalValue(now);
      const serviceIds = defaults?.serviceIds ?? [];
      const defaultDuration =
        serviceIds.reduce((sum, id) => sum + getServiceDurationSeconds(serviceById.get(id)), 0) ||
        DEFAULT_RECORD_DURATION_SECONDS;
      setForm({
        ...emptyForm,
        staffId: defaults?.staffId ?? (timelineStaff[0] ? String(timelineStaff[0].id) : ""),
        serviceIds,
        datetime: baseStart,
        datetimeEnd: defaults?.datetimeEnd || addSecondsToDateTimeLocal(baseStart, defaultDuration),
        ...defaults,
        allowOverlap: false,
      });
      setEditingRecordId(null);
      setFormMode("create");
      setFormError(null);
      setLinkedCreateDealId(null);
      setFormOpen(true);
    },
    [scheduleDate, serviceById, timelineStaff]
  );

  const openQuickCreateFromMinute = useCallback(
    (staffIdValue: number, minute: number) => {
      const clamped = Math.max(timelineStartMinute, Math.min(timelineEndMinute - 5, minute));
      const rounded = Math.floor(clamped / 5) * 5;
      const start = `${scheduleDate}T${formatMinute(rounded)}`;
      openCreateForm({
        staffId: String(staffIdValue),
        datetime: start,
        datetimeEnd: addSecondsToDateTimeLocal(start, selectedServiceDurationSeconds),
      });
      setSelectedRecordId(null);
    },
    [openCreateForm, scheduleDate, selectedServiceDurationSeconds, timelineEndMinute, timelineStartMinute]
  );

  useEffect(() => {
    const crmDealId = searchParams.get("crmDealId");
    const shouldOpen = searchParams.get("new") === "1" && Boolean(crmDealId);
    if (!shouldOpen || crmPrefillAppliedRef.current || staff.length === 0) return;
    crmPrefillAppliedRef.current = true;
    const clientName = searchParams.get("client") ?? searchParams.get("search") ?? "";
    const phone = searchParams.get("phone") ?? "";
    const vehicle = searchParams.get("vehicle") ?? "";
    const comment = searchParams.get("comment") ?? "";
    openCreateForm({
      clientSearch: clientName || phone,
      clientName,
      clientPhone: phone,
      vehicleModel: vehicle,
      comment,
      internalComment: `Источник: CRM-дело ${crmDealId}`,
    });
    setLinkedCreateDealId(crmDealId);
    setToast("Форма записи заполнена из дела клиента");
  }, [openCreateForm, searchParams, staff.length]);

  useEffect(() => {
    const rawRecordId = searchParams.get("recordId");
    if (!rawRecordId || !companyId || focusedRecordParamRef.current === rawRecordId) return;
    const recordId = Number(rawRecordId);
    if (!Number.isFinite(recordId) || recordId <= 0) return;
    focusedRecordParamRef.current = rawRecordId;
    const recordIdParam = rawRecordId;
    setPendingFocusRecordId(recordId);
    setSelectedRecordId(recordId);
    setSearchQuery(rawRecordId);

    const dateParam = searchParams.get("date");
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      setScheduleDate(dateParam);
      return;
    }

    const controller = new AbortController();
    async function loadRecordDate() {
      try {
        const params = new URLSearchParams({
          action: "record",
          company_id: companyId,
          record_id: recordIdParam,
        });
        const res = await fetch(`/api/yclients?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return;
        const record = (data?.data ?? data) as RecordItem;
        const date = parseRecordDate(record);
        if (date) setScheduleDate(toDateInputValue(date));
      } catch {
        // Фокус останется по id в текущем дне, если отдельная запись не загрузилась.
      }
    }
    void loadRecordDate();
    return () => controller.abort();
  }, [companyId, searchParams]);

  useEffect(() => {
    if (!pendingFocusRecordId) return;
    if (dayTimeline.some((record) => record.id === pendingFocusRecordId)) {
      setSelectedRecordId(pendingFocusRecordId);
      setPendingFocusRecordId(null);
    }
  }, [dayTimeline, pendingFocusRecordId]);

  const getRoundedMinute = useCallback(
    (minute: number) => {
      const clamped = Math.max(timelineStartMinute, Math.min(timelineEndMinute - TIMELINE_SNAP_MINUTES, minute));
      return Math.floor(clamped / TIMELINE_SNAP_MINUTES) * TIMELINE_SNAP_MINUTES;
    },
    [timelineEndMinute, timelineStartMinute]
  );

  const openEditForm = useCallback((record: TimelineRecord, original: RecordItem) => {
    const rawDate = String(original.date ?? original.datetime ?? "").replace(" ", "T");
    const normalizedDate = rawDate.length >= 16 ? rawDate.slice(0, 16) : "";
    const serviceIds = (original.services ?? []).map((service) => String(service.id)).filter(Boolean);
    setForm({
      ...emptyForm,
      staffId: original.staff_id ? String(original.staff_id) : String(record.staffId),
      serviceIds,
      clientSearch: record.clientName,
      selectedClientId: "",
      clientName: record.clientName,
      clientPhone: record.phone,
      clientEmail: record.email,
      vehicleModel: record.vehicle.model,
      vehiclePlate: record.vehicle.plate,
      vehicleVin: record.vehicle.vin,
      datetime: normalizedDate,
      datetimeEnd:
        normalizedDate
          ? addSecondsToDateTimeLocal(
              normalizedDate,
              Number(original.seance_length ?? original.length ?? DEFAULT_RECORD_DURATION_SECONDS) || DEFAULT_RECORD_DURATION_SECONDS
            )
          : "",
      comment: record.comment,
      internalComment: record.internalComment,
      statusKey: record.statusKey,
      allowOverlap: false,
    });
    setEditingRecordId(record.id);
    setFormMode("edit");
    setFormError(null);
    setFormOpen(true);
  }, []);

  const toggleService = useCallback(
    (id: string) => {
      setForm((prev) => {
        const serviceIds = prev.serviceIds.includes(id)
          ? prev.serviceIds.filter((item) => item !== id)
          : [...prev.serviceIds, id];
        const totalDuration =
          serviceIds.reduce((sum, serviceId) => sum + getServiceDurationSeconds(serviceById.get(serviceId)), 0) ||
          DEFAULT_RECORD_DURATION_SECONDS;
        return {
          ...prev,
          serviceIds,
          datetimeEnd: prev.datetime ? addSecondsToDateTimeLocal(prev.datetime, totalDuration) : prev.datetimeEnd,
          allowOverlap: false,
        };
      });
    },
    [serviceById]
  );

  const selectClient = useCallback((option: ClientOption) => {
    setForm((prev) => ({
      ...prev,
      selectedClientId: option.id,
      clientSearch: option.name,
      clientName: option.name,
      clientPhone: option.phone,
      clientEmail: option.email,
      vehicleModel: option.vehicle.model || prev.vehicleModel,
      vehiclePlate: option.vehicle.plate || prev.vehiclePlate,
      vehicleVin: option.vehicle.vin || prev.vehicleVin,
    }));
    setClientDropdownOpen(false);
  }, []);

  const handleSubmitRecord = useCallback(
    async (openShipmentAfterCreate = false) => {
      if (form.serviceIds.length === 0) {
        setFormError("Выберите хотя бы одну услугу");
        return;
      }
      if (!formTimeValidation.ok) {
        setFormError(formTimeValidation.message);
        return;
      }
      if (!form.clientName.trim() || !form.clientPhone.trim()) {
        setFormError("Для записи обязательны имя и телефон клиента");
        return;
      }
      const phone = normalizePhone(form.clientPhone);
      if (!phone) {
        setFormError("Укажите телефон клиента цифрами");
        return;
      }
      const manualSeanceLength = form.datetimeEnd ? calculateSeanceLengthSeconds(form.datetime, form.datetimeEnd) : null;
      if (form.datetimeEnd && manualSeanceLength == null) {
        setFormError("Окончание записи должно быть позже начала");
        return;
      }
      if (formConflicts.length > 0 && !form.allowOverlap) {
        setFormError("В это время уже есть запись. Выберите другое окно или подтвердите пересечение.");
        return;
      }

      setFormSaving(true);
      setFormError(null);
      setError(null);
      const seanceLength = manualSeanceLength ?? selectedServiceDurationSeconds;
      const comment = composeComment(form);

      try {
        if (formMode === "create") {
          const payload = {
            staff_id: Number(form.staffId),
            services: form.serviceIds.map((id) => ({ id: Number(id) })),
            client: {
              name: form.clientName.trim(),
              phone,
              email: form.clientEmail.trim() || fallbackEmail(phone),
            },
            datetime: toYclientsDateTime(form.datetime),
            seance_length: seanceLength,
            comment: comment || undefined,
            save_if_busy: form.allowOverlap,
            send_sms: false,
          };

          const res = await fetch("/api/yclients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "create-record", company_id: companyId, payload }),
          });
          const data = await res.json();
          if (!res.ok) {
            setFormError(getRecordSaveErrorMessage(data, "Ошибка сохранения записи"));
            return;
          }

          const nextRecords = await loadRecords();
          const created = findCreatedRecord(nextRecords, form);
          if (created) setSelectedRecordId(created.id);
          let successToast = "Запись создана";
          if (created && linkedCreateDealId) {
            const linkRes = await fetch(`/api/crm/deals/${encodeURIComponent(linkedCreateDealId)}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                yclientsRecordId: String(created.id),
                nextAction: "Подготовить визит",
                nextContactAt: form.datetime,
              }),
            });
            if (linkRes.ok) {
              await loadCrmDeals();
            } else {
              successToast = "Запись создана, но дело не связалось автоматически";
            }
          }
          setFormOpen(false);
          setToast(successToast);
          setLinkedCreateDealId(null);
          if (openShipmentAfterCreate) {
            const shipmentRes = await fetch("/api/demands/from-record", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                recordId: created?.id ?? null,
                recordDateTime: form.datetime,
                recordSource: "yclients",
                sourceLabel: "YCLIENTS",
                clientName: form.clientName.trim(),
                clientPhone: phone,
                clientEmail: form.clientEmail.trim(),
                vehicle: { model: form.vehicleModel, plate: form.vehiclePlate, vin: form.vehicleVin },
                comment: form.comment,
                internalComment: form.internalComment,
                services: form.serviceIds.map((id) => serviceById.get(id)?.title ?? "").filter(Boolean),
              }),
            });
            const shipmentData = (await shipmentRes.json().catch(() => ({}))) as CreateShipmentFromRecordResponse;
            if (shipmentRes.ok && shipmentData.id) {
              router.push(`/shipment/${encodeURIComponent(shipmentData.id)}/edit`);
            } else {
              setToast(shipmentData.error ?? "Запись создана, но отгрузку создать не удалось");
            }
          }
          return;
        }

        if (!editingRecordId) {
          setFormError("Не выбрана запись для редактирования");
          return;
        }
        const payload = {
          staff_id: Number(form.staffId),
          services: form.serviceIds.map((id) => ({ id: Number(id) })),
          client: {
            name: form.clientName.trim(),
            phone,
            email: form.clientEmail.trim() || fallbackEmail(phone),
          },
          datetime: `${form.datetime.replace("T", " ")}:00`,
          seance_length: seanceLength,
          comment: comment || undefined,
          confirmed: form.statusKey === "confirmed" ? 1 : undefined,
          attendance: form.statusKey === "arrived" || form.statusKey === "in_work" || form.statusKey === "done" ? 1 : undefined,
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
          setFormError(getRecordSaveErrorMessage(data, "Ошибка редактирования записи"));
          return;
        }

        setFormOpen(false);
        await loadRecords();
        setSelectedRecordId(editingRecordId);
        setToast("Запись обновлена");
      } finally {
        setFormSaving(false);
      }
    },
    [
      companyId,
      editingRecordId,
      form,
      formConflicts.length,
      formTimeValidation,
      formMode,
      linkedCreateDealId,
      loadCrmDeals,
      loadRecords,
      router,
      selectedServiceDurationSeconds,
      serviceById,
    ]
  );

  const handleConfirmRecord = useCallback(async () => {
    if (!selectedRecordItem || !selectedTimelineRecord) return;
    const date = String(selectedRecordItem.date ?? selectedRecordItem.datetime ?? "").replace(" ", "T").slice(0, 16);
    if (!date) return;
    setError(null);
    const phone = normalizePhone(selectedTimelineRecord.phone);
    const payload = {
      staff_id: selectedTimelineRecord.staffId,
      services: (selectedRecordItem.services ?? []).map((service) => ({ id: Number(service.id) })),
      client: {
        name: selectedTimelineRecord.clientName,
        phone,
        email: selectedTimelineRecord.email || fallbackEmail(phone),
      },
      datetime: `${date.replace("T", " ")}:00`,
      seance_length: Number(selectedRecordItem.seance_length ?? selectedRecordItem.length ?? DEFAULT_RECORD_DURATION_SECONDS),
      comment: selectedRecordItem.comment || undefined,
      confirmed: 1,
      save_if_busy: true,
    };
    const res = await fetch("/api/yclients", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update-record",
        company_id: companyId,
        record_id: selectedRecordItem.id,
        payload,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(getApiErrorMessage(data, "Не удалось подтвердить запись"));
      return;
    }
    await loadRecords();
    setToast("Запись подтверждена");
  }, [companyId, loadRecords, selectedRecordItem, selectedTimelineRecord]);

  const handleCancelRecord = useCallback(async () => {
    if (!selectedRecordId) return;
    const ok = window.confirm("Отменить запись?");
    if (!ok) return;
    window.prompt("Причина отмены (опционально)", "");

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
      setError(getApiErrorMessage(data, "Ошибка отмены записи"));
      return;
    }

    setSelectedRecordId(null);
    await loadRecords();
    setToast("Запись отменена");
  }, [companyId, loadRecords, selectedRecordId]);

  const copyPhone = useCallback(async (phone: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setToast("Телефон скопирован");
    } catch {
      setToast("Не удалось скопировать телефон");
    }
  }, []);

  const handleCreateShipmentFromRecord = useCallback(
    async (record: TimelineRecord) => {
      if (creatingShipmentRecordId) return;
      setCreatingShipmentRecordId(record.id);
      setError(null);
      try {
        const res = await fetch("/api/demands/from-record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recordId: record.id,
            recordDateTime: record.recordDateTime || `${scheduleDate}T${record.startedAtText}`,
            recordSource: record.source,
            sourceLabel: record.sourceLabel,
            clientName: record.clientName,
            clientPhone: record.phone,
            clientEmail: record.email,
            clientExternalId: record.clientExternalId,
            yclientsClientId: record.yclientsClientId,
            vehicle: record.vehicle,
            comment: record.comment,
            internalComment: record.internalComment,
            services: record.serviceTitles.length ? record.serviceTitles : [record.serviceTitle],
          }),
        });
        const data = (await res.json().catch(() => ({}))) as CreateShipmentFromRecordResponse;
        if (!res.ok || !data.id) {
          throw new Error(data.error ?? "Не удалось создать отгрузку из записи");
        }
        setToast(data.counterpartyCreated ? "Клиент создан, черновик отгрузки открыт" : "Черновик отгрузки открыт");
        router.push(`/shipment/${encodeURIComponent(data.id)}/edit`);
      } catch (e) {
        setToast(e instanceof Error ? e.message : "Не удалось создать отгрузку из записи");
      } finally {
        setCreatingShipmentRecordId(null);
      }
    },
    [creatingShipmentRecordId, router, scheduleDate]
  );

  const handleCreateCaseFromRecord = useCallback(
    async (record: TimelineRecord) => {
      const existing = crmDealByRecordId[String(record.id)];
      if (existing) {
        router.push(`/crm?dealId=${encodeURIComponent(existing.id)}`);
        return;
      }
      if (creatingCaseRecordId) return;
      setCreatingCaseRecordId(record.id);
      setError(null);
      try {
        const phone = normalizePhone(record.phone);
        const shipments = phone ? shipmentLookupByPhone[phone]?.rows ?? [] : [];
        const recordDate = parseRecordDate({ date: record.recordDateTime } as RecordItem);
        const isPast = recordDate ? recordDate.getTime() < Date.now() : false;
        const nextAction =
          isPast && shipments.length === 0
            ? "Создать отгрузку"
            : record.serviceTitle.toLowerCase().includes("расход")
              ? "Подготовить расходники"
              : "Уточнить услугу";
        const notes = [
          `Создано из журнала записей: ${formatScheduleTitle(scheduleDate)} ${record.startedAtText}–${record.endedAtText}`,
          record.comment ? `Комментарий клиента: ${record.comment}` : "",
          record.internalComment ? `Внутренний комментарий: ${record.internalComment}` : "",
          record.sourceLabel ? `Источник записи: ${record.sourceLabel}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        const res = await fetch("/api/crm/deals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: record.serviceTitle || `Запись ${record.startedAtText}`,
            customerName: record.clientName,
            phone: record.phone,
            vehicle: vehicleLabel(record.vehicle),
            source: `Журнал записей / ${record.sourceLabel}`,
            clientType: phone ? "regular" : "new_lead",
            nextAction,
            nextContactAt: isPast ? "" : record.recordDateTime,
            notes,
            yclientsRecordId: String(record.id),
            moyskladDemandId: shipments[0]?.id ?? "",
            createLocalClient: true,
            moyskladCounterpartyName: record.clientName,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as CrmDealLink & { error?: string };
        if (!res.ok || !data.id) {
          throw new Error(data.error ?? "Не удалось создать дело клиента");
        }
        await loadCrmDeals();
        setToast(
          data.alreadyExists
            ? "У записи уже есть дело клиента"
            : phone
              ? "Дело клиента создано"
              : "Клиент создан без телефона, дело клиента создано"
        );
      } catch (e) {
        setToast(e instanceof Error ? e.message : "Не удалось создать дело клиента");
      } finally {
        setCreatingCaseRecordId(null);
      }
    },
    [creatingCaseRecordId, crmDealByRecordId, loadCrmDeals, router, scheduleDate, shipmentLookupByPhone]
  );

  useEffect(() => {
    timelineInteractionRef.current = timelineInteraction;
  }, [timelineInteraction]);

  const commitTimelineTimeChange = useCallback(
    async (interaction: TimelineInteraction) => {
      if (!interaction.moved) return;
      const record = dayTimeline.find((item) => item.id === interaction.recordId);
      const original = records.find((item) => item.id === interaction.recordId);
      if (!record || !original) return;
      const startMinute = interaction.targetStartMinute;
      const endMinute = interaction.targetEndMinute;
      if (startMinute < timelineStartMinute || endMinute > timelineEndMinute) {
        setToast("Время вне рабочего графика");
        return;
      }
      const conflicts = (timelineByStaff.get(interaction.staffId) ?? []).filter((item) => {
        if (item.id === record.id) return false;
        return startMinute < item.endMinute && endMinute > item.startMinute;
      });
      if (conflicts.length > 0) {
        setToast(`Слот занят: ${conflicts.map((item) => `${item.startedAtText}–${item.endedAtText}`).join(", ")}`);
        return;
      }
      if (!companyId) {
        setToast("Не удалось проверить доступность: не настроен филиал YCLIENTS");
        return;
      }

      setTimelineActionSaving(true);
      setError(null);
      try {
        const phone = normalizePhone(record.phone);
        const payload = {
          staff_id: interaction.staffId,
          services: (original.services ?? []).map((service) => ({ id: Number(service.id) })).filter((service) => Number.isFinite(service.id)),
          client: {
            name: record.clientName,
            phone,
            email: record.email || fallbackEmail(phone),
          },
          datetime: `${scheduleDate} ${formatMinute(startMinute)}:00`,
          seance_length: (endMinute - startMinute) * 60,
          comment: original.comment || undefined,
          confirmed: record.statusKey === "confirmed" ? 1 : undefined,
          attendance: record.statusKey === "arrived" || record.statusKey === "in_work" || record.statusKey === "done" ? 1 : undefined,
        };
        const res = await fetch("/api/yclients", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update-record",
            company_id: companyId,
            record_id: record.id,
            payload,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setToast(getRecordSaveErrorMessage(data, "Не удалось перенести запись"));
          return;
        }
        await loadRecords();
        setSelectedRecordId(record.id);
        setToast(interaction.kind === "resize" ? "Длительность обновлена" : "Запись перенесена");
      } catch (e) {
        setToast(e instanceof Error ? e.message : "Не удалось сохранить новое время");
      } finally {
        setTimelineActionSaving(false);
      }
    },
    [companyId, dayTimeline, loadRecords, records, scheduleDate, timelineByStaff, timelineEndMinute, timelineStartMinute]
  );

  useEffect(() => {
    if (!timelineInteraction) return;
    const onPointerMove = (event: PointerEvent) => {
      setTimelineInteraction((prev) => {
        if (!prev) return prev;
        const pointerMinute = (event.clientY - prev.columnTop) / minutePx + timelineStartMinute;
        if (prev.kind === "resize") {
          const nextEnd = Math.min(timelineEndMinute, Math.max(prev.startMinute + MIN_SLOT_MINUTES, getRoundedMinute(pointerMinute)));
          const next = { ...prev, targetEndMinute: nextEnd, moved: nextEnd !== prev.endMinute };
          timelineInteractionRef.current = next;
          return next;
        }
        const duration = prev.endMinute - prev.startMinute;
        const nextStart = Math.max(timelineStartMinute, Math.min(timelineEndMinute - duration, getRoundedMinute(pointerMinute - prev.pointerOffsetMinutes)));
        const next = {
          ...prev,
          targetStartMinute: nextStart,
          targetEndMinute: nextStart + duration,
          moved: nextStart !== prev.startMinute,
        };
        timelineInteractionRef.current = next;
        return next;
      });
    };
    const onPointerUp = () => {
      const finalInteraction = timelineInteractionRef.current;
      setTimelineInteraction(null);
      if (finalInteraction) void commitTimelineTimeChange(finalInteraction);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [commitTimelineTimeChange, getRoundedMinute, minutePx, timelineEndMinute, timelineInteraction, timelineStartMinute]);

  const startTimelineInteraction = useCallback(
    (kind: TimelineInteractionKind, record: PositionedTimelineRecord, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || timelineActionSaving) return;
      const column = event.currentTarget.closest(".eco-records-timeline-col");
      if (!(column instanceof HTMLElement)) return;
      const rect = column.getBoundingClientRect();
      const pointerMinute = (event.clientY - rect.top) / minutePx + timelineStartMinute;
      event.preventDefault();
      event.stopPropagation();
      setSelectedRecordId(record.id);
      setTimelineInteraction({
        kind,
        recordId: record.id,
        staffId: record.staffId,
        pointerOffsetMinutes: Math.max(0, pointerMinute - record.startMinute),
        startMinute: record.startMinute,
        endMinute: record.endMinute,
        targetStartMinute: record.startMinute,
        targetEndMinute: record.endMinute,
        columnTop: rect.top,
        moved: false,
      });
    },
    [minutePx, timelineActionSaving, timelineStartMinute]
  );

  const formDate = form.datetime ? form.datetime.slice(0, 10) : scheduleDate;
  const formStartTime = form.datetime ? form.datetime.slice(11, 16) : "";
  const formEndTime = form.datetimeEnd ? form.datetimeEnd.slice(11, 16) : "";
  const formDurationMinutes = form.datetime && form.datetimeEnd ? Math.round((calculateSeanceLengthSeconds(form.datetime, form.datetimeEnd) ?? 0) / 60) : 0;
  const selectedClientPhoneKey = normalizePhone(form.clientPhone);
  const selectedClientShipments = selectedClientPhoneKey ? shipmentLookupByPhone[selectedClientPhoneKey]?.rows ?? [] : [];

  const selectedPhoneKey = selectedTimelineRecord ? normalizePhone(selectedTimelineRecord.phone) : "";
  const selectedShipments = selectedPhoneKey ? shipmentLookupByPhone[selectedPhoneKey]?.rows ?? [] : [];
  const selectedShipmentsLoading = selectedPhoneKey ? shipmentLookupByPhone[selectedPhoneKey]?.loading : false;
  const selectedShipmentsError = selectedPhoneKey ? shipmentLookupByPhone[selectedPhoneKey]?.error : null;

  const initialLoading = checkingAuth || configLoading || (baseLoading && staff.length === 0) || (recordsLoading && records.length === 0);
  const timelineColumnCount = Math.max(1, timelineStaff.length);
  const timelineGridTemplate = `${TIMELINE_AXIS_WIDTH}px repeat(${timelineColumnCount}, minmax(260px, 1fr))`;
  const timelineMinWidth = Math.max(820, TIMELINE_AXIS_WIDTH + timelineColumnCount * 300);
  const nowLineTop = nowMinute !== null ? (nowMinute - timelineStartMinute) * minutePx : null;

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
    <main className="eco-page eco-page--wide eco-records-page">
      <div className="eco-records-stack">
        <section className="eco-page-head eco-records-head">
          <div>
            <div className="eco-page-crumbs">
              <span>CRM</span>
              <span className="sep">/</span>
              <span className="cur">Журнал записей</span>
            </div>
            <div className="eco-title-row">
              <h1 className="eco-page-title">Журнал записей</h1>
              <EcoBadge tone="success" dot>
                YCLIENTS
              </EcoBadge>
              <EcoBadge tone="neutral">{dayTimeline.length} {dayTimeline.length === 1 ? "запись" : dayTimeline.length > 1 && dayTimeline.length < 5 ? "записи" : "записей"}</EcoBadge>
            </div>
            <p className="eco-page-subtitle">
              {companyTitle} ({companyId || "—"})
            </p>
          </div>
          <div className="eco-page-actions">
            <Link href="/crm" className="eco-btn eco-btn--secondary">
              <ArrowLeft size={15} />
              К воронке
            </Link>
            <EcoButton variant="primary" type="button" onClick={() => openCreateForm()}>
              <Plus size={15} />
              Новая запись
            </EcoButton>
          </div>
        </section>

        <section className="eco-records-toolbar" aria-label="Панель календаря">
          <div className="eco-journal-date-nav eco-records-date-nav">
            <button type="button" className="eco-icon-btn" onClick={() => setScheduleDate((value) => addDays(value, -1))} aria-label="Предыдущий день">
              <ChevronLeft size={15} />
            </button>
            <div className="eco-records-date-picker">
              <button
                type="button"
                className="eco-journal-date-card eco-records-date-card eco-records-date-trigger"
                onClick={() => setDatePickerOpen((value) => !value)}
              >
                <CalendarDays size={16} />
                <span>
                  <strong>{formatScheduleTitle(scheduleDate)}</strong>
                  <small>{isToday(scheduleDate) ? "сегодня" : "рабочий день"}</small>
                </span>
              </button>
              {datePickerOpen ? (
                <div className="eco-records-month-popover">
                  <div className="eco-records-month-head">
                    <button type="button" className="eco-icon-btn" onClick={() => setCalendarMonth((value) => addMonths(value, -1))} aria-label="Предыдущий месяц">
                      <ChevronLeft size={14} />
                    </button>
                    <strong>
                      {new Intl.DateTimeFormat("ru-RU", {
                        timeZone: SERVICE_TIME_ZONE,
                        month: "long",
                        year: "numeric",
                      }).format(new Date(`${calendarMonth}T00:00:00`))}
                    </strong>
                    <button type="button" className="eco-icon-btn" onClick={() => setCalendarMonth((value) => addMonths(value, 1))} aria-label="Следующий месяц">
                      <ChevronRight size={14} />
                    </button>
                    <button type="button" onClick={() => setScheduleDate(toDateInputValue(new Date()))}>Сегодня</button>
                  </div>
                  {monthLoading ? <div className="eco-records-month-state">Загружаю загрузку дней…</div> : null}
                  {monthError ? <div className="eco-records-month-state is-error">{monthError}</div> : null}
                  <div className="eco-records-month-weekdays">
                    {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <span key={day}>{day}</span>)}
                  </div>
                  <div className="eco-records-month-grid">
                    {calendarDays.map((day) => {
                      const stat = monthLoadByDate.get(day);
                      const tone = workloadTone(stat);
                      const inMonth = day.startsWith(calendarMonth.slice(0, 7));
                      const title = stat
                        ? `${formatScheduleTitle(day)}: записей ${stat.recordCount}; ${loadLabel(stat)}; свободно ${durationLabel(stat.freeMinutes)}${stat.nearestFreeMinute != null ? `; ближайшее ${formatMinute(stat.nearestFreeMinute)}` : ""}`
                        : `${formatScheduleTitle(day)}: нет данных`;
                      return (
                        <button
                          key={day}
                          type="button"
                          title={title}
                          className={cx(
                            "eco-records-month-day",
                            `is-${tone}`,
                            !inMonth && "is-outside",
                            day === scheduleDate && "is-selected",
                            isToday(day) && "is-today"
                          )}
                          onClick={() => {
                            setScheduleDate(day);
                            setDatePickerOpen(false);
                          }}
                        >
                          <span>{Number(day.slice(8, 10))}</span>
                          <strong>{stat?.recordCount ?? 0}</strong>
                          <small>{loadLabel(stat)}</small>
                        </button>
                      );
                    })}
                  </div>
                  <div className="eco-records-month-legend">
                    <span><i className="is-free" /> свободно</span>
                    <span><i className="is-busy" /> средне</span>
                    <span><i className="is-full" /> перегружено</span>
                  </div>
                </div>
              ) : null}
            </div>
            <button type="button" className="eco-icon-btn" onClick={() => setScheduleDate((value) => addDays(value, 1))} aria-label="Следующий день">
              <ChevronRight size={15} />
            </button>
          </div>

          <EcoButton type="button" onClick={() => setScheduleDate(toDateInputValue(new Date()))}>
            Сегодня
          </EcoButton>

          <label className="eco-select-chip eco-records-control">
            <span>Бокс / сотрудник</span>
            <select value={timelineStaffId} onChange={(event) => setTimelineStaffId(event.target.value)} className="eco-select-inline">
              <option value="">Все боксы</option>
              {staff.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="eco-records-search">
            <Search size={15} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Клиент, телефон, авто, услуга, отгрузка"
            />
          </label>

          <EcoButton type="button" onClick={() => void refreshRecords()} disabled={refreshing || recordsLoading}>
            {refreshing || recordsLoading ? <Loader2 size={15} className="eco-spin" /> : <RefreshCw size={15} />}
            Обновить
          </EcoButton>

          <div className="eco-records-confirmed">
            <EcoStatusDot tone="success" />
            <span>Подтверждено</span>
            <strong>{confirmedCount}</strong>
          </div>

          <div className="eco-seg eco-records-view-toggle" aria-label="Вид журнала">
            <button type="button" className={cx("eco-seg-btn", viewMode === "timeline" && "is-active")} onClick={() => setViewMode("timeline")}>
              <Columns3 size={14} />
              Таймлайн
            </button>
            <button type="button" className={cx("eco-seg-btn", viewMode === "list" && "is-active")} onClick={() => setViewMode("list")}>
              <List size={14} />
              Список
            </button>
          </div>
        </section>

        <section className="eco-records-filterbar" aria-label="Фильтры записей">
          <label className="eco-select-chip">
            <span>Статус</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="eco-select-inline">
              <option value="all">Все</option>
              {Object.entries(STATUS_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </select>
          </label>
          <label className="eco-select-chip">
            <span>Источник</span>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)} className="eco-select-inline">
              <option value="all">Все</option>
              <option value="yclients">YCLIENTS</option>
              <option value="online">YCLIENTS online</option>
              <option value="local">Локально</option>
            </select>
          </label>
          <label className="eco-select-chip">
            <span>Отгрузки</span>
            <select value={shipmentFilter} onChange={(event) => setShipmentFilter(event.target.value as typeof shipmentFilter)} className="eco-select-inline">
              <option value="all">Все</option>
              <option value="with">Есть отгрузка</option>
              <option value="without">Нет отгрузки</option>
            </select>
          </label>
        </section>

        {nextFreeCards.length > 0 ? (
          <section className="eco-records-availability" aria-label="Ближайшие свободные окна">
            {nextFreeCards.map(({ staffItem, boxLabel, next, totalFree }) => (
              <div key={staffItem.id} className={cx("eco-records-availability-item", next && "is-open")}>
                <div>
                  <span>{boxLabel}</span>
                  <strong>{staffItem.name}</strong>
                  {next ? (
                    <p>
                      Ближайшее окно: <b>{formatMinute(next.start)}–{formatMinute(next.end)}</b> · свободно {durationLabel(next.end - next.start)}
                      {totalFree > next.end - next.start ? ` · за день ${durationLabel(totalFree)}` : ""}
                    </p>
                  ) : (
                    <p>Свободных окон сегодня нет</p>
                  )}
                </div>
                <EcoButton type="button" size="sm" variant="primary" disabled={!next} onClick={() => next && openQuickCreateFromMinute(staffItem.id, next.start)}>
                  <Plus size={14} />
                  Записать
                </EcoButton>
              </div>
            ))}
          </section>
        ) : null}

        {error ? (
          <section className="eco-records-error">
            <AlertTriangle size={18} />
            <div>
              <strong>Не удалось загрузить журнал записей</strong>
              <p>{error || "Проверьте подключение к YCLIENTS или локальной базе."}</p>
            </div>
            <EcoButton type="button" size="sm" onClick={() => void refreshRecords()}>
              Повторить
            </EcoButton>
          </section>
        ) : null}

        {initialLoading ? (
          <section className="eco-records-layout">
            <div className="eco-records-calendar">
              <SkeletonBlock className="h-10" />
              <div className="grid grid-cols-3 gap-3">
                <SkeletonBlock className="h-[520px]" />
                <SkeletonBlock className="h-[520px]" />
                <SkeletonBlock className="h-[520px]" />
              </div>
            </div>
            <aside className="eco-records-details">
              <SkeletonBlock className="h-24" />
              <SkeletonBlock className="h-36" />
              <SkeletonBlock className="h-44" />
            </aside>
          </section>
        ) : (
          <section className="eco-records-layout">
            <div className="eco-records-calendar">
              {viewMode === "timeline" ? (
                <>
                  {dayTimeline.length === 0 ? (
                    <div className="eco-records-empty-banner">
                      <CalendarCheck size={18} />
                      <div>
                        <strong>Записей на этот день нет</strong>
                        <span>Кликните по свободному времени в сетке, чтобы создать запись.</span>
                      </div>
                      <EcoButton variant="primary" type="button" size="sm" onClick={() => openCreateForm()}>
                        <Plus size={14} />
                        Новая запись
                      </EcoButton>
                    </div>
                  ) : null}
                  <div className="eco-records-timeline-shell">
                  <div className="eco-records-timeline" style={{ minWidth: `${timelineMinWidth}px` }}>
                    <div className="eco-records-timeline-head" style={{ gridTemplateColumns: timelineGridTemplate }}>
                      <div>Время</div>
                      {timelineStaff.map((staffItem, index) => (
                        <div key={`head-${staffItem.id}`}>
                          <span>{getResourceKicker(staffItem.name, index)}</span>
                          <strong>{staffItem.name}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="eco-records-timeline-grid" style={{ gridTemplateColumns: timelineGridTemplate, height: `${timelineHeight}px` }}>
                      <div className="eco-records-time-axis">
                        {hourMarks.map((minute) => (
                          <div key={`time-${minute}`} style={{ top: `${(minute - timelineStartMinute) * minutePx}px` }}>
                            {formatMinute(minute)}
                          </div>
                        ))}
                        {nowLineTop !== null ? (
                          <div className="eco-records-now-label" style={{ top: `${nowLineTop}px` }}>
                            сейчас
                          </div>
                        ) : null}
                      </div>
                      {nowLineTop !== null ? <div className="eco-records-now-line" style={{ top: `${nowLineTop}px`, left: `${TIMELINE_AXIS_WIDTH}px` }} /> : null}

                      {timelineStaff.map((staffItem) => {
                        const staffBlocks = positionedByStaff.get(staffItem.id) ?? [];
                        const activeInteraction = timelineInteraction?.staffId === staffItem.id ? timelineInteraction : null;
                        const activeRecord = activeInteraction ? dayTimeline.find((record) => record.id === activeInteraction.recordId) : null;
                        return (
                          <div
                            key={`col-${staffItem.id}`}
                            className="eco-records-timeline-col"
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
                          >
                            {hourMarks.map((minute) => (
                              <div key={`line-${staffItem.id}-${minute}`} className="eco-records-hour-line" style={{ top: `${(minute - timelineStartMinute) * minutePx}px` }} />
                            ))}
                            {halfHourMarks.map((minute) => (
                              <div key={`half-${staffItem.id}-${minute}`} className="eco-records-half-line" style={{ top: `${(minute - timelineStartMinute) * minutePx}px` }} />
                            ))}
                            {hoveredSlot?.staffId === staffItem.id ? (
                              <div
                                className="eco-records-hover-slot"
                                style={{
                                  top: `${Math.max(0, (hoveredSlot.minute - timelineStartMinute) * minutePx)}px`,
                                  height: `${Math.max(34, MIN_SLOT_MINUTES * minutePx)}px`,
                                }}
                              >
                                <span>+ Создать запись · {formatMinute(hoveredSlot.minute)}</span>
                              </div>
                            ) : null}
                            {activeInteraction && activeRecord ? (
                              <div
                                className="eco-records-drag-target"
                                style={{
                                  top: `${Math.max(0, (activeInteraction.targetStartMinute - timelineStartMinute) * minutePx)}px`,
                                  height: `${Math.max(36, (activeInteraction.targetEndMinute - activeInteraction.targetStartMinute) * minutePx)}px`,
                                }}
                              >
                                <span>
                                  {formatMinute(activeInteraction.targetStartMinute)}–{formatMinute(activeInteraction.targetEndMinute)}
                                </span>
                                <strong>{activeInteraction.kind === "resize" ? "Новая длительность" : "Новое время"}</strong>
                              </div>
                            ) : null}
                            {staffBlocks.map((block) => {
                              const selected = selectedRecordId === block.id;
                              const interacting = timelineInteraction?.recordId === block.id;
                              const linkedDeal = crmDealByRecordId[String(block.id)];
                              const vehicleName = vehicleLabel(block.vehicle);
                              const title = [
                                `${block.startedAtText}–${block.endedAtText}`,
                                block.serviceTitle,
                                block.clientName,
                                vehicleName,
                                formatPhone(block.phone),
                                block.statusLabel,
                                block.sourceLabel,
                              ]
                                .filter(Boolean)
                                .join(" · ");
                              const laneCount = Math.max(1, block.laneCount);
                              const laneGap = EVENT_LANE_GAP_PX;
                              const laneGapTotal = (laneCount - 1) * laneGap;
                              const laneInset = (EVENT_GUTTER_PX * 2 + laneGapTotal) / laneCount;
                              const laneWidth = `calc(${100 / laneCount}% - ${laneInset}px)`;
                              const laneLeft =
                                laneCount > 1
                                  ? `calc(${EVENT_GUTTER_PX}px + ${(100 / laneCount) * block.lane}% + ${(laneGap - laneInset) * block.lane}px)`
                                  : `${EVENT_GUTTER_PX}px`;
                              const showVehicle = block.displayMode === "long" || block.displayMode === "normal";
                              const secondaryText = block.displayMode === "mini"
                                ? block.clientName || shortServiceTitle(block.serviceTitle)
                                : [
                                    block.clientName,
                                    showVehicle ? vehicleName : "",
                                    block.displayMode === "compact" ? block.statusLabel : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ");
                              return (
                                <button
                                  key={`block-${staffItem.id}-${block.id}`}
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (timelineInteractionRef.current?.recordId === block.id) return;
                                    setSelectedRecordId(block.id);
                                  }}
                                  onPointerDown={(event) => startTimelineInteraction("drag", block, event)}
                                  className={cx(
                                    "eco-record-card",
                                    `eco-record-card--${block.statusKey}`,
                                    `eco-record-card--${block.displayMode}`,
                                    laneCount > 1 && "is-overlap",
                                    selected && "is-selected",
                                    interacting && "is-interacting"
                                  )}
                                  title={title}
                                  style={{
                                    top: `${block.topPx}px`,
                                    height: `${block.heightPx}px`,
                                    left: laneLeft,
                                    right: laneCount === 1 ? `${EVENT_GUTTER_PX}px` : "auto",
                                    width: laneCount > 1 ? laneWidth : undefined,
                                  }}
                                >
                                  <span className="eco-record-card__time">{block.startedAtText}–{block.endedAtText}</span>
                                  <strong className="eco-record-card__service">{shortServiceTitle(block.serviceTitle)}</strong>
                                  {secondaryText ? <span className="eco-record-card__client">{secondaryText}</span> : null}
                                  {block.displayMode === "normal" || block.displayMode === "long" ? (
                                    <small>
                                      {block.displayMode === "long" && block.phone ? `${formatPhone(block.phone)} · ` : ""}
                                      {block.statusLabel}
                                    </small>
                                  ) : null}
                                  {block.displayMode === "long" ? <i>{block.sourceLabel}</i> : null}
                                  {linkedDeal ? <span className="eco-record-card__case">Есть дело</span> : null}
                                  <span
                                    className="eco-record-card__resize"
                                    aria-hidden="true"
                                    onPointerDown={(event) => startTimelineInteraction("resize", block, event)}
                                  />
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                </>
              ) : (
                <div className="eco-records-list">
                  {filteredTimeline.length === 0 ? (
                    <div className="eco-records-empty">
                      <CalendarCheck size={28} />
                      <strong>Записей на этот день нет</strong>
                      <p>Переключитесь на таймлайн и кликните по свободному времени.</p>
                      <EcoButton variant="primary" type="button" onClick={() => setViewMode("timeline")}>
                        <CalendarDays size={15} />
                        Открыть таймлайн
                      </EcoButton>
                    </div>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Время</th>
                          <th>Клиент</th>
                          <th>Телефон</th>
                          <th>Авто</th>
                          <th>Услуга</th>
                          <th>Бокс / сотрудник</th>
                          <th>Статус</th>
                          <th>Отгрузка</th>
                          <th>Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTimeline.map((record) => {
                          const phone = normalizePhone(record.phone);
                          const shipments = phone ? shipmentLookupByPhone[phone]?.rows ?? [] : [];
                          const linkedDeal = crmDealByRecordId[String(record.id)];
                          return (
                            <tr key={record.id} className={selectedRecordId === record.id ? "is-selected" : undefined}>
                              <td>{record.startedAtText}–{record.endedAtText}</td>
                              <td>{record.clientName}</td>
                              <td>{formatPhone(record.phone)}</td>
                              <td>{vehicleLabel(record.vehicle) || "—"}</td>
                              <td>{record.serviceTitle}</td>
                              <td>{record.staffName}</td>
                              <td><span className={cx("eco-record-status", `eco-record-status--${record.statusKey}`)}>{record.statusLabel}</span></td>
                              <td>
                                {shipments[0] ? (
                                  <Link href={shipmentHref(shipments[0])}>{shipments[0].name}</Link>
                                ) : (
                                  <button type="button" disabled={creatingShipmentRecordId === record.id} onClick={() => void handleCreateShipmentFromRecord(record)}>
                                    {creatingShipmentRecordId === record.id ? "Создаю…" : "Создать"}
                                  </button>
                                )}
                              </td>
                              <td>
                                <button type="button" onClick={() => setSelectedRecordId(record.id)}>Открыть</button>
                                {linkedDeal ? (
                                  <Link href={`/crm?dealId=${encodeURIComponent(linkedDeal.id)}`}>Дело</Link>
                                ) : (
                                  <button type="button" disabled={creatingCaseRecordId === record.id} onClick={() => void handleCreateCaseFromRecord(record)}>
                                    {creatingCaseRecordId === record.id ? "Создаю…" : "В дела"}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              <div className="eco-records-mobile-cards">
                {filteredTimeline.map((record) => (
                  <button key={`mobile-${record.id}`} type="button" onClick={() => setSelectedRecordId(record.id)} className={cx("eco-records-mobile-card", selectedRecordId === record.id && "is-selected")}>
                    <span>{record.startedAtText}–{record.endedAtText}</span>
                    <strong>{record.serviceTitle}</strong>
                    <small>{record.clientName} · {formatPhone(record.phone)}</small>
                    <i className={cx("eco-record-status", `eco-record-status--${record.statusKey}`)}>{record.statusLabel}</i>
                    {crmDealByRecordId[String(record.id)] ? <em>Есть дело</em> : null}
                  </button>
                ))}
              </div>
            </div>

            <aside className="eco-records-details">
              {selectedTimelineRecord ? (
                <div className="eco-records-details-stack">
                  <div className="eco-records-details-head">
                    <div>
                      <span>{formatScheduleTitle(scheduleDate)}</span>
                      <strong>{selectedTimelineRecord.startedAtText}–{selectedTimelineRecord.endedAtText}</strong>
                    </div>
                    <span className={cx("eco-record-status", `eco-record-status--${selectedTimelineRecord.statusKey}`)}>
                      {selectedTimelineRecord.statusLabel}
                    </span>
                  </div>

                  <section className="eco-records-detail-block">
                    <SectionTitle icon={<UserRound size={15} />} title="Клиент" action={<Link href={`/clients/counterparties?search=${encodeURIComponent(selectedTimelineRecord.clientName)}`}>Карточка</Link>} />
                    <div className="eco-records-detail-main">
                      <strong>{selectedTimelineRecord.clientName}</strong>
                      <span>{formatPhone(selectedTimelineRecord.phone)}</span>
                    </div>
                    <button type="button" className="eco-records-inline-action" onClick={() => void copyPhone(selectedTimelineRecord.phone)}>
                      <Copy size={14} />
                      Скопировать телефон
                    </button>
                  </section>

                  <section className="eco-records-detail-block">
                    <SectionTitle icon={<Car size={15} />} title="Автомобиль" />
                    <dl className="eco-records-detail-list">
                      <div><dt>Модель</dt><dd>{selectedTimelineRecord.vehicle.model || "Не указана"}</dd></div>
                      <div><dt>Госномер</dt><dd>{selectedTimelineRecord.vehicle.plate || "—"}</dd></div>
                      <div><dt>VIN</dt><dd>{selectedTimelineRecord.vehicle.vin || "—"}</dd></div>
                    </dl>
                  </section>

                  <section className="eco-records-detail-block">
                    <SectionTitle icon={<Wrench size={15} />} title="Услуги" />
                    <div className="eco-records-services-list">
                      {(selectedTimelineRecord.serviceTitles.length ? selectedTimelineRecord.serviceTitles : [selectedTimelineRecord.serviceTitle]).map((service) => (
                        <span key={service}>{service}</span>
                      ))}
                    </div>
                    <p className="eco-records-muted">Длительность: {durationLabel(selectedTimelineRecord.endMinute - selectedTimelineRecord.startMinute)}</p>
                  </section>

                  <section className="eco-records-detail-block">
                    <SectionTitle icon={<MessageSquare size={15} />} title="Комментарии" action={<button type="button" onClick={() => setCommentDialogOpen(true)}>Открыть</button>} />
                    <p>{selectedTimelineRecord.comment || "Комментария клиента нет"}</p>
                    {selectedTimelineRecord.internalComment ? <small>Внутренний: {selectedTimelineRecord.internalComment}</small> : null}
                  </section>

                  <section className="eco-records-detail-block">
                    <SectionTitle
                      icon={<PackagePlus size={15} />}
                      title="Отгрузки"
                      action={
                        <button
                          type="button"
                          disabled={creatingShipmentRecordId === selectedTimelineRecord.id}
                          onClick={() => void handleCreateShipmentFromRecord(selectedTimelineRecord)}
                        >
                          {creatingShipmentRecordId === selectedTimelineRecord.id ? "Создаю…" : "Создать из записи"}
                        </button>
                      }
                    />
                    {selectedShipmentsLoading ? <p className="eco-records-muted">Проверяю связанные отгрузки…</p> : null}
                    {selectedShipmentsError ? <p className="eco-records-warning">Отгрузки не загрузились</p> : null}
                    {!selectedShipmentsLoading && selectedShipments.length === 0 ? (
                      <div className="eco-records-empty-inline">
                        <span>Связанных отгрузок нет</span>
                        <button
                          type="button"
                          disabled={creatingShipmentRecordId === selectedTimelineRecord.id}
                          onClick={() => void handleCreateShipmentFromRecord(selectedTimelineRecord)}
                        >
                          {creatingShipmentRecordId === selectedTimelineRecord.id ? "Создаю…" : "Создать отгрузку из записи"}
                        </button>
                      </div>
                    ) : null}
                    {selectedShipments.length > 0 ? (
                      <div className="eco-records-shipment-list">
                        {selectedShipments.map((shipment) => (
                          <Link key={shipment.id} href={shipmentHref(shipment)}>
                            <strong>{shipment.name}</strong>
                            <span>{formatShipmentDate(shipment.momentAt || shipment.documentDate)} · {formatRubles(shipment.sumCents)} ₽ · {shipment.applicable ? "проведена" : "черновик"}</span>
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </section>

                  <section className="eco-records-detail-block">
                    <SectionTitle
                      icon={<ClipboardList size={15} />}
                      title="Дело клиента"
                      action={
                        selectedRecordDeal ? (
                          <Link href={`/crm?dealId=${encodeURIComponent(selectedRecordDeal.id)}`}>Открыть дело</Link>
                        ) : (
                          <button
                            type="button"
                            disabled={creatingCaseRecordId === selectedTimelineRecord.id}
                            onClick={() => void handleCreateCaseFromRecord(selectedTimelineRecord)}
                          >
                            {creatingCaseRecordId === selectedTimelineRecord.id ? "Создаю…" : "Добавить в дела"}
                          </button>
                        )
                      }
                    />
                    {crmDealsLoading ? <p className="eco-records-muted">Проверяю клиентские дела…</p> : null}
                    {crmDealsError ? <p className="eco-records-warning">Дела клиентов не загрузились</p> : null}
                    {selectedRecordDeal ? (
                      <div className="eco-records-case-link">
                        <strong>{selectedRecordDeal.title}</strong>
                        <span>{selectedRecordDeal.nextAction || selectedRecordDeal.status || "Следующий шаг не указан"}</span>
                        <small>{formatCaseDate(selectedRecordDeal.nextContactAt)} · {selectedRecordDeal.responsibleLogin || "без ответственного"}</small>
                      </div>
                    ) : (
                      <div className="eco-records-empty-inline">
                        <span>По этой записи нет клиентского дела</span>
                        <button
                          type="button"
                          disabled={creatingCaseRecordId === selectedTimelineRecord.id}
                          onClick={() => void handleCreateCaseFromRecord(selectedTimelineRecord)}
                        >
                          {creatingCaseRecordId === selectedTimelineRecord.id ? "Создаю…" : "Создать дело"}
                        </button>
                      </div>
                    )}
                  </section>

                  <section className="eco-records-detail-block">
                    <SectionTitle icon={<RefreshCw size={15} />} title="Синхронизация" />
                    <dl className="eco-records-detail-list">
                      <div><dt>Источник</dt><dd>{selectedTimelineRecord.sourceLabel}</dd></div>
                      <div><dt>Статус</dt><dd>{selectedTimelineRecord.syncLabel}</dd></div>
                      <div><dt>Обновлено</dt><dd>{refreshing ? "обновление…" : "последняя загрузка журнала"}</dd></div>
                    </dl>
                  </section>

                  <div className="eco-records-detail-actions">
                    {selectedTimelineRecord.statusKey === "new" || selectedTimelineRecord.statusKey === "waiting" ? (
                      <EcoButton type="button" variant="primary" onClick={() => void handleConfirmRecord()}>
                        <CheckCircle2 size={15} />
                        Подтвердить
                      </EcoButton>
                    ) : null}
                    <EcoButton type="button" onClick={() => selectedRecordItem && openEditForm(selectedTimelineRecord, selectedRecordItem)}>
                      <Edit3 size={15} />
                      Редактировать
                    </EcoButton>
                    <EcoButton
                      type="button"
                      disabled={creatingShipmentRecordId === selectedTimelineRecord.id}
                      onClick={() => void handleCreateShipmentFromRecord(selectedTimelineRecord)}
                    >
                      <PackagePlus size={15} />
                      {creatingShipmentRecordId === selectedTimelineRecord.id ? "Создаю…" : "Создать отгрузку"}
                    </EcoButton>
                    {selectedRecordDeal ? (
                      <Link className="eco-btn" href={`/crm?dealId=${encodeURIComponent(selectedRecordDeal.id)}`}>
                        <ClipboardList size={15} />
                        Открыть дело
                      </Link>
                    ) : (
                      <EcoButton
                        type="button"
                        disabled={creatingCaseRecordId === selectedTimelineRecord.id}
                        onClick={() => void handleCreateCaseFromRecord(selectedTimelineRecord)}
                      >
                        <ClipboardList size={15} />
                        {creatingCaseRecordId === selectedTimelineRecord.id ? "Создаю…" : "Добавить в дела"}
                      </EcoButton>
                    )}
                    <EcoButton type="button" variant="danger" onClick={() => void handleCancelRecord()}>
                      <Ban size={15} />
                      Отменить запись
                    </EcoButton>
                  </div>
                </div>
              ) : (
                <div className="eco-records-details-empty">
                  <CalendarCheck size={24} />
                  <strong>Выберите запись</strong>
                  <p>Кликните по карточке в таймлайне или по строке списка, чтобы увидеть клиента, авто, услуги и отгрузки.</p>
                  <EcoButton type="button" variant="primary" onClick={() => openCreateForm()}>
                    <Plus size={15} />
                    Новая запись
                  </EcoButton>
                </div>
              )}
            </aside>
          </section>
        )}
      </div>

      {formOpen ? (
        <div className="eco-records-drawer-backdrop" role="dialog" aria-modal="true">
          <div className="eco-records-drawer">
            <div className="eco-records-drawer-head">
              <div>
                <span>{formMode === "create" ? "Новая запись" : "Редактирование"}</span>
                <strong>{formMode === "create" ? "Создать запись" : "Изменить запись"}</strong>
              </div>
              <button type="button" onClick={() => setFormOpen(false)} aria-label="Закрыть">
                <X size={18} />
              </button>
            </div>

            <div className="eco-records-form">
              <section>
                <SectionTitle icon={<Clock3 size={15} />} title="Время и ресурс" />
                <div className="eco-records-form-grid">
                  <label>
                    <span>Дата</span>
                    <input type="date" value={formDate} onChange={(event) => {
                      const nextStart = replaceDatePart(form.datetime, event.target.value);
                      const nextEnd = replaceDatePart(form.datetimeEnd || addSecondsToDateTimeLocal(nextStart, selectedServiceDurationSeconds), event.target.value);
                      setForm((prev) => ({ ...prev, datetime: nextStart, datetimeEnd: nextEnd, allowOverlap: false }));
                    }} />
                  </label>
                  <label>
                    <span>Начало</span>
                    <input type="time" value={formStartTime} onChange={(event) => {
                      const nextStart = replaceTimePart(form.datetime, event.target.value, scheduleDate);
                      setForm((prev) => ({ ...prev, datetime: nextStart, datetimeEnd: addSecondsToDateTimeLocal(nextStart, selectedServiceDurationSeconds), allowOverlap: false }));
                    }} />
                  </label>
                  <label>
                    <span>Окончание</span>
                    <input type="time" value={formEndTime} onChange={(event) => setForm((prev) => ({ ...prev, datetimeEnd: replaceTimePart(prev.datetimeEnd || prev.datetime, event.target.value, formDate), allowOverlap: false }))} />
                  </label>
                  <label>
                    <span>Бокс / сотрудник</span>
                    <select value={form.staffId} onChange={(event) => setForm((prev) => ({ ...prev, staffId: event.target.value, allowOverlap: false }))}>
                      <option value="">Выберите</option>
                      {staff.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className={cx("eco-records-availability-check", (!formTimeValidation.ok || formTimeValidation.warning) && "is-warning")}>
                  {!formTimeValidation.ok && formConflicts.length === 0 ? (
                    <>
                      <AlertTriangle size={16} />
                      <div>
                        <strong>{formTimeValidation.message}</strong>
                        <p>Проверьте рабочие часы, дату и выбранный ресурс.</p>
                      </div>
                    </>
                  ) : formConflicts.length > 0 ? (
                    <>
                      <AlertTriangle size={16} />
                      <div>
                        <strong>В это время уже есть запись</strong>
                        <p>{formConflicts.map((item) => `${item.startedAtText}–${item.endedAtText} · ${item.clientName}`).join("; ")}</p>
                        {nearestFormSlots.length > 0 ? (
                          <div className="eco-records-slot-suggestions">
                            {nearestFormSlots.map((slot) => (
                              <button key={`${slot.start}-${slot.end}`} type="button" onClick={() => {
                                const nextStart = `${formDate}T${formatMinute(slot.start)}`;
                                setForm((prev) => ({ ...prev, datetime: nextStart, datetimeEnd: addSecondsToDateTimeLocal(nextStart, selectedServiceDurationSeconds), allowOverlap: false }));
                              }}>
                                {formatMinute(slot.start)}–{formatMinute(slot.end)}
                              </button>
                            ))}
                          </div>
                        ) : null}
                        <label className="eco-records-overlap">
                          <input type="checkbox" checked={form.allowOverlap} onChange={(event) => setFormValue("allowOverlap", event.target.checked)} />
                          Разрешить пересечение явно
                        </label>
                      </div>
                    </>
                  ) : formTimeValidation.warning ? (
                    <>
                      <AlertTriangle size={16} />
                      <div>
                        <strong>{formTimeValidation.message}</strong>
                        <p>Локальная сетка не блокирует запись; окончательное окно проверит YCLIENTS.</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      <div>
                        <strong>Время свободно</strong>
                        <p>Длительность: {durationLabel(formDurationMinutes || Math.round(selectedServiceDurationSeconds / 60))}</p>
                      </div>
                    </>
                  )}
                </div>
              </section>

              <section>
                <SectionTitle icon={<Wrench size={15} />} title="Услуга" />
                <div className="eco-records-service-picker">
                  {services.map((service) => {
                    const id = String(service.id);
                    const selected = form.serviceIds.includes(id);
                    return (
                      <button key={service.id} type="button" className={selected ? "is-selected" : undefined} onClick={() => toggleService(id)}>
                        <strong>{service.title}</strong>
                        <span>{durationLabel(Math.round(getServiceDurationSeconds(service) / 60))} · {getServicePriceLabel(service)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <SectionTitle icon={<UserRound size={15} />} title="Клиент" />
                <div className="eco-records-client-field" ref={clientPickerRef}>
                <label>
                  <span>Поиск клиента</span>
                  <input
                    value={form.clientSearch}
                    onFocus={() => form.clientSearch.trim().length >= 2 && setClientDropdownOpen(true)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setForm((prev) => ({ ...prev, clientSearch: value, selectedClientId: "", clientName: value }));
                      setClientDropdownOpen(value.trim().length >= 2);
                    }}
                    placeholder="Имя или телефон"
                  />
                </label>
                {clientDropdownOpen ? (
                <div className="eco-records-client-options">
                  {clientSearchLoading ? <div className="eco-records-muted">Ищу клиентов…</div> : null}
                  {clientSearchError ? <div className="eco-records-warning">{clientSearchError}</div> : null}
                  {clientOptions.map((option) => (
                    <button key={option.id} type="button" className={form.selectedClientId === option.id ? "is-selected" : undefined} onClick={() => selectClient(option)}>
                      <strong>{option.name}</strong>
                      <span>{[option.matchLabel, option.subtitle || (option.source === "crm" ? "CRM" : "Журнал")].filter(Boolean).join(" · ")}</span>
                    </button>
                  ))}
                  {form.clientSearch.trim() && clientOptions.length === 0 && !clientSearchLoading ? (
                    <button type="button" onClick={() => {
                      setForm((prev) => ({ ...prev, clientName: prev.clientSearch.trim(), selectedClientId: "new" }));
                      setClientDropdownOpen(false);
                    }}>
                      <strong>Создать нового клиента</strong>
                      <span>{form.clientSearch.trim()}</span>
                    </button>
                  ) : null}
                </div>
                ) : null}
                </div>
                <div className="eco-records-form-grid">
                  <label>
                    <span>Имя</span>
                    <input value={form.clientName} onChange={(event) => setFormValue("clientName", event.target.value)} />
                  </label>
                  <label>
                    <span>Телефон</span>
                    <input value={form.clientPhone} onChange={(event) => setFormValue("clientPhone", event.target.value)} placeholder="79990000000" />
                  </label>
                  <label>
                    <span>Email</span>
                    <input value={form.clientEmail} onChange={(event) => setFormValue("clientEmail", event.target.value)} placeholder="optional" />
                  </label>
                </div>
                {selectedClientShipments.length > 0 ? (
                  <div className="eco-records-client-history">
                    <strong>История клиента</strong>
                    {selectedClientShipments.slice(0, 3).map((shipment) => (
                      <Link key={shipment.id} href={shipmentHref(shipment)}>{shipment.name} · {formatShipmentDate(shipment.momentAt)}</Link>
                    ))}
                  </div>
                ) : null}
              </section>

              <section>
                <SectionTitle icon={<Car size={15} />} title="Автомобиль" />
                <div className="eco-records-form-grid">
                  <label>
                    <span>Модель</span>
                    <input value={form.vehicleModel} onChange={(event) => setFormValue("vehicleModel", event.target.value)} placeholder="Mitsubishi ASX" />
                  </label>
                  <label>
                    <span>Госномер</span>
                    <input value={form.vehiclePlate} onChange={(event) => setFormValue("vehiclePlate", event.target.value)} placeholder="А123ВС39" />
                  </label>
                  <label>
                    <span>VIN</span>
                    <input value={form.vehicleVin} onChange={(event) => setFormValue("vehicleVin", event.target.value)} placeholder="VIN" />
                  </label>
                </div>
              </section>

              <section>
                <SectionTitle icon={<MessageSquare size={15} />} title="Комментарий" />
                <label>
                  <span>Комментарий клиента</span>
                  <textarea rows={3} value={form.comment} onChange={(event) => setFormValue("comment", event.target.value)} />
                </label>
                <label>
                  <span>Внутренний комментарий</span>
                  <textarea rows={2} value={form.internalComment} onChange={(event) => setFormValue("internalComment", event.target.value)} />
                </label>
              </section>

              {formMode === "edit" ? (
                <section>
                  <SectionTitle icon={<CheckCircle2 size={15} />} title="Статус" />
                  <div className="eco-records-status-picker">
                    {Object.entries(STATUS_META).map(([key, meta]) => (
                      <button key={key} type="button" className={form.statusKey === key ? "is-selected" : undefined} onClick={() => setFormValue("statusKey", key as AppointmentStatusKey)}>
                        <i style={{ background: meta.dot }} />
                        {meta.label}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {formError ? <div className="eco-records-form-error">{formError}</div> : null}
            </div>

            <div className="eco-records-drawer-footer">
              <EcoButton type="button" variant="primary" onClick={() => void handleSubmitRecord(false)} disabled={formSaving}>
                {formSaving ? <Loader2 size={15} className="eco-spin" /> : <CheckCircle2 size={15} />}
                {formMode === "create" ? "Создать запись" : "Сохранить"}
              </EcoButton>
              {formMode === "create" ? (
                <EcoButton type="button" onClick={() => void handleSubmitRecord(true)} disabled={formSaving}>
                  <PackagePlus size={15} />
                  Создать и открыть отгрузку
                </EcoButton>
              ) : null}
              <EcoButton type="button" variant="ghost" onClick={() => setFormOpen(false)}>
                Отмена
              </EcoButton>
            </div>
          </div>
        </div>
      ) : null}

      {commentDialogOpen && selectedTimelineRecord ? (
        <div className="eco-records-modal-backdrop" role="dialog" aria-modal="true">
          <div className="eco-records-comment-modal">
            <div className="eco-records-drawer-head">
              <div>
                <span>Комментарий к записи</span>
                <strong>{selectedTimelineRecord.startedAtText}–{selectedTimelineRecord.endedAtText} · {selectedTimelineRecord.clientName}</strong>
              </div>
              <button type="button" onClick={() => setCommentDialogOpen(false)} aria-label="Закрыть">
                <X size={18} />
              </button>
            </div>
            <div className="eco-records-comment-body">
              <p>{selectedTimelineRecord.comment || "Комментария клиента нет"}</p>
              {selectedTimelineRecord.internalComment ? <small>{selectedTimelineRecord.internalComment}</small> : null}
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className="eco-records-toast">{toast}</div> : null}
    </main>
  );
}
