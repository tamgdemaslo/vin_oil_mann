"use client";

import { Archive, ArrowRight, Building2, CalendarDays, MapPin, Phone, Plus, Settings, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { invalidateDashboardClientBundle } from "@/lib/dashboard-client";
import { safeReadJson } from "@/lib/http-json";

type Branch = {
  id: string;
  name: string;
  shortName: string;
  slug: string;
  status: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  legalEntityName: string | null;
  openingDate: string | null;
  createdAt: string;
  communication: { callbackSettingsJson?: unknown } | null;
  legalEntities: Array<{ name: string; isPrimary: boolean }>;
  telegramIntegration: { status: string; lastSyncAt: string | null; errorCode: string | null } | null;
  _count: { memberships: number };
};

type BranchListPayload = {
  branches?: Branch[];
  activeBranchId?: string;
  mode?: "branch" | "all";
  canCreateBranches?: boolean;
  canUpdateBranches?: boolean;
  canArchiveBranches?: boolean;
  error?: string;
};

function dateRu(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("ru-RU");
}

function workLabel(branch: Branch) {
  const callbacks = branch.communication?.callbackSettingsJson;
  if (!callbacks || typeof callbacks !== "object" || Array.isArray(callbacks)) return "График не заполнен";
  const work = (callbacks as { work?: unknown }).work;
  if (!work || typeof work !== "object" || Array.isArray(work)) return "График не заполнен";
  const data = work as { days?: unknown; startTime?: unknown; endTime?: unknown };
  const days = Array.isArray(data.days) ? data.days.map(String).join(", ") : "";
  const time = data.startTime && data.endTime ? `${String(data.startTime)}–${String(data.endTime)}` : "";
  return [days, time].filter(Boolean).join(" · ") || "График не заполнен";
}

function telegramLabel(branch: Branch) {
  if (branch.telegramIntegration?.status === "connected") return "Telegram подключён";
  if (branch.telegramIntegration?.errorCode) return "Telegram требует внимания";
  return "Telegram не подключён";
}

export default function BranchesPage() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [canCreate, setCanCreate] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [canArchive, setCanArchive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/branches", { cache: "no-store" });
    const payload = await safeReadJson<BranchListPayload>(response);
    setBranches(payload?.branches ?? []);
    setActiveBranchId(payload?.activeBranchId ?? "all");
    setCanCreate(Boolean(payload?.canCreateBranches));
    setCanUpdate(Boolean(payload?.canUpdateBranches));
    setCanArchive(Boolean(payload?.canArchiveBranches));
    setError(response.ok ? "" : payload?.error ?? "Не удалось загрузить филиалы");
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const totals = useMemo(() => ({
    active: branches.filter((branch) => branch.status === "active").length,
    archived: branches.filter((branch) => branch.status === "archived").length,
    members: branches.reduce((sum, branch) => sum + branch._count.memberships, 0),
  }), [branches]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const payload = await safeReadJson<{ error?: string; branch?: { id: string } }>(response);
    if (!response.ok) {
      setError(payload?.error ?? "Не удалось создать филиал");
      return;
    }
    event.currentTarget.reset();
    setCreating(false);
    await load();
  }

  async function switchBranch(branchId: string, destination?: string) {
    if (switchingId) return;
    setSwitchingId(branchId);
    setError("");
    try {
      const response = await fetch("/api/session/active-branch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId }),
      });
      const payload = await safeReadJson<{ error?: string }>(response);
      if (!response.ok) {
        setError(payload?.error ?? "Не удалось переключить филиал");
        return;
      }
      const sessionResponse = await fetch("/api/session/active-branch", { cache: "no-store" });
      const session = await safeReadJson<{ activeBranchId?: string; error?: string }>(sessionResponse);
      if (!sessionResponse.ok || session?.activeBranchId !== branchId) {
        setError(session?.error ?? "Сессия филиала не успела обновиться. Повторите переключение.");
        return;
      }
      setActiveBranchId(branchId);
      invalidateDashboardClientBundle();
      window.dispatchEvent(new CustomEvent("eco-branch-context-changed", { detail: { branchId } }));
      if (destination) router.push(destination);
      router.refresh();
    } finally {
      setSwitchingId(null);
    }
  }

  async function archive(branch: Branch) {
    if (branch.id !== activeBranchId) {
      setError("Перед архивированием переключитесь на выбранный филиал.");
      return;
    }
    if (!window.confirm(`Архивировать филиал «${branch.shortName}»?`)) return;
    const response = await fetch(`/api/branches/${branch.id}/archive`, { method: "POST" });
    const payload = await safeReadJson<{ error?: string }>(response);
    if (!response.ok) {
      setError(payload?.error ?? "Не удалось архивировать филиал");
      return;
    }
    await load();
    router.refresh();
  }

  return (
    <main className="eco-branches-page">
      <header className="eco-branches-page__head">
        <div>
          <p>Кабинет / Филиалы</p>
          <h1>Филиалы</h1>
          <span>Адреса, телефоны, графики, сотрудники и настройки физических точек обслуживания.</span>
        </div>
        {canCreate && (
          <button type="button" className="eco-btn eco-btn--primary" onClick={() => setCreating((value) => !value)}>
            <Plus aria-hidden className="eco-icon" />
            {creating ? "Закрыть форму" : "Создать филиал"}
          </button>
        )}
      </header>

      <section className="eco-branches-page__summary" aria-label="Сводка по филиалам">
        <div><span>Активные точки</span><strong>{totals.active}</strong></div>
        <div><span>Сотрудники</span><strong>{totals.members}</strong></div>
        <div><span>Архив</span><strong>{totals.archived}</strong></div>
      </section>

      {error && <p className="eco-branches-page__error" role="alert">{error}</p>}

      {creating && (
        <form className="eco-branches-page__form" onSubmit={submit}>
          <div><label>Полное название<input name="name" required placeholder="Новая точка" /></label><label>Короткое название<input name="shortName" required placeholder="Новая" /></label></div>
          <div><label>Адрес<input name="address" placeholder="Адрес точки" /></label><label>Часовой пояс<input name="timezone" defaultValue="Europe/Kaliningrad" /></label></div>
          <div><label>Рабочий телефон<input name="phone" inputMode="tel" /></label><label>Дата открытия<input name="openingDate" type="date" /></label></div>
          <footer><span>Новая точка создаётся пустой: клиенты, остатки, документы и credentials других филиалов не копируются.</span><button className="eco-btn eco-btn--primary" type="submit">Создать пустой филиал</button></footer>
        </form>
      )}

      <section className="eco-branches-page__list" aria-busy={loading}>
        {loading ? (
          <p className="eco-branches-page__loading">Загрузка филиалов…</p>
        ) : branches.length === 0 ? (
          <p className="eco-branches-page__loading">Нет доступных филиалов.</p>
        ) : branches.map((branch) => {
          const active = branch.id === activeBranchId;
          const settingsHref = `/cabinet/branches/${branch.id}`;
          const legalName = branch.legalEntities.find((item) => item.isPrimary)?.name ?? branch.legalEntityName ?? "Организация не выбрана";
          return (
            <article key={branch.id} className={active ? "is-current" : undefined}>
              <div className="eco-branches-page__identity">
                <span className={`eco-branches-page__dot is-${branch.status}`} />
                <div>
                  <strong>{branch.name}</strong>
                  <small>{branch.shortName}{active ? " · текущий филиал" : ""}</small>
                </div>
                <span className="eco-branches-page__status">{branch.status === "active" ? "Активен" : branch.status === "archived" ? "Архив" : "Неактивен"}</span>
              </div>
              <dl>
                <div><dt><MapPin aria-hidden size={13} />Адрес</dt><dd>{branch.address || "Не заполнен"}</dd></div>
                <div><dt><Phone aria-hidden size={13} />Телефон</dt><dd>{branch.phone || "Не заполнен"}</dd></div>
                <div><dt><CalendarDays aria-hidden size={13} />Режим работы</dt><dd>{workLabel(branch)}</dd></div>
                <div><dt><Users aria-hidden size={13} />Сотрудники</dt><dd>{branch._count.memberships}</dd></div>
                <div><dt><Building2 aria-hidden size={13} />Организация</dt><dd>{legalName}</dd></div>
                <div><dt>Telegram</dt><dd>{telegramLabel(branch)}</dd></div>
                <div><dt>Создан</dt><dd>{dateRu(branch.createdAt)}</dd></div>
              </dl>
              <footer>
                <Link href={settingsHref} className="eco-btn eco-btn--secondary"><ArrowRight aria-hidden className="eco-icon" />Открыть</Link>
                {canUpdate && (
                  <button type="button" className="eco-btn eco-btn--secondary" onClick={() => active ? router.push(settingsHref) : void switchBranch(branch.id, settingsHref)} disabled={Boolean(switchingId) || branch.status !== "active"}>
                    <Settings aria-hidden className="eco-icon" />{switchingId === branch.id ? "Переключаем…" : "Настроить"}
                  </button>
                )}
                {!active && branch.status === "active" && <button type="button" className="eco-btn eco-btn--secondary" onClick={() => void switchBranch(branch.id)} disabled={Boolean(switchingId)}>Переключиться</button>}
                {canArchive && branch.status === "active" && <button type="button" className="eco-btn eco-btn--ghost-danger" onClick={() => void archive(branch)}><Archive aria-hidden className="eco-icon" />Архивировать</button>}
              </footer>
            </article>
          );
        })}
      </section>
    </main>
  );
}
