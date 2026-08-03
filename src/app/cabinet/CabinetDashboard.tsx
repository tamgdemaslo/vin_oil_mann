"use client";

import Link from "next/link";
import { BellRing, Bot, Building2, KeyRound, Plug, ShieldCheck, UserRound } from "lucide-react";
import EmployeeTelegramCard from "./EmployeeTelegramCard";
import PasswordChangeCard from "./PasswordChangeCard";
import { EcoBadge, EcoKpi } from "@/components/platform/EcoUI";

type CabinetDashboardProps = {
  role?: "owner" | "admin" | "master";
  canManageOrganizations?: boolean;
};

export default function CabinetDashboard({ role, canManageOrganizations = false }: CabinetDashboardProps) {
  const canAccessCrm = role === "owner" || role === "admin";
  const canManageIntegrations = role === "owner" || role === "admin";
  const links = [
    { href: "/cabinet", label: "Профиль", description: "Личные данные и смена пароля.", icon: UserRound },
    ...(canAccessCrm
      ? [
          {
            href: "/cabinet/customer-analytics",
            label: "Аналитика клиентов",
            description: "Повторы, прибыль и клиентские показатели.",
            icon: ShieldCheck,
          },
        ]
      : []),
    ...(canManageIntegrations
      ? [
          {
            href: "/cabinet/ai-assistant",
            label: "ИИ-помощник",
            description: "Внутренний поиск, проверка данных и расчёты без действий от имени клиента.",
            icon: Bot,
          },
          ...(canManageOrganizations
            ? [
                {
                  href: "/cabinet/organizations",
                  label: "Организации",
                  description: "Реквизиты, банк, налоги и основная организация.",
                  icon: Building2,
                },
              ]
            : []),
          { href: "/cabinet/integrations", label: "Интеграции", description: "Статус и ручные служебные запуски.", icon: Plug },
          {
            href: "/cabinet/integrations/messenger",
            label: "Мессенджеры",
            description: "Telegram webhook и будущие каналы.",
            icon: Plug,
          },
          {
            href: "/cabinet/notifications",
            label: "Уведомления клиентам",
            description: "Автоматические Telegram-сообщения, шаблоны и журнал.",
            icon: BellRing,
          },
        ]
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
              <h2 className="eco-stock-doc-title">Личные и системные блоки</h2>
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

        <EmployeeTelegramCard />
      </section>
    </main>
  );
}
