"use client";

import Link from "next/link";
import {
  Archive,
  CalendarClock,
  CalendarOff,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  Globe2,
  Info,
  Plus,
  Save,
  Settings2,
  UsersRound,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  branch: { id: string; name: string; shortName: string; address: string | null };
  canManage: boolean;
  settings: BookingSettings;
  workingHours: WorkingHour[];
  services: Service[];
  masters: Master[];
  exceptions: ScheduleException[];
};

type Tab = "general" | "services" | "masters" | "exceptions";

type CatalogSyncResult = {
  catalogCount: number;
  added: number;
  updated: number;
  disabled: number;
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
  const [newService, setNewService] = useState({ name: "", description: "", durationMinutes: 60, onlineBookingEnabled: true, requiresVin: false, requiresConfirmation: false, requiredFieldsJson: [] as string[], sortOrder: 0 });
  const [openMasterId, setOpenMasterId] = useState<string | null>(null);
  const [exceptionDraft, setExceptionDraft] = useState({ membershipId: "", localDate: "", kind: "CLOSED", startTime: "09:00", endTime: "18:00", note: "" });
  const [legacyMigration, setLegacyMigration] = useState<{ status: string; migratedAt: string | null; metadataJson: Record<string, unknown> } | null>(null);
  const [legacyFromDate, setLegacyFromDate] = useState("2020-01-01");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let settings = await json<SettingsState>(await fetch("/api/booking-admin/settings", { cache: "no-store" }));
      if (settings.canManage) {
        try {
          const sync = await json<{ result: CatalogSyncResult }>(await fetch("/api/booking-admin/services/sync", { method: "POST" }));
          if (sync.result.added || sync.result.updated || sync.result.disabled) {
            settings = await json<SettingsState>(await fetch("/api/booking-admin/settings", { cache: "no-store" }));
          }
        } catch (cause) {
          setError(cause instanceof Error ? `Настройки загружены, но каталог услуг не синхронизирован: ${cause.message}` : "Каталог услуг не синхронизирован");
        }
      }
      setState(settings);
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
    setState((current) => current ? { ...current, settings: { ...current.settings, [key]: value } } : current);
  }

  function updateBranchHour(weekday: number, patch: Partial<WorkingHour>) {
    setState((current) => current ? {
      ...current,
      workingHours: sevenHours(current.workingHours, []).map((row) => row.weekday === weekday ? { ...row, ...patch } : row),
    } : current);
  }

  function updateService(id: string, patch: Partial<Service>) {
    setState((current) => current ? { ...current, services: current.services.map((service) => service.id === id ? { ...service, ...patch } : service) } : current);
  }

  function toggleRequiredField(service: Service, field: string) {
    const fields = Array.isArray(service.requiredFieldsJson) ? service.requiredFieldsJson : [];
    updateService(service.id, {
      requiredFieldsJson: fields.includes(field) ? fields.filter((item) => item !== field) : [...fields, field],
    });
  }

  function updateMaster(id: string, patch: Partial<Master>) {
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

  async function saveGeneral() {
    if (!state) return;
    await execute(async () => {
      await json(await fetch("/api/booking-admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...state.settings, workingHours: sevenHours(state.workingHours, []) }),
      }));
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
    await execute(async () => {
      await json(await fetch("/api/booking-admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newService),
      }));
      setNewService({ name: "", description: "", durationMinutes: 60, onlineBookingEnabled: true, requiresVin: false, requiresConfirmation: false, requiredFieldsJson: [], sortOrder: 0 });
      await load();
    }, "Услуга добавлена");
  }

  async function syncCatalogServices() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const sync = await json<{ result: CatalogSyncResult }>(await fetch("/api/booking-admin/services/sync", { method: "POST" }));
      const refreshed = await json<SettingsState>(await fetch("/api/booking-admin/settings", { cache: "no-store" }));
      setState(refreshed);
      setNotice(`В каталоге ${sync.result.catalogCount} услуг: добавлено ${sync.result.added}, обновлено ${sync.result.updated}, отключено ${sync.result.disabled}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось синхронизировать услуги");
    } finally {
      setSaving(false);
    }
  }

  async function saveService(service: Service) {
    await execute(async () => {
      await json(await fetch(`/api/booking-admin/services/${encodeURIComponent(service.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(service),
      }));
    }, `Услуга «${service.name}» сохранена`);
  }

  async function disableService(service: Service) {
    await execute(async () => {
      await json(await fetch(`/api/booking-admin/services/${encodeURIComponent(service.id)}`, { method: "DELETE" }));
      await load();
    }, "Услуга отключена");
  }

  async function saveMaster(master: Master) {
    if (!state) return;
    const workingHours = sevenHours(master.workingHours, state.workingHours);
    await execute(async () => {
      await json(await fetch(`/api/booking-admin/masters/${encodeURIComponent(master.membershipId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceIds: master.serviceIds, workingHours }),
      }));
      updateMaster(master.membershipId, { workingHours });
    }, `Расписание ${master.name} сохранено`);
  }

  async function addException() {
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

  return (
    <main className={`eco-page eco-page--wide ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <div className={styles.crumbs}><Link href="/management">Управление</Link><span>/</span><span>Запись</span></div>
          <h1>Онлайн-запись филиала</h1>
          <p>{state.branch.name}{state.branch.address ? ` · ${state.branch.address}` : ""} · настройка доступности для клиентов</p>
        </div>
        <a className={styles.publicLink} href="/booking" target="_blank" rel="noreferrer">Проверить форму записи <ExternalLink aria-hidden /></a>
      </header>

      <nav className={styles.tabs} aria-label="Разделы настройки записи">
        {([
          ["general", Settings2, "Публикация и часы"],
          ["services", Wrench, "Услуги"],
          ["masters", UsersRound, "Мастера"],
          ["exceptions", CalendarOff, "Исключения"],
        ] as const).map(([id, Icon, label]) => <button type="button" key={id} className={tab === id ? styles.activeTab : ""} onClick={() => { setTab(id); setError(""); setNotice(""); }}><Icon aria-hidden /> {label}</button>)}
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
          <div className={styles.sectionHeading}><div><h2>Услуги филиала</h2><p>Все активные позиции типа «Услуга» из каталога добавляются автоматически. Длительность и настройки записи сохраняются здесь.</p></div>{state.canManage && <button type="button" className={styles.secondary} onClick={syncCatalogServices} disabled={saving}>{saving ? "Синхронизируем…" : "Обновить из каталога"}</button>}</div>
          <div className={styles.serviceList}>
            {state.services.map((service) => {
              const disabled = !state.canManage || service.status !== "ACTIVE";
              return (
                <article key={service.id} className={`${styles.serviceRow} ${service.status !== "ACTIVE" ? styles.inactiveRow : ""}`}>
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
                      <label>
                        <span>Порядок</span>
                        <input type="number" value={service.sortOrder} onChange={(event) => updateService(service.id, { sortOrder: Number(event.target.value) })} disabled={disabled} />
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
                        <button type="button" className={styles.primary} onClick={() => saveService(service)} disabled={saving}><Save aria-hidden /> Сохранить</button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {state.canManage && <div className={styles.createService}><h3>Новая услуга</h3><div className={styles.formGrid}><label><span>Название</span><input value={newService.name} onChange={(event) => setNewService((current) => ({ ...current, name: event.target.value }))} /></label><label><span>Длительность, минут</span><input type="number" min={5} step={5} value={newService.durationMinutes} onChange={(event) => setNewService((current) => ({ ...current, durationMinutes: Number(event.target.value) }))} /></label><label><span>Порядок</span><input type="number" value={newService.sortOrder} onChange={(event) => setNewService((current) => ({ ...current, sortOrder: Number(event.target.value) }))} /></label><label className={styles.wide}><span>Описание</span><input value={newService.description} onChange={(event) => setNewService((current) => ({ ...current, description: event.target.value }))} /></label></div><div className={styles.inlineChecks}><label><input type="checkbox" checked={newService.onlineBookingEnabled} onChange={(event) => setNewService((current) => ({ ...current, onlineBookingEnabled: event.target.checked }))} />Онлайн-запись</label><label><input type="checkbox" checked={newService.requiresVin} onChange={(event) => setNewService((current) => ({ ...current, requiresVin: event.target.checked }))} />Требовать VIN</label><label><input type="checkbox" checked={newService.requiresConfirmation} onChange={(event) => setNewService((current) => ({ ...current, requiresConfirmation: event.target.checked }))} />Ручное подтверждение</label><label><input type="checkbox" checked={newService.requiredFieldsJson.includes("email")} onChange={() => setNewService((current) => ({ ...current, requiredFieldsJson: current.requiredFieldsJson.includes("email") ? current.requiredFieldsJson.filter((field) => field !== "email") : [...current.requiredFieldsJson, "email"] }))} />Требовать email</label><label><input type="checkbox" checked={newService.requiredFieldsJson.includes("plate")} onChange={() => setNewService((current) => ({ ...current, requiredFieldsJson: current.requiredFieldsJson.includes("plate") ? current.requiredFieldsJson.filter((field) => field !== "plate") : [...current.requiredFieldsJson, "plate"] }))} />Требовать госномер</label><label><input type="checkbox" checked={newService.requiredFieldsJson.includes("year")} onChange={() => setNewService((current) => ({ ...current, requiredFieldsJson: current.requiredFieldsJson.includes("year") ? current.requiredFieldsJson.filter((field) => field !== "year") : [...current.requiredFieldsJson, "year"] }))} />Требовать год</label></div><button type="button" className={styles.primary} onClick={createService} disabled={saving || !newService.name.trim()}><Plus aria-hidden /> Добавить услугу</button></div>}
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
