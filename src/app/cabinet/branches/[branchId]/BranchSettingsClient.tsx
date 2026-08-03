"use client";

import { AlertTriangle, Archive, Bell, Building2, CalendarClock, FileText, Link2, MapPin, MessageCircle, Save, Settings, ShieldAlert, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { invalidateDashboardClientBundle } from "@/lib/dashboard-client";
import { safeReadJson } from "@/lib/http-json";

type JsonObject = Record<string, unknown>;
type Branch = {
  id: string;
  name: string;
  shortName: string;
  slug: string;
  status: string;
  address: string | null;
  timezone: string;
  phone: string | null;
  email: string | null;
  telegramUsername: string | null;
  legalEntityName: string | null;
  legalEntityType: string | null;
  inn: string | null;
  ogrn: string | null;
  bankDetailsJson: unknown;
  openingDate: string | null;
  legacyOrganizationId: string | null;
  communication: {
    primaryPhone: string;
    secondaryPhone: string | null;
    whatsapp: string | null;
    telegram: string | null;
    email: string | null;
    callbackSettingsJson: unknown;
  } | null;
  legalEntities: Array<{
    id: string;
    name: string;
    isPrimary: boolean;
    legalAddress: string | null;
    bankDetailsJson: unknown;
    documentSettingsJson: unknown;
  }>;
  telegramIntegration: {
    status: string;
    phoneNumberMasked: string | null;
    telegramUsername: string | null;
    connectedAt: string | null;
    lastSyncAt: string | null;
    errorCode: string | null;
  } | null;
};

type DetailPayload = {
  branch?: Branch;
  activeBranchId?: string;
  mode?: "branch" | "all";
  canUpdate?: boolean;
  canArchive?: boolean;
  canManageMembers?: boolean;
  canManageIntegrations?: boolean;
  error?: string;
};

type Member = {
  id: string;
  roleId: string;
  status: string;
  position: string | null;
  scheduleJson: unknown;
  paySettingsJson: unknown;
  user: { id: string; login: string; name: string; status: string };
};

type Organization = { id: string; name: string; fullLegalName: string; inn: string; isActive: boolean };

const TABS = [
  ["main", "Основное", Settings],
  ["work", "Работа точки", CalendarClock],
  ["legal", "Юридические данные", Building2],
  ["communication", "Связь и уведомления", MessageCircle],
  ["integrations", "Интеграции", Link2],
  ["members", "Сотрудники", Users],
  ["documents", "Документы и нумерация", FileText],
  ["danger", "Опасная зона", ShieldAlert],
] as const;

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function string(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown) {
  return value === true;
}

function dateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ru-RU");
}

type FieldProps = { label: string; children: ReactNode; wide?: boolean; hint?: string };
function Field({ label, children, wide, hint }: FieldProps) {
  return <label className={wide ? "wide" : undefined}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export default function BranchSettingsClient({ branchId }: { branchId: string }) {
  const router = useRouter();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number][0]>("main");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [canUpdate, setCanUpdate] = useState(false);
  const [canArchive, setCanArchive] = useState(false);
  const [canManageMembers, setCanManageMembers] = useState(false);
  const [canManageIntegrations, setCanManageIntegrations] = useState(false);
  const [activeBranchId, setActiveBranchId] = useState("all");
  const [members, setMembers] = useState<Member[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [form, setForm] = useState<Record<string, string | number | boolean | string[]>>({});

  const hydrateForm = useCallback((item: Branch) => {
    const callback = object(item.communication?.callbackSettingsJson);
    const work = object(callback.work);
    const messages = object(callback.messages);
    const primaryLegal = item.legalEntities.find((entity) => entity.isPrimary) ?? item.legalEntities[0];
    const legal = object(item.bankDetailsJson);
    const documents = object(primaryLegal?.documentSettingsJson);
    setForm({
      name: item.name,
      shortName: item.shortName,
      slug: item.slug,
      status: item.status === "inactive" ? "inactive" : "active",
      openingDate: dateInput(item.openingDate),
      address: item.address ?? "",
      timezone: item.timezone,
      phone: item.phone ?? item.communication?.primaryPhone ?? "",
      secondaryPhone: item.communication?.secondaryPhone ?? "",
      email: item.email ?? "",
      comment: string(messages.comment),
      workDays: Array.isArray(work.days) ? work.days.map(String) : ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"],
      startTime: string(work.startTime) || "09:00",
      endTime: string(work.endTime) || "19:00",
      breaks: string(work.breaks),
      servicePosts: number(work.servicePosts, 1),
      lifts: number(work.lifts, 1),
      appointmentMinutes: number(work.appointmentMinutes, 60),
      onlineBooking: work.onlineBooking === undefined ? true : bool(work.onlineBooking),
      holidays: string(work.holidays),
      navigationAddress: string(work.navigationAddress) || item.address || "",
      mapLink: string(work.mapLink),
      organizationId: item.legacyOrganizationId ?? "",
      legalAddress: string(legal.legalAddress) || primaryLegal?.legalAddress || "",
      cashbox: string(legal.cashbox),
      bankDetails: string(legal.bankDetails),
      legalDocumentPrefix: string(legal.documentPrefix),
      printDetails: string(legal.printDetails),
      warrantyTerms: string(legal.warrantyTerms),
      whatsapp: item.communication?.whatsapp ?? "",
      communicationTelegram: item.communication?.telegram ?? item.telegramUsername ?? "",
      communicationEmail: item.communication?.email ?? item.email ?? "",
      messageSignature: string(messages.signature),
      reminderAddress: string(messages.reminderAddress) || item.address || "",
      messageMapLink: string(messages.mapLink),
      messageWorkHours: string(messages.workHours),
      welcomeText: string(messages.welcomeText),
      afterServiceText: string(messages.afterServiceText),
      shipmentPrefix: string(documents.shipmentPrefix),
      workOrderPrefix: string(documents.workOrderPrefix),
      cashPrefix: string(documents.cashPrefix),
      nextNumber: number(documents.nextNumber, 1),
      templates: string(documents.templates),
      printOrganization: string(documents.organization),
      printAddress: string(documents.address) || item.address || "",
      printPhone: string(documents.phone) || item.phone || "",
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/branches/${branchId}`, { cache: "no-store" });
    const payload = await safeReadJson<DetailPayload>(response);
    if (!response.ok || !payload?.branch) {
      setError(payload?.error ?? "Не удалось загрузить филиал");
      setLoading(false);
      return;
    }
    setBranch(payload.branch);
    setActiveBranchId(payload.activeBranchId ?? "all");
    setCanUpdate(Boolean(payload.canUpdate));
    setCanArchive(Boolean(payload.canArchive));
    setCanManageMembers(Boolean(payload.canManageMembers));
    setCanManageIntegrations(Boolean(payload.canManageIntegrations));
    hydrateForm(payload.branch);
    setLoading(false);
  }, [branchId, hydrateForm]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (activeTab !== "members" || !canManageMembers) return;
    void (async () => {
      const response = await fetch(`/api/branches/${branchId}/members`, { cache: "no-store" });
      const payload = await safeReadJson<{ memberships?: Member[] }>(response);
      if (response.ok) setMembers(payload?.memberships ?? []);
    })();
  }, [activeTab, branchId, canManageMembers]);

  useEffect(() => {
    if (activeTab !== "legal") return;
    void (async () => {
      const response = await fetch("/api/organizations", { cache: "no-store" });
      const payload = await safeReadJson<{ organizations?: Organization[] }>(response);
      if (response.ok) setOrganizations((payload?.organizations ?? []).filter((item) => item.isActive));
    })();
  }, [activeTab]);

  const set = (key: string, value: string | number | boolean | string[]) => setForm((current) => ({ ...current, [key]: value }));
  const field = (key: string) => string(form[key]);
  const numeric = (key: string) => number(form[key], 0);
  const checked = (key: string) => bool(form[key]);

  const payload = useMemo(() => ({
    name: field("name"), shortName: field("shortName"), slug: field("slug"), status: field("status"),
    openingDate: field("openingDate"), address: field("address"), timezone: field("timezone"), phone: field("phone"),
    secondaryPhone: field("secondaryPhone"), email: field("email"), organizationId: field("organizationId"),
    whatsapp: field("whatsapp"), communicationTelegram: field("communicationTelegram"), communicationEmail: field("communicationEmail"),
    workingSettingsJson: {
      days: Array.isArray(form.workDays) ? form.workDays : [], startTime: field("startTime"), endTime: field("endTime"),
      breaks: field("breaks"), servicePosts: numeric("servicePosts"), lifts: numeric("lifts"), appointmentMinutes: numeric("appointmentMinutes"),
      onlineBooking: checked("onlineBooking"), holidays: field("holidays"), navigationAddress: field("navigationAddress"), mapLink: field("mapLink"),
    },
    communicationSettingsJson: {
      comment: field("comment"), signature: field("messageSignature"), reminderAddress: field("reminderAddress"), mapLink: field("messageMapLink"),
      workHours: field("messageWorkHours"), welcomeText: field("welcomeText"), afterServiceText: field("afterServiceText"),
    },
    bankDetailsJson: {
      ...object(branch?.bankDetailsJson), legalAddress: field("legalAddress"), cashbox: field("cashbox"), bankDetails: field("bankDetails"),
      documentPrefix: field("legalDocumentPrefix"), printDetails: field("printDetails"), warrantyTerms: field("warrantyTerms"),
    },
    documentSettingsJson: {
      shipmentPrefix: field("shipmentPrefix"), workOrderPrefix: field("workOrderPrefix"), cashPrefix: field("cashPrefix"), nextNumber: numeric("nextNumber"),
      templates: field("templates"), organization: field("printOrganization"), address: field("printAddress"), phone: field("printPhone"),
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [form, branch?.bankDetailsJson]);

  async function save() {
    if (!canUpdate || saving) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/branches/${branchId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = await safeReadJson<{ branch?: Branch; error?: string }>(response);
      if (!response.ok) { setError(result?.error ?? "Не удалось сохранить филиал"); return; }
      setMessage("Настройки филиала сохранены.");
      window.dispatchEvent(new Event("eco-branch-updated"));
      router.refresh();
      await load();
    } finally { setSaving(false); }
  }

  async function switchToBranch() {
    setSwitching(true); setError("");
    try {
      const response = await fetch("/api/session/active-branch", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId }),
      });
      const result = await safeReadJson<{ error?: string }>(response);
      if (!response.ok) { setError(result?.error ?? "Не удалось переключить филиал"); return; }
      const sessionResponse = await fetch("/api/session/active-branch", { cache: "no-store" });
      const session = await safeReadJson<{ activeBranchId?: string; error?: string }>(sessionResponse);
      if (!sessionResponse.ok || session?.activeBranchId !== branchId) {
        setError(session?.error ?? "Сессия филиала не успела обновиться. Повторите переключение.");
        return;
      }
      invalidateDashboardClientBundle();
      window.dispatchEvent(new CustomEvent("eco-branch-context-changed", { detail: { branchId } }));
      router.refresh();
      await load();
    } finally { setSwitching(false); }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/branches/${branchId}/members`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data.entries())),
    });
    const result = await safeReadJson<{ membership?: Member; error?: string }>(response);
    if (!response.ok) { setError(result?.error ?? "Не удалось назначить сотрудника"); return; }
    if (result?.membership) setMembers((current) => [...current.filter((item) => item.id !== result.membership?.id), result.membership as Member]);
    event.currentTarget.reset();
    setMessage("Сотрудник назначен филиалу.");
  }

  async function updateMember(member: Member, values: { roleId?: string; status?: string }) {
    const response = await fetch(`/api/branches/${branchId}/members/${member.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values),
    });
    const result = await safeReadJson<{ membership?: Member; error?: string }>(response);
    if (!response.ok || !result?.membership) { setError(result?.error ?? "Не удалось обновить доступ"); return; }
    setMembers((current) => current.map((item) => item.id === member.id ? result.membership as Member : item));
  }

  async function archiveBranch() {
    if (!branch || !window.confirm(`Архивировать филиал «${branch.shortName}»?`)) return;
    const response = await fetch(`/api/branches/${branchId}/archive`, { method: "POST" });
    const result = await safeReadJson<{ error?: string }>(response);
    if (!response.ok) { setError(result?.error ?? "Не удалось архивировать филиал"); return; }
    router.push("/cabinet/branches"); router.refresh();
  }

  if (loading) return <main className="eco-branch-settings"><p className="eco-branch-settings__loading">Загрузка настроек филиала…</p></main>;
  if (!branch) return <main className="eco-branch-settings"><p className="eco-branches-page__error">{error || "Филиал не найден"}</p></main>;

  const inactiveContext = activeBranchId !== branchId;
  const telegram = branch.telegramIntegration;
  const integrationRows = [
    { name: "Рабочий Telegram", status: telegram?.status === "connected" ? "Подключено" : telegram?.errorCode ? "Ошибка" : "Не подключено", detail: telegram?.errorCode || `Последняя синхронизация: ${dateTime(telegram?.lastSyncAt)}`, href: "/cabinet/integrations/messenger" },
    { name: "Telegram сотрудников", status: "Доступно", detail: "Привязки сотрудников управляются в их Кабинете.", href: "/cabinet" },
    { name: "Yclients", status: "По филиалу", detail: "Credentials из другого филиала не подставляются.", href: "/cabinet/integrations" },
    { name: "МойСклад", status: "По филиалу", detail: "Проверить подключение и последнюю синхронизацию.", href: "/cabinet/integrations" },
    { name: "ROSSKO", status: "По филиалу", detail: "Проверить настройки поставщика.", href: "/cabinet/integrations" },
    { name: "T-Bank", status: "По филиалу", detail: "Касса и счёт выбираются в контексте филиала.", href: "/cabinet/integrations" },
    { name: "TRONK", status: "По филиалу", detail: "VIN-декодирование использует филиальную конфигурацию.", href: "/cabinet/integrations" },
    { name: "Уведомления", status: "По филиалу", detail: "Шаблоны и правила не смешиваются между точками.", href: "/cabinet/notifications" },
  ];

  return (
    <main className="eco-branch-settings">
      <header className="eco-branch-settings__head">
        <div>
          <div className="eco-page-crumbs"><Link href="/cabinet">Кабинет</Link><span className="sep">/</span><Link href="/cabinet/branches">Филиалы</Link><span className="sep">/</span><span className="cur">{branch.shortName}</span></div>
          <h1>Настройки филиала</h1>
          <p><strong>{branch.name}</strong><span>{branch.status === "active" ? "Активен" : branch.status === "archived" ? "Архив" : "Неактивен"}</span><span><MapPin aria-hidden size={13} />{branch.address || "Адрес не заполнен"}</span></p>
        </div>
        {canUpdate && <button className="eco-btn eco-btn--primary" type="button" onClick={() => void save()} disabled={saving}><Save aria-hidden className="eco-icon" />{saving ? "Сохраняем…" : "Сохранить"}</button>}
      </header>

      {inactiveContext && (
        <div className="eco-branch-settings__context" role="status">
          <AlertTriangle aria-hidden size={18} />
          <div><strong>Этот филиал сейчас не выбран</strong><span>Просмотр доступен, но изменения и филиальные интеграции требуют активного контекста.</span></div>
          <button type="button" className="eco-btn eco-btn--secondary" onClick={() => void switchToBranch()} disabled={switching || branch.status !== "active"}>{switching ? "Переключаем…" : "Переключиться"}</button>
        </div>
      )}
      {error && <p className="eco-branches-page__error" role="alert">{error}</p>}
      {message && <p className="eco-branch-settings__message" role="status">{message}</p>}

      <nav className="eco-tabs eco-branch-settings__tabs" aria-label="Разделы настроек филиала">
        {TABS.map(([id, label, Icon]) => <button key={id} type="button" className={`eco-tab ${activeTab === id ? "is-active" : ""}`} onClick={() => setActiveTab(id)}><Icon aria-hidden size={14} />{label}</button>)}
      </nav>

      <section className="eco-branch-settings__panel">
        {activeTab === "main" && <><PanelHead title="Основное" text="Название, контакты и идентификаторы физической точки." /><div className="eco-branch-settings__form">
          <Field label="Полное название"><input value={field("name")} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Короткое название"><input value={field("shortName")} onChange={(e) => set("shortName", e.target.value)} /></Field>
          <Field label="Внутренний slug"><input value={field("slug")} onChange={(e) => set("slug", e.target.value)} /></Field>
          <Field label="Статус"><select value={field("status")} onChange={(e) => set("status", e.target.value)}><option value="active">Активен</option><option value="inactive">Неактивен</option></select></Field>
          <Field label="Дата открытия"><input type="date" value={field("openingDate")} onChange={(e) => set("openingDate", e.target.value)} /></Field>
          <Field label="Часовой пояс"><input value={field("timezone")} onChange={(e) => set("timezone", e.target.value)} /></Field>
          <Field label="Адрес" wide><textarea value={field("address")} onChange={(e) => set("address", e.target.value)} /></Field>
          <Field label="Основной телефон"><input value={field("phone")} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Дополнительный телефон"><input value={field("secondaryPhone")} onChange={(e) => set("secondaryPhone", e.target.value)} /></Field>
          <Field label="Email"><input type="email" value={field("email")} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Комментарий" wide><textarea value={field("comment")} onChange={(e) => set("comment", e.target.value)} /></Field>
        </div></>}

        {activeTab === "work" && <><PanelHead title="Работа точки" text="Рабочий график, мощности сервиса и параметры онлайн-записи." /><div className="eco-branch-settings__form">
          <Field label="Дни работы" wide><div className="eco-branch-settings__weekdays">{WEEKDAYS.map((day) => { const days = Array.isArray(form.workDays) ? form.workDays : []; return <label key={day}><input type="checkbox" checked={days.includes(day)} onChange={(e) => set("workDays", e.target.checked ? [...days, day] : days.filter((item) => item !== day))} />{day}</label>; })}</div></Field>
          <Field label="Начало"><input type="time" value={field("startTime")} onChange={(e) => set("startTime", e.target.value)} /></Field><Field label="Окончание"><input type="time" value={field("endTime")} onChange={(e) => set("endTime", e.target.value)} /></Field>
          <Field label="Перерывы" wide><input value={field("breaks")} onChange={(e) => set("breaks", e.target.value)} placeholder="Например, 13:00–14:00" /></Field>
          <Field label="Количество постов"><input type="number" min="0" value={numeric("servicePosts")} onChange={(e) => set("servicePosts", Number(e.target.value))} /></Field><Field label="Количество подъёмников"><input type="number" min="0" value={numeric("lifts")} onChange={(e) => set("lifts", Number(e.target.value))} /></Field>
          <Field label="Стандартная запись, минут"><input type="number" min="15" step="15" value={numeric("appointmentMinutes")} onChange={(e) => set("appointmentMinutes", Number(e.target.value))} /></Field>
          <Field label="Онлайн-запись"><label className="eco-branch-settings__switch"><input type="checkbox" checked={checked("onlineBooking")} onChange={(e) => set("onlineBooking", e.target.checked)} />Разрешена</label></Field>
          <Field label="Праздники и исключения" wide><textarea value={field("holidays")} onChange={(e) => set("holidays", e.target.value)} /></Field>
          <Field label="Адрес для навигации"><input value={field("navigationAddress")} onChange={(e) => set("navigationAddress", e.target.value)} /></Field><Field label="Ссылка на карту"><input type="url" value={field("mapLink")} onChange={(e) => set("mapLink", e.target.value)} /></Field>
        </div></>}

        {activeTab === "legal" && <><PanelHead title="Юридические данные" text="Филиал выбирает организацию из отдельного справочника; справочник здесь не дублируется." /><div className="eco-branch-settings__form">
          <Field label="Основная организация филиала" wide><select value={field("organizationId")} onChange={(e) => set("organizationId", e.target.value)}><option value="">Не выбрана</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}{org.inn ? ` · ИНН ${org.inn}` : ""}</option>)}</select><small><Link href="/cabinet/organizations">Открыть справочник организаций</Link></small></Field>
          <Field label="Юридический адрес в документах" wide><textarea value={field("legalAddress")} onChange={(e) => set("legalAddress", e.target.value)} /></Field>
          <Field label="Касса"><input value={field("cashbox")} onChange={(e) => set("cashbox", e.target.value)} /></Field><Field label="Банковские реквизиты"><input value={field("bankDetails")} onChange={(e) => set("bankDetails", e.target.value)} /></Field>
          <Field label="Префикс документов"><input value={field("legalDocumentPrefix")} onChange={(e) => set("legalDocumentPrefix", e.target.value)} /></Field><Field label="Печатные реквизиты"><input value={field("printDetails")} onChange={(e) => set("printDetails", e.target.value)} /></Field>
          <Field label="Гарантийные условия" wide><textarea value={field("warrantyTerms")} onChange={(e) => set("warrantyTerms", e.target.value)} /></Field>
        </div></>}

        {activeTab === "communication" && <><PanelHead title="Связь и уведомления" text="Контакты и тексты, которые видят клиенты именно этой точки." /><div className="eco-branch-settings__form">
          <Field label="Рабочий телефон"><input value={field("phone")} onChange={(e) => set("phone", e.target.value)} /></Field><Field label="Дополнительный телефон"><input value={field("secondaryPhone")} onChange={(e) => set("secondaryPhone", e.target.value)} /></Field>
          <Field label="Telegram"><input value={field("communicationTelegram")} onChange={(e) => set("communicationTelegram", e.target.value)} /></Field><Field label="WhatsApp"><input value={field("whatsapp")} onChange={(e) => set("whatsapp", e.target.value)} /></Field>
          <Field label="Email"><input type="email" value={field("communicationEmail")} onChange={(e) => set("communicationEmail", e.target.value)} /></Field><Field label="Подпись сообщений"><input value={field("messageSignature")} onChange={(e) => set("messageSignature", e.target.value)} /></Field>
          <Field label="Адрес в напоминаниях"><input value={field("reminderAddress")} onChange={(e) => set("reminderAddress", e.target.value)} /></Field><Field label="Ссылка на карту"><input type="url" value={field("messageMapLink")} onChange={(e) => set("messageMapLink", e.target.value)} /></Field>
          <Field label="Режим работы в сообщениях" wide><input value={field("messageWorkHours")} onChange={(e) => set("messageWorkHours", e.target.value)} /></Field>
          <Field label="Приветственный текст" wide><textarea value={field("welcomeText")} onChange={(e) => set("welcomeText", e.target.value)} /></Field><Field label="Текст после обслуживания" wide><textarea value={field("afterServiceText")} onChange={(e) => set("afterServiceText", e.target.value)} /></Field>
        </div></>}

        {activeTab === "integrations" && <><PanelHead title="Интеграции" text="Каждое подключение разрешается на сервере для текущего филиала; fallback на credentials другой точки запрещён." /><div className="eco-branch-settings__integration-list">{integrationRows.map((item) => <article key={item.name}><div><strong>{item.name}</strong><span>{item.detail}</span></div><b>{item.status}</b>{canManageIntegrations ? <Link href={item.href} className="eco-btn eco-btn--secondary">Настроить</Link> : <span>Только просмотр</span>}</article>)}</div></>}

        {activeTab === "members" && <><PanelHead title="Сотрудники" text="Роли, доступ и филиальные назначения сотрудников." />{canManageMembers ? <><form className="eco-branch-settings__member-form" onSubmit={addMember}><Field label="Логин сотрудника"><input name="login" required /></Field><Field label="Роль"><select name="roleId" defaultValue="administrator"><option value="branch_owner">Владелец филиала</option><option value="administrator">Администратор</option><option value="master">Мастер</option><option value="mechanic">Механик</option><option value="accountant">Бухгалтер</option><option value="viewer">Наблюдатель</option></select></Field><button className="eco-btn eco-btn--primary" type="submit">Назначить</button></form><div className="eco-branch-settings__member-list">{members.map((member) => <article key={member.id}><div><strong>{member.user.name}</strong><span>{member.user.login}{member.position ? ` · ${member.position}` : ""}</span></div><select value={member.roleId} onChange={(e) => void updateMember(member, { roleId: e.target.value })}><option value="branch_owner">Владелец филиала</option><option value="administrator">Администратор</option><option value="master">Мастер</option><option value="mechanic">Механик</option><option value="accountant">Бухгалтер</option><option value="viewer">Наблюдатель</option></select><button type="button" className="eco-btn eco-btn--secondary" onClick={() => void updateMember(member, { status: member.status === "active" ? "disabled" : "active" })}>{member.status === "active" ? "Отключить доступ" : "Включить доступ"}</button></article>)}</div></> : <p className="eco-branch-settings__empty">Нет права `branches.manage_members`.</p>}</>}

        {activeTab === "documents" && <><PanelHead title="Документы и нумерация" text="Префиксы и печатные данные этой точки." /><div className="eco-branch-settings__form">
          <Field label="Префикс отгрузок"><input value={field("shipmentPrefix")} onChange={(e) => set("shipmentPrefix", e.target.value)} /></Field><Field label="Префикс заказ-нарядов"><input value={field("workOrderPrefix")} onChange={(e) => set("workOrderPrefix", e.target.value)} /></Field>
          <Field label="Префикс кассовых документов"><input value={field("cashPrefix")} onChange={(e) => set("cashPrefix", e.target.value)} /></Field><Field label="Следующий номер"><input type="number" min="1" value={numeric("nextNumber")} onChange={(e) => set("nextNumber", Number(e.target.value))} /></Field>
          <Field label="Шаблоны" wide><textarea value={field("templates")} onChange={(e) => set("templates", e.target.value)} /></Field><Field label="Юридическое лицо в печати"><input value={field("printOrganization")} onChange={(e) => set("printOrganization", e.target.value)} /></Field>
          <Field label="Адрес в печати"><input value={field("printAddress")} onChange={(e) => set("printAddress", e.target.value)} /></Field><Field label="Телефон в печати"><input value={field("printPhone")} onChange={(e) => set("printPhone", e.target.value)} /></Field>
        </div></>}

        {activeTab === "danger" && <><PanelHead title="Опасная зона" text="Архивирование отключает операционную работу точки и её Telegram-интеграцию." /><div className="eco-branch-settings__danger"><div><strong>Архивировать филиал</strong><span>Данные сохранятся. Единственный активный филиал архивировать нельзя.</span></div><button type="button" className="eco-btn eco-btn--ghost-danger" onClick={() => void archiveBranch()} disabled={!canArchive}><Archive aria-hidden className="eco-icon" />Архивировать</button></div></>}
      </section>

      {canUpdate && activeTab !== "danger" && activeTab !== "integrations" && activeTab !== "members" && <footer className="eco-branch-settings__save"><button className="eco-btn eco-btn--primary" type="button" onClick={() => void save()} disabled={saving}><Save aria-hidden className="eco-icon" />{saving ? "Сохраняем…" : "Сохранить изменения"}</button></footer>}
    </main>
  );
}

function PanelHead({ title, text }: { title: string; text: string }) {
  return <header className="eco-branch-settings__panel-head"><div><h2>{title}</h2><p>{text}</p></div><Bell aria-hidden size={18} /></header>;
}
