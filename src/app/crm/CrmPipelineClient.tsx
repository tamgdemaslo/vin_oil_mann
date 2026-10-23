"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type DragEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, ChevronDown, Phone, Plus, Search, X, ArrowRight, Archive, GripVertical, MessageCircle, Pencil } from "lucide-react";
import { EcoButton } from "@/components/platform/EcoUI";
import { formatServiceDate, formatServiceDateTime, parseServiceDateTime, toServiceMomentString } from "@/lib/date-time";
import { formatPhoneForDisplay, normalizePhoneKey } from "@/lib/phone-normalize";
import { simpleCaseDeadline, simpleCaseStatus, WORK_CASE_LABELS, WORK_CASE_STATUSES, type SimpleCaseStatus, type WorkCaseStatus } from "@/lib/client-case-simple";
import { caseRosskoOrder, caseTimeRemaining, validCaseRosskoOrder } from "@/lib/client-case-parts";
import { CASE_CORRESPONDENCE_CHANNELS, caseCorrespondence, caseCorrespondenceLink, withoutCaseCorrespondence } from "@/lib/client-case-correspondence";
import { caseCounterpartyHref, caseCustomerTitle } from "@/lib/client-case-counterparty";
import { caseChatPhoneLink, validCaseChatLink } from "@/lib/client-case-chat-link";
import type { ClientCaseAction } from "@/lib/client-case-shared";
import styles from "./simple-crm.module.css";
import CaseTimeline from "./CaseTimeline";

type Deal = {
  id: string; title: string; customerName: string | null; phoneNormalized: string | null;
  clientCounterpartyId?: string | null;
  closure?: { actorLogin: string | null; closedAt: string | null } | null;
  vehicle: string | null; source: string | null; notes: string | null; createdByLogin: string;
  createdAt: string; updatedAt: string; status: string; caseStatus?: string | null;
  nextAction?: string | null; nextActionAt?: string | null; nextContactAt?: string | null;
  yclientsRecordId: string | null; appointmentId?: string | null; shipmentId: string | null;
  suppliesNote?: string | null; suppliesSupplier?: string | null; suppliesExpectedAt?: string | null; closeReason?: string | null;
};
type Stage = { id: string; name: string; deals: Deal[] };
type Case = Deal & { stage: Stage };
type Form = { phone: string; title: string; customerName: string; vehicle: string; correspondenceChannel: string };
const BOARD_MOVE_ACTIONS: Record<WorkCaseStatus, ClientCaseAction> = {
  calculation_needed: "calculate",
  calculation_sent: "mark_calculation_sent",
  waiting_parts: "waiting_parts",
  parts_arrived: "parts_arrived",
};
const CASE_DRAG_TYPE = "application/x-eco-client-case";
const EMPTY_FORM: Form = { phone: "", title: "", customerName: "", vehicle: "", correspondenceChannel: "" };
const CREATOR_NAMES: Record<string, string> = { ilya: "Илья", denis: "Денис", vadim: "Вадим", maksim: "Максим", sergei: "Сергей", "client-site": "Сайт" };
const creatorName = (login: string) => CREATOR_NAMES[login] ?? login;
function phoneHref(phone: string | null) {
  const digits = normalizePhoneKey(phone);
  return `tel:+${digits && /^9\d{9}$/.test(digits) ? `7${digits}` : digits || ""}`;
}

function recordsHref(deal: Deal) {
  const params = new URLSearchParams();
  if (deal.yclientsRecordId || deal.appointmentId) {
    params.set("recordId", deal.yclientsRecordId || deal.appointmentId!);
  } else {
    params.set("new", "1");
    params.set("crmDealId", deal.id);
    params.set("source", "CRM");
    params.set("comment", [deal.title, withoutCaseCorrespondence(deal.notes)].filter(Boolean).join("\n"));
    if (deal.phoneNormalized) params.set("phone", deal.phoneNormalized);
    if (deal.customerName) params.set("client", deal.customerName);
    if (deal.vehicle) params.set("vehicle", deal.vehicle);
  }
  return `/records?${params}`;
}

function calculationHref(deal: Deal) {
  if (deal.shipmentId) return `/shipment/${encodeURIComponent(deal.shipmentId)}/edit`;
  const params = new URLSearchParams({ crmDealId: deal.id, comment: [deal.title, withoutCaseCorrespondence(deal.notes)].filter(Boolean).join("\n") });
  if (deal.customerName) params.set("counterparty", deal.customerName);
  if (deal.phoneNormalized) params.set("phone", deal.phoneNormalized);
  if (deal.vehicle) params.set("vehicle", deal.vehicle);
  return `/shipment/new?${params}`;
}

export default function CrmPipelineClient({ userLogin, userName }: { userLogin: string; userName: string | null }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [cases, setCases] = useState<Case[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<SimpleCaseStatus | "board">("board");
  const [mobileFocus, setMobileFocus] = useState(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const partsDialogRef = useRef<HTMLDialogElement>(null);
  const bookingCloseRef = useRef<HTMLDialogElement>(null);
  const [closingBooking, setClosingBooking] = useState<Case | null>(null);
  const [bookingMenuId, setBookingMenuId] = useState<string | null>(null);
  const [bookingMenuPlacement, setBookingMenuPlacement] = useState<"above" | "below">("below");
  const partsOrderRef = useRef<HTMLInputElement>(null);
  const [partsRow, setPartsRow] = useState<Case | null>(null);
  const [partsOrder, setPartsOrder] = useState("");
  const [partsExpected, setPartsExpected] = useState("");
  const [partsError, setPartsError] = useState<string | null>(null);
  const [deadlineEdit, setDeadlineEdit] = useState<{ id: string; status: SimpleCaseStatus; value: string } | null>(null);
  const [correspondenceEdit, setCorrespondenceEdit] = useState<{ id: string; channel: string; url: string } | null>(null);
  const [openingChat, setOpeningChat] = useState<string | null>(null);
  const openingChatRef = useRef(false);
  const [quickError, setQuickError] = useState<{ id: string; message: string } | null>(null);
  const deadlineInputRef = useRef<HTMLInputElement>(null);
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<WorkCaseStatus | null>(null);
  const mutationPending = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ title: "", phone: "", customerName: "", vehicle: "", notes: "" });
  const [now, setNow] = useState(() => new Date());
  const phoneRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const focusedId = useRef<string | null>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const res = await fetch("/api/crm/deals", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось загрузить заявки");
      setCases((data.stages ?? []).flatMap((stage: Stage) => stage.deals.map(deal => ({ ...deal, stage }))));
      setLoadError(null);
      window.dispatchEvent(new Event("eco-client-cases-changed"));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Не удалось загрузить заявки");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(true); }, [load]);
  useEffect(() => {
    if (!bookingMenuId) return;
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest("[data-booking-menu]")) setBookingMenuId(null); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setBookingMenuId(null); document.getElementById(`booking-toggle-${bookingMenuId}`)?.focus(); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [bookingMenuId]);
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(new Date()); if (!document.hidden) void load(); }, 60_000);
    const refresh = () => { setNow(new Date()); if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [load]);
  useEffect(() => {
    const filter = searchParams.get("filter");
    if (filter === "overdue" || filter === "today") { setView("calculation_needed"); setUrgentOnly(filter === "overdue"); }
    else if (filter === "check_response" || filter === "client_replied") { setView("calculation_sent"); setUrgentOnly(false); }
    else if (WORK_CASE_STATUSES.some(status => status === filter) || filter === "closed") { setView(filter as SimpleCaseStatus); setUrgentOnly(false); }
  }, [searchParams]);
  useEffect(() => {
    const id = searchParams.get("dealId") || searchParams.get("crmDealId") || searchParams.get("deal");
    const found = cases.find(row => row.id === id);
    if (found && focusedId.current !== found.id) {
      focusedId.current = found.id;
      setView(simpleCaseStatus(found)); setUrgentOnly(false); setQuery(""); setEditing(found.id);
      setEdit({ title: found.title, phone: found.phoneNormalized || "", customerName: found.customerName || "", vehicle: found.vehicle || "", notes: withoutCaseCorrespondence(found.notes) });
    }
  }, [searchParams, cases]);

  const counts = useMemo(() => Object.fromEntries([...WORK_CASE_STATUSES, "closed"].map(status => [status, cases.filter(row => simpleCaseStatus(row) === status).length])), [cases]);
  const rows = useMemo(() => cases.filter(row => {
    if (view === "board" ? simpleCaseStatus(row) === "closed" : simpleCaseStatus(row) !== view) return false;
    if (urgentOnly && !(simpleCaseDeadline(row) && simpleCaseDeadline(row)! < now)) return false;
    const haystack = [row.title, row.customerName, row.phoneNormalized, row.vehicle, row.notes, row.createdByLogin].join(" ").toLowerCase();
    const digits = query.replace(/\D/g, "");
    return !query.trim() || haystack.includes(query.trim().toLowerCase()) || (digits.length >= 4 && Boolean(row.phoneNormalized?.includes(digits)));
  }).sort((a, b) => {
    if (view === "closed") return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    return (simpleCaseDeadline(a)?.getTime() ?? Date.parse(a.createdAt)) - (simpleCaseDeadline(b)?.getTime() ?? Date.parse(b.createdAt));
  }), [cases, view, query, urgentOnly, now]);
  const hasMobileRows = rows.some(row => !mobileFocus || ["calculation_needed", "parts_arrived"].includes(simpleCaseStatus(row)));
  const attentionCount = (counts.calculation_needed || 0) + (counts.parts_arrived || 0);
  const openCount = WORK_CASE_STATUSES.reduce((total, status) => total + (counts[status] || 0), 0);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!normalizePhoneKey(form.phone)) { setFormError("Укажите телефон с кодом города или страны"); phoneRef.current?.focus(); return; }
    if (!form.title.trim()) { setFormError("Напишите, что нужно рассчитать"); return; }
    submitting.current = true;
    setSaving(true); setFormError(null); setNotice("");
    try {
      const res = await fetch("/api/crm/deals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, title: form.title.trim(), caseStatus: "calculation_needed", caseType: "calculation", source: "Звонок", quickRequest: true, createLocalClient: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось добавить заявку");
      setForm(EMPTY_FORM); dialogRef.current?.close(); setView("board"); setMobileFocus(true); setQuery(""); setUrgentOnly(false);
      setNotice("Заявка добавлена. Рассчитать сегодня.");
      await load();
    } catch (error) { setFormError(error instanceof Error ? error.message : "Не удалось добавить заявку. Попробуйте ещё раз."); }
    finally { submitting.current = false; setSaving(false); requestAnimationFrame(() => phoneRef.current?.focus()); }
  }

  async function action(row: Case, action: ClientCaseAction, body: Record<string, unknown> = {}, successMessage?: string, partsConfirmed = false) {
    if (mutationPending.current) return false;
    if (action === "waiting_parts" && !partsConfirmed) { openPartsOrder(row); return false; }
    mutationPending.current = true;
    setBusy(row.id); setActionError(null); setNotice("");
    try {
      const res = await fetch(`/api/client-cases/${encodeURIComponent(row.id)}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, action }) });
      const data = await res.json();
      if (!res.ok) { if (res.status === 409) await load(); throw new Error(data.error || "Не удалось обновить заявку"); }
      if (data.case?.id === row.id) setCases(current => current.map(item => item.id === row.id ? { ...item, ...data.case, stage: item.stage } : item));
      await load();
      setNotice(successMessage ?? (action === "mark_calculation_sent" ? "Расчёт отмечен отправленным. Напоминаний об ответе не будет." : "Заявка обновлена"));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось обновить заявку";
      setActionError(message);
      if (partsConfirmed) setPartsError(message);
      return false;
    }
    finally { mutationPending.current = false; setBusy(null); }
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>, row: Case) {
    event.preventDefault();
    if (mutationPending.current) return;
    if (!edit.title.trim()) { setActionError("Укажите запрос клиента"); return; }
    if (edit.phone.trim() && !normalizePhoneKey(edit.phone)) { setActionError("Проверьте телефон клиента"); return; }
    mutationPending.current = true;
    setBusy(row.id); setActionError(null);
    try {
      const res = await fetch(`/api/crm/deals/${encodeURIComponent(row.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить изменения");
      setEditing(null); await load(); setNotice("Изменения сохранены");
    } catch (error) { setActionError(error instanceof Error ? error.message : "Не удалось сохранить изменения"); }
    finally { mutationPending.current = false; setBusy(null); }
  }

  async function patchCard(row: Case, body: Record<string, unknown>, message: string) {
    if (mutationPending.current) return false;
    mutationPending.current = true;
    setBusy(row.id); setQuickError(null); setNotice("");
    try {
      const res = await fetch(`/api/crm/deals/${encodeURIComponent(row.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить изменения");
      setCases(current => current.map(item => item.id === row.id ? { ...item, ...data, stage: item.stage } : item));
      await load(); setNotice(message);
      return true;
    } catch (error) {
      setQuickError({ id: row.id, message: error instanceof Error ? error.message : "Не удалось сохранить изменения" });
      return false;
    } finally { mutationPending.current = false; setBusy(null); }
  }

  function editCorrespondence(row: Case) {
    setQuickError(null);
    setCorrespondenceEdit({ id: row.id, channel: caseCorrespondence(row.notes), url: caseCorrespondenceLink(row.notes) });
  }

  async function saveCorrespondence(event: FormEvent<HTMLFormElement>, row: Case) {
    event.preventDefault();
    if (!correspondenceEdit || mutationPending.current) return;
    const ok = await patchCard(row, { correspondenceChannel: correspondenceEdit.channel, correspondenceUrl: correspondenceEdit.url.trim() }, "Переписка сохранена");
    if (ok) setCorrespondenceEdit(null);
  }

  async function openChat(row: Case) {
    if (openingChatRef.current || busy || saving || loadError) return;
    openingChatRef.current = true;
    setOpeningChat(row.id); setQuickError(null);
    try {
      const res = await fetch(`/api/client-cases/${encodeURIComponent(row.id)}/conversation`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        if (data.needsLink) editCorrespondence(row);
        throw new Error(data.error || "Не удалось открыть переписку");
      }
      const channel = caseCorrespondence(row.notes);
      if (typeof data.url !== "string" || (!validCaseChatLink(data.url, channel, window.location.origin) && data.url !== caseChatPhoneLink(channel, row.phoneNormalized))) throw new Error("Не удалось получить ссылку на переписку");
      if (data.url.startsWith("/messages?conversationId=") || new URL(data.url, window.location.origin).origin === window.location.origin) router.push(data.url);
      else window.location.assign(data.url);
    } catch (error) { setQuickError({ id: row.id, message: error instanceof Error ? error.message : "Не удалось открыть переписку" }); }
    finally { openingChatRef.current = false; setOpeningChat(null); }
  }

  function editDeadline(row: Case) {
    const status = simpleCaseStatus(row);
    const date = status === "waiting_parts" ? row.suppliesExpectedAt : row.nextActionAt || row.nextContactAt;
    setQuickError(null);
    setDeadlineEdit({ id: row.id, status, value: date ? toServiceMomentString(date).slice(0, 16).replace(" ", "T") : "" });
    requestAnimationFrame(() => deadlineInputRef.current?.focus());
  }

  async function saveDeadline(event: FormEvent<HTMLFormElement>, row: Case) {
    event.preventDefault();
    if (!deadlineEdit || mutationPending.current) return;
    const current = cases.find(item => item.id === row.id);
    if (!current || simpleCaseStatus(current) !== deadlineEdit.status) {
      setQuickError({ id: row.id, message: "Этап заявки изменился. Закройте изменение срока и откройте его заново." }); return;
    }
    const date = parseServiceDateTime(deadlineEdit.value);
    if (!date) { setQuickError({ id: row.id, message: "Укажите дату и время" }); return; }
    const ok = await patchCard(row, deadlineEdit.status === "waiting_parts" ? { suppliesExpectedAt: date.toISOString() } : { nextActionAt: date.toISOString() }, "Новый срок сохранён");
    if (ok) setDeadlineEdit(null);
  }

  function openPartsOrder(row: Case) {
    if (mutationPending.current || saving) return;
    setPartsRow(row);
    setPartsOrder(caseRosskoOrder(row.suppliesNote));
    setPartsExpected(row.suppliesExpectedAt ? toServiceMomentString(row.suppliesExpectedAt).slice(0, 16).replace(" ", "T") : "");
    setPartsError(null);
    requestAnimationFrame(() => { partsDialogRef.current?.showModal(); partsOrderRef.current?.focus(); });
  }

  async function saveParts(skip = false) {
    if (!partsRow || mutationPending.current) return;
    const row = cases.find(item => item.id === partsRow.id);
    if (!row || simpleCaseStatus(row) === "closed") { setPartsError("Заявка уже закрыта или недоступна. Обновите доску."); return; }
    if (!skip && !validCaseRosskoOrder(partsOrder)) { setPartsError("Номер заказа — только цифры, до 20 символов."); return; }
    const expected = partsExpected ? parseServiceDateTime(partsExpected) : null;
    if (!skip && partsExpected && !expected) { setPartsError("Проверьте дату и время поставки."); return; }
    setPartsError(null);
    const ok = await action(row, "waiting_parts", skip ? {} : { rosskoOrderNumber: partsOrder.trim(), suppliesExpectedAt: expected?.toISOString() ?? null }, skip ? "Заявка перемещена: Запчасти заказаны" : "Заказ и срок сохранены", true);
    if (ok) partsDialogRef.current?.close();
  }

  function openBookingClose(row: Case) {
    setBookingMenuId(null); setClosingBooking(row); setActionError(null);
    requestAnimationFrame(() => bookingCloseRef.current?.showModal());
  }

  async function confirmBookingClose() {
    if (!closingBooking || mutationPending.current) return;
    const current = cases.find(row => row.id === closingBooking.id);
    if (!current || simpleCaseStatus(current) !== "parts_arrived") { setActionError("Этап заявки изменился. Обновите доску перед закрытием."); return; }
    const linked = Boolean(current.appointmentId || current.yclientsRecordId);
    const ok = await action(current, linked ? "close" : "confirm_manual_booking", linked ? { reason: "Клиент записан" } : {}, "Заявка закрыта: клиент записан");
    if (ok) bookingCloseRef.current?.close();
  }

  function deadlineInfo(deadline: Date, label: string) {
    const remaining = caseTimeRemaining(deadline, now);
    return <div className={remaining.expired ? styles.expiredDeadline : styles.deadlineClock}>
      <time dateTime={deadline.toISOString()}>{label} {formatServiceDateTime(deadline)}</time>
      <strong>{remaining.label}</strong>
    </div>;
  }

  function endDrag() {
    setDraggedId(null);
    setDropTarget(null);
  }

  function startDrag(event: DragEvent<HTMLElement>, row: Case) {
    const target = event.target as Element;
    if (busy || saving || editing || deadlineEdit || correspondenceEdit || loadError || simpleCaseStatus(row) === "closed" ||
      (target.closest("a, button, input, textarea, select, summary") && !target.closest("[data-drag-handle]"))) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(CASE_DRAG_TYPE, row.id);
    event.dataTransfer.setData("text/plain", row.id);
    setDraggedId(row.id);
  }

  function canDrop(status: WorkCaseStatus) {
    const row = cases.find(item => item.id === draggedId);
    return !busy && !loadError && row && simpleCaseStatus(row) !== status;
  }

  async function moveTo(row: Case, status: WorkCaseStatus) {
    if (simpleCaseStatus(row) === "closed" || simpleCaseStatus(row) === status) return;
    await action(row, BOARD_MOVE_ACTIONS[status], {}, `Заявка перемещена: ${WORK_CASE_LABELS[status]}`);
  }

  function dropCase(event: DragEvent<HTMLElement>, status: WorkCaseStatus) {
    if (!draggedId) return;
    event.preventDefault();
    const row = cases.find(item => item.id === draggedId);
    const valid = canDrop(status) && (event.dataTransfer.getData(CASE_DRAG_TYPE) || event.dataTransfer.getData("text/plain")) === draggedId;
    endDrag();
    if (valid && row) void moveTo(row, status);
  }

  function renderRow(row: Case) {
    const status = simpleCaseStatus(row);
    const due = simpleCaseDeadline(row);
    const isOverdue = due && due < now;
    const isEditing = editing === row.id;
    const orderNumber = caseRosskoOrder(row.suppliesNote);
    const partsDue = row.suppliesExpectedAt ? parseServiceDateTime(row.suppliesExpectedAt) : null;
    const hasBooking = Boolean(row.yclientsRecordId || row.appointmentId);
    const clientHref = caseCounterpartyHref(row);
    const customerTitle = caseCustomerTitle(row);
    const clientLink = clientHref ? <Link className={styles.customerLink} href={clientHref} aria-label={`Открыть контрагента: ${row.customerName || row.phoneNormalized || "клиент"}`} title="Открыть карточку контрагента">{customerTitle}</Link> : null;
    return <article className={`${styles.row} ${isOverdue ? styles.overdueCard : ""} ${draggedId === row.id ? styles.draggedCard : ""}`} key={row.id} id={`case-${row.id}`} aria-busy={busy === row.id}
      draggable={status !== "closed" && !busy && !saving && !editing && !deadlineEdit && !correspondenceEdit && !loadError}
      onDragStart={event => startDrag(event, row)} onDragEnd={endDrag}>
      {status !== "closed" && <button type="button" className={styles.dragHandle} data-drag-handle draggable={!busy && !saving && !editing && !deadlineEdit && !correspondenceEdit && !loadError}
        disabled={Boolean(busy) || saving || Boolean(editing) || Boolean(deadlineEdit) || Boolean(correspondenceEdit) || Boolean(loadError)}
        aria-label={`Переместить заявку: ${row.vehicle || row.customerName || row.title}`} title="Перетащите в другую колонку. Нажмите, чтобы выбрать этап."
        onClick={event => {
          const card = event.currentTarget.closest("article");
          const details = card?.querySelector("details");
          if (details) details.open = true;
          card?.querySelector<HTMLSelectElement>("[data-stage-select]")?.focus();
        }}><GripVertical size={16} /></button>}
      {busy === row.id && <span className={styles.savingBadge} role="status">Сохраняем…</span>}
      <div className={styles.cardHeading}><strong>{clientLink || customerTitle}</strong><span>{row.source === "client-site" || row.createdByLogin === "client-site" ? "С сайта" : row.source || ""}</span></div>
      <div className={styles.request} title={row.title}><strong>{row.title}</strong></div>
      {row.vehicle?.trim() && <div className={styles.vehicle} title={row.vehicle}>Авто: {row.vehicle}</div>}
      <div className={styles.contactRow}>
      <div className={styles.client}>
        {row.phoneNormalized ? <a href={phoneHref(row.phoneNormalized)} aria-label={"Позвонить: " + formatPhoneForDisplay(row.phoneNormalized)} title={formatPhoneForDisplay(row.phoneNormalized)}><Phone size={13} /><span className={styles.phoneNumber}>{row.customerName?.trim() ? formatPhoneForDisplay(row.phoneNormalized) : "Позвонить"}</span></a> : <span>Телефон не указан</span>}
      </div>
      <div className={styles.correspondence}>
        {caseCorrespondence(row.notes) ? <><button type="button" className={styles.chatLink} aria-busy={openingChat === row.id} disabled={Boolean(busy) || Boolean(openingChat) || correspondenceEdit?.id === row.id || Boolean(loadError)} aria-label={`Открыть переписку в ${caseCorrespondence(row.notes)}: ${row.customerName || row.vehicle || row.title}`} onClick={() => void openChat(row)}><MessageCircle size={14} />{openingChat === row.id ? "Открываем…" : caseCorrespondence(row.notes)}<ArrowRight size={13} /></button><button type="button" className={styles.editChat} aria-label="Изменить мессенджер и ссылку" title="Изменить мессенджер и ссылку" disabled={Boolean(busy) || Boolean(openingChat) || correspondenceEdit?.id === row.id} onClick={() => editCorrespondence(row)}><Pencil size={14} /></button></> : <button type="button" className={styles.chatLink} disabled={Boolean(busy)} onClick={() => editCorrespondence(row)} aria-label="Указать мессенджер"><MessageCircle size={14} /><span className={styles.emptyChatLabel}>Указать мессенджер</span></button>}
      </div>
      </div>
      <div className={styles.deadline}>
        {status === "calculation_needed" && due && deadlineInfo(due, "Рассчитать до")}
        {status === "parts_arrived" && <><span className={styles.arrivedBadge}>Позвонить и записать</span>{due && deadlineInfo(due, "Записать до")}</>}
        {status === "waiting_parts" ? <button type="button" className={styles.orderNumber} disabled={Boolean(busy) || Boolean(loadError)} onClick={() => openPartsOrder(row)}>{orderNumber ? "РОССКО № " + orderNumber : "Указать № РОССКО"}</button> : status === "parts_arrived" && orderNumber && <span className={styles.orderNumber}>РОССКО № {orderNumber}</span>}
        {status === "waiting_parts" && (partsDue ? deadlineInfo(partsDue, "Поставка до") : <span>Срок поставки не указан</span>)}
        {status === "calculation_sent" && <span>Расчёт у клиента</span>}
        {status === "closed" && <span>{row.closeReason || "Закрыто"}</span>}
        {(status === "waiting_parts" || status === "parts_arrived") && deadlineEdit?.id !== row.id && <button type="button" className={styles.changeDeadline} title={(status === "waiting_parts" ? partsDue : due) ? "Изменить срок" : "Указать срок"} disabled={Boolean(busy) || Boolean(loadError)} onClick={() => editDeadline(row)}><CalendarClock size={16} /><span>{(status === "waiting_parts" ? partsDue : due) ? "Изменить срок" : "Указать срок"}</span></button>}
        {deadlineEdit?.id === row.id && <form className={styles.deadlineForm} aria-label="Изменение срока" onSubmit={event => void saveDeadline(event, row)}>
          <label>{deadlineEdit.status === "waiting_parts" ? "Когда ждём запчасти" : "Позвонить и записать до"}<input ref={deadlineInputRef} className="eco-input" type="datetime-local" required value={deadlineEdit.value} disabled={Boolean(busy)} onInput={event => setDeadlineEdit({ ...deadlineEdit, value: event.currentTarget.value })} onChange={event => setDeadlineEdit({ ...deadlineEdit, value: event.target.value })} /></label>
          <div className={styles.actions}><EcoButton type="submit" variant="primary" disabled={Boolean(busy)}>{busy === row.id ? "Сохраняем…" : "Сохранить срок"}</EcoButton><EcoButton type="button" disabled={Boolean(busy)} onClick={() => { setDeadlineEdit(null); setQuickError(null); }}>Отмена</EcoButton></div>
        </form>}
      </div>
      {correspondenceEdit?.id === row.id && <form className={styles.chatForm} aria-label="Настройка переписки" onSubmit={event => void saveCorrespondence(event, row)}>
        <label>Мессенджер · необязательно<select className="eco-input" value={correspondenceEdit.channel} disabled={Boolean(busy)} onChange={event => { setCorrespondenceEdit({ ...correspondenceEdit, channel: event.target.value, url: "" }); setQuickError(null); }}><option value="">Не указан</option>{CASE_CORRESPONDENCE_CHANNELS.map(channel => <option key={channel} value={channel}>{channel}</option>)}</select></label>
        {correspondenceEdit.channel && <label>Ссылка на переписку · необязательно<input className="eco-input" inputMode="url" autoComplete="off" placeholder="https://…" maxLength={2000} value={correspondenceEdit.url} disabled={Boolean(busy)} onChange={event => setCorrespondenceEdit({ ...correspondenceEdit, url: event.target.value })} /></label>}
        <small>Ссылка нужна, если диалог не найден на платформе. Telegram, WhatsApp и SMS можно открыть по телефону.</small>
        <div className={styles.actions}><EcoButton type="submit" variant="primary" disabled={Boolean(busy)}>{busy === row.id ? "Сохраняем…" : "Сохранить"}</EcoButton><EcoButton type="button" disabled={Boolean(busy)} onClick={() => { setCorrespondenceEdit(null); setQuickError(null); }}>Отмена</EcoButton></div>
      </form>}
      {quickError?.id === row.id && <p className={styles.formError} role="alert">{quickError.message}</p>}
      {status === "closed" && <p className={styles.closureMeta}>Закрыл: {row.closure?.actorLogin ? creatorName(row.closure.actorLogin) : "сотрудник не указан"}<span> · {row.closure?.closedAt ? <time dateTime={row.closure.closedAt}>{formatServiceDateTime(row.closure.closedAt)}</time> : "время не сохранено"}</span></p>}
      <div className={styles.actions}>
        {status === "calculation_needed" && <Link className="eco-btn eco-btn--primary" href={calculationHref(row)}>Рассчитать <ArrowRight size={15} /></Link>}
        {status === "calculation_sent" && <EcoButton disabled={Boolean(busy)} onClick={() => void action(row, "waiting_parts")}>Отметить заказ</EcoButton>}
        {status === "waiting_parts" && <EcoButton disabled={Boolean(busy)} onClick={() => void action(row, "parts_arrived")}>Отметить поступление</EcoButton>}
        {status === "parts_arrived" && <>{row.phoneNormalized && <a className="eco-btn" href={phoneHref(row.phoneNormalized)}><Phone size={15} />Позвонить</a>}
          <div className={styles.bookingMenu} data-booking-menu data-placement={bookingMenuPlacement} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setBookingMenuId(null); }}>
            <EcoButton id={`booking-toggle-${row.id}`} type="button" variant="primary" disabled={Boolean(busy) || Boolean(loadError)} aria-expanded={bookingMenuId === row.id} aria-controls={bookingMenuId === row.id ? `booking-options-${row.id}` : undefined} onClick={event => {
              const opening = bookingMenuId !== row.id;
              const rect = event.currentTarget.getBoundingClientRect();
              setBookingMenuPlacement(window.innerHeight - rect.bottom < 150 && rect.top > 150 ? "above" : "below");
              setBookingMenuId(opening ? row.id : null);
              if (opening) requestAnimationFrame(() => document.getElementById(`booking-options-${row.id}`)?.scrollIntoView({ block: "nearest" }));
            }}>{hasBooking ? "Запись" : "Записать"}<ChevronDown size={14} /></EcoButton>
            {bookingMenuId === row.id && <div className={styles.bookingOptions} id={`booking-options-${row.id}`} aria-label="Действия по записи">
              <Link href={recordsHref(row)} onClick={() => setBookingMenuId(null)}>{hasBooking ? "Открыть запись" : "Записать через платформу"}</Link>
              <button type="button" onClick={() => openBookingClose(row)}>{hasBooking ? "Клиент записан — закрыть заявку" : "Уже записан — закрыть заявку"}</button>
            </div>}
          </div>
        </>}
      </div>
      <details className={styles.details} open={isEditing || undefined} onToggle={event => { const open = event.currentTarget.open; setExpandedHistory(current => current[row.id] === open ? current : { ...current, [row.id]: open }); }}>
        <summary><span className={styles.cardMeta}>Создал: {creatorName(row.createdByLogin)}</span><span className={styles.detailsToggle}>Подробнее <ChevronDown size={14} /></span></summary>
        <div className={styles.detailsBody}>
          <p className={styles.cardMeta}>Создано: {formatServiceDate(row.createdAt)}</p>
          {row.phoneNormalized && <p className={styles.fullPhone}><a href={phoneHref(row.phoneNormalized)}>{formatPhoneForDisplay(row.phoneNormalized)}</a></p>}
          {status !== "closed" && !isEditing && <label className={styles.stageField}>Этап заявки
            <select data-stage-select aria-label="Этап заявки" value={status} disabled={Boolean(busy) || Boolean(loadError)}
              onChange={event => void moveTo(row, event.target.value as WorkCaseStatus)}>
              {WORK_CASE_STATUSES.map(stage => <option key={stage} value={stage}>{WORK_CASE_LABELS[stage]}</option>)}
            </select>
          </label>}
          {row.vehicle?.trim() && <p>Автомобиль: {row.vehicle}</p>}
          <p className={styles.notes}>{row.title}</p>
          {withoutCaseCorrespondence(row.notes) && <p className={styles.notes}>{withoutCaseCorrespondence(row.notes)}</p>}
          {row.suppliesNote && <p>Запчасти: {row.suppliesNote}</p>}
          {row.source && <p>Источник: {row.source === "client-site" ? "Сайт" : row.source}</p>}
          {expandedHistory[row.id] && <CaseTimeline caseId={row.id} version={row.updatedAt} employeeName={creatorName} />}
          {isEditing ? <form onSubmit={event => void saveDetails(event, row)} className={styles.editForm}>
            <label>Что рассчитать<input className="eco-input" value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} required /></label>
            <label>Телефон<input className="eco-input" type="tel" value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></label>
            <label>Имя<input className="eco-input" value={edit.customerName} onChange={e => setEdit({ ...edit, customerName: e.target.value })} /></label>
            <label>Автомобиль<input className="eco-input" value={edit.vehicle} onChange={e => setEdit({ ...edit, vehicle: e.target.value })} /></label>
            <label>Комментарий<textarea className="eco-input" value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></label>
            <div className={styles.actions}><EcoButton type="submit" variant="primary" disabled={Boolean(busy)}>Сохранить</EcoButton><EcoButton type="button" disabled={Boolean(busy)} onClick={() => setEditing(null)}>Отмена</EcoButton></div>
          </form> : <div className={styles.actions}>
            {status === "waiting_parts" && <EcoButton disabled={Boolean(busy)} onClick={() => openPartsOrder(row)}>Изменить заказ и срок</EcoButton>}
            {status === "calculation_needed" && <EcoButton disabled={Boolean(busy)} onClick={() => void action(row, "mark_calculation_sent")}>Расчёт уже отправлен</EcoButton>}
            <EcoButton onClick={() => { setEdit({ title: row.title, phone: row.phoneNormalized || "", customerName: row.customerName || "", vehicle: row.vehicle || "", notes: withoutCaseCorrespondence(row.notes) }); setEditing(row.id); }}>Редактировать</EcoButton>
            {row.phoneNormalized && <a className="eco-btn" href={phoneHref(row.phoneNormalized)}><Phone size={15} />Позвонить</a>}
            {status !== "closed" && <>
              {status !== "calculation_needed" && <EcoButton disabled={Boolean(busy)} onClick={() => void action(row, "calculate")}>Нужен новый расчёт</EcoButton>}
              {status === "calculation_needed" && <EcoButton disabled={Boolean(busy)} onClick={() => void action(row, "waiting_parts")}>Запчасти уже заказаны</EcoButton>}
              {status !== "parts_arrived" && <Link className="eco-btn" href={recordsHref(row)}>Записать клиента</Link>}
              <EcoButton disabled={Boolean(busy)} onClick={() => void action(row, "refused", { reason: "Клиент отказался" })}>Клиент отказался</EcoButton>
              <EcoButton disabled={Boolean(busy)} onClick={() => void action(row, "duplicate", { reason: "Дубль" })}>Дубль</EcoButton>
            </>}
            {status === "closed" && <EcoButton disabled={Boolean(busy)} onClick={() => void action(row, "calculate")}>Вернуть на расчёт</EcoButton>}
          </div>}
        </div>
      </details>
    </article>;
  }

  return <main className={`eco-page ${styles.page}`}>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>КЛИЕНТСКИЙ СЕРВИС</div><h1>Заявки клиентов</h1><p>{loading ? "Загружаем заявки…" : attentionCount ? "Расчёты — сегодня. Запчасти пришли — позвоните и запишите клиента." : "Новых расчётов и звонков нет. Заявки в ожидании остаются на доске."}</p>{!loading && attentionCount > 0 && <div className={styles.attentionLinks}><a href="#queue-calculation_needed" onClick={() => { setView("board"); setMobileFocus(true); setUrgentOnly(false); }}>Рассчитать <strong>{counts.calculation_needed || 0}</strong></a><a href="#queue-parts_arrived" onClick={() => { setView("board"); setMobileFocus(true); setUrgentOnly(false); }}>Позвонить <strong>{counts.parts_arrived || 0}</strong></a></div>}</div>
      <EcoButton variant="primary" className={styles.newRequest} onClick={() => { dialogRef.current?.showModal(); requestAnimationFrame(() => phoneRef.current?.focus()); }}><Plus size={18} />Новый запрос</EcoButton>
    </header>
    <div className={styles.toolbar}>
      <nav className={styles.phoneFilters} aria-label="Фильтры заявок на телефоне">
        <button aria-current={view !== "closed" ? "page" : undefined} onClick={() => { setView("board"); setUrgentOnly(false); }}>В работе <span>{openCount}</span></button>
        <button aria-current={view === "closed" ? "page" : undefined} onClick={() => { setView("closed"); setUrgentOnly(false); }}>История <span>{counts.closed || 0}</span></button>
        <button className={styles.phoneFilterStart} aria-pressed={view !== "closed" && mobileFocus} onClick={() => { setMobileFocus(true); setView("board"); setUrgentOnly(false); }}>Нужно сделать <span>{attentionCount}</span></button>
        <button aria-pressed={view !== "closed" && !mobileFocus} onClick={() => { setMobileFocus(false); setView("board"); setUrgentOnly(false); }}>Все заявки <span>{openCount}</span></button>
      </nav>
      <nav className={styles.views} aria-label="Вид заявок"><button aria-current={view !== "closed" ? "page" : undefined} onClick={() => { setView("board"); setUrgentOnly(false); }}>В работе <span>{openCount}</span></button><button aria-current={view === "closed" ? "page" : undefined} onClick={() => { setView("closed"); setUrgentOnly(false); }}><Archive size={15} />История <span>{counts.closed || 0}</span></button></nav>
      <label className={styles.search}><Search size={17} /><input aria-label="Поиск заявок" placeholder="Телефон, авто или клиент" value={query} onChange={e => { setQuery(e.target.value); if(e.target.value) setMobileFocus(false); }} /></label>
    </div>
    {view !== "closed" && <nav className={styles.mobileSwitch} aria-label="Заявки на телефоне"><button aria-pressed={mobileFocus} onClick={() => { setMobileFocus(true); setView("board"); }}>Нужно сделать <span>{attentionCount}</span></button><button aria-pressed={!mobileFocus} onClick={() => { setMobileFocus(false); setView("board"); }}>Все заявки <span>{openCount}</span></button></nav>}
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="new-request-title">
      <div className={styles.dialogHeading}><div><h2 id="new-request-title">Новый запрос</h2><p>Запишите главное прямо во время звонка.</p></div><button aria-label="Закрыть форму" onClick={() => dialogRef.current?.close()}><X size={20} /></button></div>
    <form className={styles.quickForm} onSubmit={event => void create(event)} aria-label="Новая заявка">
      <div className={styles.formHeading}>Срок расчёта — сегодня. Установим автоматически.</div>
      <label className={styles.phoneField}>Телефон<input ref={phoneRef} type="tel" inputMode="tel" autoComplete="tel" className="eco-input" placeholder="+7 900 000-00-00" required value={form.phone} disabled={saving} aria-invalid={Boolean(formError) || undefined} aria-describedby={formError ? "request-form-error" : undefined} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
      <label className={styles.titleField}>Что рассчитать<input className="eco-input" placeholder="Например: замена масла в АКПП" required maxLength={500} value={form.title} disabled={saving} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label>Где переписка · необязательно<select className="eco-input" value={form.correspondenceChannel} disabled={saving} onChange={event => setForm({ ...form, correspondenceChannel: event.target.value })}><option value="">Не указана</option>{CASE_CORRESPONDENCE_CHANNELS.map(channel => <option key={channel} value={channel}>{channel}</option>)}</select></label>
      <details className={styles.optional}><summary>Имя и авто <ChevronDown size={14} /></summary><div><label>Имя · необязательно<input className="eco-input" autoComplete="name" value={form.customerName} disabled={saving} onChange={e => setForm({ ...form, customerName: e.target.value })} /></label><label>Авто / VIN · необязательно<input className="eco-input" value={form.vehicle} disabled={saving} onChange={e => setForm({ ...form, vehicle: e.target.value })} /></label></div></details>
      <EcoButton className={styles.submit} type="submit" variant="primary" disabled={saving || Boolean(loadError) || loading}><Plus size={16} />{saving ? "Добавляем…" : "Сохранить запрос"}</EcoButton>
      {formError && <p className={styles.formError} role="alert" id="request-form-error">{formError}</p>}
      <small className={styles.creator}>Создаст: {userName || creatorName(userLogin)}</small>
    </form>
    </dialog>
    <dialog ref={partsDialogRef} className={styles.dialog} aria-labelledby="parts-order-title"
      onClose={() => setPartsRow(null)} onCancel={event => { if (busy) event.preventDefault(); }}>
      <div className={styles.dialogHeading}><div><h2 id="parts-order-title">Заказ и срок поставки</h2><p>Добавьте номер заказа РОССКО и когда ждёте запчасти. Можно заполнить позже.</p></div><button type="button" aria-label="Отменить перенос" disabled={Boolean(busy)} onClick={() => partsDialogRef.current?.close()}><X size={20} /></button></div>
      <form className={styles.quickForm} onSubmit={event => { event.preventDefault(); void saveParts(); }}>
        {partsRow && <div className={styles.formHeading}>{partsRow.vehicle || partsRow.customerName || "Заявка клиента"}</div>}
        <label>Номер заказа РОССКО · необязательно<input ref={partsOrderRef} className="eco-input" inputMode="numeric" maxLength={20} pattern="[0-9]{1,20}" placeholder="Например: 123456789" value={partsOrder} disabled={Boolean(busy)} onChange={event => setPartsOrder(event.target.value)} /></label>
        <label>Когда ждём запчасти · необязательно<input className="eco-input" type="datetime-local" value={partsExpected} disabled={Boolean(busy)} onInput={event => setPartsExpected(event.currentTarget.value)} onChange={event => setPartsExpected(event.target.value)} /></label>
        {partsError && <p className={styles.formError} role="alert">{partsError}</p>}
        <EcoButton type="submit" variant="primary" className={styles.submit} disabled={Boolean(busy)}>{busy ? "Сохраняем…" : partsRow && simpleCaseStatus(partsRow) === "waiting_parts" ? "Сохранить" : "Сохранить и перенести"}</EcoButton>
        <div className={styles.partsDialogActions}><EcoButton type="button" disabled={Boolean(busy)} onClick={() => partsDialogRef.current?.close()}>Отмена</EcoButton>{partsRow && simpleCaseStatus(partsRow) !== "waiting_parts" && <EcoButton type="button" disabled={Boolean(busy)} onClick={() => void saveParts(true)}>Пропустить</EcoButton>}</div>
      </form>
    </dialog>
    <dialog ref={bookingCloseRef} className={styles.dialog} aria-labelledby="booking-close-title" aria-describedby="booking-close-description" onClose={() => setClosingBooking(null)} onCancel={event => { if (busy) event.preventDefault(); }}>
      <div className={styles.dialogHeading}><div><h2 id="booking-close-title">Клиент уже записан?</h2><p id="booking-close-description">Если клиент уже записан администратором, закройте заявку. Она перейдёт в историю.</p></div><button type="button" aria-label="Отменить закрытие" disabled={Boolean(busy)} onClick={() => bookingCloseRef.current?.close()}><X size={20} /></button></div>
      {closingBooking && <><div className={styles.formHeading}>{caseCustomerTitle(closingBooking)} · {closingBooking.title}</div><p className={styles.bookingCloseNote}>{closingBooking.appointmentId || closingBooking.yclientsRecordId ? "Закроем как «Клиент записан»." : "В истории сохраним: «Клиент записан вручную», кто подтвердил и время закрытия."}</p></>}
      {actionError && <p className={styles.formError} role="alert">{actionError}</p>}
      <div className={styles.actions}><EcoButton type="button" variant="primary" disabled={Boolean(busy)} onClick={() => void confirmBookingClose()}>{busy ? "Закрываем…" : "Да, закрыть заявку"}</EcoButton><EcoButton type="button" disabled={Boolean(busy)} onClick={() => bookingCloseRef.current?.close()}>Отмена</EcoButton></div>
    </dialog>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {actionError && <p className={styles.formError} role="alert">{actionError}</p>}
    {loadError && <div role="alert" className={styles.formError}>{loadError} <EcoButton onClick={() => void load(true)}>Повторить загрузку</EcoButton></div>}
    {urgentOnly && <p className={styles.filterNote}>Только просроченные <button onClick={() => setUrgentOnly(false)}>Показать все</button></p>}
    {loading ? <p className={styles.empty} role="status">Загружаем заявки…</p> : <>
      {view !== "closed" && <div className={`${styles.board} ${draggedId ? styles.boardDragging : ""}`} data-mobile-focus={mobileFocus}>
        {WORK_CASE_STATUSES.filter(status => view === "board" || view === status).map(status => {
          const index = WORK_CASE_STATUSES.indexOf(status);
          const items = rows.filter(row => simpleCaseStatus(row) === status);
          const titles = ["Нужно рассчитать", "Расчёт отправлен", "Запчасти заказаны", "Пришли — записать"];
          const hints = ["Сделать сегодня", "Ждём решения клиента", "Ждём поставку", "Позвонить клиенту"];
          const needsAction = status === "calculation_needed" || status === "parts_arrived";
          return <section key={status} id={`queue-${status}`} className={`${styles.column} ${needsAction ? styles.activeColumn : ""} ${dropTarget === status ? styles.dropTarget : ""}`} data-status={status} data-empty={items.length === 0} aria-label={WORK_CASE_LABELS[status]}
            onDragEnter={event => { if (canDrop(status)) event.preventDefault(); }}
            onDragOver={event => {
              if (!canDrop(status)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTarget(status);
            }}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(current => current === status ? null : current);
            }} onDrop={event => dropCase(event, status)}>
            {dropTarget === status && <div className={styles.dropHint}>Отпустите, чтобы сменить этап</div>}
            <header className={styles.columnHeading}><div><h2>{titles[index]} <span>{items.length}</span></h2><p>{hints[index]}</p></div>{needsAction && <span className={styles.actionDot} aria-label="Требует действия" />}</header>
            <div className={styles.columnCards}>{items.map(renderRow)}{!items.length && <p className={styles.columnEmpty}>{query ? "Совпадений нет" : status === "calculation_needed" ? "Все расчёты готовы" : status === "parts_arrived" ? "Поступлений пока нет" : "Пока нет заявок"}</p>}</div>
          </section>;
        })}
      </div>}
      {view !== "closed" && !hasMobileRows && <div className={styles.mobileBoardEmpty} role="status">
        <p>{query.trim() ? "В этом виде совпадений нет." : mobileFocus ? "Сейчас нет заявок, требующих действия." : "Заявок пока нет."}</p>
        {mobileFocus && rows.length > 0 && <EcoButton onClick={() => setMobileFocus(false)}>Показать все заявки</EcoButton>}
      </div>}
      {view === "closed" && <section className={styles.history} aria-label="История заявок">{rows.map(renderRow)}{!rows.length && <p className={styles.empty}>{query ? "Совпадений не найдено" : "Закрытые заявки появятся здесь после записи клиента."}</p>}</section>}
      {view !== "board" && view !== "closed" && <button className={styles.resetFilter} onClick={() => { setView("board"); setUrgentOnly(false); }}>Показать всю доску</button>}
    </>}
    <footer className={styles.footer}><span>Звонки и заявки с сайта — на одной доске. {formatServiceDate(now)}</span><Link href="/records"><CalendarClock size={15} />Журнал записей</Link></footer>
  </main>;
}
