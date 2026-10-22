"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarClock, ChevronDown, Phone, Plus, Search } from "lucide-react";
import { EcoButton } from "@/components/platform/EcoUI";
import { formatServiceDate } from "@/lib/date-time";
import { formatPhoneForDisplay, normalizePhoneKey } from "@/lib/phone-normalize";
import { simpleCaseDeadline, simpleCaseStatus, WORK_CASE_LABELS, WORK_CASE_STATUSES, type SimpleCaseStatus } from "@/lib/client-case-simple";
import type { ClientCaseAction } from "@/lib/client-case-shared";
import styles from "./simple-crm.module.css";

type Deal = {
  id: string; title: string; customerName: string | null; phoneNormalized: string | null;
  vehicle: string | null; source: string | null; notes: string | null; createdByLogin: string;
  createdAt: string; updatedAt: string; status: string; caseStatus?: string | null;
  nextAction?: string | null; nextActionAt?: string | null; nextContactAt?: string | null;
  yclientsRecordId: string | null; appointmentId?: string | null; shipmentId: string | null;
  suppliesNote?: string | null; suppliesExpectedAt?: string | null; closeReason?: string | null;
};
type Stage = { id: string; name: string; deals: Deal[] };
type Case = Deal & { stage: Stage };
type Form = { phone: string; title: string; customerName: string; vehicle: string };
const EMPTY_FORM: Form = { phone: "", title: "", customerName: "", vehicle: "" };
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
    params.set("comment", [deal.title, deal.notes].filter(Boolean).join("\n"));
    if (deal.phoneNormalized) params.set("phone", deal.phoneNormalized);
    if (deal.customerName) params.set("client", deal.customerName);
    if (deal.vehicle) params.set("vehicle", deal.vehicle);
  }
  return `/records?${params}`;
}

function calculationHref(deal: Deal) {
  if (deal.shipmentId) return `/shipment/${encodeURIComponent(deal.shipmentId)}/edit`;
  const params = new URLSearchParams({ crmDealId: deal.id, comment: [deal.title, deal.notes].filter(Boolean).join("\n") });
  if (deal.customerName) params.set("counterparty", deal.customerName);
  if (deal.phoneNormalized) params.set("phone", deal.phoneNormalized);
  if (deal.vehicle) params.set("vehicle", deal.vehicle);
  return `/shipment/new?${params}`;
}

export default function CrmPipelineClient({ userLogin, userName }: { userLogin: string; userName: string | null }) {
  const searchParams = useSearchParams();
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<SimpleCaseStatus>("calculation_needed");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
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
      setEdit({ title: found.title, phone: found.phoneNormalized || "", customerName: found.customerName || "", vehicle: found.vehicle || "", notes: found.notes || "" });
    }
  }, [searchParams, cases]);

  const counts = useMemo(() => Object.fromEntries([...WORK_CASE_STATUSES, "closed"].map(status => [status, cases.filter(row => simpleCaseStatus(row) === status).length])), [cases]);
  const rows = useMemo(() => cases.filter(row => {
    if (simpleCaseStatus(row) !== view) return false;
    if (urgentOnly && !(simpleCaseDeadline(row) && simpleCaseDeadline(row)! < now)) return false;
    const haystack = [row.title, row.customerName, row.phoneNormalized, row.vehicle, row.notes, row.createdByLogin].join(" ").toLowerCase();
    const digits = query.replace(/\D/g, "");
    return !query.trim() || haystack.includes(query.trim().toLowerCase()) || (digits.length >= 4 && Boolean(row.phoneNormalized?.includes(digits)));
  }).sort((a, b) => {
    if (view === "closed") return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    return (simpleCaseDeadline(a)?.getTime() ?? Date.parse(a.createdAt)) - (simpleCaseDeadline(b)?.getTime() ?? Date.parse(b.createdAt));
  }), [cases, view, query, urgentOnly, now]);
  const overdue = rows.filter(row => { const due = simpleCaseDeadline(row); return due && due < now; });
  const remaining = rows.filter(row => !overdue.includes(row));

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
      setForm(EMPTY_FORM); setView("calculation_needed"); setQuery(""); setUrgentOnly(false);
      setNotice("Заявка добавлена. Рассчитать сегодня.");
      await load();
    } catch (error) { setFormError(error instanceof Error ? error.message : "Не удалось добавить заявку. Попробуйте ещё раз."); }
    finally { submitting.current = false; setSaving(false); requestAnimationFrame(() => phoneRef.current?.focus()); }
  }

  async function action(row: Case, action: ClientCaseAction, body: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(row.id); setActionError(null); setNotice("");
    try {
      const res = await fetch(`/api/client-cases/${encodeURIComponent(row.id)}/action`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, action }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось обновить заявку");
      await load();
      setNotice(action === "mark_calculation_sent" ? "Расчёт отмечен отправленным. Напоминаний об ответе не будет." : "Заявка обновлена");
    } catch (error) { setActionError(error instanceof Error ? error.message : "Не удалось обновить заявку"); }
    finally { setBusy(null); }
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>, row: Case) {
    event.preventDefault();
    if (busy) return;
    if (!edit.title.trim()) { setActionError("Укажите запрос клиента"); return; }
    if (edit.phone.trim() && !normalizePhoneKey(edit.phone)) { setActionError("Проверьте телефон клиента"); return; }
    setBusy(row.id); setActionError(null);
    try {
      const res = await fetch(`/api/crm/deals/${encodeURIComponent(row.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить изменения");
      setEditing(null); await load(); setNotice("Изменения сохранены");
    } catch (error) { setActionError(error instanceof Error ? error.message : "Не удалось сохранить изменения"); }
    finally { setBusy(null); }
  }

  function renderRow(row: Case) {
    const status = simpleCaseStatus(row);
    const due = simpleCaseDeadline(row);
    const isOverdue = due && due < now;
    const isEditing = editing === row.id;
    const hasBooking = Boolean(row.yclientsRecordId || row.appointmentId);
    return <article className={styles.row} key={row.id} id={`case-${row.id}`}>
      <div className={styles.client}>
        <strong>{row.customerName || (row.phoneNormalized ? <a href={phoneHref(row.phoneNormalized)}>{formatPhoneForDisplay(row.phoneNormalized)}</a> : "Клиент")}</strong>
        {row.customerName && row.phoneNormalized && <a href={phoneHref(row.phoneNormalized)}>{formatPhoneForDisplay(row.phoneNormalized)}</a>}
        {!row.phoneNormalized && <span>Телефон не указан</span>}
      </div>
      <div className={styles.vehicle}>{row.vehicle || "Авто не указано"}</div>
      <div className={styles.request}><strong>{row.title}</strong><span>Создал: {creatorName(row.createdByLogin)} · {formatServiceDate(row.createdAt)}{row.source === "client-site" ? " · С сайта" : ""}</span></div>
      <div className={styles.deadline}>
        {status === "calculation_needed" && <span className={isOverdue ? styles.overdueBadge : styles.todayBadge}>{isOverdue ? "Просрочено" : "Сегодня"}</span>}
        {status === "parts_arrived" && <span className={styles.todayBadge}>Позвонить и записать</span>}
        {status === "waiting_parts" && <span>{row.suppliesExpectedAt ? `Ждём ${formatServiceDate(row.suppliesExpectedAt)}` : "Ждём поставку"}</span>}
        {status === "calculation_sent" && <span>Ждём решения клиента</span>}
        {status === "closed" && <span>{row.closeReason || "Закрыто"}</span>}
      </div>
      <div className={styles.actions}>
        {status === "calculation_needed" && <><Link className="eco-btn" href={calculationHref(row)}>Рассчитать</Link><EcoButton variant="primary" disabled={Boolean(busy)} onClick={() => void action(row, "mark_calculation_sent")}>Расчёт отправлен</EcoButton></>}
        {status === "calculation_sent" && <EcoButton disabled={Boolean(busy)} onClick={() => void action(row, "waiting_parts")}>Запчасти заказаны</EcoButton>}
        {status === "waiting_parts" && <EcoButton variant="primary" disabled={Boolean(busy)} onClick={() => void action(row, "parts_arrived")}>Запчасти пришли</EcoButton>}
        {status === "parts_arrived" && <>{row.phoneNormalized && <a className="eco-btn" href={phoneHref(row.phoneNormalized)}><Phone size={15} />Позвонить</a>}<Link className="eco-btn eco-btn--primary" href={recordsHref(row)}>{hasBooking ? "Открыть запись" : "Записать"}</Link>{hasBooking && <EcoButton disabled={Boolean(busy)} onClick={() => void action(row, "close", { reason: "Клиент записан" })}>Клиент записан</EcoButton>}</>}
      </div>
      <details className={styles.details} open={isEditing || undefined}>
        <summary>Подробнее <ChevronDown size={14} /></summary>
        <div className={styles.detailsBody}>
          {row.notes && <p className={styles.notes}>{row.notes}</p>}
          {row.suppliesNote && <p>Запчасти: {row.suppliesNote}</p>}
          {row.source && <p>Источник: {row.source === "client-site" ? "Сайт" : row.source}</p>}
          {isEditing ? <form onSubmit={event => void saveDetails(event, row)} className={styles.editForm}>
            <label>Что рассчитать<input className="eco-input" value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} required /></label>
            <label>Телефон<input className="eco-input" type="tel" value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></label>
            <label>Имя<input className="eco-input" value={edit.customerName} onChange={e => setEdit({ ...edit, customerName: e.target.value })} /></label>
            <label>Автомобиль<input className="eco-input" value={edit.vehicle} onChange={e => setEdit({ ...edit, vehicle: e.target.value })} /></label>
            <label>Комментарий<textarea className="eco-input" value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></label>
            <div className={styles.actions}><EcoButton type="submit" variant="primary" disabled={Boolean(busy)}>Сохранить</EcoButton><EcoButton type="button" disabled={Boolean(busy)} onClick={() => setEditing(null)}>Отмена</EcoButton></div>
          </form> : <div className={styles.actions}>
            <EcoButton onClick={() => { setEdit({ title: row.title, phone: row.phoneNormalized || "", customerName: row.customerName || "", vehicle: row.vehicle || "", notes: row.notes || "" }); setEditing(row.id); }}>Редактировать</EcoButton>
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
    <header className={styles.header}><div><h1>Заявки клиентов</h1><p>Рассчитайте сегодня — ничего не потеряется.</p></div><label className={styles.search}><Search size={16} /><input aria-label="Поиск заявок" placeholder="Клиент, телефон, авто…" value={query} onChange={e => setQuery(e.target.value)} /></label></header>
    <nav className={styles.tabs} aria-label="Статусы заявок">
      {WORK_CASE_STATUSES.map(status => <button key={status} aria-current={view === status ? "page" : undefined} onClick={() => { setView(status); setUrgentOnly(false); }}>{WORK_CASE_LABELS[status]} <span>{counts[status] || 0}</span></button>)}
      <button className={styles.archive} aria-current={view === "closed" ? "page" : undefined} onClick={() => { setView("closed"); setUrgentOnly(false); }}>Закрытые <span>{counts.closed || 0}</span></button>
    </nav>
    <label className={styles.mobileStatus}>Показать<select value={view} onChange={event => { setView(event.target.value as SimpleCaseStatus); setUrgentOnly(false); }}>
      {[...WORK_CASE_STATUSES, "closed" as const].map(status => <option key={status} value={status}>{WORK_CASE_LABELS[status]} · {counts[status] || 0}</option>)}
    </select></label>
    <form className={styles.quickForm} onSubmit={event => void create(event)} aria-label="Новая заявка">
      <div className={styles.formHeading}><h2>Новая заявка</h2><span>Рассчитать сегодня</span></div>
      <label className={styles.phoneField}>Телефон<input ref={phoneRef} type="tel" inputMode="tel" autoComplete="tel" className="eco-input" placeholder="+7 900 000-00-00" required value={form.phone} disabled={saving} aria-invalid={Boolean(formError) || undefined} aria-describedby={formError ? "request-form-error" : undefined} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
      <label className={styles.titleField}>Что рассчитать<input className="eco-input" placeholder="Например: замена масла в АКПП" required maxLength={500} value={form.title} disabled={saving} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <details className={styles.optional}><summary>Имя и авто <ChevronDown size={14} /></summary><div><label>Имя · необязательно<input className="eco-input" autoComplete="name" value={form.customerName} disabled={saving} onChange={e => setForm({ ...form, customerName: e.target.value })} /></label><label>Авто / VIN · необязательно<input className="eco-input" value={form.vehicle} disabled={saving} onChange={e => setForm({ ...form, vehicle: e.target.value })} /></label></div></details>
      <EcoButton className={styles.submit} type="submit" variant="primary" disabled={saving || Boolean(loadError) || loading}><Plus size={16} />{saving ? "Добавляем…" : "Добавить заявку"}</EcoButton>
      {formError && <p className={styles.formError} role="alert" id="request-form-error">{formError}</p>}
      <small className={styles.creator}>Создаст: {userName || creatorName(userLogin)}</small>
    </form>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {actionError && <p className={styles.formError} role="alert">{actionError}</p>}
    {loadError && <div role="alert" className={styles.formError}>{loadError} <EcoButton onClick={() => void load(true)}>Повторить загрузку</EcoButton></div>}
    {urgentOnly && <p className={styles.filterNote}>Только просроченные <button onClick={() => setUrgentOnly(false)}>Показать все</button></p>}
    <section className={styles.list} aria-label={WORK_CASE_LABELS[view]} aria-busy={loading}>
      {loading ? <p className={styles.empty}>Загружаем заявки…</p> : <>
        {overdue.length > 0 && <><h3 className={styles.overdueHeading}><AlertCircle size={17} />Просроченные <span>{overdue.length}</span></h3>{overdue.map(renderRow)}</>}
        {remaining.length > 0 && <>{view === "calculation_needed" && <h3 className={styles.todayHeading}>На сегодня <span>{remaining.length}</span></h3>}{remaining.map(renderRow)}</>}
        {!rows.length && !loadError && <p className={styles.empty}>{query ? "По этому запросу ничего не найдено. Попробуйте телефон или имя." : view === "calculation_needed" ? "Все расчёты готовы. После звонка добавьте телефон и запрос в строку выше." : view === "parts_arrived" ? "Поступивших запчастей пока нет. Когда заказ придёт, отметьте «Запчасти пришли»." : "В этом разделе пока нет заявок."}</p>}
      </>}
    </section>
    <footer className={styles.footer}><span>Звонки и заявки с сайта — в одном списке. {formatServiceDate(now)}</span><Link href="/records"><CalendarClock size={15} />Журнал записей</Link></footer>
  </main>;
}
