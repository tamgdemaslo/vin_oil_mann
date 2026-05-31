"use client";

import Link from "next/link";
import { CalendarDays, CreditCard, KeyRound, Plug, ShieldCheck } from "lucide-react";
import PasswordChangeCard from "./PasswordChangeCard";
import { EcoBadge, EcoKpi } from "@/components/platform/EcoUI";

type CabinetDashboardProps = {
  role?: "owner" | "admin" | "master";
};

export default function CabinetDashboard({ role }: CabinetDashboardProps) {
  const canManageIntegrations = role === "owner" || role === "admin";
  const links = [
    { href: "/cabinet/salary", label: "Зарплата", description: "Начисления, выплаты и детализация периода.", icon: CreditCard },
    { href: "/cabinet/shifts", label: "Смены", description: "История и рабочие смены сотрудника.", icon: CalendarDays },
    { href: "/cabinet/analytics", label: "Аналитика", description: "Показатели и расчётные блоки для руководителя.", icon: ShieldCheck },
    ...(canManageIntegrations
      ? [{ href: "/cabinet/integrations", label: "Интеграции", description: "Статус и ручные служебные запуски.", icon: Plug }]
      : []),
  ];

  return (
    <main className="eco-page">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <span className="cur">Кабинет</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Личный кабинет</h1>
            <EcoBadge tone="success" dot>
              внутренний доступ
            </EcoBadge>
          </div>
          <p className="eco-page-subtitle">Профиль сотрудника и настройки доступа.</p>
        </div>
      </section>

      <div className="eco-grid eco-grid--kpi eco-cabinet-metrics">
        <EcoKpi label="Профиль" value="Активен" tone="success" />
        <EcoKpi label="Пароль" value="4 цифры" tone="neutral" />
        <EcoKpi label="Разделы" value={links.length} tone="rust" />
      </div>

      <section className="eco-cabinet-grid">
        <div className="eco-card">
          <div className="eco-card__head">
            <div>
              <div className="eco-page-kicker">Разделы</div>
              <h2 className="eco-stock-doc-title">Рабочие блоки</h2>
            </div>
          </div>
          <div className="eco-action-list">
            {links.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} className="eco-action-link">
                  <span className="eco-action-icon">
                    <Icon size={17} />
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        <div className="eco-card eco-card--padded">
          <div className="eco-card__head--plain">
            <div>
              <div className="eco-page-kicker">Безопасность</div>
              <h2>Смена пароля</h2>
              <p>Обновите 4-значный пароль для входа в систему.</p>
            </div>
            <KeyRound size={22} />
          </div>
          <PasswordChangeCard />
        </div>
      </section>
    </main>
  );
}
