"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CalendarDays, CreditCard, Settings2 } from "lucide-react";
import AnalyticsBlock from "../cabinet/analytics/AnalyticsBlock";
import PieceworkRulesEditor from "../cabinet/analytics/PieceworkRulesEditor";
import WorkingDaysBlock from "../cabinet/working-days/WorkingDaysBlock";
import { EcoBadge, EcoKpi } from "@/components/platform/EcoUI";

type SectionCardProps = {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
};

function SectionCard({ id, title, description, children, className = "" }: SectionCardProps) {
  return (
    <section
      id={id}
      className={`eco-salary-section scroll-mt-24 ${className}`}
    >
      <div className="eco-salary-section-head">
        <div className="eco-page-kicker">Зарплата</div>
        <h2 className="eco-page-title">{title}</h2>
        <p className="eco-page-subtitle">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default function SalaryDashboard({
  role,
  login,
  isOwner,
}: {
  role: string;
  login: string;
  isOwner: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"working-days" | "payouts" | "piecework-rules">("payouts");
  const sectionLinks = [
    {
      id: "payouts" as const,
      label: isOwner ? "Все сотрудники" : "Мои начисления",
      description: isOwner
        ? "Расчет по сотрудникам, ставки смен и остатки к выдаче."
        : "Ваш расчет зарплаты, текущая ставка и детализация начислений.",
      icon: CreditCard,
      count: isOwner ? "расчет" : login,
    },
    ...(isOwner
      ? [
          {
            id: "working-days" as const,
            label: "Рабочие дни сотрудников",
            description: "Календарь рабочих дней и фактических смен по сотрудникам.",
            icon: CalendarDays,
            count: "календарь",
          },
          {
            id: "piecework-rules" as const,
            label: "Правила сдельной части",
            description: "Настройка фиксированных значений и процентов для расчета.",
            icon: Settings2,
            count: "правила",
          },
        ]
      : []),
  ];
  const activeSection = sectionLinks.find((section) => section.id === activeTab) ?? sectionLinks[0];

  return (
    <main className="eco-page">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <span>Финансы</span>
            <span className="sep">/</span>
            <span className="cur">Зарплата</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Зарплата</h1>
            <EcoBadge tone="rust">текущий период</EcoBadge>
            <EcoBadge tone={isOwner ? "success" : "info"} dot>
              {isOwner ? "владелец" : "сотрудник"}
            </EcoBadge>
          </div>
          <p className="eco-page-subtitle">
            Расчёт выплат, рабочих дней и сдельных правил по текущим данным платформы.
          </p>
        </div>
        <div className="eco-seg">
          <button type="button" className={`eco-seg-btn ${isOwner ? "is-active" : ""}`} disabled={!isOwner}>
            Владелец
          </button>
          <button type="button" className={`eco-seg-btn ${!isOwner ? "is-active" : ""}`} disabled={isOwner}>
            Сотрудник
          </button>
        </div>
      </section>

      <div className="eco-grid eco-grid--kpi eco-salary-metrics">
        <EcoKpi label="Режим" value={isOwner ? "Владелец" : "Сотрудник"} tone={isOwner ? "success" : "info"} />
        <EcoKpi label="Логин" value={login} tone="neutral" />
        <EcoKpi label="Раздел" value={activeSection.label} sub={activeSection.count} tone="rust" />
        <EcoKpi label="Доступ" value={role} tone="neutral" />
      </div>

      <div className="eco-tabs eco-salary-tabs">
        {sectionLinks.map((section) => {
          const Icon = section.icon;
          return (
            <button
              key={section.id}
              type="button"
              className={`eco-tab ${activeTab === section.id ? "is-active" : ""}`}
              onClick={() => setActiveTab(section.id)}
            >
              <Icon size={15} />
              {section.label}
              <span className="eco-tab__count">{section.count}</span>
            </button>
          );
        })}
      </div>

      <div className="eco-salary-content">
        {isOwner && activeTab === "working-days" && (
          <SectionCard
            id="working-days"
            title="Рабочие дни сотрудников"
            description="Календарь рабочих дней по сотрудникам и фактические смены."
          >
            <WorkingDaysBlock />
          </SectionCard>
        )}

        {activeTab === "payouts" && (
          <SectionCard
            id="payouts"
            title="Выплаты и ставки"
            description={
              isOwner
                ? "Кто, за что и сколько получает, плюс редактирование ставок смен."
                : "Ваши начисления за период, текущая ставка смены и разбивка сдельной части."
            }
          >
            <AnalyticsBlock role={role} login={login} embedded showPieceworkRules={false} />
          </SectionCard>
        )}

        {isOwner && activeTab === "piecework-rules" && (
          <SectionCard
            id="piecework-rules"
            title="Правила сдельной части"
            description="Настройка сдельных начислений для услуг и групп товаров."
          >
            <PieceworkRulesEditor />
          </SectionCard>
        )}
      </div>
    </main>
  );
}
