"use client";

import Link from "next/link";
import { Bell, Building2, KeyRound, Send, UserRound, WalletCards } from "lucide-react";
import EmployeeTelegramCard from "./EmployeeTelegramCard";
import PasswordChangeCard from "./PasswordChangeCard";
import { EcoBadge } from "@/components/platform/EcoUI";

type CabinetTab = "profile" | "security" | "telegram" | "branches";

type CabinetDashboardProps = {
  user: { login: string; name: string; role: "owner" | "admin" | "master" };
  branches: Array<{ id: string; displayName?: string; shortName: string; name: string; status: string }>;
  activeBranchId: string | null;
  branchRole: string | null;
  initialTab: CabinetTab;
};

const tabs: Array<{ id: CabinetTab; label: string; icon: typeof UserRound }> = [
  { id: "profile", label: "Мой профиль", icon: UserRound },
  { id: "security", label: "Безопасность", icon: KeyRound },
  { id: "telegram", label: "Мой Telegram", icon: Send },
  { id: "branches", label: "Доступные филиалы", icon: Building2 },
];

function roleLabel(role: string | null) {
  const labels: Record<string, string> = {
    owner: "Владелец",
    admin: "Администратор",
    master: "Мастер-приёмщик",
    group_owner: "Владелец группы",
    group_admin: "Администратор группы",
    group_analyst: "Аналитик группы",
    branch_owner: "Владелец филиала",
    administrator: "Администратор филиала",
    mechanic: "Механик",
    accountant: "Бухгалтер",
    viewer: "Наблюдатель",
  };
  return role ? labels[role] ?? role : "Сотрудник";
}

export default function CabinetDashboard({ user, branches, activeBranchId, branchRole, initialTab }: CabinetDashboardProps) {
  const activeBranch = branches.find((branch) => branch.id === activeBranchId) ?? null;

  return (
    <main className="eco-page eco-personal-page">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главное</Link>
            <span className="sep">/</span>
            <span className="cur">Мой профиль</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Личные настройки</h1>
            <EcoBadge tone="success" dot>только ваши данные</EcoBadge>
          </div>
          <p className="eco-page-subtitle">Профиль, безопасность и персональные уведомления сотрудника.</p>
        </div>
      </section>

      <nav className="eco-personal-tabs" aria-label="Личные настройки">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const href = tab.id === "profile" ? "/cabinet" : `/cabinet?tab=${tab.id}`;
          return (
            <Link key={tab.id} href={href} className={initialTab === tab.id ? "is-active" : ""} aria-current={initialTab === tab.id ? "page" : undefined}>
              <Icon aria-hidden size={16} />
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {initialTab === "profile" && (
        <section className="eco-personal-grid">
          <article className="eco-card eco-card--padded">
            <div className="eco-card__head--plain">
              <div><div className="eco-page-kicker">Учётная запись</div><h2>{user.name}</h2><p>Персональные данные текущего сотрудника.</p></div>
              <UserRound aria-hidden size={22} />
            </div>
            <dl className="eco-personal-details">
              <div><dt>Логин</dt><dd>{user.login}</dd></div>
              <div><dt>Роль в филиале</dt><dd>{roleLabel(branchRole ?? user.role)}</dd></div>
              <div><dt>Текущий филиал</dt><dd>{activeBranch?.displayName ?? activeBranch?.shortName ?? activeBranch?.name ?? "Все филиалы"}</dd></div>
            </dl>
          </article>
          <article className="eco-card eco-card--padded">
            <div className="eco-card__head--plain">
              <div><div className="eco-page-kicker">Быстрые переходы</div><h2>Мои рабочие данные</h2><p>Личные сведения не смешиваются с управлением бизнесом.</p></div>
              <WalletCards aria-hidden size={22} />
            </div>
            <div className="eco-action-list">
              <Link href="/salary?view=mine" className="eco-action-link"><span className="eco-action-icon"><WalletCards size={17} /></span><span><strong>Моя зарплата</strong><small>Собственные начисления и выплаты</small></span></Link>
              <Link href="/notifications" className="eco-action-link"><span className="eco-action-icon"><Bell size={17} /></span><span><strong>Мои уведомления</strong><small>Задачи и персональные напоминания</small></span></Link>
            </div>
          </article>
        </section>
      )}

      {initialTab === "security" && (
        <section className="eco-card eco-card--padded eco-personal-single">
          <div className="eco-card__head--plain">
            <div><div className="eco-page-kicker">Безопасность</div><h2>Смена пароля</h2><p>Обновите 4-значный пароль для входа в Эко-платформу.</p></div>
            <KeyRound aria-hidden size={22} />
          </div>
          <PasswordChangeCard />
        </section>
      )}

      {initialTab === "telegram" && <EmployeeTelegramCard />}

      {initialTab === "branches" && (
        <section className="eco-card eco-card--padded eco-personal-single">
          <div className="eco-card__head--plain">
            <div><div className="eco-page-kicker">Рабочий доступ</div><h2>Доступные филиалы</h2><p>Здесь показаны ваши рабочие области. Настройки бизнеса находятся в «Управлении».</p></div>
            <Building2 aria-hidden size={22} />
          </div>
          <div className="eco-personal-branches">
            {branches.map((branch) => (
              <div key={branch.id} className={branch.id === activeBranchId ? "is-active" : ""}>
                <span><strong>{branch.displayName ?? branch.shortName ?? branch.name}</strong><small>{branch.id === activeBranchId ? "Текущий филиал" : branch.status === "active" ? "Доступен" : "Архив"}</small></span>
                {branch.id === activeBranchId && <EcoBadge tone="success">выбран</EcoBadge>}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
