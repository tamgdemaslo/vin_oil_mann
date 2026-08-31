"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Archive, Building2, Check, FileText, MessageSquareText, Pencil, Plus, Save, Star, UserPlus, UsersRound, Warehouse } from "lucide-react";
import { safeReadJson } from "@/lib/http-json";
import { formatPhoneForDisplay } from "@/lib/phone-normalize";

type Branch = {
  id: string;
  name: string;
  shortName: string;
  displayName?: string;
  slug: string;
  status: string;
  address: string | null;
  timezone: string;
  phone: string | null;
  email: string | null;
  telegramUsername: string | null;
  openingDate?: string | null;
  updatedAt?: string | null;
  legacyOrganizationId: string | null;
};

type BranchDetails = Branch & {
  communication?: {
    primaryPhone: string;
    secondaryPhone: string | null;
    whatsapp: string | null;
    telegram: string | null;
    email: string | null;
    callbackSettingsJson?: { workingHours?: string | null } | null;
  } | null;
  telegramIntegration?: {
    status: string;
    phoneNumberMasked?: string | null;
    telegramUsername?: string | null;
    connectedAt?: string | null;
  } | null;
};

type Membership = {
  id: string;
  roleId: string;
  status: string;
  user: { id: string; login: string; name: string; status: string };
};

type PublicUser = { login: string; name: string; role: string };
type Organization = { id: string; name: string; fullLegalName?: string; inn?: string; isActive: boolean };
type WarehouseRow = {
  id: string;
  branchId: string;
  name: string;
  shortName: string;
  address: string;
  comment: string;
  isMain: boolean;
  archived: boolean;
};

type BranchTab = "overview" | "employees" | "channels" | "warehouses";

const NETWORK_RETRY_DELAY_MS = 750;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function fetchRead(input: RequestInfo | URL, init: RequestInit = {}) {
  try {
    return await fetch(input, init);
  } catch {
    // GET requests are safe to repeat when Safari loses an individual connection.
    await wait(NETWORK_RETRY_DELAY_MS);
    return fetch(input, init);
  }
}

const BRANCH_ROLES = [
  ["branch_owner", "Владелец филиала"],
  ["administrator", "Администратор"],
  ["master", "Мастер-приёмщик"],
  ["mechanic", "Механик"],
  ["accountant", "Бухгалтер"],
  ["viewer", "Наблюдатель"],
] as const;

function branchName(branch: Branch) {
  return branch.displayName?.trim() || branch.shortName || branch.name;
}

function queryState(): { branchId: string | null; tab: BranchTab } {
  if (typeof window === "undefined") return { branchId: null, tab: "overview" };
  const params = new URLSearchParams(window.location.search);
  const rawTab = params.get("tab");
  const tab: BranchTab = rawTab === "employees" || rawTab === "channels" || rawTab === "warehouses" ? rawTab : "overview";
  return { branchId: params.get("branch"), tab };
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [details, setDetails] = useState<BranchDetails | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [tab, setTab] = useState<BranchTab>("overview");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warehousesLoading, setWarehousesLoading] = useState(false);
  const [canManageWarehouses, setCanManageWarehouses] = useState(false);
  const [warehouseFormOpen, setWarehouseFormOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseRow | null>(null);
  const [employeeFormOpen, setEmployeeFormOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phonePreview, setPhonePreview] = useState("");

  const updateLocation = useCallback((branchId: string | null, nextTab: BranchTab) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (branchId) params.set("branch", branchId);
    if (nextTab !== "overview") params.set("tab", nextTab);
    window.history.replaceState(null, "", `/cabinet/branches${params.size ? `?${params}` : ""}`);
  }, []);

  const loadBranches = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchRead("/api/branches", { cache: "no-store" });
      const payload = await safeReadJson<{ branches?: Branch[]; activeBranchId?: string; canManageBranches?: boolean; error?: string }>(response);
      const rows = payload?.branches ?? [];
      setBranches(rows);
      setCanManage(Boolean(payload?.canManageBranches));
      setActiveBranchId(payload?.activeBranchId && payload.activeBranchId !== "all" ? payload.activeBranchId : null);
      setError(response.ok ? "" : payload?.error ?? "Не удалось загрузить филиалы");
      const initial = queryState();
      const selected = rows.find((branch) => branch.id === initial.branchId)?.id
        ?? rows.find((branch) => branch.id === payload?.activeBranchId)?.id
        ?? rows[0]?.id
        ?? null;
      setSelectedBranchId((current) => current && rows.some((branch) => branch.id === current) ? current : selected);
      setTab(initial.tab);
    } catch {
      setError("Сетевое соединение прервалось. Повторите загрузку филиалов.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrganizations = useCallback(async () => {
    try {
      const response = await fetchRead("/api/organizations", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await safeReadJson<{ organizations?: Organization[] }>(response);
      setOrganizations(payload?.organizations ?? []);
    } catch {
      // Organizations are secondary data on this screen; the branch list stays usable.
    }
  }, []);

  const loadBranch = useCallback(async (branchId: string) => {
    setDetailLoading(true);
    setError("");
    try {
      const [branchResponse, membersResponse, usersResponse] = await Promise.all([
        fetchRead(`/api/branches/${encodeURIComponent(branchId)}`, { cache: "no-store" }),
        fetchRead(`/api/branches/${encodeURIComponent(branchId)}/members`, { cache: "no-store" }),
        fetchRead("/api/auth/users", { cache: "no-store" }),
      ]);
      const branchPayload = await safeReadJson<{ branch?: BranchDetails; error?: string }>(branchResponse);
      const membersPayload = await safeReadJson<{ memberships?: Membership[]; error?: string }>(membersResponse);
      const usersPayload = await safeReadJson<{ users?: PublicUser[]; error?: string }>(usersResponse);
      const loadedMemberships = membersResponse.ok ? membersPayload?.memberships ?? [] : [];
      if (!branchResponse.ok || !branchPayload?.branch) {
        setError(branchPayload?.error ?? "Не удалось открыть филиал");
        setDetails(null);
      } else {
        setDetails(branchPayload.branch);
        setPhonePreview(formatPhoneForDisplay(branchPayload.branch.communication?.primaryPhone || branchPayload.branch.phone));
        if (!membersResponse.ok) setError(membersPayload?.error ?? "Не удалось загрузить сотрудников филиала");
        else if (!usersResponse.ok) setError(usersPayload?.error ?? "Не удалось загрузить список пользователей");
      }
      setMemberships(loadedMemberships);
      setUsers(usersResponse.ok ? usersPayload?.users ?? [] : []);
      return { memberships: loadedMemberships };
    } catch {
      setError("Сетевое соединение прервалось. Повторите открытие филиала.");
      return null;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadWarehouses = useCallback(async (branchId: string) => {
    setWarehousesLoading(true);
    try {
      const response = await fetchRead(`/api/branches/${encodeURIComponent(branchId)}/warehouses`, { cache: "no-store" });
      const payload = await safeReadJson<{ warehouses?: WarehouseRow[]; canManage?: boolean; error?: string }>(response);
      if (!response.ok) {
        setError(payload?.error ?? "Не удалось загрузить склады филиала");
        setWarehouses([]);
        setCanManageWarehouses(false);
      } else {
        setWarehouses(payload?.warehouses ?? []);
        setCanManageWarehouses(Boolean(payload?.canManage));
      }
    } catch {
      setError("Сетевое соединение прервалось. Повторите загрузку складов.");
      setWarehouses([]);
      setCanManageWarehouses(false);
    } finally {
      setWarehousesLoading(false);
    }
  }, []);

  useEffect(() => {
    // These callbacks start remote reads; their state updates happen as the requests settle.
    void Promise.all([loadBranches(), loadOrganizations()]);
  }, [loadBranches, loadOrganizations]);

  useEffect(() => {
    // The selected id is the external route state that drives the detail request.
    if (selectedBranchId) void loadBranch(selectedBranchId);
  }, [loadBranch, selectedBranchId]);

  useEffect(() => {
    // This starts a remote read; the state updates happen when the request settles.
    if (selectedBranchId && tab === "warehouses") void loadWarehouses(selectedBranchId);
  }, [loadWarehouses, selectedBranchId, tab]);

  const assignedLogins = useMemo(() => new Set(memberships.filter((membership) => membership.status === "active").map((membership) => membership.user.login)), [memberships]);

  function chooseBranch(branchId: string) {
    setSelectedBranchId(branchId);
    setTab("overview");
    setNotice("");
    setWarehouseFormOpen(false);
    setEditingWarehouse(null);
    setEmployeeFormOpen(false);
    updateLocation(branchId, "overview");
  }

  function chooseTab(nextTab: BranchTab) {
    setTab(nextTab);
    setNotice("");
    if (nextTab !== "employees") setEmployeeFormOpen(false);
    updateLocation(selectedBranchId, nextTab);
  }

  function openWarehouseForm(warehouse?: WarehouseRow) {
    setEditingWarehouse(warehouse ?? null);
    setWarehouseFormOpen(true);
    setError("");
  }

  async function saveWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBranchId) return;
    setSaving(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const warehouseId = editingWarehouse?.id;
    const body = Object.fromEntries(form.entries()) as Record<string, FormDataEntryValue>;
    body.isMain = form.get("isMain") === "true" ? "true" : "false";
    const response = await fetch(
      warehouseId
        ? `/api/branches/${encodeURIComponent(selectedBranchId)}/warehouses/${encodeURIComponent(warehouseId)}`
        : `/api/branches/${encodeURIComponent(selectedBranchId)}/warehouses`,
      {
        method: warehouseId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const payload = await safeReadJson<{ error?: string }>(response);
    if (!response.ok) {
      setError(payload?.error ?? "Не удалось сохранить склад");
    } else {
      setWarehouseFormOpen(false);
      setEditingWarehouse(null);
      await loadWarehouses(selectedBranchId);
      setNotice(warehouseId ? "Настройки склада сохранены." : "Склад создан. Остатки и движения других филиалов не копировались.");
    }
    setSaving(false);
  }

  async function setMainWarehouse(warehouse: WarehouseRow) {
    if (!selectedBranchId || warehouse.isMain) return;
    setSaving(true);
    setError("");
    const response = await fetch(`/api/branches/${encodeURIComponent(selectedBranchId)}/warehouses/${encodeURIComponent(warehouse.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_main" }),
    });
    const payload = await safeReadJson<{ error?: string }>(response);
    if (!response.ok) setError(payload?.error ?? "Не удалось назначить основной склад");
    else {
      await loadWarehouses(selectedBranchId);
      setNotice(`Склад «${warehouse.name}» назначен основным.`);
    }
    setSaving(false);
  }

  async function archiveWarehouse(warehouse: WarehouseRow) {
    if (!selectedBranchId || !window.confirm(`Переместить склад «${warehouse.name}» в архив? Новые документы на него больше не оформляются.`)) return;
    setSaving(true);
    setError("");
    const response = await fetch(`/api/branches/${encodeURIComponent(selectedBranchId)}/warehouses/${encodeURIComponent(warehouse.id)}`, { method: "DELETE" });
    const payload = await safeReadJson<{ error?: string }>(response);
    if (!response.ok) setError(payload?.error ?? "Не удалось архивировать склад");
    else {
      await loadWarehouses(selectedBranchId);
      setNotice(`Склад «${warehouse.name}» перемещён в архив.`);
    }
    setSaving(false);
  }

  async function createBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const payload = await safeReadJson<{ branch?: Branch; error?: string }>(response);
    if (!response.ok) {
      setError(payload?.error ?? "Не удалось создать филиал");
    } else {
      event.currentTarget.reset();
      setCreating(false);
      await loadBranches();
      if (payload?.branch?.id) chooseBranch(payload.branch.id);
      setNotice("Филиал создан без фиктивных credentials. Продолжите мастер настройки в карточке филиала.");
    }
    setSaving(false);
  }

  async function continueOnboarding() {
    if (!details) return;
    setSaving(true);
    setError("");
    const response = await fetch("/api/session/active-branch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId: details.id }),
    });
    const payload = await safeReadJson<{ error?: string }>(response);
    if (!response.ok) {
      setError(payload?.error ?? "Не удалось выбрать филиал для мастера настройки");
      setSaving(false);
      return;
    }
    window.location.assign("/cabinet/integrations?onboarding=1");
  }

  async function saveBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    setSaving(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const requestedStatus = String(form.get("status") ?? details.status);
    form.delete("status");
    const payload: Record<string, string> = Object.fromEntries(form.entries()) as Record<string, string>;
    if (requestedStatus === "active" && details.status === "archived") payload.status = "active";
    const response = await fetch(`/api/branches/${encodeURIComponent(details.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await safeReadJson<{ error?: string }>(response);
    if (!response.ok) {
      setError(data?.error ?? "Не удалось сохранить филиал");
      setSaving(false);
      return;
    }
    if (requestedStatus === "archived" && details.status !== "archived") {
      const archiveResponse = await fetch(`/api/branches/${encodeURIComponent(details.id)}/archive`, { method: "POST" });
      const archiveData = await safeReadJson<{ error?: string }>(archiveResponse);
      if (!archiveResponse.ok) {
        setError(archiveData?.error ?? "Данные сохранены, но филиал не удалось перевести в архив");
        setSaving(false);
        await loadBranch(details.id);
        return;
      }
    }
    await Promise.all([loadBranches(), loadBranch(details.id)]);
    setNotice("Настройки филиала сохранены.");
    setSaving(false);
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    setSaving(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/branches/${encodeURIComponent(details.id)}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const payload = await safeReadJson<{ error?: string }>(response);
    if (!response.ok) setError(payload?.error ?? "Не удалось добавить сотрудника");
    else {
      event.currentTarget.reset();
      await loadBranch(details.id);
      setNotice("Сотрудник добавлен в филиал.");
    }
    setSaving(false);
  }

  async function createMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    const passwordConfirmation = String(form.get("passwordConfirmation") ?? "");
    if (password !== passwordConfirmation) {
      setError("Введённые пароли не совпадают");
      return;
    }
    const login = String(form.get("login") ?? "").trim().toLowerCase();
    const name = String(form.get("name") ?? "").trim();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/branches/${encodeURIComponent(details.id)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(form.entries()), createUser: true, login }),
      });
      const payload = await safeReadJson<{ error?: string }>(response);
      if (!response.ok) {
        setError(payload?.error ?? "Не удалось создать сотрудника");
      } else {
        formElement.reset();
        setEmployeeFormOpen(false);
        await loadBranch(details.id);
        setNotice(`${name || login} создан и добавлен в филиал. Передайте сотруднику логин и временный PIN-код.`);
      }
    } catch {
      // Never repeat this POST automatically: the server may have committed the
      // transaction before the response connection was lost. Reconcile instead.
      const refreshed = await loadBranch(details.id);
      const wasCreated = refreshed?.memberships.some((membership) => membership.user.login.toLowerCase() === login);
      if (wasCreated) {
        formElement.reset();
        setEmployeeFormOpen(false);
        setError("");
        setNotice(`${name || login} создан. Ответ сервера потерялся, но список сотрудников уже обновлён.`);
      } else {
        setError("Сетевое соединение прервалось. Сотрудник не подтверждён — проверьте список и повторите отправку.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function updateMember(membership: Membership, input: { roleId?: string; status?: string }) {
    if (!details) return;
    setSaving(true);
    setError("");
    const response = await fetch(`/api/branches/${encodeURIComponent(details.id)}/members/${encodeURIComponent(membership.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await safeReadJson<{ error?: string }>(response);
    if (!response.ok) setError(payload?.error ?? "Не удалось изменить доступ сотрудника");
    else {
      await loadBranch(details.id);
      setNotice(input.status === "disabled" ? "Доступ сотрудника отключён." : "Роль сотрудника обновлена.");
    }
    setSaving(false);
  }

  return (
    <main className="eco-branches-page">
      <header className="eco-branches-page__head">
        <div><p>Управление / Структура бизнеса</p><h1>Филиалы</h1><span>Физические точки, их сотрудники и рабочие каналы. Юридические лица редактируются отдельно.</span></div>
        {canManage && <button type="button" className="eco-btn eco-btn--primary" onClick={() => setCreating((value) => !value)}><Plus aria-hidden className="eco-icon" />{creating ? "Закрыть форму" : "Создать филиал"}</button>}
      </header>

      {error && <p className="eco-branches-page__error" role="alert">{error}</p>}
      {notice && <p className="eco-branches-page__notice" role="status"><Check aria-hidden size={16} />{notice}</p>}

      {creating && (
        <form className="eco-branches-page__form" onSubmit={createBranch}>
          <div><label>Название<input name="name" required placeholder="Дачная 6В" /></label><label>Короткое название<input name="shortName" required placeholder="Дачная 6В" /></label></div>
          <div><label>Адрес<input name="address" placeholder="Адрес физической точки" /></label><label>Часовой пояс<input name="timezone" defaultValue="Europe/Kaliningrad" /></label></div>
          <div><label>Основной телефон<input name="phone" inputMode="tel" autoComplete="tel" placeholder="+7 (950) 676-46-16" onBlur={(event) => { event.currentTarget.value = formatPhoneForDisplay(event.currentTarget.value); }} /><small>Используется в документах этого филиала.</small></label><label>Дата открытия<input name="openingDate" type="date" /></label></div>
          <label>Связанная организация<select name="legacyOrganizationId" defaultValue=""><option value="">Создать операционную организацию автоматически</option>{organizations.filter((organization) => organization.isActive).map((organization) => <option value={organization.id} key={organization.id}>{organization.name}{organization.inn ? ` · ИНН ${organization.inn}` : ""}</option>)}</select></label>
          <footer><span>Филиал — физическая точка. ИНН, банк и налоги настраиваются в отдельном разделе «Организации».</span><button className="eco-btn eco-btn--primary" type="submit" disabled={saving}>{saving ? "Создаём…" : "Создать филиал"}</button></footer>
        </form>
      )}

      <section className="eco-branch-workspace" aria-busy={loading || detailLoading}>
        <aside className="eco-branch-list" aria-label="Список филиалов">
          {loading ? <p>Загрузка филиалов…</p> : branches.map((branch) => (
            <button type="button" key={branch.id} onClick={() => chooseBranch(branch.id)} className={branch.id === selectedBranchId ? "is-active" : ""}>
              <span className={`eco-branches-page__dot is-${branch.status}`} />
              <span><strong>{branchName(branch)}</strong><small>{branch.address || "Адрес не заполнен"}</small></span>
              {branch.id === activeBranchId && <em>текущий</em>}
            </button>
          ))}
        </aside>

        <div className="eco-branch-detail">
          {!selectedBranchId || !details ? (
            <div className="eco-branch-empty"><Building2 aria-hidden size={28} /><strong>{detailLoading ? "Открываем филиал…" : "Выберите филиал"}</strong><span>Настройки и сотрудники появятся здесь.</span></div>
          ) : (
            <>
              <header className="eco-branch-detail__head"><div><p className="eco-page-kicker">Физическая точка</p><h2>{branchName(details)}</h2><span>{details.address || "Адрес не заполнен"}</span></div><span className={`eco-branches-page__status is-${details.status}`}>{details.status === "active" ? "Активен" : "Архив"}</span></header>
              <nav className="eco-branch-tabs" aria-label="Настройки филиала">
                <button type="button" onClick={() => chooseTab("overview")} className={tab === "overview" ? "is-active" : ""}>Основное</button>
                <button type="button" onClick={() => chooseTab("warehouses")} className={tab === "warehouses" ? "is-active" : ""}><Warehouse aria-hidden size={15} />Склады</button>
                <button type="button" onClick={() => chooseTab("employees")} className={tab === "employees" ? "is-active" : ""}><UsersRound aria-hidden size={15} />Сотрудники</button>
                <button type="button" onClick={() => chooseTab("channels")} className={tab === "channels" ? "is-active" : ""}><MessageSquareText aria-hidden size={15} />Каналы связи</button>
              </nav>

              {tab === "overview" && (
                <form className="eco-branch-editor" key={`overview-${details.id}-${details.updatedAt ?? ""}`} onSubmit={saveBranch}>
                  <div className="eco-branch-form-grid">
                    <label>Название<input name="name" defaultValue={details.name} required disabled={!canManage} /></label>
                    <label>Короткое название<input name="shortName" defaultValue={details.shortName} required disabled={!canManage} /></label>
                    <label className="is-wide">Адрес<input name="address" defaultValue={details.address ?? ""} disabled={!canManage} /></label>
                    <label>Часовой пояс<input name="timezone" defaultValue={details.timezone} disabled={!canManage} /></label>
                    <label>Дата открытия<input name="openingDate" type="date" defaultValue={details.openingDate?.slice(0, 10) ?? ""} disabled={!canManage} /></label>
                    <label className="is-wide">График работы<input name="workingHours" defaultValue={details.communication?.callbackSettingsJson?.workingHours ?? ""} placeholder="Пн–Пт 09:00–18:00, Сб 10:00–16:00" disabled={!canManage} /></label>
                    <label className="is-wide">Связанная организация<select name="legacyOrganizationId" defaultValue={details.legacyOrganizationId ?? ""} disabled={!canManage}><option value="">Не выбрана</option>{organizations.filter((organization) => organization.isActive || organization.id === details.legacyOrganizationId).map((organization) => <option value={organization.id} key={organization.id}>{organization.name}{organization.inn ? ` · ИНН ${organization.inn}` : ""}</option>)}</select><small>Реквизиты организации изменяются отдельно.</small></label>
                    <label>Статус<select name="status" defaultValue={details.status} disabled={!canManage}><option value="active">Активен</option><option value="archived">Архив</option></select></label>
                  </div>
                  <div className="eco-branch-editor__actions"><Link href="/cabinet/organizations" className="eco-btn eco-btn--quiet">Открыть организации</Link>{canManage && <button type="button" className="eco-btn eco-btn--secondary" onClick={() => void continueOnboarding()} disabled={saving}>Продолжить мастер настройки</button>}{canManage && <button type="submit" className="eco-btn eco-btn--primary" disabled={saving}><Save aria-hidden className="eco-icon" />{saving ? "Сохраняем…" : "Сохранить филиал"}</button>}</div>
                </form>
              )}

              {tab === "warehouses" && (
                <section className="eco-branch-warehouses">
                  <header className="eco-branch-warehouses__head">
                    <div>
                      <p className="eco-page-kicker">Локальные остатки</p>
                      <h3>Склады филиала</h3>
                      <span>Каждый склад принадлежит только этому филиалу. Создание склада не переносит остатки и движения.</span>
                    </div>
                    {canManageWarehouses && <button type="button" className="eco-btn eco-btn--primary" onClick={() => openWarehouseForm()} disabled={saving}><Plus aria-hidden className="eco-icon" />Создать склад</button>}
                  </header>

                  {warehouseFormOpen && (
                    <form className="eco-warehouse-editor" key={`warehouse-${editingWarehouse?.id ?? "new"}`} onSubmit={saveWarehouse}>
                      <div className="eco-branch-form-grid">
                        <label>Название *<input name="name" required defaultValue={editingWarehouse?.name ?? "Основной склад"} disabled={!canManageWarehouses || saving} /></label>
                        <label>Короткое название<input name="shortName" defaultValue={editingWarehouse?.shortName ?? ""} placeholder="Основной" disabled={!canManageWarehouses || saving} /></label>
                        <label className="is-wide">Адрес<input name="address" defaultValue={editingWarehouse?.address ?? details.address ?? ""} placeholder="По умолчанию — адрес филиала" disabled={!canManageWarehouses || saving} /></label>
                        <label className="is-wide">Комментарий<textarea name="comment" defaultValue={editingWarehouse?.comment ?? ""} placeholder="Например: выдача и хранение масел" disabled={!canManageWarehouses || saving} /></label>
                        <label className="eco-warehouse-editor__main"><input type="checkbox" name="isMain" value="true" defaultChecked={editingWarehouse?.isMain ?? warehouses.every((warehouse) => warehouse.archived)} disabled={!canManageWarehouses || saving} /><span>Основной склад филиала</span><small>Первый активный склад назначается основным автоматически.</small></label>
                      </div>
                      <div className="eco-branch-editor__actions">
                        <button type="button" className="eco-btn eco-btn--quiet" onClick={() => { setWarehouseFormOpen(false); setEditingWarehouse(null); }} disabled={saving}>Отменить</button>
                        {canManageWarehouses && <button type="submit" className="eco-btn eco-btn--primary" disabled={saving}><Save aria-hidden className="eco-icon" />{saving ? "Сохраняем…" : editingWarehouse ? "Сохранить склад" : "Создать склад"}</button>}
                      </div>
                    </form>
                  )}

                  {warehousesLoading ? <div className="eco-branch-empty"><Warehouse aria-hidden size={28} /><strong>Загружаем склады…</strong></div> : warehouses.length === 0 ? (
                    <div className="eco-branch-empty eco-warehouse-empty">
                      <Warehouse aria-hidden size={30} />
                      <strong>В филиале ещё нет складов</strong>
                      <span>Создайте первый склад, чтобы проводить приёмки и вести остатки этого филиала отдельно.</span>
                      {canManageWarehouses && <button type="button" className="eco-btn eco-btn--primary" onClick={() => openWarehouseForm()}><Plus aria-hidden className="eco-icon" />Создать основной склад</button>}
                    </div>
                  ) : (
                    <div className="eco-warehouse-list">
                      {warehouses.map((warehouse) => (
                        <article key={warehouse.id} className={warehouse.archived ? "is-archived" : ""}>
                          <div className="eco-warehouse-list__identity">
                            <div><Warehouse aria-hidden size={19} /></div>
                            <span>
                              <strong>{warehouse.name}</strong>
                              <small>{warehouse.shortName || warehouse.address || "Адрес не указан"}</small>
                              {warehouse.comment && <em>{warehouse.comment}</em>}
                            </span>
                          </div>
                          <div className="eco-warehouse-list__meta">
                            {warehouse.archived ? <span className="eco-warehouse-status is-archived">В архиве</span> : warehouse.isMain ? <span className="eco-warehouse-status is-main"><Star aria-hidden size={13} />Основной</span> : <span className="eco-warehouse-status">Активен</span>}
                            {canManageWarehouses && !warehouse.archived && (
                              <div className="eco-warehouse-list__actions">
                                {!warehouse.isMain && <button type="button" className="eco-btn eco-btn--quiet" onClick={() => void setMainWarehouse(warehouse)} disabled={saving}>Сделать основным</button>}
                                <button type="button" className="eco-btn eco-btn--quiet" onClick={() => openWarehouseForm(warehouse)} disabled={saving}><Pencil aria-hidden className="eco-icon" />Изменить</button>
                                <button type="button" className="eco-btn eco-btn--quiet is-danger" onClick={() => void archiveWarehouse(warehouse)} disabled={saving}><Archive aria-hidden className="eco-icon" />В архив</button>
                              </div>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {tab === "employees" && (
                <div className="eco-branch-employees">
                  <header className="eco-branch-employees__head">
                    <div>
                      <h3>Сотрудники филиала</h3>
                      <span>Создавайте учётные записи или назначайте уже зарегистрированных пользователей.</span>
                    </div>
                    {canManage && <button type="button" className="eco-btn eco-btn--primary" aria-expanded={employeeFormOpen} aria-controls="branch-create-member" onClick={() => { setEmployeeFormOpen((value) => !value); setError(""); }}><UserPlus aria-hidden className="eco-icon" />{employeeFormOpen ? "Закрыть форму" : "Создать сотрудника"}</button>}
                  </header>
                  {canManage && employeeFormOpen && (
                    <form id="branch-create-member" onSubmit={createMember} className="eco-branch-create-member">
                      <div className="eco-branch-create-member__intro"><UserPlus aria-hidden size={20} /><span><strong>Новая учётная запись</strong><small>Сотрудник сможет войти сразу после создания.</small></span></div>
                      <div className="eco-branch-create-member__grid">
                        <label>Имя сотрудника<input name="name" required minLength={2} maxLength={100} autoComplete="name" placeholder="Иван Петров" disabled={saving} /></label>
                        <label>Логин<input name="login" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="ivan" disabled={saving} /><small>3–32 символа латиницей; можно использовать цифры, точку, дефис и _</small></label>
                        <label>Временный PIN-код<input name="password" required type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="new-password" placeholder="4 цифры" disabled={saving} /></label>
                        <label>Повторите PIN-код<input name="passwordConfirmation" required type="password" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} autoComplete="new-password" placeholder="Ещё раз" disabled={saving} /></label>
                        <label className="is-wide">Роль в филиале<select name="roleId" required defaultValue="master" disabled={saving}>{BRANCH_ROLES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
                      </div>
                      <footer><span>PIN-код можно изменить позже в личном кабинете сотрудника.</span><div><button type="button" className="eco-btn eco-btn--quiet" onClick={() => { setEmployeeFormOpen(false); setError(""); }} disabled={saving}>Отменить</button><button type="submit" className="eco-btn eco-btn--primary" disabled={saving}><UserPlus aria-hidden className="eco-icon" />{saving ? "Создаём…" : "Создать и добавить"}</button></div></footer>
                    </form>
                  )}
                  {canManage && (
                    <form onSubmit={addMember} className="eco-branch-add-member">
                      <div><UsersRound aria-hidden size={20} /><span><strong>Назначить зарегистрированного пользователя</strong><small>Для сотрудника, у которого уже есть учётная запись.</small></span></div>
                      <select name="login" required defaultValue=""><option value="" disabled>Выберите сотрудника</option>{users.map((user) => <option value={user.login} key={user.login} disabled={assignedLogins.has(user.login)}>{user.name} · {user.login}{assignedLogins.has(user.login) ? " · уже добавлен" : ""}</option>)}</select>
                      <select name="roleId" required defaultValue="master">{BRANCH_ROLES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
                      <button type="submit" className="eco-btn eco-btn--primary" disabled={saving || users.every((user) => assignedLogins.has(user.login))}><UserPlus aria-hidden className="eco-icon" />Добавить</button>
                    </form>
                  )}
                  <div className="eco-branch-member-list">
                    {memberships.length ? memberships.map((membership) => (
                      <article key={membership.id} className={membership.status === "disabled" ? "is-disabled" : ""}>
                        <span><strong>{membership.user.name}</strong><small>{membership.user.login} · {membership.status === "active" ? "доступ активен" : "доступ отключён"}</small></span>
                        <select value={membership.roleId} onChange={(event) => void updateMember(membership, { roleId: event.target.value, status: "active" })} disabled={!canManage || saving}>{BRANCH_ROLES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
                        {canManage && <button type="button" className="eco-btn eco-btn--quiet" onClick={() => void updateMember(membership, { roleId: membership.roleId, status: membership.status === "active" ? "disabled" : "active" })} disabled={saving}>{membership.status === "active" ? "Отключить доступ" : "Восстановить"}</button>}
                      </article>
                    )) : <div className="eco-branch-empty"><UsersRound aria-hidden size={26} /><strong>Сотрудники не назначены</strong><span>Добавьте настроенного пользователя и выберите роль филиала.</span></div>}
                  </div>
                </div>
              )}

              {tab === "channels" && (
                <form className="eco-branch-editor" key={`channels-${details.id}-${details.updatedAt ?? ""}`} onSubmit={saveBranch}>
                  <div className="eco-branch-form-grid">
                    <label>Основной телефон<input name="phone" inputMode="tel" autoComplete="tel" placeholder="+7 (950) 676-46-16" defaultValue={formatPhoneForDisplay(details.communication?.primaryPhone || details.phone)} onChange={(event) => setPhonePreview(formatPhoneForDisplay(event.currentTarget.value))} onBlur={(event) => { const formatted = formatPhoneForDisplay(event.currentTarget.value); event.currentTarget.value = formatted; setPhonePreview(formatted); }} aria-describedby="branch-primary-phone-help" disabled={!canManage} /><small id="branch-primary-phone-help">Используется в заказ-нарядах, бирках и других документах этого филиала.</small></label>
                    <label>Дополнительный телефон<input name="secondaryPhone" defaultValue={details.communication?.secondaryPhone ?? ""} disabled={!canManage} /></label>
                    <label>Email филиала<input name="communicationEmail" type="email" defaultValue={details.communication?.email || details.email || ""} disabled={!canManage} /></label>
                    <label>WhatsApp<input name="whatsapp" defaultValue={details.communication?.whatsapp ?? ""} disabled={!canManage} /></label>
                    <label className="is-wide">Публичное имя рабочего Telegram<input name="communicationTelegram" defaultValue={details.communication?.telegram || details.telegramUsername || ""} placeholder="@tam_gde_maslo" disabled={!canManage} /><small>Это канал филиала для клиентов, не личный Telegram сотрудника.</small></label>
                  </div>
                  {details.status === "active" && !phonePreview && (
                    <div className="eco-branch-phone-warning" role="status"><AlertTriangle aria-hidden size={18} /><span><strong>Не указан основной телефон</strong><small>Он не будет отображаться в печатных документах этого филиала.</small></span></div>
                  )}
                  <section className="eco-branch-document-preview" aria-label="Предпросмотр контактов в документах">
                    <header><FileText aria-hidden size={17} /><span><strong>Используется в документах</strong><small>Актуальные контакты филиала при каждой печати</small></span></header>
                    <div><strong>{details.address || branchName(details)}</strong><span>{phonePreview || "Телефон не указан"}</span></div>
                  </section>
                  <div className="eco-working-telegram-status"><MessageSquareText aria-hidden size={20} /><span><strong>Рабочий Telegram филиала</strong><small>{details.telegramIntegration?.status === "connected" ? `${details.telegramIntegration.telegramUsername ? `@${details.telegramIntegration.telegramUsername}` : details.telegramIntegration.phoneNumberMasked ?? "Подключён"}` : "Не подключён или требует настройки"}</small></span><Link href="/cabinet/integrations/messenger" className="eco-btn eco-btn--secondary">Настроить канал связи</Link></div>
                  <div className="eco-branch-editor__actions">{canManage && <button type="submit" className="eco-btn eco-btn--primary" disabled={saving}><Save aria-hidden className="eco-icon" />{saving ? "Сохраняем…" : "Сохранить каналы"}</button>}</div>
                </form>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
