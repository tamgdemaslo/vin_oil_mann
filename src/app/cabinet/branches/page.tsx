"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Building2, Check, MessageSquareText, Plus, Save, UserPlus, UsersRound } from "lucide-react";
import { safeReadJson } from "@/lib/http-json";

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
type BranchTab = "overview" | "employees" | "channels";

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
  const tab: BranchTab = rawTab === "employees" || rawTab === "channels" ? rawTab : "overview";
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
  const [tab, setTab] = useState<BranchTab>("overview");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const updateLocation = useCallback((branchId: string | null, nextTab: BranchTab) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (branchId) params.set("branch", branchId);
    if (nextTab !== "overview") params.set("tab", nextTab);
    window.history.replaceState(null, "", `/cabinet/branches${params.size ? `?${params}` : ""}`);
  }, []);

  const loadBranches = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/branches", { cache: "no-store" });
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
    setLoading(false);
  }, []);

  const loadOrganizations = useCallback(async () => {
    const response = await fetch("/api/organizations", { cache: "no-store" });
    if (!response.ok) return;
    const payload = await safeReadJson<{ organizations?: Organization[] }>(response);
    setOrganizations(payload?.organizations ?? []);
  }, []);

  const loadBranch = useCallback(async (branchId: string) => {
    setDetailLoading(true);
    setError("");
    const [branchResponse, membersResponse, usersResponse] = await Promise.all([
      fetch(`/api/branches/${encodeURIComponent(branchId)}`, { cache: "no-store" }),
      fetch(`/api/branches/${encodeURIComponent(branchId)}/members`, { cache: "no-store" }),
      fetch("/api/auth/users", { cache: "no-store" }),
    ]);
    const branchPayload = await safeReadJson<{ branch?: BranchDetails; error?: string }>(branchResponse);
    const membersPayload = await safeReadJson<{ memberships?: Membership[] }>(membersResponse);
    const usersPayload = await safeReadJson<{ users?: PublicUser[] }>(usersResponse);
    if (!branchResponse.ok || !branchPayload?.branch) {
      setError(branchPayload?.error ?? "Не удалось открыть филиал");
      setDetails(null);
    } else {
      setDetails(branchPayload.branch);
    }
    setMemberships(membersResponse.ok ? membersPayload?.memberships ?? [] : []);
    setUsers(usersResponse.ok ? usersPayload?.users ?? [] : []);
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    // These callbacks start remote reads; their state updates happen as the requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.all([loadBranches(), loadOrganizations()]);
  }, [loadBranches, loadOrganizations]);

  useEffect(() => {
    // The selected id is the external route state that drives the detail request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedBranchId) void loadBranch(selectedBranchId);
  }, [loadBranch, selectedBranchId]);

  const assignedLogins = useMemo(() => new Set(memberships.filter((membership) => membership.status === "active").map((membership) => membership.user.login)), [memberships]);

  function chooseBranch(branchId: string) {
    setSelectedBranchId(branchId);
    setTab("overview");
    setNotice("");
    updateLocation(branchId, "overview");
  }

  function chooseTab(nextTab: BranchTab) {
    setTab(nextTab);
    setNotice("");
    updateLocation(selectedBranchId, nextTab);
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
      setNotice("Филиал создан. Юридические реквизиты редактируются отдельно в «Организациях».");
    }
    setSaving(false);
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
          <div><label>Рабочий телефон<input name="phone" inputMode="tel" /></label><label>Дата открытия<input name="openingDate" type="date" /></label></div>
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
                  <div className="eco-branch-editor__actions"><Link href="/cabinet/organizations" className="eco-btn eco-btn--quiet">Открыть организации</Link>{canManage && <button type="submit" className="eco-btn eco-btn--primary" disabled={saving}><Save aria-hidden className="eco-icon" />{saving ? "Сохраняем…" : "Сохранить филиал"}</button>}</div>
                </form>
              )}

              {tab === "employees" && (
                <div className="eco-branch-employees">
                  {canManage && (
                    <form onSubmit={addMember} className="eco-branch-add-member">
                      <div><UserPlus aria-hidden size={20} /><span><strong>Добавить существующего пользователя</strong><small>Доступ начинает действовать сразу после назначения роли.</small></span></div>
                      <select name="login" required defaultValue=""><option value="" disabled>Выберите сотрудника</option>{users.map((user) => <option value={user.login} key={user.login} disabled={assignedLogins.has(user.login)}>{user.name} · {user.login}{assignedLogins.has(user.login) ? " · уже добавлен" : ""}</option>)}</select>
                      <select name="roleId" required defaultValue="master">{BRANCH_ROLES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
                      <button type="submit" className="eco-btn eco-btn--primary" disabled={saving}><UserPlus aria-hidden className="eco-icon" />Добавить</button>
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
                <form className="eco-branch-editor" onSubmit={saveBranch}>
                  <div className="eco-branch-form-grid">
                    <label>Основной телефон<input name="phone" defaultValue={details.communication?.primaryPhone || details.phone || ""} disabled={!canManage} /></label>
                    <label>Дополнительный телефон<input name="secondaryPhone" defaultValue={details.communication?.secondaryPhone ?? ""} disabled={!canManage} /></label>
                    <label>Email филиала<input name="communicationEmail" type="email" defaultValue={details.communication?.email || details.email || ""} disabled={!canManage} /></label>
                    <label>WhatsApp<input name="whatsapp" defaultValue={details.communication?.whatsapp ?? ""} disabled={!canManage} /></label>
                    <label className="is-wide">Публичное имя рабочего Telegram<input name="communicationTelegram" defaultValue={details.communication?.telegram || details.telegramUsername || ""} placeholder="@tam_gde_maslo" disabled={!canManage} /><small>Это канал филиала для клиентов, не личный Telegram сотрудника.</small></label>
                  </div>
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
