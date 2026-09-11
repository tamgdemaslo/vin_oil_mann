"use client";

import {
  ArrowLeft, ArrowRight, CalendarDays, Car, Check, CheckCircle2, ChevronDown, Clock3, Copy,
  Info, LoaderCircle, MapPin, MessageCircle, Navigation, Phone, ShieldCheck, UserRound, Wrench,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publicBookingBranchFromSearch } from "@/lib/booking/public-link";
import type { PublicServiceGroup } from "@/lib/booking/public-service-presentation";
import styles from "./booking.module.css";

type Branch = {
  id: string; name: string; address: string | null; phone: string | null; timezone: string; intro: string | null;
  bookingHorizonDays: number;
  workingHours: Array<{ weekday: number; isWorking: boolean; startTime: string | null; endTime: string | null }>;
};
type Service = {
  id: string; name: string; description: string | null; customerName: string; customerDescription: string | null;
  group: PublicServiceGroup; sortOrder: number; durationMinutes: number; requiresVin: boolean;
  requiresConfirmation: boolean; requiredFields: string[];
  pricing: { kind: "fixed" | "from"; amountCents: number; currency: string } | { kind: "vehicle_calculation" } | null;
};
type Slot = {
  startsAt: string; endsAt: string; localTime: string; durationMinutes: number;
  master: { membershipId: string; name: string; position: string | null };
};
type Availability = {
  localDate: string; durationMinutes: number; requiresVin: boolean; requiresConfirmation: boolean;
  slots: Slot[]; reasonCode?: string; message?: string;
};
type NearestDay = { localDate: string; durationMinutes: number; slots: Slot[] };
type BookingResult = {
  id: string;
  branch: { id: string; name: string; timezone: string; address: string | null; phone: string | null };
  vehicle: { id: string | null; make: string; model: string; generation: string | null; year: number | null; plate: string | null; vin: string | null } | null;
  master: { membershipId: string; name: string; position: string | null } | null;
  services: Array<{ id: string | null; name: string; durationMinutes: number }>;
  startsAt: string; endsAt: string; durationMinutes: number; status: string; confirmationState: string;
  requiresConfirmation: boolean; clarificationRequired: boolean;
};
type CreateResult = {
  booking: BookingResult; managementUrl: string; reused: boolean;
  notification: { state: "DELIVERED" | "QUEUED" | "NOT_CONFIRMED" | "NOT_AVAILABLE" };
};
type Draft = {
  savedAt: number; step: number; branchId: string; serviceIds: string[]; localDate: string; name: string;
  phone: string; email: string; make: string; model: string; year: string; plate: string; vin: string;
  comment: string; needsVinHelp: boolean; idempotencyKey: string; lastSubmissionFingerprint: string;
  submissionUnknown: boolean;
};

class ApiError extends Error {
  code: string; status: number; details: unknown;
  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message); this.name = "ApiError"; this.code = code; this.status = status; this.details = details;
  }
}

const FULL_STEPS = [
  { step: 1, label: "Филиал" }, { step: 2, label: "Услуги" },
  { step: 3, label: "Время" }, { step: 4, label: "Данные" },
];
const BRANCH_STEPS = FULL_STEPS.slice(1);
const SERVICE_GROUPS: Array<{ key: PublicServiceGroup; title: string; intro: string }> = [
  { key: "engine", title: "Замена моторного масла", intro: "Основное обслуживание двигателя" },
  { key: "transmission", title: "Трансмиссия", intro: "Работы с маслом в коробке передач" },
  { key: "fluids", title: "Жидкости и обслуживание", intro: "Фильтры и технические жидкости" },
  { key: "other", title: "Другие работы", intro: "Диагностика и специальные работы" },
];
const DRAFT_KEY = "tgm-public-booking-draft-v3";
const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const SLOT_CONFLICT_CODES = new Set([
  "booking_slot_taken", "booking_outside_schedule", "booking_nonstandard_start",
  "booking_master_unavailable", "booking_master_service_mismatch",
]);

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string; code?: string; details?: unknown }) | null;
  if (!response.ok) throw new ApiError(body?.error || "Не удалось выполнить запрос", body?.code || "booking_request_failed", response.status, body?.details);
  if (!body) throw new ApiError("Сервис вернул пустой ответ", "booking_empty_response", response.status);
  return body;
}
function operationKey() {
  return globalThis.crypto?.randomUUID?.() || `booking-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function branchToday(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${value.year}-${value.month}-${value.day}`;
  } catch { return new Date().toISOString().slice(0, 10); }
}
function maxBookingDate(branch: Branch) {
  const date = new Date(`${branchToday(branch.timezone)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + branch.bookingHorizonDays);
  return date.toISOString().slice(0, 10);
}
function dateLabel(value: string) {
  return value ? new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00Z`)) : "Не выбрано";
}
function bookingDateLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return !hours ? `${rest} мин` : rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}
function branchHoursLabel(hours: Branch["workingHours"]) {
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"], byDay = new Map(hours.map((row) => [row.weekday, row]));
  return days.map((day, index) => {
    const row = byDay.get(index + 1);
    return row?.isWorking && row.startTime && row.endTime ? `${day} ${row.startTime}–${row.endTime}` : `${day} выходной`;
  }).join(" · ");
}
function timezoneLabel(timezone: string) {
  if (timezone === "Europe/Kaliningrad") return "Время Калининграда";
  if (timezone === "Europe/Moscow") return "Московское время";
  return "Местное время филиала";
}
function requirementLabels(service: Service) {
  const fields = new Set(service.requiredFields ?? []); if (service.requiresVin) fields.add("vin");
  const names: Record<string, string> = { vin: "VIN", plate: "госномер", year: "год автомобиля", email: "email" };
  return [...fields].map((field) => names[field] ?? field);
}
function money(amountCents: number, currency: string) {
  const normalized = currency.toUpperCase() === "RUB" || /руб/iu.test(currency) ? "RUB" : currency;
  return normalized === "RUB" ? new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(amountCents / 100) : `${(amountCents / 100).toLocaleString("ru-RU")} ${currency}`;
}
function pricingLabel(pricing: Service["pricing"]) {
  if (!pricing || pricing.kind === "vehicle_calculation") return "Стоимость уточним по автомобилю";
  return `Стоимость работы: ${pricing.kind === "from" ? "от " : ""}${money(pricing.amountCents, pricing.currency)}. Масло и расходники отдельно.`;
}
function availabilityMessage(value: Availability) {
  if (value.reasonCode === "branch_closed") return "Филиал не работает в этот день.";
  if (value.reasonCode === "day_fully_booked") return "В этот день все подходящие окна заняты.";
  if (["master_closed", "master_not_working"].includes(value.reasonCode || "")) return "В этот день нет работающего мастера для выбранных работ.";
  return value.message || "На выбранную дату свободных окон нет.";
}
function errorCopy(error: unknown) {
  if (!(error instanceof ApiError)) return "Нет связи с сервером. Проверьте интернет и повторите попытку.";
  if (error.status === 429 || error.code === "booking_rate_limited") return "Слишком много запросов. Подождите немного и повторите.";
  if (error.code === "booking_date_out_of_range") return "Дата вне доступного периода записи. Выберите другую.";
  if (SLOT_CONFLICT_CODES.has(error.code)) return error.message;
  if (error.status >= 500) return "Сервис записи временно недоступен. Заполненные данные сохранены.";
  return error.message;
}

export default function BookingClient() {
  const [step, setStep] = useState(1), [enteredByBranchLink, setEnteredByBranchLink] = useState(false);
  const [branchLinkError, setBranchLinkError] = useState(""), [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState(""), [services, setServices] = useState<Service[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]), [localDate, setLocalDate] = useState("");
  const [availability, setAvailability] = useState<Availability | null>(null), [availabilityError, setAvailabilityError] = useState("");
  const [nearestDays, setNearestDays] = useState<NearestDay[]>([]), [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [name, setName] = useState(""), [phone, setPhone] = useState(""), [email, setEmail] = useState("");
  const [make, setMake] = useState(""), [model, setModel] = useState(""), [year, setYear] = useState("");
  const [plate, setPlate] = useState(""), [vin, setVin] = useState(""), [needsVinHelp, setNeedsVinHelp] = useState(false);
  const [comment, setComment] = useState(""), [loading, setLoading] = useState(true);
  const [servicesLoading, setServicesLoading] = useState(false), [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [nearestLoading, setNearestLoading] = useState(false), [submitBusy, setSubmitBusy] = useState(false);
  const [formError, setFormError] = useState(""), [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [slotNotice, setSlotNotice] = useState(""), [submissionUnknown, setSubmissionUnknown] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(operationKey), [lastSubmissionFingerprint, setLastSubmissionFingerprint] = useState("");
  const [created, setCreated] = useState<CreateResult | null>(null), [copied, setCopied] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false), [telegramLink, setTelegramLink] = useState(""), [telegramError, setTelegramError] = useState("");
  const [draftReady, setDraftReady] = useState(false);
  const availabilityAbortRef = useRef<AbortController | null>(null), servicesAbortRef = useRef<AbortController | null>(null);
  const activeAvailabilityKeyRef = useRef("");

  const branch = branches.find((item) => item.id === branchId) ?? null;
  const selectedServices = useMemo(() => services.filter((service) => serviceIds.includes(service.id)), [services, serviceIds]);
  const totalDuration = selectedServices.reduce((sum, service) => sum + service.durationMinutes, 0);
  const requiresVin = selectedServices.some((service) => service.requiresVin || service.requiredFields.includes("vin"));
  const requiresConfirmation = selectedServices.some((service) => service.requiresConfirmation) || (requiresVin && needsVinHelp);
  const requiredFields = useMemo(() => {
    const fields = new Set(selectedServices.flatMap((service) => service.requiredFields ?? []));
    if (requiresVin) fields.add("vin"); return fields;
  }, [requiresVin, selectedServices]);
  const fixedLaborTotals = selectedServices.reduce<Record<string, number>>((totals, service) => {
    if (service.pricing?.kind === "fixed") {
      totals[service.pricing.currency] = (totals[service.pricing.currency] ?? 0) + service.pricing.amountCents;
    }
    return totals;
  }, {});
  const pricedFromCount = selectedServices.filter((service) => service.pricing?.kind === "from").length;
  const calculatedCount = selectedServices.filter((service) => !service.pricing || service.pricing.kind === "vehicle_calculation").length;
  const flowSteps = step === 1 ? FULL_STEPS : BRANCH_STEPS;
  const flowPosition = Math.max(1, flowSteps.findIndex((item) => item.step === step) + 1);
  const availabilityKey = useMemo(() => JSON.stringify({ branchId, serviceIds: [...serviceIds].sort(), localDate, totalDuration, timezone: branch?.timezone ?? "" }), [branch?.timezone, branchId, localDate, serviceIds, totalDuration]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Draft;
        if (Date.now() - draft.savedAt <= DRAFT_TTL_MS) {
          setStep(Math.max(1, Math.min(4, Number(draft.step) || 1))); setBranchId(draft.branchId || "");
          setServiceIds(Array.isArray(draft.serviceIds) ? draft.serviceIds : []); setLocalDate(draft.localDate || "");
          setName(draft.name || ""); setPhone(draft.phone || ""); setEmail(draft.email || ""); setMake(draft.make || "");
          setModel(draft.model || ""); setYear(draft.year || ""); setPlate(draft.plate || ""); setVin(draft.vin || "");
          setComment(draft.comment || ""); setNeedsVinHelp(Boolean(draft.needsVinHelp));
          if (/^[A-Za-z0-9._~-]{16,128}$/u.test(draft.idempotencyKey || "")) setIdempotencyKey(draft.idempotencyKey);
          setLastSubmissionFingerprint(draft.lastSubmissionFingerprint || ""); setSubmissionUnknown(Boolean(draft.submissionUnknown));
        } else sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch { sessionStorage.removeItem(DRAFT_KEY); } finally { setDraftReady(true); }
  }, []);

  useEffect(() => {
    if (!draftReady || created) return;
    const draft: Draft = { savedAt: Date.now(), step, branchId, serviceIds, localDate, name, phone, email, make, model, year, plate, vin, comment, needsVinHelp, idempotencyKey, lastSubmissionFingerprint, submissionUnknown };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [branchId, comment, created, draftReady, email, idempotencyKey, lastSubmissionFingerprint, localDate, make, model, name, needsVinHelp, phone, plate, serviceIds, step, submissionUnknown, vin, year]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/booking/branches", { signal: controller.signal }).then((response) => readJson<{ branches: Branch[] }>(response)).then((data) => {
      setBranches(data.branches);
      const requestedId = publicBookingBranchFromSearch(window.location.search), requested = requestedId ? data.branches.find((item) => item.id === requestedId) : null;
      if (requested) {
        setEnteredByBranchLink(true); setBranchLinkError("");
        setBranchId((current) => { if (current && current !== requested.id) setServiceIds([]); return requested.id; });
        setLocalDate(branchToday(requested.timezone)); setStep(2);
      } else if (requestedId) {
        setEnteredByBranchLink(false); setBranchId(""); setStep(1);
        setBranchLinkError("Филиал по этой ссылке не найден или сейчас недоступен для онлайн-записи. Выберите другую точку.");
      } else { setEnteredByBranchLink(false); setBranchId((current) => data.branches.some((item) => item.id === current) ? current : ""); }
    }).catch((error) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) setFormError(errorCopy(error));
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  useEffect(() => { if (branch && !localDate) setLocalDate(branchToday(branch.timezone)); }, [branch, localDate]);
  useEffect(() => { if (!requiresVin && needsVinHelp) setNeedsVinHelp(false); }, [needsVinHelp, requiresVin]);

  useEffect(() => {
    servicesAbortRef.current?.abort();
    if (!branchId) { setServices([]); setServicesLoading(false); return; }
    const controller = new AbortController(); servicesAbortRef.current = controller; setServicesLoading(true); setServices([]);
    fetch(`/api/public/booking/services?branchId=${encodeURIComponent(branchId)}`, { signal: controller.signal })
      .then((response) => readJson<{ services: Service[] }>(response)).then((data) => {
        setServices(data.services); const ids = new Set(data.services.map((service) => service.id));
        setServiceIds((current) => current.filter((id) => ids.has(id)));
      }).catch((error) => { if (!(error instanceof DOMException && error.name === "AbortError")) setFormError(errorCopy(error)); })
      .finally(() => { if (!controller.signal.aborted) setServicesLoading(false); });
    return () => controller.abort();
  }, [branchId]);

  const loadAvailability = useCallback(async () => {
    if (!branchId || !localDate || !serviceIds.length || !branch) return;
    availabilityAbortRef.current?.abort(); const controller = new AbortController(); availabilityAbortRef.current = controller;
    activeAvailabilityKeyRef.current = availabilityKey; const requestKey = availabilityKey;
    setAvailabilityLoading(true); setAvailabilityError(""); setNearestLoading(false); setAvailability(null); setNearestDays([]);
    try {
      const exact = await readJson<Availability>(await fetch("/api/public/booking/availability", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ branchId, localDate, serviceIds }) }));
      if (activeAvailabilityKeyRef.current !== requestKey) return; setAvailability(exact); setAvailabilityLoading(false);
      if (!exact.slots.length) {
        setNearestLoading(true);
        const nearest = await readJson<{ days: NearestDay[] }>(await fetch("/api/public/booking/nearest", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ branchId, fromDate: localDate, serviceIds }) }));
        if (activeAvailabilityKeyRef.current !== requestKey) return; setNearestDays(nearest.days); setNearestLoading(false);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") && activeAvailabilityKeyRef.current === requestKey) setAvailabilityError(errorCopy(error));
    } finally { if (activeAvailabilityKeyRef.current === requestKey) { setAvailabilityLoading(false); setNearestLoading(false); } }
  }, [availabilityKey, branch, branchId, localDate, serviceIds]);
  useEffect(() => { if (step === 3) void loadAvailability(); return () => availabilityAbortRef.current?.abort(); }, [loadAvailability, step]);

  function openBranchChooser() { setEnteredByBranchLink(false); setBranchLinkError(""); setFormError(""); setStep(1); }
  function chooseBranch(nextId: string) {
    const next = branches.find((item) => item.id === nextId), changed = Boolean(branchId && branchId !== nextId);
    setBranchId(nextId); if (changed) { setServiceIds([]); setServices([]); }
    setLocalDate(next ? branchToday(next.timezone) : ""); setAvailability(null); setAvailabilityError("");
    setNearestDays([]); setSelectedSlot(null); setSlotNotice(changed ? "Филиал изменён. Услуги и время будут рассчитаны заново." : "");
    setBranchLinkError(""); setFormError(""); setSubmissionUnknown(false);
  }
  function toggleService(id: string) {
    const hadSlot = Boolean(selectedSlot);
    setServiceIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    setAvailability(null); setAvailabilityError(""); setNearestDays([]); setSelectedSlot(null);
    setSlotNotice(hadSlot ? "Состав работ изменился, поэтому прежнее время больше не закреплено. Выберите новое окно." : "");
    setFormError(""); setSubmissionUnknown(false);
  }
  function chooseDate(value: string) {
    setLocalDate(value); setAvailability(null); setAvailabilityError(""); setNearestDays([]); setSelectedSlot(null); setFormError(""); setSubmissionUnknown(false);
  }
  function clearFieldError(field: string) {
    setFieldErrors((current) => { if (!current[field]) return current; const next = { ...current }; delete next[field]; return next; });
  }
  function finalFieldErrors() {
    const errors: Record<string, string> = {};
    if (!make.trim()) errors.make = "Укажите марку автомобиля.";
    if (!model.trim()) errors.model = "Укажите модель автомобиля.";
    if (requiredFields.has("vin") && !needsVinHelp && vin.trim().length !== 17) errors.vin = "Введите VIN из 17 символов или выберите помощь с подбором.";
    if (requiredFields.has("plate") && !plate.trim()) errors.plate = "Укажите госномер автомобиля.";
    if (requiredFields.has("year") && !year.trim()) errors.year = "Укажите год выпуска автомобиля.";
    if (!name.trim()) errors.name = "Укажите, как к вам обращаться.";
    if (phone.replace(/\D/g, "").length < 10) errors.phone = "Проверьте номер телефона.";
    if (requiredFields.has("email") && !email.trim()) errors.email = "Для выбранной услуги нужен email.";
    return errors;
  }
  function validationMessage(target = step) {
    if (target === 1 && !branchId) return "Выберите филиал, в который хотите приехать.";
    if (target === 2 && !serviceIds.length) return "Выберите хотя бы одну услугу.";
    if (target === 3 && !selectedSlot) return "Выберите свободное время визита.";
    return "";
  }
  function goNext() { const message = validationMessage(); if (message) return setFormError(message); setFormError(""); setStep((current) => Math.min(4, current + 1)); }
  function applyCreated(data: CreateResult) { setCreated(data); setSubmissionUnknown(false); sessionStorage.removeItem(DRAFT_KEY); }

  async function checkOriginalOperation() {
    if (!branchId || !idempotencyKey) return; setSubmitBusy(true); setFormError("");
    try {
      applyCreated(await readJson<CreateResult>(await fetch("/api/public/booking/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId, idempotencyKey }) })));
    } catch (error) {
      if (error instanceof ApiError && error.code === "booking_idempotency_result_not_found") {
        setSubmissionUnknown(false); setFormError("Исходная операция не была сохранена. Можно безопасно нажать «Записаться» ещё раз.");
      } else setFormError(errorCopy(error));
    } finally { setSubmitBusy(false); }
  }
  async function submitBooking() {
    const errors = finalFieldErrors(); setFieldErrors(errors);
    if (Object.keys(errors).length) {
      setFormError("Проверьте поля, отмеченные ниже.");
      requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus()); return;
    }
    if (!selectedSlot || !branchId) return;
    const basePayload = {
      branchId, serviceIds, masterMembershipId: selectedSlot.master.membershipId, startsAt: selectedSlot.startsAt,
      customerName: name.trim(), phone: phone.trim(), email: email.trim() || null,
      vehicle: { make: make.trim(), model: model.trim(), year: year.trim() || null, plate: plate.trim() || null, vin: needsVinHelp ? null : vin.trim() || null },
      needsVehicleClarification: requiresVin && needsVinHelp, comment: comment.trim() || null, website: "",
    };
    const fingerprint = JSON.stringify(basePayload); let requestId = idempotencyKey;
    if (!requestId || (lastSubmissionFingerprint && lastSubmissionFingerprint !== fingerprint)) { requestId = operationKey(); setIdempotencyKey(requestId); }
    setLastSubmissionFingerprint(fingerprint); setSubmitBusy(true); setSubmissionUnknown(false); setFormError("");
    try {
      applyCreated(await readJson<CreateResult>(await fetch("/api/public/booking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...basePayload, idempotencyKey: requestId }) })));
    } catch (error) {
      if (!(error instanceof ApiError)) { setSubmissionUnknown(true); setFormError("Связь прервалась, и результат создания неизвестен. Сначала проверьте исходную операцию."); }
      else if (SLOT_CONFLICT_CODES.has(error.code)) { setSlotNotice(error.message); setSelectedSlot(null); setStep(3); }
      else if (error.code === "booking_vin_required") { setFieldErrors((current) => ({ ...current, vin: "Введите VIN или выберите помощь с подбором." })); setFormError(error.message); }
      else setFormError(errorCopy(error));
    } finally { setSubmitBusy(false); }
  }
  async function copyManagementLink() { if (created?.managementUrl) { await navigator.clipboard.writeText(created.managementUrl); setCopied(true); } }
  async function prepareTelegramLink() {
    if (!created?.managementUrl) return; setTelegramBusy(true); setTelegramError("");
    try {
      const management = new URL(created.managementUrl, window.location.origin), prefix = "/booking/manage/";
      const token = management.pathname.startsWith(prefix) ? management.pathname.slice(prefix.length) : "";
      if (!token) throw new Error("Не удалось подготовить ссылку Telegram");
      const data = await readJson<{ linkUrl: string }>(await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}/telegram-link`, { method: "POST" }));
      setTelegramLink(data.linkUrl);
    } catch (error) { setTelegramError(errorCopy(error)); } finally { setTelegramBusy(false); }
  }

  function CostSummary({ compact = false }: { compact?: boolean }) {
    if (!selectedServices.length) return null;
    return <div className={compact ? styles.costSummaryCompact : styles.costSummary}>
      {Object.entries(fixedLaborTotals).map(([currency, amount]) => <span key={currency}>Работы с фиксированной ценой: <strong>{money(amount, currency)}</strong></span>)}
      {pricedFromCount > 0 && <span>Для {pricedFromCount} {pricedFromCount === 1 ? "работы" : "работ"} указана минимальная цена.</span>}
      {calculatedCount > 0 && <span>{calculatedCount} {calculatedCount === 1 ? "работа требует" : "работы требуют"} расчёта по автомобилю.</span>}
      <span>Масло и расходники в сумму работ не включены.</span>
    </div>;
  }
  function serviceRows(group: PublicServiceGroup) {
    return services.filter((service) => service.group === group).map((service) => {
      const requirements = requirementLabels(service), selected = serviceIds.includes(service.id);
      return <label key={service.id} className={selected ? styles.selectedChoice : ""}>
        <input type="checkbox" checked={selected} onChange={() => toggleService(service.id)} />
        <span><strong>{service.customerName}</strong>{service.customerDescription && <small>{service.customerDescription}</small>}
          <small>{durationLabel(service.durationMinutes)}{requirements.length ? ` · Понадобится: ${requirements.join(", ")}` : ""}</small>
          <small className={styles.priceLine}>{pricingLabel(service.pricing)}</small>
          {service.requiresConfirmation && <em>Время будет предварительным до проверки администратором</em>}</span><Check aria-hidden />
      </label>;
    });
  }

  if (created) {
    const clarification = created.booking.clarificationRequired, pending = created.booking.confirmationState === "PENDING";
    const notificationText = created.notification.state === "DELIVERED" ? "Ссылка управления доставлена."
      : created.notification.state === "QUEUED" ? "Уведомление со ссылкой поставлено в очередь."
        : created.notification.state === "NOT_AVAILABLE" ? "Автоматический канал уведомлений не настроен — сохраните ссылку ниже."
          : "Доставка уведомления не подтверждена — сохраните ссылку ниже.";
    const routeUrl = created.booking.branch.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(created.booking.branch.address)}` : null;
    return <main className={styles.publicRoot}><section className={styles.successPanel} aria-live="polite">
      <span className={pending ? styles.pendingSuccessIcon : styles.successIcon}><CheckCircle2 aria-hidden /></span>
      <h1>{clarification ? "Заявка принята. Свяжемся, чтобы уточнить работы и подтвердить время" : pending ? "Заявка принята. Время предварительное" : "Вы записаны"}</h1>
      <p>{clarification ? "Администратор поможет уточнить автомобиль и состав работ. До этого время не считается окончательно подтверждённым." : pending ? "Администратор проверит условия работ и подтвердит запись." : "Время закреплено в календаре сервиса."}</p>
      <div className={styles.confirmationFacts}>
        <span><CalendarDays aria-hidden /> {bookingDateLabel(created.booking.startsAt, created.booking.branch.timezone)}</span>
        <span><MapPin aria-hidden /> {[created.booking.branch.name, created.booking.branch.address].filter(Boolean).join(" · ")}</span>
        <span><Car aria-hidden /> {created.booking.vehicle ? `${created.booking.vehicle.make} ${created.booking.vehicle.model}` : "Автомобиль указан в заявке"}</span>
        <span><Wrench aria-hidden /> {created.booking.services.map((service) => service.name).join(", ")}</span>
        <span><Clock3 aria-hidden /> {durationLabel(created.booking.durationMinutes)}</span>
        <span><UserRound aria-hidden /> Мастер: {created.booking.master?.name ?? "будет назначен"}</span>
        <span><ShieldCheck aria-hidden /> {pending ? "Ожидает подтверждения" : "Подтверждено"}</span>
        {created.booking.branch.phone && <span><Phone aria-hidden /> Если планы изменятся: {created.booking.branch.phone}</span>}
      </div>
      <p className={styles.deliveryState}>{notificationText}</p>
      <div className={styles.successActions}>
        <a className={styles.primaryButton} href={created.managementUrl}>Открыть мою запись <ArrowRight aria-hidden /></a>
        <button className={styles.secondaryButton} type="button" onClick={() => void copyManagementLink()}><Copy aria-hidden /> {copied ? "Ссылка скопирована" : "Скопировать ссылку"}</button>
        {routeUrl && <a className={styles.secondaryButton} href={routeUrl} target="_blank" rel="noreferrer"><Navigation aria-hidden /> Построить маршрут</a>}
      </div>
      <div className={styles.telegramAction}><strong>Telegram — необязательно</strong><span>Подключите его для сервисных уведомлений. Номер телефона сам по себе Telegram не подключает.</span>
        {telegramLink ? <a className={styles.secondaryButton} href={telegramLink} target="_blank" rel="noreferrer"><MessageCircle aria-hidden /> Открыть Telegram</a> : <button className={styles.secondaryButton} type="button" disabled={telegramBusy} onClick={() => void prepareTelegramLink()}>{telegramBusy ? <LoaderCircle className={styles.searchSpinner} aria-hidden /> : <MessageCircle aria-hidden />} Подключить Telegram</button>}
        {telegramError && <small role="alert">{telegramError}</small>}
      </div>
      <small>Персональная ссылка открывает только эту запись. Не пересылайте её посторонним.</small>
    </section></main>;
  }

  return <main className={styles.publicRoot}>
    <header className={styles.publicHeader}><a className={styles.brand} href="/client-site" aria-label="Там где масло — на главную"><Image src="/brand/logo-wordmark-white.svg" width={204} height={30} priority alt="Там где масло." /></a><div className={styles.headerActions}><a href="/client-site">На сайт</a><ShieldCheck aria-hidden /><span>Онлайн-запись<br /><small>без звонка и регистрации</small></span></div></header>
    <section className={styles.bookingShell}>
      {step === 1 ? <div className={styles.intro}><div><span className={styles.bookingKicker}>Онлайн-запись · Калининград</span><h1>Запись в сервис за несколько минут.</h1><p>Выберите филиал — покажем его услуги, график и действительно свободное время.</p></div><div className={styles.introProof} aria-label="Условия онлайн-записи"><span>Без звонка</span><span>Свободные окна</span><span>Оплата в сервисе</span></div></div> : branch ? <div className={styles.branchContext}><div><small>Онлайн-запись · Калининград</small><strong>{[branch.name, branch.address].filter(Boolean).join(" · ")}</strong><span>{branchHoursLabel(branch.workingHours)}</span></div><button className={styles.secondaryButton} type="button" onClick={openBranchChooser}>Изменить</button></div> : null}
      <div className={styles.progressHeader}><nav className={styles.steps} aria-label="Шаги записи">{flowSteps.map((item, index) => <button type="button" key={item.step} className={item.step === step ? styles.activeStep : item.step < step ? styles.doneStep : ""} disabled={item.step > step} onClick={() => item.step < step && setStep(item.step)}><span>{item.step < step ? <Check aria-hidden /> : index + 1}</span>{item.label}</button>)}</nav><div className={styles.mobileProgress}><div><strong>{flowSteps.find((item) => item.step === step)?.label}</strong><span>{flowPosition} из {flowSteps.length}</span></div><i><span style={{ transform: `scaleX(${flowPosition / flowSteps.length})` }} /></i></div></div>
      <div className={styles.workspace}><section className={styles.stage}>
        {step > 1 && selectedServices.length > 0 && <div className={styles.mobileSummary}><Wrench aria-hidden /><span><strong>Выбрано: {selectedServices.length} {selectedServices.length === 1 ? "услуга" : "услуги"} · {durationLabel(totalDuration)}</strong><small>{selectedServices.map((service) => service.customerName).join(", ")}</small></span></div>}
        {loading ? <div className={styles.skeleton}><i /><i /><i /></div> : <div className={styles.stageBody}>
          {step === 1 && <><div className={styles.stageHeading}><MapPin aria-hidden /><div><h2>Куда вы хотите приехать?</h2><p>У каждого филиала свой график и свободные окна.</p></div></div>{branchLinkError && <div className={styles.warning} role="alert">{branchLinkError}</div>}<div className={styles.choiceList}>{branches.map((item) => <label key={item.id} className={item.id === branchId ? styles.selectedChoice : ""}><input type="radio" name="branch" checked={item.id === branchId} onChange={() => chooseBranch(item.id)} /><span><strong>{item.name}</strong>{item.address && <small>{item.address}</small>}<small>{branchHoursLabel(item.workingHours)}</small></span><Check aria-hidden /></label>)}{!branches.length && <div className={styles.empty}>Онлайн-запись пока не открыта ни в одном филиале.</div>}</div></>}
          {step === 2 && <><div className={styles.stageHeading}><Wrench aria-hidden /><div><h2>Что нужно сделать?</h2><p>Можно выбрать несколько работ. Длительность берём из настроек филиала.</p></div></div><div className={styles.serviceCatalog}>{SERVICE_GROUPS.map((group) => { const count = services.filter((service) => service.group === group.key).length; if (!count) return null; return group.key === "other" ? <details className={styles.serviceGroupDetails} key={group.key}><summary><span><strong>{group.title}</strong><small>{group.intro} · {count}</small></span><ChevronDown aria-hidden /></summary><div className={styles.serviceList}>{serviceRows(group.key)}</div></details> : <section className={styles.serviceGroup} key={group.key}><div className={styles.groupHeading}><strong>{group.title}</strong><span>{group.intro}</span></div><div className={styles.serviceList}>{serviceRows(group.key)}</div></section>; })}{servicesLoading ? <div className={styles.slotSkeleton}><i /><i /><i /><i /></div> : !services.length && <div className={styles.empty}>Для этого филиала пока нет опубликованных услуг с настроенной длительностью.{branch?.phone ? <> Позвоните: <a href={`tel:${branch.phone.replace(/[^+\d]/g, "")}`}>{branch.phone}</a>.</> : null}</div>}</div>{serviceIds.length > 0 && <div className={styles.selectionTotals}><div><Clock3 aria-hidden /><span><strong>{selectedServices.length} {selectedServices.length === 1 ? "услуга" : "услуги"} · {durationLabel(totalDuration)}</strong><small>{requiresConfirmation ? "После отправки потребуется подтверждение." : "Время закрепится после отправки формы."}</small></span></div><CostSummary compact /></div>}</>}
          {step === 3 && <><div className={styles.stageHeading}><CalendarDays aria-hidden /><div><h2>Когда вам удобно?</h2><p>{branch ? timezoneLabel(branch.timezone) : "Время филиала"}. Имя мастера указано как дополнительная информация.</p></div></div><label className={styles.dateField}><span>Дата визита</span><input type="date" value={localDate} min={branch ? branchToday(branch.timezone) : undefined} max={branch ? maxBookingDate(branch) : undefined} onChange={(event) => chooseDate(event.target.value)} /></label>{slotNotice && <div className={styles.warning} role="status">{slotNotice}</div>}{availabilityError && <div className={styles.errorInline} role="alert"><strong>Не удалось загрузить расписание</strong><span>{availabilityError}</span><button type="button" onClick={() => void loadAvailability()}>Повторить</button></div>}<div className={styles.slotHeader}><strong>{dateLabel(localDate)}</strong><button type="button" onClick={() => void loadAvailability()} disabled={availabilityLoading}>Обновить</button></div>{availabilityLoading ? <div className={styles.slotSkeleton}><i /><i /><i /><i /></div> : availability?.slots.length ? <div className={styles.slotGrid}>{availability.slots.map((slot) => <button type="button" key={`${slot.startsAt}-${slot.master.membershipId}`} className={selectedSlot?.startsAt === slot.startsAt && selectedSlot.master.membershipId === slot.master.membershipId ? styles.selectedSlot : ""} onClick={() => { setSelectedSlot(slot); setSlotNotice(""); setFormError(""); }}><strong>{slot.localTime}</strong><span>Мастер {slot.master.name}</span></button>)}</div> : availability ? <div className={styles.empty}>{availabilityMessage(availability)}</div> : null}{!availabilityLoading && nearestDays.length > 0 && <div className={styles.nearestDays}><strong>Ближайшие даты со свободным временем</strong><div>{nearestDays.map((day) => <button type="button" key={day.localDate} onClick={() => chooseDate(day.localDate)}><CalendarDays aria-hidden /><span>{dateLabel(day.localDate)}<small>с {day.slots[0]?.localTime} · {day.slots.length} вариант(а)</small></span></button>)}</div></div>}{nearestLoading && <div className={styles.neutralNotice}><LoaderCircle className={styles.searchSpinner} aria-hidden /> Ищем ближайшие даты…</div>}{!availabilityLoading && availability && !availability.slots.length && <button className={styles.textButton} type="button" onClick={openBranchChooser}>Выбрать другой филиал</button>}</>}
          {step === 4 && <><div className={styles.stageHeading}><Car aria-hidden /><div><h2>Автомобиль и контакты</h2><p>Укажите данные для этой записи. Сохранённые автомобили по одному номеру телефона не показываем.</p></div></div><div className={styles.sectionLead}><strong>Автомобиль</strong><span>Обязательные для выбранных работ поля отмечены звёздочкой.</span></div>
            <div className={styles.formGrid}><label><span>Марка *</span><input value={make} aria-invalid={Boolean(fieldErrors.make)} onChange={(event) => { setMake(event.target.value); clearFieldError("make"); }} autoComplete="organization" placeholder="BMW" />{fieldErrors.make && <small className={styles.fieldError}>{fieldErrors.make}</small>}</label><label><span>Модель *</span><input value={model} aria-invalid={Boolean(fieldErrors.model)} onChange={(event) => { setModel(event.target.value); clearFieldError("model"); }} placeholder="X5" />{fieldErrors.model && <small className={styles.fieldError}>{fieldErrors.model}</small>}</label>{(requiredFields.has("year") || year) && <label><span>Год {requiredFields.has("year") ? "*" : ""}</span><input value={year} aria-invalid={Boolean(fieldErrors.year)} onChange={(event) => { setYear(event.target.value.replace(/\D/g, "").slice(0, 4)); clearFieldError("year"); }} inputMode="numeric" placeholder="2020" />{fieldErrors.year && <small className={styles.fieldError}>{fieldErrors.year}</small>}</label>}{(requiredFields.has("plate") || plate) && <label><span>Госномер {requiredFields.has("plate") ? "*" : ""}</span><input value={plate} aria-invalid={Boolean(fieldErrors.plate)} onChange={(event) => { setPlate(event.target.value.toUpperCase()); clearFieldError("plate"); }} placeholder="А123АА39" />{fieldErrors.plate && <small className={styles.fieldError}>{fieldErrors.plate}</small>}</label>}{(requiredFields.has("vin") || vin) && <label className={styles.wideField}><span>VIN {requiredFields.has("vin") && !needsVinHelp ? "*" : ""}</span><input value={vin} disabled={needsVinHelp} aria-invalid={Boolean(fieldErrors.vin)} onChange={(event) => { setVin(event.target.value.toUpperCase().replace(/\s/g, "").slice(0, 17)); clearFieldError("vin"); }} autoCapitalize="characters" autoComplete="off" placeholder="17 символов" /><small>VIN нужен, чтобы точно подобрать масло, фильтры и уточнить состав работ.</small>{fieldErrors.vin && <small className={styles.fieldError}>{fieldErrors.vin}</small>}</label>}</div>
            {requiresVin && <label className={needsVinHelp ? `${styles.helpChoice} ${styles.helpChoiceSelected}` : styles.helpChoice}><input type="checkbox" checked={needsVinHelp} onChange={(event) => { setNeedsVinHelp(event.target.checked); clearFieldError("vin"); }} /><span><strong>Не знаю VIN / нужна помощь с подбором</strong><small>Создадим заявку на уточнение. Администратор свяжется с вами, а время будет подтверждено после уточнения.</small></span></label>}
            {!requiresVin && !requiredFields.has("plate") && !requiredFields.has("year") && <details className={styles.vehicleDetails}><summary><ChevronDown aria-hidden /><span><strong>Добавить VIN, госномер или год</strong><small>Необязательно для выбранных работ</small></span></summary><div className={`${styles.formGrid} ${styles.vehicleOptionalFields}`}><label><span>Год</span><input value={year} onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" /></label><label><span>Госномер</span><input value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} /></label><label className={styles.wideField}><span>VIN</span><input value={vin} onChange={(event) => setVin(event.target.value.toUpperCase().replace(/\s/g, "").slice(0, 17))} /></label></div></details>}
            <div className={styles.contactPanel}><div className={styles.sectionLead}><strong>Контакты</strong><span>Только для связи по этой записи. Регистрация не требуется.</span></div><div className={styles.formGrid}><label><span>Имя *</span><input value={name} aria-invalid={Boolean(fieldErrors.name)} onChange={(event) => { setName(event.target.value); clearFieldError("name"); }} autoComplete="name" />{fieldErrors.name && <small className={styles.fieldError}>{fieldErrors.name}</small>}</label><label><span>Телефон *</span><input type="tel" value={phone} aria-invalid={Boolean(fieldErrors.phone)} onChange={(event) => { setPhone(event.target.value); clearFieldError("phone"); }} autoComplete="tel" inputMode="tel" placeholder="+7 999 000-00-00" />{fieldErrors.phone && <small className={styles.fieldError}>{fieldErrors.phone}</small>}</label>{requiredFields.has("email") && <label className={styles.wideField}><span>Email *</span><input type="email" value={email} aria-invalid={Boolean(fieldErrors.email)} onChange={(event) => { setEmail(event.target.value); clearFieldError("email"); }} autoComplete="email" />{fieldErrors.email && <small className={styles.fieldError}>{fieldErrors.email}</small>}</label>}</div><details className={styles.vehicleDetails} open={requiredFields.has("email") || undefined}><summary><ChevronDown aria-hidden /><span><strong>Дополнительные контакты и комментарий</strong><small>{requiredFields.has("email") ? "Email обязателен для выбранной услуги" : "Необязательно"}</small></span></summary><div className={`${styles.formGrid} ${styles.vehicleOptionalFields}`}>{!requiredFields.has("email") && <label className={styles.wideField}><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>}<label className={styles.wideField}><span>Комментарий</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} placeholder="Что важно знать мастеру" /></label></div></details></div>
            <section className={styles.finalReview}><div className={styles.sectionLead}><strong>Проверьте запись</strong><span>Измените нужный раздел — остальные данные сохранятся.</span></div><dl><div><dt>Филиал</dt><dd>{branch?.name}<small>{branch?.address}</small></dd><button type="button" onClick={openBranchChooser}>Изменить</button></div><div><dt>Работы</dt><dd>{selectedServices.map((service) => service.customerName).join(", ")}<small>{durationLabel(totalDuration)}</small></dd><button type="button" onClick={() => setStep(2)}>Изменить</button></div><div><dt>Время</dt><dd>{selectedSlot ? `${dateLabel(localDate)}, ${selectedSlot.localTime}` : "Не выбрано"}<small>{selectedSlot ? `Мастер ${selectedSlot.master.name}` : ""}</small></dd><button type="button" onClick={() => setStep(3)}>Изменить</button></div><div><dt>Стоимость</dt><dd><CostSummary compact /></dd></div><div><dt>Автомобиль</dt><dd>{[make, model, year].filter(Boolean).join(" ") || "Не указан"}{needsVinHelp && <small>Нужна помощь с VIN</small>}</dd></div><div><dt>Контакт</dt><dd>{name || "Имя не указан"}<small>{phone || "Телефон не указан"}</small></dd></div></dl></section>
            {requiresConfirmation && <div className={styles.pendingNotice}><Info aria-hidden /><span>{needsVinHelp ? "Будет создана заявка на уточнение. Время подтвердит администратор после подбора." : "Заявка будет создана со статусом «ожидает подтверждения». Выбранное время предварительное."}</span></div>}
            {submissionUnknown && <div className={styles.unknownResult}><strong>Результат нужно проверить</strong><p>Не отправляйте форму повторно вслепую.</p><button type="button" className={styles.secondaryButton} disabled={submitBusy} onClick={() => void checkOriginalOperation()}>{submitBusy ? <LoaderCircle className={styles.searchSpinner} aria-hidden /> : <ShieldCheck aria-hidden />} Проверить исходную операцию</button></div>}
            <p className={styles.privacyNote}>Нажимая «Записаться», вы разрешаете использовать контакты для этой записи. <a href="/client-site#/privacy" target="_blank" rel="noreferrer">Политика конфиденциальности</a>.</p></>}
        </div>}
        {formError && <div className={styles.error} role="alert">{formError}</div>}
        {!loading && <div className={styles.footerSpacer} aria-hidden />}
        {!loading && <footer className={styles.stageFooter}>{(step > 2 || (step === 2 && !enteredByBranchLink)) ? <button className={styles.secondaryButton} type="button" onClick={() => { setFormError(""); setStep((current) => current - 1); }}><ArrowLeft aria-hidden /> Назад</button> : <span />}{step < 4 ? <button className={styles.primaryButton} type="button" onClick={goNext}>Продолжить <ArrowRight aria-hidden /></button> : <button className={styles.primaryButton} type="button" disabled={submitBusy || submissionUnknown} onClick={() => void submitBooking()}>{submitBusy ? <LoaderCircle className={styles.searchSpinner} aria-hidden /> : null} {needsVinHelp ? "Отправить заявку" : "Записаться"} <ArrowRight aria-hidden /></button>}</footer>}
      </section>
      <aside className={styles.summary}><h2>Ваша запись</h2><dl><div><dt><MapPin aria-hidden /> Филиал</dt><dd>{branch?.name ?? "Не выбран"}{branch?.address && <small>{branch.address}</small>}{branch && <button className={styles.textButton} type="button" onClick={openBranchChooser}>Изменить</button>}</dd></div><div><dt><Wrench aria-hidden /> Работы</dt><dd>{selectedServices.length ? selectedServices.map((service) => service.customerName).join(", ") : "Не выбраны"}{totalDuration > 0 && <small>{durationLabel(totalDuration)}</small>}{selectedServices.length > 0 && step > 2 && <button className={styles.textButton} type="button" onClick={() => setStep(2)}>Изменить</button>}</dd></div><div><dt><Clock3 aria-hidden /> Время</dt><dd>{selectedSlot ? <>{dateLabel(localDate)}, {selectedSlot.localTime}<small>Мастер: {selectedSlot.master.name}</small>{step > 3 && <button className={styles.textButton} type="button" onClick={() => setStep(3)}>Изменить</button>}</> : "Не выбрано"}</dd></div><div><dt><Car aria-hidden /> Автомобиль</dt><dd>{make || model ? [make, model].filter(Boolean).join(" ") : "Укажете после выбора времени"}</dd></div></dl>{selectedServices.length > 0 && <CostSummary />}<p><ShieldCheck aria-hidden /> Данные передаются в систему выбранного филиала. Оплата на сайте не требуется.</p></aside>
      </div>
    </section>
  </main>;
}
