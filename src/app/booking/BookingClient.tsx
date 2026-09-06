"use client";

import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Car,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Info,
  LoaderCircle,
  MapPin,
  Navigation,
  Phone,
  ShieldCheck,
  UserRound,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publicBookingBranchFromSearch } from "@/lib/booking/public-link";
import styles from "./booking.module.css";

type Branch = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  intro: string | null;
  bookingHorizonDays: number;
  workingHours: Array<{ weekday: number; isWorking: boolean; startTime: string | null; endTime: string | null }>;
};

type Service = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  requiresVin: boolean;
  requiresConfirmation: boolean;
  requiredFields: string[];
  pricing: { kind: "fixed" | "from"; amountCents: number; currency: string } | { kind: "vehicle_calculation" } | null;
};

type Slot = {
  startsAt: string;
  endsAt: string;
  localTime: string;
  durationMinutes: number;
  master: { membershipId: string; name: string; position: string | null };
};

type Availability = {
  localDate: string;
  durationMinutes: number;
  requiresVin: boolean;
  requiresConfirmation: boolean;
  slots: Slot[];
  reasonCode?: string;
  message?: string;
};

type NearestDay = { localDate: string; durationMinutes: number; slots: Slot[] };

type BookingResult = {
  id: string;
  branch: { id: string; name: string; timezone: string; address: string | null; phone: string | null };
  vehicle: { id: string | null; make: string; model: string; generation: string | null; year: number | null; plate: string | null; vin: string | null } | null;
  master: { membershipId: string; name: string; position: string | null } | null;
  services: Array<{ id: string | null; name: string; durationMinutes: number }>;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: string;
  confirmationState: string;
  requiresConfirmation: boolean;
};

type CreateResult = {
  booking: BookingResult;
  managementUrl: string;
  reused: boolean;
  notification: { state: "DELIVERED" | "QUEUED" | "NOT_CONFIRMED" | "NOT_AVAILABLE" };
};

type Draft = {
  savedAt: number;
  step: number;
  branchId: string;
  serviceIds: string[];
  localDate: string;
  name: string;
  phone: string;
  email: string;
  make: string;
  model: string;
  year: string;
  plate: string;
  vin: string;
  comment: string;
  idempotencyKey: string;
  lastSubmissionFingerprint: string;
  submissionUnknown: boolean;
};

class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const STEPS = ["Филиал", "Услуги", "Время", "Автомобиль и контакты"];
const DRAFT_KEY = "tgm-public-booking-draft-v2";
const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const SLOT_CONFLICT_CODES = new Set([
  "booking_slot_taken",
  "booking_outside_schedule",
  "booking_nonstandard_start",
  "booking_master_unavailable",
  "booking_master_service_mismatch",
]);

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string; code?: string; details?: unknown }) | null;
  if (!response.ok) {
    throw new ApiError(body?.error || "Не удалось выполнить запрос", body?.code || "booking_request_failed", response.status, body?.details);
  }
  if (!body) throw new ApiError("Сервис вернул пустой ответ", "booking_empty_response", response.status);
  return body;
}

function operationKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `booking-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function branchToday(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function dateLabel(value: string) {
  if (!value) return "Не выбрано";
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long" })
    .format(new Date(`${value}T12:00:00Z`));
}

function bookingDateLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function branchHoursLabel(hours: Branch["workingHours"]) {
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const byDay = new Map(hours.map((row) => [row.weekday, row]));
  return days.map((day, index) => {
    const row = byDay.get(index + 1);
    return row?.isWorking && row.startTime && row.endTime
      ? `${day} ${row.startTime}–${row.endTime}`
      : `${day} выходной`;
  }).join(" · ");
}

function requirementLabels(service: Service) {
  const fields = new Set(service.requiredFields ?? []);
  if (service.requiresVin) fields.add("vin");
  const names: Record<string, string> = { vin: "VIN", plate: "госномер", year: "год автомобиля", email: "email" };
  return [...fields].map((field) => names[field] ?? field);
}

function pricingLabel(pricing: Service["pricing"]) {
  if (!pricing) return null;
  if (pricing.kind === "vehicle_calculation") return "Стоимость работы рассчитывается по автомобилю; материалы отдельно";
  const currency = pricing.currency.toUpperCase() === "RUB" || /руб/iu.test(pricing.currency) ? "RUB" : pricing.currency;
  const amount = currency === "RUB"
    ? new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(pricing.amountCents / 100)
    : `${(pricing.amountCents / 100).toLocaleString("ru-RU")} ${pricing.currency}`;
  return `Работа: ${pricing.kind === "from" ? "от " : ""}${amount}; материалы отдельно`;
}

function errorCopy(error: unknown) {
  if (!(error instanceof ApiError)) return "Нет связи с сервером. Проверьте интернет и повторите попытку.";
  if (error.status === 429 || error.code === "booking_rate_limited") return "Слишком много запросов. Подождите немного и повторите.";
  if (SLOT_CONFLICT_CODES.has(error.code)) return error.message;
  if (error.status >= 500) return "Сервис записи временно недоступен. Заполненные данные сохранены.";
  return error.message;
}

export default function BookingClient() {
  const [step, setStep] = useState(1);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [localDate, setLocalDate] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [nearestDays, setNearestDays] = useState<NearestDay[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [plate, setPlate] = useState("");
  const [vin, setVin] = useState("");
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [nearestLoading, setNearestLoading] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [slotNotice, setSlotNotice] = useState("");
  const [submissionUnknown, setSubmissionUnknown] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(operationKey);
  const [lastSubmissionFingerprint, setLastSubmissionFingerprint] = useState("");
  const [created, setCreated] = useState<CreateResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const availabilityAbortRef = useRef<AbortController | null>(null);
  const servicesAbortRef = useRef<AbortController | null>(null);
  const activeAvailabilityKeyRef = useRef("");

  const branch = branches.find((item) => item.id === branchId) ?? null;
  const selectedServices = useMemo(
    () => services.filter((service) => serviceIds.includes(service.id)),
    [services, serviceIds],
  );
  const totalDuration = selectedServices.reduce((total, service) => total + service.durationMinutes, 0);
  const requiresVin = selectedServices.some((service) => service.requiresVin);
  const requiresConfirmation = selectedServices.some((service) => service.requiresConfirmation);
  const requiredFields = useMemo(() => {
    const fields = new Set(selectedServices.flatMap((service) => service.requiredFields ?? []));
    if (requiresVin) fields.add("vin");
    return fields;
  }, [requiresVin, selectedServices]);
  const availabilityKey = useMemo(() => JSON.stringify({
    branchId,
    serviceIds: [...serviceIds].sort(),
    localDate,
    durationMinutes: totalDuration,
    timezone: branch?.timezone ?? "",
  }), [branch?.timezone, branchId, localDate, serviceIds, totalDuration]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Draft;
        if (Date.now() - draft.savedAt <= DRAFT_TTL_MS) {
          setStep(Math.max(1, Math.min(3, Number(draft.step) || 1)));
          setBranchId(draft.branchId || "");
          setServiceIds(Array.isArray(draft.serviceIds) ? draft.serviceIds : []);
          setLocalDate(draft.localDate || "");
          setName(draft.name || "");
          setPhone(draft.phone || "");
          setEmail(draft.email || "");
          setMake(draft.make || "");
          setModel(draft.model || "");
          setYear(draft.year || "");
          setPlate(draft.plate || "");
          setVin(draft.vin || "");
          setComment(draft.comment || "");
          if (/^[A-Za-z0-9._~-]{16,128}$/u.test(draft.idempotencyKey || "")) setIdempotencyKey(draft.idempotencyKey);
          setLastSubmissionFingerprint(draft.lastSubmissionFingerprint || "");
          setSubmissionUnknown(Boolean(draft.submissionUnknown));
        } else {
          sessionStorage.removeItem(DRAFT_KEY);
        }
      }
    } catch {
      sessionStorage.removeItem(DRAFT_KEY);
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady || created) return;
    const draft: Draft = {
      savedAt: Date.now(), step, branchId, serviceIds, localDate, name, phone, email,
      make, model, year, plate, vin, comment, idempotencyKey, lastSubmissionFingerprint, submissionUnknown,
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [branchId, comment, created, draftReady, email, idempotencyKey, lastSubmissionFingerprint, localDate, make, model, name, phone, plate, serviceIds, step, submissionUnknown, vin, year]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/booking/branches", { signal: controller.signal })
      .then((response) => readJson<{ branches: Branch[] }>(response))
      .then((data) => {
        setBranches(data.branches);
        const requestedBranchId = publicBookingBranchFromSearch(window.location.search);
        const requestedBranch = requestedBranchId ? data.branches.find((item) => item.id === requestedBranchId) : null;
        if (requestedBranch) {
          setBranchId((current) => {
            if (current && current !== requestedBranch.id) setServiceIds([]);
            return requestedBranch.id;
          });
          setLocalDate(branchToday(requestedBranch.timezone));
          setStep(2);
        } else if (requestedBranchId) {
          setFormError("Филиал по этой ссылке сейчас недоступен. Выберите другой филиал.");
        } else {
          setBranchId((current) => data.branches.some((item) => item.id === current) ? current : "");
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFormError(errorCopy(error));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!branch) return;
    if (!localDate) setLocalDate(branchToday(branch.timezone));
  }, [branch, localDate]);

  useEffect(() => {
    servicesAbortRef.current?.abort();
    if (!branchId) {
      setServices([]);
      setServicesLoading(false);
      return;
    }
    const controller = new AbortController();
    servicesAbortRef.current = controller;
    setServicesLoading(true);
    setServices([]);
    fetch(`/api/public/booking/services?branchId=${encodeURIComponent(branchId)}`, { signal: controller.signal })
      .then((response) => readJson<{ services: Service[] }>(response))
      .then((data) => {
        setServices(data.services);
        const availableIds = new Set(data.services.map((service) => service.id));
        setServiceIds((current) => current.filter((id) => availableIds.has(id)));
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFormError(errorCopy(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setServicesLoading(false);
      });
    return () => controller.abort();
  }, [branchId]);

  const loadAvailability = useCallback(async () => {
    if (!branchId || !localDate || !serviceIds.length || !branch) return;
    availabilityAbortRef.current?.abort();
    const controller = new AbortController();
    availabilityAbortRef.current = controller;
    activeAvailabilityKeyRef.current = availabilityKey;
    const requestKey = availabilityKey;
    setAvailabilityLoading(true);
    setNearestLoading(false);
    setAvailability(null);
    setNearestDays([]);
    try {
      const exact = await readJson<Availability>(await fetch("/api/public/booking/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ branchId, localDate, serviceIds }),
      }));
      if (activeAvailabilityKeyRef.current !== requestKey) return;
      setAvailability(exact);
      setAvailabilityLoading(false);
      if (!exact.slots.length) {
        setNearestLoading(true);
        const nearest = await readJson<{ days: NearestDay[] }>(await fetch("/api/public/booking/nearest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ branchId, fromDate: localDate, serviceIds }),
        }));
        if (activeAvailabilityKeyRef.current !== requestKey) return;
        setNearestDays(nearest.days);
        setNearestLoading(false);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (activeAvailabilityKeyRef.current !== requestKey) return;
      setFormError(errorCopy(error));
    } finally {
      if (activeAvailabilityKeyRef.current === requestKey) {
        setAvailabilityLoading(false);
        setNearestLoading(false);
      }
    }
  }, [availabilityKey, branch, branchId, localDate, serviceIds]);

  useEffect(() => {
    if (step === 3) void loadAvailability();
    return () => availabilityAbortRef.current?.abort();
  }, [loadAvailability, step]);

  function chooseBranch(nextBranchId: string) {
    const next = branches.find((item) => item.id === nextBranchId);
    setBranchId(nextBranchId);
    setServiceIds([]);
    setServices([]);
    setLocalDate(next ? branchToday(next.timezone) : "");
    setAvailability(null);
    setNearestDays([]);
    setSelectedSlot(null);
    setSlotNotice("");
    setFormError("");
    setSubmissionUnknown(false);
  }

  function toggleService(serviceId: string) {
    setServiceIds((current) => current.includes(serviceId)
      ? current.filter((id) => id !== serviceId)
      : [...current, serviceId]);
    setAvailability(null);
    setNearestDays([]);
    setSelectedSlot(null);
    setSlotNotice("");
    setFormError("");
    setSubmissionUnknown(false);
  }

  function chooseDate(value: string) {
    setLocalDate(value);
    setAvailability(null);
    setNearestDays([]);
    setSelectedSlot(null);
    setSlotNotice("");
    setFormError("");
    setSubmissionUnknown(false);
  }

  function validationMessage(targetStep = step) {
    if (targetStep === 1 && !branchId) return "Выберите филиал, в который хотите приехать.";
    if (targetStep === 2 && !serviceIds.length) return "Выберите хотя бы одну услугу.";
    if (targetStep === 3 && !selectedSlot) return "Выберите свободное время визита.";
    if (targetStep === 4) {
      if (!make.trim() || !model.trim()) return "Укажите марку и модель автомобиля.";
      if (requiredFields.has("vin") && !vin.trim()) return "Для выбранной услуги нужен VIN автомобиля.";
      if (requiredFields.has("plate") && !plate.trim()) return "Для выбранной услуги нужен госномер автомобиля.";
      if (requiredFields.has("year") && !year.trim()) return "Для выбранной услуги нужен год выпуска автомобиля.";
      if (!name.trim()) return "Укажите, как к вам обращаться.";
      if (phone.replace(/\D/g, "").length < 10) return "Проверьте номер телефона.";
      if (requiredFields.has("email") && !email.trim()) return "Для выбранной услуги нужен email.";
    }
    return "";
  }

  function goNext() {
    const message = validationMessage(step);
    if (message) {
      setFormError(message);
      return;
    }
    setFormError("");
    setStep((current) => Math.min(4, current + 1));
  }

  function applyCreated(data: CreateResult) {
    setCreated(data);
    setSubmissionUnknown(false);
    sessionStorage.removeItem(DRAFT_KEY);
  }

  async function checkOriginalOperation() {
    if (!branchId || !idempotencyKey) return;
    setSubmitBusy(true);
    setFormError("");
    try {
      const result = await readJson<CreateResult>(await fetch("/api/public/booking/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, idempotencyKey }),
      }));
      applyCreated(result);
    } catch (error) {
      if (error instanceof ApiError && error.code === "booking_idempotency_result_not_found") {
        setSubmissionUnknown(false);
        setFormError("Исходная операция не была сохранена. Можно безопасно нажать «Записаться» ещё раз.");
      } else {
        setFormError(errorCopy(error));
      }
    } finally {
      setSubmitBusy(false);
    }
  }

  async function submitBooking() {
    const message = validationMessage(4);
    if (message) {
      setFormError(message);
      return;
    }
    if (!selectedSlot || !branchId) return;
    const basePayload = {
      branchId,
      serviceIds,
      masterMembershipId: selectedSlot.master.membershipId,
      startsAt: selectedSlot.startsAt,
      customerName: name.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      vehicle: { make: make.trim(), model: model.trim(), year: year.trim() || null, plate: plate.trim() || null, vin: vin.trim() || null },
      comment: comment.trim() || null,
      website: "",
    };
    const fingerprint = JSON.stringify(basePayload);
    let requestId = idempotencyKey;
    if (!requestId || (lastSubmissionFingerprint && lastSubmissionFingerprint !== fingerprint)) {
      requestId = operationKey();
      setIdempotencyKey(requestId);
    }
    setLastSubmissionFingerprint(fingerprint);
    setSubmitBusy(true);
    setSubmissionUnknown(false);
    setFormError("");
    try {
      const result = await readJson<CreateResult>(await fetch("/api/public/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...basePayload, idempotencyKey: requestId }),
      }));
      applyCreated(result);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setSubmissionUnknown(true);
        setFormError("Связь прервалась, и результат создания неизвестен. Сначала проверьте исходную операцию — повторную запись мы создавать не будем.");
      } else if (SLOT_CONFLICT_CODES.has(error.code)) {
        setSlotNotice(error.message);
        setSelectedSlot(null);
        setStep(3);
      } else {
        setFormError(errorCopy(error));
      }
    } finally {
      setSubmitBusy(false);
    }
  }

  async function copyManagementLink() {
    if (!created?.managementUrl) return;
    await navigator.clipboard.writeText(created.managementUrl);
    setCopied(true);
  }

  if (created) {
    const pending = created.booking.confirmationState === "PENDING";
    const notificationText = created.notification.state === "DELIVERED"
      ? "Ссылка управления отправлена."
      : created.notification.state === "QUEUED"
        ? "Уведомление со ссылкой поставлено в очередь."
        : created.notification.state === "NOT_AVAILABLE"
          ? "Автоматический канал уведомлений не настроен — сохраните ссылку ниже."
          : "Доставка уведомления не подтверждена — сохраните ссылку ниже.";
    const routeUrl = created.booking.branch.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(created.booking.branch.address)}`
      : null;
    return (
      <main className={styles.publicRoot}>
        <section className={styles.successPanel} aria-live="polite">
          <span className={styles.successIcon}><CheckCircle2 aria-hidden /></span>
          <h1>{pending ? "Заявка принята. Время предварительное" : "Вы записаны"}</h1>
          <p>{pending ? "Администратор проверит условия работ и подтвердит запись или свяжется для уточнения." : "Время закреплено в календаре сервиса."}</p>
          <div className={styles.confirmationFacts}>
            <span><CalendarDays aria-hidden /> {bookingDateLabel(created.booking.startsAt, created.booking.branch.timezone)}</span>
            <span><MapPin aria-hidden /> {[created.booking.branch.name, created.booking.branch.address].filter(Boolean).join(" · ")}</span>
            <span><Car aria-hidden /> {created.booking.vehicle ? `${created.booking.vehicle.make} ${created.booking.vehicle.model}` : "Автомобиль указан в заявке"}</span>
            <span><Wrench aria-hidden /> {created.booking.services.map((service) => service.name).join(", ")}</span>
            <span><Clock3 aria-hidden /> {durationLabel(created.booking.durationMinutes)}</span>
            <span><UserRound aria-hidden /> Мастер: {created.booking.master?.name ?? "будет назначен"}</span>
            <span><ShieldCheck aria-hidden /> {pending ? "Требуется подтверждение" : "Подтверждено"}</span>
            {created.booking.branch.phone && <span><Phone aria-hidden /> {created.booking.branch.phone}</span>}
          </div>
          <p className={styles.deliveryState}>{notificationText}</p>
          <div className={styles.successActions}>
            <a className={styles.primaryButton} href={created.managementUrl}>Открыть мою запись <ArrowRight aria-hidden /></a>
            <button className={styles.secondaryButton} type="button" onClick={() => void copyManagementLink()}><Copy aria-hidden /> {copied ? "Ссылка скопирована" : "Скопировать ссылку"}</button>
            {routeUrl && <a className={styles.secondaryButton} href={routeUrl} target="_blank" rel="noreferrer"><Navigation aria-hidden /> Построить маршрут</a>}
          </div>
          <small>Персональная ссылка открывает только эту запись. Не пересылайте её посторонним.</small>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.publicRoot}>
      <header className={styles.publicHeader}>
        <a className={styles.brand} href="/client-site" aria-label="Там где масло — на главную">
          <span aria-hidden>ТГМ</span><strong>Там где масло</strong>
        </a>
        <div><ShieldCheck aria-hidden /><span>Онлайн-запись<br /><small>без звонка и регистрации</small></span></div>
      </header>

      <section className={styles.bookingShell}>
        <div className={styles.intro}>
          <div><h1>Запись в сервис</h1><p>Выберите филиал, работы и свободное время. Данные автомобиля понадобятся только на последнем шаге.</p></div>
          {branch?.phone && <a href={`tel:${branch.phone.replace(/[^+\d]/g, "")}`}><Phone aria-hidden /> {branch.phone}</a>}
        </div>

        <div className={styles.progressHeader}>
          <nav className={styles.steps} aria-label="Шаги записи">
            {STEPS.map((label, index) => {
              const number = index + 1;
              return <button type="button" key={label} className={number === step ? styles.activeStep : number < step ? styles.doneStep : ""} disabled={number > step} onClick={() => number < step && setStep(number)}>
                <span>{number < step ? <Check aria-hidden /> : number}</span>{label}
              </button>;
            })}
          </nav>
          <div className={styles.mobileProgress}><div><strong>{STEPS[step - 1]}</strong><span>{step} из {STEPS.length}</span></div><i><span style={{ transform: `scaleX(${step / STEPS.length})` }} /></i></div>
        </div>

        <div className={styles.workspace}>
          <section className={styles.stage}>
            {loading ? <div className={styles.skeleton}><i /><i /><i /></div> : (
              <div className={styles.stageBody}>
                {step === 1 && <>
                  <div className={styles.stageHeading}><MapPin aria-hidden /><div><h2>Куда вы хотите приехать?</h2><p>У каждого филиала свой график и свободные окна.</p></div></div>
                  <div className={styles.choiceList}>
                    {branches.map((item) => <label key={item.id} className={item.id === branchId ? styles.selectedChoice : ""}>
                      <input type="radio" name="branch" checked={item.id === branchId} onChange={() => chooseBranch(item.id)} />
                      <span><strong>{item.name}</strong><small>{item.address || "Адрес уточняется"}</small><small>{branchHoursLabel(item.workingHours)}</small></span><Check aria-hidden />
                    </label>)}
                    {!branches.length && <div className={styles.empty}>Онлайн-запись пока не открыта ни в одном филиале.</div>}
                  </div>
                </>}

                {step === 2 && <>
                  <div className={styles.stageHeading}><Wrench aria-hidden /><div><h2>Какие работы нужны?</h2><p>Можно выбрать несколько — длительность сложится автоматически.</p></div></div>
                  <div className={styles.serviceList}>
                    {services.map((service) => {
                      const requirements = requirementLabels(service);
                      const pricing = pricingLabel(service.pricing);
                      return <label key={service.id} className={serviceIds.includes(service.id) ? styles.selectedChoice : ""}>
                        <input type="checkbox" checked={serviceIds.includes(service.id)} onChange={() => toggleService(service.id)} />
                        <span><strong>{service.name}</strong>{service.description && <small>{service.description}</small>}<small>{durationLabel(service.durationMinutes)}{requirements.length ? ` · Понадобится: ${requirements.join(", ")}` : " · Дополнительные данные не нужны"}</small>{pricing && <small>{pricing}</small>}{service.requiresConfirmation && <em>Время будет предварительным до проверки администратором</em>}</span><Check aria-hidden />
                      </label>;
                    })}
                    {servicesLoading ? <div className={styles.slotSkeleton}><i /><i /><i /><i /></div> : !services.length && <div className={styles.empty}>Для этого филиала пока нет услуг, доступных для онлайн-записи.{branch?.phone ? <> Позвоните: <a href={`tel:${branch.phone.replace(/[^+\d]/g, "")}`}>{branch.phone}</a>.</> : null}</div>}
                  </div>
                  {serviceIds.length > 0 && <div className={requiresConfirmation ? styles.pendingNotice : styles.neutralNotice}><Clock3 aria-hidden /><span>Итого: {durationLabel(totalDuration)}. {requiresConfirmation ? "После отправки потребуется подтверждение администратора." : "Свободное окно будет закреплено после отправки формы."}</span></div>}
                </>}

                {step === 3 && <>
                  <div className={styles.stageHeading}><CalendarDays aria-hidden /><div><h2>Выберите дату и время</h2><p>Время показано по часовому поясу филиала: {branch?.timezone}.</p></div></div>
                  <label className={styles.dateField}><span>Дата визита</span><input type="date" value={localDate} min={branch ? branchToday(branch.timezone) : undefined} max={branch && localDate ? (() => { const date = new Date(`${branchToday(branch.timezone)}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + branch.bookingHorizonDays); return date.toISOString().slice(0, 10); })() : undefined} onChange={(event) => chooseDate(event.target.value)} /></label>
                  {slotNotice && <div className={styles.warning} role="alert">{slotNotice}</div>}
                  <div className={styles.slotHeader}><strong>{dateLabel(localDate)}</strong><button type="button" onClick={() => void loadAvailability()} disabled={availabilityLoading}>Обновить</button></div>
                  {availabilityLoading ? <div className={styles.slotSkeleton}><i /><i /><i /><i /></div> : availability?.slots.length ? <div className={styles.slotGrid}>
                    {availability.slots.map((slot) => <button type="button" key={`${slot.startsAt}-${slot.master.membershipId}`} className={selectedSlot?.startsAt === slot.startsAt && selectedSlot.master.membershipId === slot.master.membershipId ? styles.selectedSlot : ""} onClick={() => { setSelectedSlot(slot); setSlotNotice(""); setFormError(""); }}><strong>{slot.localTime}</strong><span>{slot.master.name}</span></button>)}
                  </div> : availability ? <div className={styles.empty}>{availability.message || "На выбранную дату свободных окон нет."}</div> : null}
                  {!availabilityLoading && nearestDays.length > 0 && <div className={styles.nearestDays}><strong>Ближайшие даты со свободным временем</strong><div>{nearestDays.map((day) => <button type="button" key={day.localDate} onClick={() => chooseDate(day.localDate)}><CalendarDays aria-hidden /><span>{dateLabel(day.localDate)}<small>с {day.slots[0]?.localTime} · {day.slots.length} вариант(а)</small></span></button>)}</div></div>}
                  {nearestLoading && <div className={styles.neutralNotice}><LoaderCircle className={styles.searchSpinner} aria-hidden /> Ищем ближайшие даты со свободным временем…</div>}
                  {!availabilityLoading && availability && !availability.slots.length && <button className={styles.textButton} type="button" onClick={() => setStep(1)}>Выбрать другой филиал</button>}
                </>}

                {step === 4 && <>
                  <div className={styles.stageHeading}><Car aria-hidden /><div><h2>Автомобиль и контакты</h2><p>Укажите данные для этой заявки. По одному номеру телефона мы не показываем сохранённые автомобили.</p></div></div>
                  <div className={styles.sectionLead}><strong>Автомобиль</strong><span>Обязательные для выбранных работ поля уже отмечены.</span></div>
                  <div className={styles.formGrid}>
                    <label><span>Марка *</span><input value={make} onChange={(event) => setMake(event.target.value)} autoComplete="organization" placeholder="BMW" /></label>
                    <label><span>Модель *</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="X5" /></label>
                    {(requiredFields.has("year") || year) && <label><span>Год {requiredFields.has("year") ? "*" : ""}</span><input value={year} onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="2020" /></label>}
                    {(requiredFields.has("plate") || plate) && <label><span>Госномер {requiredFields.has("plate") ? "*" : ""}</span><input value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} placeholder="А123АА39" /></label>}
                    {(requiredFields.has("vin") || vin) && <label className={styles.wideField}><span>VIN {requiredFields.has("vin") ? "*" : ""}</span><input value={vin} onChange={(event) => setVin(event.target.value.toUpperCase().replace(/\s/g, ""))} autoCapitalize="characters" placeholder="17 символов" /></label>}
                  </div>
                  {!requiresVin && !requiredFields.has("plate") && !requiredFields.has("year") && <details className={styles.vehicleDetails}><summary><Info aria-hidden /><span><strong>Добавить VIN, госномер или год</strong><small>Необязательно для выбранных работ</small></span></summary><div className={`${styles.formGrid} ${styles.vehicleOptionalFields}`}><label><span>Год</span><input value={year} onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" /></label><label><span>Госномер</span><input value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} /></label><label className={styles.wideField}><span>VIN</span><input value={vin} onChange={(event) => setVin(event.target.value.toUpperCase().replace(/\s/g, ""))} /></label></div></details>}
                  <div className={styles.contactPanel}><div className={styles.sectionLead}><strong>Контакты</strong><span>Для связи по этой записи. Регистрация не требуется.</span></div><div className={styles.formGrid}><label><span>Имя *</span><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label><label><span>Телефон *</span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" inputMode="tel" placeholder="+7 999 000-00-00" /></label>{requiredFields.has("email") && <label className={styles.wideField}><span>Email *</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>}</div><details className={styles.vehicleDetails} open={requiredFields.has("email") || undefined}><summary><Info aria-hidden /><span><strong>Дополнительные контакты и комментарий</strong><small>{requiredFields.has("email") ? "Email обязателен для выбранной услуги" : "Необязательно"}</small></span></summary><div className={`${styles.formGrid} ${styles.vehicleOptionalFields}`}>{!requiredFields.has("email") && <label className={styles.wideField}><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>}<label className={styles.wideField}><span>Комментарий</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Что важно знать мастеру" /></label></div></details></div>
                  {requiresConfirmation && <div className={styles.pendingNotice}><Info aria-hidden /><span>Заявка будет создана со статусом «ожидает подтверждения». Выбранное время предварительное.</span></div>}
                  {submissionUnknown && <div className={styles.unknownResult}><strong>Результат нужно проверить</strong><p>Не отправляйте форму повторно вслепую.</p><button type="button" className={styles.secondaryButton} disabled={submitBusy} onClick={() => void checkOriginalOperation()}>{submitBusy ? <LoaderCircle className={styles.searchSpinner} aria-hidden /> : <ShieldCheck aria-hidden />} Проверить исходную операцию</button></div>}
                </>}
              </div>
            )}

            {formError && <div className={styles.error} role="alert">{formError}</div>}
            {!loading && <footer className={styles.stageFooter}>
              {step > 1 ? <button className={styles.secondaryButton} type="button" onClick={() => { setFormError(""); setStep((current) => current - 1); }}><ArrowLeft aria-hidden /> Назад</button> : <span />}
              {step < 4 ? <button className={styles.primaryButton} type="button" onClick={goNext}>Продолжить <ArrowRight aria-hidden /></button> : <button className={styles.primaryButton} type="button" disabled={submitBusy || submissionUnknown} onClick={() => void submitBooking()}>{submitBusy ? <LoaderCircle className={styles.searchSpinner} aria-hidden /> : null} Записаться <ArrowRight aria-hidden /></button>}
            </footer>}
          </section>

          <aside className={styles.summary}>
            <h2>Ваша запись</h2>
            <dl>
              <div><dt><MapPin aria-hidden /> Филиал</dt><dd>{branch?.name ?? "Не выбран"}{branch?.address && <small>{branch.address}</small>}{branch && <button className={styles.textButton} type="button" onClick={() => setStep(1)}>Изменить</button>}</dd></div>
              <div><dt><Wrench aria-hidden /> Работы</dt><dd>{selectedServices.length ? selectedServices.map((service) => service.name).join(", ") : "Не выбраны"}{totalDuration > 0 && <small>{durationLabel(totalDuration)}</small>}</dd></div>
              <div><dt><Clock3 aria-hidden /> Время</dt><dd>{selectedSlot ? <>{dateLabel(localDate)}, {selectedSlot.localTime}<small>Мастер: {selectedSlot.master.name}</small></> : "Не выбрано"}</dd></div>
              <div><dt><Car aria-hidden /> Автомобиль</dt><dd>{make || model ? [make, model].filter(Boolean).join(" ") : "Укажете после времени"}</dd></div>
            </dl>
            <p><ShieldCheck aria-hidden /> Данные передаются в систему выбранного филиала. Оплата на сайте не требуется.</p>
          </aside>
        </div>
      </section>
    </main>
  );
}
