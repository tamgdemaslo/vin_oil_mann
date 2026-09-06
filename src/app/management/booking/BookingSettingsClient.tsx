"use client";

import Link from "next/link";
import {
  Archive,
  CalendarClock,
  CalendarOff,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  Globe2,
  GripVertical,
  Info,
  Plus,
  Save,
  Settings2,
  UsersRound,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publicBookingPath } from "@/lib/booking/public-link";
import styles from "./settings.module.css";

type WorkingHour = {
  id?: string;
  weekday: number;
  isWorking: boolean;
  startTime: string | null;
  endTime: string | null;
};

type BookingSettings = {
  publicBookingEnabled: boolean;
  publicName: string | null;
  publicIntro: string | null;
  bookingStepMinutes: number;
  bookingHorizonDays: number;
  minimumLeadMinutes: number;
};

type Service = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  onlineBookingEnabled: boolean;
  requiresVin: boolean;
  requiresConfirmation: boolean;
  requiredFieldsJson: string[];
  sortOrder: number;
  status: string;
  catalogManaged?: boolean;
};

type Master = {
  membershipId: string;
  name: string;
  login: string;
  roleId: string;
  position: string | null;
  serviceIds: string[];
  workingHours: WorkingHour[];
};

type ScheduleException = {
  id: string;
  membershipId: string;
  localDate: string;
  kind: string;
  startTime: string | null;
  endTime: string | null;
  note: string | null;
};

type SettingsState = {
  branch: { id: string; name: string; shortName: string; address: string | null; timezone?: string };
  canManage: boolean;
  settings: BookingSettings;
  workingHours: WorkingHour[];
  services: Service[];
  masters: Master[];
  exceptions: ScheduleException[];
  readiness: {
    ready: boolean;
    availableWindowCount: number;
    checks: Array<{ code: string; label: string; ok: boolean; message: string; action: Tab }>;
  };
};

type Tab = "general" | "services" | "masters" | "exceptions";

type CatalogSyncResult = {
  catalogCount: number;
  added: number;
  updated: number;
  disabled: number;
};

type AffectedBooking = {
  id: string;
  status: string;
  master: { membershipId: string } | null;
  services: Array<{ id: string }>;
};

const DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

async function json<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || "Не удалось выполнить запрос");
  if (!body) throw new Error("Сервис вернул пустой ответ");
  return body;
}

function sevenHours(source: WorkingHour[], fallback: WorkingHour[]) {
  return Array.from({ length: 7 }, (_, index) => {
    const weekday = index + 1;
    const row = source.find((item) => item.weekday === weekday) ?? fallback.find((item) => item.weekday === weekday);
    return {
      weekday,
      isWorking: row?.isWorking ?? false,
      startTime: row?.startTime ?? (row?.isWorking ? "09:00" : null),
      endTime: row?.endTime ?? (row?.isWorking ? "19:00" : null),
    };
  });
}

export default function BookingSettingsClient() {
  const [tab, setTab] = useState<Tab>("general");
  const [state, setState] = useState<SettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirtyTabs, setDirtyTabs] = useState<Partial<Record<Tab, boolean>>>({});
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [dirtyServiceIds, setDirtyServiceIds] = useState<string[]>([]);
  const [, setDirtyMasterIds] = useState<string[]>([]);
  const [openServiceIds, setOpenServiceIds] = useState<string[]>([]);
  const [serviceOrderDirty, setServiceOrderDirty] = useState(false);
  const [draggedServiceId, setDraggedServiceId] = useState<string | null>(null);
  const [dragOverServiceId, setDragOverServiceId] = useState<string | null>(null);
  const draggedServiceRef = useRef<string | null>(null);
  const dragOverServiceRef = useRef<string | null>(null);
  const [newService, setNewService] = useState({ name: "", description: "", durationMinutes: 0, onlineBookingEnabled: false, requiresVin: false, requiresConfirmation: false, requiredFieldsJson: [] as string[], sortOrder: 0 });
  const [openMasterId, setOpenMasterId] = useState<string | null>(null);
  const [exceptionDraft, setExceptionDraft] = useState({ membershipId: "", localDate: "", kind: "CLOSED", startTime: "09:00", endTime: "18:00", note: "" });
  const [legacyMigration, setLegacyMigration] = useState<{ status: string; migratedAt: string | null; metadataJson: Record<string, unknown> } | null>(null);
  const [legacyFromDate, setLegacyFromDate] = useState("2020-01-01");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const settings = await json<SettingsState>(await fetch("/api/booking-admin/settings", { cache: "no-store" }));
      setState(settings);
      setDirtyTabs({});
      setScheduleDirty(false);
      setDirtyServiceIds([]);
      setDirtyMasterIds([]);
      setServiceOrderDirty(false);
      const legacyResponse = await fetch("/api/booking-admin/legacy-import", { cache: "no-store" });
      if (legacyResponse.ok) {
        const legacy = await json<{ migration: typeof legacyMigration }>(legacyResponse);
        setLegacyMigration(legacy.migration);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить настройки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeServices = useMemo(() => state?.services.filter((service) => service.status === "ACTIVE") ?? [], [state?.services]);

  function updateSettings<K extends keyof BookingSettings>(key: K, value: BookingSettings[K]) {
    setDirtyTabs((current) => ({ ...current, general: true }));
    setState((current) => current ? { ...current, settings: { ...current.settings, [key]: value } } : current);
  }

  function updateBranchHour(weekday: number, patch: Partial<WorkingHour>) {
    setDirtyTabs((current) => ({ ...current, general: true }));
    setScheduleDirty(true);
    setState((current) => current ? {
      ...current,
      workingHours: sevenHours(current.workingHours, []).map((row) => row.weekday === weekday ? { ...row, ...patch } : row),
    } : current);
  }

  function updateService(id: string, patch: Partial<Service>) {
    setDirtyTabs((current) => ({ ...current, services: true }));
    setDirtyServiceIds((current) => current.includes(id) ? current : [...current, id]);
    setState((current) => current ? { ...current, services: current.services.map((service) => service.id === id ? { ...service, ...patch } : service) } : current);
  }

  function toggleService(id: string) {
    setOpenServiceIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function moveService(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    setState((current) => {
      if (!current) return current;
      const sourceIndex = current.services.findIndex((service) => service.id === sourceId);
      const targetIndex = current.services.findIndex((service) => service.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const services = [...current.services];
      const [moved] = services.splice(sourceIndex, 1);
      const targetIndexAfterRemoval = services.findIndex((service) => service.id === targetId);
      const insertionIndex = sourceIndex < targetIndex ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
      services.splice(insertionIndex, 0, moved);
      return { ...current, services: services.map((service, index) => ({ ...service, sortOrder: index })) };
    });
    setServiceOrderDirty(true);
    setDirtyTabs((current) => ({ ...current, services: true }));
  }

  function beginServiceDrag(event: React.PointerEvent<HTMLButtonElement>, serviceId: string) {
    if (!state?.canManage || saving) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggedServiceRef.current = serviceId;
    dragOverServiceRef.current = serviceId;
    setDraggedServiceId(serviceId);
    setDragOverServiceId(serviceId);
    setOpenServiceIds((current) => current.filter((id) => id !== serviceId));
  }

  function continueServiceDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const sourceId = draggedServiceRef.current;
    if (!sourceId) return;
    event.preventDefault();
    const scrollEdge = 88;
    if (event.clientY < scrollEdge) window.scrollBy({ top: -18, behavior: "auto" });
    if (event.clientY > window.innerHeight - scrollEdge) window.scrollBy({ top: 18, behavior: "auto" });
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-booking-service-id]");
    const targetId = target?.dataset.bookingServiceId ?? null;
    if (!targetId || targetId === dragOverServiceRef.current) return;
    dragOverServiceRef.current = targetId;
    setDragOverServiceId(targetId);
    moveService(sourceId, targetId);
  }

  function finishServiceDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    draggedServiceRef.current = null;
    dragOverServiceRef.current = null;
    setDraggedServiceId(null);
    setDragOverServiceId(null);
  }

  function moveServiceWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>, serviceId: string) {
    if (!state?.canManage || saving || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    const index = state.services.findIndex((service) => service.id === serviceId);
    const target = state.services[index + (event.key === "ArrowUp" ? -1 : 1)];
    if (!target) return;
    event.preventDefault();
    moveService(serviceId, target.id);
  }

  function toggleRequiredField(service: Service, field: string) {
    const fields = Array.isArray(service.requiredFieldsJson) ? service.requiredFieldsJson : [];
    updateService(service.id, {
      requiredFieldsJson: fields.includes(field) ? fields.filter((item) => item !== field) : [...fields, field],
    });
  }

  function updateMaster(id: string, patch: Partial<Master>) {
    setDirtyTabs((current) => ({ ...current, masters: true }));
    setDirtyMasterIds((current) => current.includes(id) ? current : [...current, id]);
    setState((current) => current ? { ...current, masters: current.masters.map((master) => master.membershipId === id ? { ...master, ...patch } : master) } : current);
  }

  async function execute(operation: () => Promise<void>, success: string) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить изменения");
    } finally {
      setSaving(false);
    }
  }

  async function confirmAffectedBookings(
    message: (count: number) => string,
    filters: { masterMembershipId?: string; serviceId?: string } = {},
  ) {
    if (!state) return false;
    try {
      const from = new Date();
      const to = new Date(from.getTime() + Math.max(60, state.settings.bookingHorizonDays) * 24 * 60 * 60_000);
      const params = new URLSearchParams({
        branchId: state.branch.id,
        from: from.toISOString(),
        to: to.toISOString(),
      });
      if (filters.masterMembershipId) params.set("masterMembershipId", filters.masterMembershipId);
      const preview = await json<{ bookings: AffectedBooking[] }>(await fetch(`/api/bookings?${params}`, { cache: "no-store" }));
      const affected = preview.bookings.filter((booking) => (
        booking.status === "ACTIVE"
        && (!filters.serviceId || booking.services.some((service) => service.id === filters.serviceId))
      )).length;
      return affected === 0 || window.confirm(message(affected));
    } catch (cause) {
      setNotice("");
      setError(cause instanceof Error ? cause.message : "Не удалось проверить существующие записи");
      return false;
    }
  }

  async function saveGeneral() {
    if (!state) return;
    if (scheduleDirty && !await confirmAffectedBookings(
      (count) => `В ближайшем периоде есть ${count} активных записей. Новый график их не перенесёт и не отменит. Сохранить?`,
    )) return;
    await execute(async () => {
      await json(await fetch("/api/booking-admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...state.settings, workingHours: sevenHours(state.workingHours, []) }),
      }));
      setDirtyTabs((current) => ({ ...current, general: false }));
      setScheduleDirty(false);
    }, "Настройки филиала сохранены");
  }

  async function importLegacyHistory() {
    await execute(async () => {
      const result = await json<{ result: { imported: number; skipped: number; invalid: number } }>(await fetch("/api/booking-admin/legacy-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate: legacyFromDate, toDate: new Date().toISOString().slice(0, 10) }),
      }));
      setNotice(`Архив обработан: импортировано ${result.result.imported}, уже было ${result.result.skipped}, пропущено ${result.result.invalid}`);
      const status = await json<{ migration: typeof legacyMigration }>(await fetch("/api/booking-admin/legacy-import", { cache: "no-store" }));
      setLegacyMigration(status.migration);
    }, "Архив Yclients импортирован");
  }

  async function createService() {
    if (!state) return;
    await execute(async () => {
      const created = await json<{ service: Service }>(await fetch("/api/booking-admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newService,
          sortOrder: state.services.reduce((maximum, service) => Math.max(maximum, service.sortOrder), -1) + 1,
        }),
      }));
      setNewService({ name: "", description: "", durationMinutes: 0, onlineBookingEnabled: false, requiresVin: false, requiresConfirmation: false, requiredFieldsJson: [], sortOrder: 0 });
      setState((current) => current ? { ...current, services: [...current.services, { ...created.service, catalogManaged: false }] } : current);
    }, "Услуга добавлена");
  }

  async function syncCatalogServices() {
    if (Object.values(dirtyTabs).some(Boolean) && !window.confirm("Есть несохранённые изменения. Обновление из каталога их сбросит. Продолжить?")) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const sync = await json<{ result: CatalogSyncResult }>(await fetch("/api/booking-admin/services/sync", { method: "POST" }));
      const refreshed = await json<SettingsState>(await fetch("/api/booking-admin/settings", { cache: "no-store" }));
      setState(refreshed);
      setDirtyTabs({});
      setScheduleDirty(false);
      setDirtyServiceIds([]);
      setDirtyMasterIds([]);
      setServiceOrderDirty(false);
      setNotice(`В каталоге ${sync.result.catalogCount} услуг: добавлено ${sync.result.added}, обновлено ${sync.result.updated}, отключено ${sync.result.disabled}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось синхронизировать услуги");
    } finally {
      setSaving(false);
    }
  }

  async function saveService(service: Service) {
    if (!await confirmAffectedBookings(
      (count) => `Эта услуга есть в ${count} будущих активных записях. Изменение не перенесёт и не отменит их. Сохранить?`,
      { serviceId: service.id },
    )) return;
    await execute(async () => {
      await json(await fetch(`/api/booking-admin/services/${encodeURIComponent(service.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...service, sortOrder: undefined }),
      }));
      setDirtyServiceIds((current) => {
        const next = current.filter((id) => id !== service.id);
        setDirtyTabs((tabs) => ({ ...tabs, services: next.length > 0 || serviceOrderDirty }));
        return next;
      });
    }, `Услуга «${service.name}» сохранена`);
  }

  async function saveServiceOrder() {
    if (!state || !serviceOrderDirty) return;
    const serviceIds = state.services.map((service) => service.id);
    await execute(async () => {
      await json(await fetch("/api/booking-admin/services/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceIds }),
      }));
      setServiceOrderDirty(false);
      setDirtyTabs((current) => ({ ...current, services: dirtyServiceIds.length > 0 }));
    }, "Порядок услуг для клиента сохранён");
  }

  async function disableService(service: Service) {
    if (!await confirmAffectedBookings(
      (count) => `Эта услуга есть в ${count} будущих активных записях. Отключение не отменит их. Продолжить?`,
      { serviceId: service.id },
    )) return;
    await execute(async () => {
      await json(await fetch(`/api/booking-admin/services/${encodeURIComponent(service.id)}`, { method: "DELETE" }));
      setState((current) => current ? { ...current, services: current.services.map((item) => item.id === service.id ? { ...item, status: "INACTIVE", onlineBookingEnabled: false } : item) } : current);
    }, "Услуга отключена");
  }

  async function saveMaster(master: Master) {
    if (!state) return;
    const workingHours = sevenHours(master.workingHours, state.workingHours);
    if (!await confirmAffectedBookings(
      (count) => `У ${master.name} есть ${count} будущих активных записей. Новый график и назначения услуг их не перенесут и не отменят. Сохранить?`,
      { masterMembershipId: master.membershipId },
    )) return;
    await execute(async () => {
      await json(await fetch(`/api/booking-admin/masters/${encodeURIComponent(master.membershipId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceIds: master.serviceIds, workingHours }),
      }));
      updateMaster(master.membershipId, { workingHours });
      setDirtyMasterIds((current) => {
        const next = current.filter((id) => id !== master.membershipId);
        setDirtyTabs((tabs) => ({ ...tabs, masters: next.length > 0 }));
        return next;
      });
    }, `Расписание ${master.name} сохранено`);
  }

  async function addException() {
    if (!state || !exceptionDraft.membershipId || !exceptionDraft.localDate) return;
    try {
      const params = new URLSearchParams({
        branchId: state.branch.id,
        localFrom: exceptionDraft.localDate,
        localTo: exceptionDraft.localDate,
        masterMembershipId: exceptionDraft.membershipId,
      });
      const preview = await json<{ bookings: Array<{ status: string }> }>(await fetch(`/api/bookings?${params}`, { cache: "no-store" }));
      const affected = preview.bookings.filter((booking) => booking.status === "ACTIVE").length;
      if (affected > 0 && !window.confirm(`На эту дату у мастера уже ${affected} активных записей. Исключение их не перенесёт и не отменит. Сохранить?`)) return;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось проверить существующие записи");
      return;
    }
    await execute(async () => {
      await json(await fetch("/api/booking-admin/exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exceptionDraft),
      }));
      setExceptionDraft((current) => ({ ...current, localDate: "", note: "" }));
      await load();
    }, "Исключение расписания добавлено");
  }

  async function removeException(id: string) {
    await execute(async () => {
      await json(await fetch(`/api/booking-admin/exceptions/${encodeURIComponent(id)}`, { method: "DELETE" }));
      setState((current) => current ? { ...current, exceptions: current.exceptions.filter((item) => item.id !== id) } : current);
    }, "Исключение удалено");
  }

  if (loading) return <main className={`eco-page eco-page--wide ${styles.page}`}><div className={styles.loading}>Загружаем настройки записи…</div></main>;
  if (!state) return <main className={`eco-page eco-page--wide ${styles.page}`}><div className={styles.error}>{error || "Настройки недоступны"}</div></main>;

  const branchHours = sevenHours(state.workingHours, []);
  const workingDaysCount = branchHours.filter((row) => row.isWorking).length;
  const migrationLabel = legacyMigration?.status === "COMPLETED"
    ? "Импорт завершён"
    : legacyMigration?.status === "IN_PROGRESS"
      ? "Выполняется"
      : legacyMigration?.status === "FAILED"
        ? "Нужен повтор"
        : "Не запускался";
  const branchBookingHref = publicBookingPath(state.branch.id);

  async function copyBranchBookingLink() {
    try {
      const url = new URL(branchBookingHref, window.location.origin).toString();
      await navigator.clipboard.writeText(url);
      setError("");
      setNotice("Ссылка на запись в филиал скопирована");
    } catch {
      setNotice("");
      setError("Не удалось скопировать ссылку. Откройте форму и скопируйте адрес из браузера.");
    }
  }

  return (
    <main className={`eco-page eco-page--wide ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <div className={styles.crumbs}><Link href="/management">Управление</Link><span>/</span><span>Запись</span></div>
          <h1>Система записи</h1>
          <p>{state.branch.name}{state.branch.address ? ` · ${state.branch.address}` : ""} · готовность расписания и публичной формы</p>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.journalLink} href="/records">Открыть журнал</Link>
          <a className={styles.publicLink} href={branchBookingHref} target="_blank" rel="noreferrer">Открыть запись филиала <ExternalLink aria-hidden /></a>
        </div>
      </header>

      <section className={styles.readiness} aria-label="Готовность системы записи">
        <div className={styles.readinessHead}>
          <span><strong>{state.readiness.ready ? "Система готова к записи" : "Настройка не завершена"}</strong><small>{state.settings.publicBookingEnabled ? "Публичная форма включена" : "Публичная форма выключена"}</small></span>
          <b className={state.readiness.ready ? styles.ready : styles.notReady}>{state.readiness.checks.filter((item) => item.ok).length} из {state.readiness.checks.length}</b>
        </div>
        <div className={styles.readinessGrid}>{state.readiness.checks.map((check) => <button key={check.code} type="button" className={check.ok ? styles.checkReady : styles.checkProblem} onClick={() => setTab(check.action)}><span>{check.ok ? <Check aria-hidden /> : <Info aria-hidden />}</span><strong>{check.label}</strong><small>{check.message}</small></button>)}</div>
      </section>

      <nav className={styles.tabs} aria-label="Разделы настройки записи">
        {([
          ["general", Settings2, "Публикация и часы"],
          ["services", Wrench, "Услуги"],
          ["masters", UsersRound, "Мастера"],
          ["exceptions", CalendarOff, "Исключения"],
        ] as const).map(([id, Icon, label]) => <button type="button" key={id} className={tab === id ? styles.activeTab : ""} onClick={() => { setTab(id); setError(""); setNotice(""); }}><Icon aria-hidden /> {label}{dirtyTabs[id] ? <span className={styles.dirtyBadge}>Не сохранено</span> : null}</button>)}
      </nav>

      {error && <div className={styles.error} role="alert">{error}</div>}
      {notice && <div className={styles.notice} role="status"><Check aria-hidden /> {notice}</div>}

      {tab === "general" && (
        <div className={styles.generalWorkspace}>
          <section className={`${styles.panel} ${styles.publicPanel}`}>
            <div className={styles.sectionHeading}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionIcon}><Globe2 aria-hidden /></span>
                <div><h2>Публичная запись</h2><p>Как филиал видят клиенты и на каких условиях они могут записаться.</p></div>
              </div>
              <label className={styles.switch}>
                <input type="checkbox" checked={state.settings.publicBookingEnabled} onChange={(event) => updateSettings("publicBookingEnabled", event.target.checked)} disabled={!state.canManage} aria-label="Публичная запись" />
                <span />
                <strong>{state.settings.publicBookingEnabled ? "Запись открыта" : "Запись закрыта"}</strong>
              </label>
            </div>

            <div className={styles.shareLink}>
              <div>
                <strong>Ссылка для клиентов этого филиала</strong>
                <span>Филиал уже выбран — клиент сразу начнёт с автомобиля.</span>
              </div>
              <code>{branchBookingHref}</code>
              <button type="button" onClick={copyBranchBookingLink}><Copy aria-hidden /> Копировать ссылку</button>
            </div>

            <div className={styles.publicLayout}>
              <div className={styles.settingsGrid}>
                <label className={styles.wide}>
                  <span>Название в форме записи</span>
                  <input value={state.settings.publicName ?? ""} onChange={(event) => updateSettings("publicName", event.target.value)} disabled={!state.canManage} />
                  <small>Например: «Дачная 6В» или «Там где масло · Дачная».</small>
                </label>
                <label>
                  <span>Интервал слотов</span>
                  <div className={styles.inputWithSuffix}><input type="number" min={5} max={240} step={5} value={state.settings.bookingStepMinutes} onChange={(event) => updateSettings("bookingStepMinutes", Number(event.target.value))} disabled={!state.canManage} /><span>мин</span></div>
                  <small>Шаг между вариантами времени.</small>
                </label>
                <label>
                  <span>Запись вперёд</span>
                  <div className={styles.inputWithSuffix}><input type="number" min={1} max={365} value={state.settings.bookingHorizonDays} onChange={(event) => updateSettings("bookingHorizonDays", Number(event.target.value))} disabled={!state.canManage} /><span>дней</span></div>
                  <small>На сколько дней открыты слоты.</small>
                </label>
                <label>
                  <span>Минимум до визита</span>
                  <div className={styles.inputWithSuffix}><input type="number" min={0} value={state.settings.minimumLeadMinutes} onChange={(event) => updateSettings("minimumLeadMinutes", Number(event.target.value))} disabled={!state.canManage} /><span>мин</span></div>
                  <small>Минимальное время до визита.</small>
                </label>
                <label className={styles.wide}>
                  <span>Приветствие для клиента</span>
                  <textarea rows={3} value={state.settings.publicIntro ?? ""} onChange={(event) => updateSettings("publicIntro", event.target.value)} disabled={!state.canManage} placeholder="Коротко расскажите, что нужно знать перед записью" />
                  <small>Текст показывается над выбором филиала.</small>
                </label>
              </div>

              <aside className={styles.bookingSummary} aria-label="Сводка публичной записи">
                <span className={styles.summaryEyebrow}>Сейчас для клиента</span>
                <strong className={state.settings.publicBookingEnabled ? styles.summaryOpen : styles.summaryClosed}><span />{state.settings.publicBookingEnabled ? "Можно записаться" : "Форма закрыта"}</strong>
                <dl>
                  <div><dt>Доступно вперёд</dt><dd>{state.settings.bookingHorizonDays} дн.</dd></div>
                  <div><dt>Интервал слотов</dt><dd>{state.settings.bookingStepMinutes} мин.</dd></div>
                  <div><dt>Рабочих дней</dt><dd>{workingDaysCount} из 7</dd></div>
                </dl>
                <p><Info aria-hidden /> Свободные окна считаются по часам филиала, графику мастера и длительности услуги.</p>
              </aside>
            </div>
          </section>

          <section className={`${styles.panel} ${styles.hoursPanel}`}>
            <div className={styles.sectionHeading}>
              <div className={styles.sectionTitle}>
                <span className={styles.sectionIcon}><Clock3 aria-hidden /></span>
                <div><h2>Рабочая неделя</h2><p>Общие границы записи. График каждого мастера дополнительно ограничивает эти часы.</p></div>
              </div>
              <span className={styles.daysBadge}>{workingDaysCount} рабочих дней</span>
            </div>
            <div className={`${styles.hoursTable} ${styles.branchHours}`}>
              {branchHours.map((row) => (
                <div key={row.weekday} className={!row.isWorking ? styles.dayOff : ""}>
                  <label className={styles.dayControl}>
                    <input type="checkbox" checked={row.isWorking} onChange={(event) => updateBranchHour(row.weekday, { isWorking: event.target.checked, startTime: event.target.checked ? row.startTime || "09:00" : null, endTime: event.target.checked ? row.endTime || "19:00" : null })} disabled={!state.canManage} />
                    <span><strong>{DAYS[row.weekday - 1]}</strong><small>{row.isWorking ? "Филиал принимает записи" : "Выходной"}</small></span>
                  </label>
                  {row.isWorking ? (
                    <div className={styles.timeRange}>
                      <label><span>Открытие</span><input type="time" value={row.startTime ?? ""} onChange={(event) => updateBranchHour(row.weekday, { startTime: event.target.value })} disabled={!state.canManage} /></label>
                      <span>до</span>
                      <label><span>Закрытие</span><input type="time" value={row.endTime ?? ""} onChange={(event) => updateBranchHour(row.weekday, { endTime: event.target.value })} disabled={!state.canManage} /></label>
                    </div>
                  ) : <span className={styles.closedRange}>Запись закрыта</span>}
                </div>
              ))}
            </div>
          </section>

          <details className={styles.archivePanel}>
            <summary>
              <span className={styles.sectionIcon}><Archive aria-hidden /></span>
              <span><strong>Архив Yclients</strong><small>Разовый импорт старых записей</small></span>
              <span className={legacyMigration?.status === "COMPLETED" ? styles.migrationDone : styles.migrationPending}>{migrationLabel}</span>
              <ChevronDown aria-hidden className={styles.archiveChevron} />
            </summary>
            <div className={styles.archiveBody}>
              <p>Внешние идентификаторы не дублируются, поэтому импорт можно повторить. Новые записи в Yclients не отправляются.</p>
              <div className={styles.migrationRow}>
                <label><span>Импортировать с даты</span><input type="date" value={legacyFromDate} onChange={(event) => setLegacyFromDate(event.target.value)} disabled={!state.canManage || saving} /></label>
                {state.canManage && <button type="button" className={styles.secondary} onClick={importLegacyHistory} disabled={saving || legacyMigration?.status === "IN_PROGRESS"}>Импортировать архив</button>}
              </div>
            </div>
          </details>

          {state.canManage && <footer className={`${styles.footer} ${styles.stickyFooter}`}><span>Изменения повлияют на доступные клиентам окна</span><button type="button" className={styles.primary} onClick={saveGeneral} disabled={saving}><Save aria-hidden /> {saving ? "Сохраняем…" : "Сохранить и опубликовать"}</button></footer>}
        </div>
      )}

      {tab === "services" && (
        <section className={styles.panel}>
          <div className={styles.sectionHeading}>
            <div><h2>Услуги филиала</h2><p>Перетащите услуги за ручку — в таком порядке их увидит клиент. Нажмите на услугу, чтобы изменить длительность и условия записи.</p></div>
            {state.canManage && <div className={styles.sectionActions}>
              {serviceOrderDirty && <span className={styles.orderDirty}>Порядок изменён</span>}
              <button type="button" className={styles.primary} onClick={saveServiceOrder} disabled={saving || !serviceOrderDirty}><Save aria-hidden /> Сохранить порядок</button>
              <button type="button" className={styles.secondary} onClick={syncCatalogServices} disabled={saving}>{saving ? "Синхронизируем…" : "Обновить из каталога"}</button>
            </div>}
          </div>
          <div className={styles.serviceList}>
            {state.services.map((service, index) => {
              const disabled = !state.canManage || service.status !== "ACTIVE";
              const open = openServiceIds.includes(service.id);
              const dragging = draggedServiceId === service.id;
              const dragTarget = Boolean(draggedServiceId && dragOverServiceId === service.id && !dragging);
              return (
                <article
                  key={service.id}
                  data-booking-service-id={service.id}
                  className={`${styles.serviceRow} ${open ? styles.serviceRowOpen : ""} ${service.status !== "ACTIVE" ? styles.inactiveRow : ""} ${dragging ? styles.draggingRow : ""} ${dragTarget ? styles.dragTargetRow : ""}`}
                >
                  <div className={styles.serviceRowHead}>
                    <button
                      type="button"
                      className={styles.dragHandle}
                      aria-label={`Изменить порядок услуги «${service.name}»`}
                      title="Перетащите или используйте стрелки вверх и вниз"
                      disabled={!state.canManage || saving}
                      onPointerDown={(event) => beginServiceDrag(event, service.id)}
                      onPointerMove={continueServiceDrag}
                      onPointerUp={finishServiceDrag}
                      onPointerCancel={finishServiceDrag}
                      onKeyDown={(event) => moveServiceWithKeyboard(event, service.id)}
                    >
                      <GripVertical aria-hidden />
                    </button>
                    <button
                      type="button"
                      className={styles.serviceSummary}
                      aria-expanded={open}
                      aria-controls={`booking-service-${service.id}`}
                      onClick={() => toggleService(service.id)}
                    >
                      <span className={styles.orderBadge}>{index + 1}</span>
                      <span className={styles.serviceSummaryCopy}>
                        <strong>{service.name}</strong>
                        <small>{service.durationMinutes} мин · {service.catalogManaged ? "из каталога" : "вручную"}</small>
                      </span>
                      <span className={service.status === "ACTIVE" && service.onlineBookingEnabled ? styles.clientVisible : styles.clientHidden}>
                        {service.status !== "ACTIVE" ? "Отключена" : service.onlineBookingEnabled ? "Видна клиентам" : "Скрыта от клиентов"}
                      </span>
                      {dirtyServiceIds.includes(service.id) && <span className={styles.serviceDirty}>Не сохранено</span>}
                      <ChevronDown aria-hidden className={open ? styles.rotated : ""} />
                    </button>
                  </div>

                  {open && <div id={`booking-service-${service.id}`} className={styles.serviceBody}>
                    <div className={styles.serviceIdentity}>
                      <label>
                        <span>Название услуги</span>
                        <input value={service.name} onChange={(event) => updateService(service.id, { name: event.target.value })} disabled={disabled || service.catalogManaged} />
                      </label>
                      <label>
                        <span>Описание для клиента</span>
                        <input value={service.description ?? ""} onChange={(event) => updateService(service.id, { description: event.target.value })} placeholder="Коротко опишите результат услуги" disabled={disabled || service.catalogManaged} />
                      </label>
                      {service.catalogManaged && <small className={styles.catalogBadge}>Название и описание берутся из каталога</small>}
                    </div>

                    <div className={styles.serviceConfig}>
                      <div className={styles.serviceNumbers}>
                        <label>
                          <span>Длительность</span>
                          <div className={styles.serviceNumberControl}><input type="number" min={5} step={5} value={service.durationMinutes} onChange={(event) => updateService(service.id, { durationMinutes: Number(event.target.value) })} disabled={disabled} /><span>мин</span></div>
                        </label>
                      </div>

                      <div className={styles.serviceToggles}>
                        <label><input type="checkbox" checked={service.onlineBookingEnabled} onChange={(event) => updateService(service.id, { onlineBookingEnabled: event.target.checked })} disabled={disabled} /><span><strong>Онлайн-запись</strong><small>Показывать клиентам</small></span></label>
                        <label><input type="checkbox" checked={service.requiresVin} onChange={(event) => updateService(service.id, { requiresVin: event.target.checked })} disabled={disabled} /><span><strong>VIN</strong><small>Обязателен при записи</small></span></label>
                        <label><input type="checkbox" checked={service.requiresConfirmation} onChange={(event) => updateService(service.id, { requiresConfirmation: event.target.checked })} disabled={disabled} /><span><strong>Подтверждение</strong><small>Проверить вручную</small></span></label>
                      </div>

                      <div className={styles.serviceRequired}>
                        <span>Дополнительно спросить</span>
                        <label><input type="checkbox" checked={service.requiredFieldsJson?.includes("email") ?? false} onChange={() => toggleRequiredField(service, "email")} disabled={disabled} />Email</label>
                        <label><input type="checkbox" checked={service.requiredFieldsJson?.includes("plate") ?? false} onChange={() => toggleRequiredField(service, "plate")} disabled={disabled} />Госномер</label>
                        <label><input type="checkbox" checked={service.requiredFieldsJson?.includes("year") ?? false} onChange={() => toggleRequiredField(service, "year")} disabled={disabled} />Год автомобиля</label>
                      </div>

                      {service.status === "ACTIVE" && state.canManage && (
                        <div className={styles.serviceActions}>
                          {!service.catalogManaged && <button type="button" className={styles.mutedAction} onClick={() => disableService(service)} disabled={saving}>Отключить</button>}
                          <button type="button" className={styles.primary} onClick={() => saveService(service)} disabled={saving}><Save aria-hidden /> Сохранить услугу</button>
                        </div>
                      )}
                    </div>
                  </div>}
                </article>
              );
            })}
          </div>
          {state.canManage && <div className={styles.createService}><h3>Новая услуга</h3><p className={styles.createHint}>Новая услуга добавится в конец списка. После создания её можно перетащить на нужное место.</p><div className={styles.formGrid}><label><span>Название</span><input value={newService.name} onChange={(event) => setNewService((current) => ({ ...current, name: event.target.value }))} /></label><label><span>Длительность, минут</span><input type="number" min={5} step={5} value={newService.durationMinutes || ""} placeholder="Укажите" onChange={(event) => setNewService((current) => ({ ...current, durationMinutes: Number(event.target.value) }))} /></label><label className={styles.wide}><span>Описание</span><input value={newService.description} onChange={(event) => setNewService((current) => ({ ...current, description: event.target.value }))} /></label></div><div className={styles.inlineChecks}><label><input type="checkbox" checked={newService.onlineBookingEnabled} onChange={(event) => setNewService((current) => ({ ...current, onlineBookingEnabled: event.target.checked }))} />Онлайн-запись</label><label><input type="checkbox" checked={newService.requiresVin} onChange={(event) => setNewService((current) => ({ ...current, requiresVin: event.target.checked }))} />Требовать VIN</label><label><input type="checkbox" checked={newService.requiresConfirmation} onChange={(event) => setNewService((current) => ({ ...current, requiresConfirmation: event.target.checked }))} />Ручное подтверждение</label><label><input type="checkbox" checked={newService.requiredFieldsJson.includes("email")} onChange={() => setNewService((current) => ({ ...current, requiredFieldsJson: current.requiredFieldsJson.includes("email") ? current.requiredFieldsJson.filter((field) => field !== "email") : [...current.requiredFieldsJson, "email"] }))} />Требовать email</label><label><input type="checkbox" checked={newService.requiredFieldsJson.includes("plate")} onChange={() => setNewService((current) => ({ ...current, requiredFieldsJson: current.requiredFieldsJson.includes("plate") ? current.requiredFieldsJson.filter((field) => field !== "plate") : [...current.requiredFieldsJson, "plate"] }))} />Требовать госномер</label><label><input type="checkbox" checked={newService.requiredFieldsJson.includes("year")} onChange={() => setNewService((current) => ({ ...current, requiredFieldsJson: current.requiredFieldsJson.includes("year") ? current.requiredFieldsJson.filter((field) => field !== "year") : [...current.requiredFieldsJson, "year"] }))} />Требовать год</label></div><button type="button" className={styles.primary} onClick={createService} disabled={saving || !newService.name.trim() || newService.durationMinutes < 5}><Plus aria-hidden /> Добавить услугу</button></div>}
        </section>
      )}

      {tab === "masters" && (
        <section className={styles.panel}>
          <div className={styles.sectionHeading}><div><h2>Мастера и расписания</h2><p>Сотрудник попадает в доступность только для назначенных ему услуг и рабочих часов.</p></div></div>
          <div className={styles.masterList}>
            {state.masters.map((master) => {
              const open = openMasterId === master.membershipId;
              const hours = sevenHours(master.workingHours, state.workingHours);
              return <article key={master.membershipId}><button type="button" className={styles.masterHead} onClick={() => setOpenMasterId(open ? null : master.membershipId)}><span><strong>{master.name}</strong><small>{master.position || master.roleId} · {master.serviceIds.length} услуг</small></span><ChevronDown aria-hidden className={open ? styles.rotated : ""} /></button>{open && <div className={styles.masterBody}><h3>Услуги</h3><div className={styles.assignmentGrid}>{activeServices.map((service) => <label key={service.id}><input type="checkbox" checked={master.serviceIds.includes(service.id)} onChange={() => updateMaster(master.membershipId, { serviceIds: master.serviceIds.includes(service.id) ? master.serviceIds.filter((id) => id !== service.id) : [...master.serviceIds, service.id] })} disabled={!state.canManage} />{service.name}</label>)}</div><h3>Рабочая неделя</h3><div className={styles.hoursTable}>{hours.map((row) => <div key={row.weekday}><label><input type="checkbox" checked={row.isWorking} onChange={(event) => updateMaster(master.membershipId, { workingHours: hours.map((item) => item.weekday === row.weekday ? { ...item, isWorking: event.target.checked, startTime: event.target.checked ? item.startTime || "09:00" : null, endTime: event.target.checked ? item.endTime || "19:00" : null } : item) })} disabled={!state.canManage} />{DAYS[row.weekday - 1]}</label><input type="time" value={row.startTime ?? ""} onChange={(event) => updateMaster(master.membershipId, { workingHours: hours.map((item) => item.weekday === row.weekday ? { ...item, startTime: event.target.value } : item) })} disabled={!row.isWorking || !state.canManage} /><span>—</span><input type="time" value={row.endTime ?? ""} onChange={(event) => updateMaster(master.membershipId, { workingHours: hours.map((item) => item.weekday === row.weekday ? { ...item, endTime: event.target.value } : item) })} disabled={!row.isWorking || !state.canManage} /></div>)}</div>{state.canManage && <button type="button" className={styles.primary} onClick={() => saveMaster({ ...master, workingHours: hours })} disabled={saving}><Save aria-hidden /> Сохранить мастера</button>}</div>}</article>;
            })}
          </div>
        </section>
      )}

      {tab === "exceptions" && (
        <section className={styles.panel}>
          <div className={styles.sectionHeading}><div><h2>Исключения расписания</h2><p>Выходной, отпуск или индивидуальные часы мастера на конкретную дату.</p></div></div>
          {state.canManage && <div className={styles.exceptionForm}><label><span>Мастер</span><select value={exceptionDraft.membershipId} onChange={(event) => setExceptionDraft((current) => ({ ...current, membershipId: event.target.value }))}><option value="">Выберите</option>{state.masters.map((master) => <option key={master.membershipId} value={master.membershipId}>{master.name}</option>)}</select></label><label><span>Дата</span><input type="date" value={exceptionDraft.localDate} onChange={(event) => setExceptionDraft((current) => ({ ...current, localDate: event.target.value }))} /></label><label><span>Тип</span><select value={exceptionDraft.kind} onChange={(event) => setExceptionDraft((current) => ({ ...current, kind: event.target.value }))}><option value="CLOSED">Выходной</option><option value="CUSTOM">Особые часы</option></select></label>{exceptionDraft.kind === "CUSTOM" && <><label><span>С</span><input type="time" value={exceptionDraft.startTime} onChange={(event) => setExceptionDraft((current) => ({ ...current, startTime: event.target.value }))} /></label><label><span>До</span><input type="time" value={exceptionDraft.endTime} onChange={(event) => setExceptionDraft((current) => ({ ...current, endTime: event.target.value }))} /></label></>}<label className={styles.wide}><span>Комментарий</span><input value={exceptionDraft.note} onChange={(event) => setExceptionDraft((current) => ({ ...current, note: event.target.value }))} /></label><button type="button" className={styles.primary} onClick={addException} disabled={saving || !exceptionDraft.membershipId || !exceptionDraft.localDate}><Plus aria-hidden /> Добавить</button></div>}
          <div className={styles.exceptionList}>{state.exceptions.map((item) => { const master = state.masters.find((candidate) => candidate.membershipId === item.membershipId); return <div key={item.id}><CalendarClock aria-hidden /><span><strong>{item.localDate} · {master?.name || "Сотрудник"}</strong><small>{item.kind === "CLOSED" ? "Выходной" : `${item.startTime}–${item.endTime}`}{item.note ? ` · ${item.note}` : ""}</small></span>{state.canManage && <button type="button" onClick={() => removeException(item.id)}>Удалить</button>}</div>; })}{!state.exceptions.length && <p className={styles.empty}>Исключений пока нет.</p>}</div>
        </section>
      )}
    </main>
  );
}
