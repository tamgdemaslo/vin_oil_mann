"use client";

import type { ReactNode } from "react";
import AnalyticsBlock from "../cabinet/analytics/AnalyticsBlock";
import PieceworkRulesEditor from "../cabinet/analytics/PieceworkRulesEditor";
import WorkingDaysBlock from "../cabinet/working-days/WorkingDaysBlock";

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
      className={`scroll-mt-24 rounded-3xl border border-zinc-200 bg-white/95 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90 sm:p-6 ${className}`}
    >
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">{title}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
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
  const sectionLinks = [
    ...(isOwner
      ? [
          {
            href: "#working-days",
            label: "Рабочие дни сотрудников",
            description: "Календарь рабочих дней и фактических смен по сотрудникам.",
          },
        ]
      : []),
    {
      href: "#payouts",
      label: "Выплаты и ставки",
      description: isOwner
        ? "Расчет по сотрудникам, ставки смен и остатки к выдаче."
        : "Ваш расчет зарплаты, текущая ставка и детализация начислений.",
    },
    ...(isOwner
      ? [
          {
            href: "#piecework-rules",
            label: "Правила сдельной части",
            description: "Настройка фиксированных значений и процентов для расчета.",
          },
        ]
      : []),
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <section className="rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            Разделы:
          </span>
          {sectionLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-amber-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <div className="space-y-6">
        {isOwner && (
          <SectionCard
            id="working-days"
            title="Рабочие дни сотрудников"
            description="Календарь рабочих дней по сотрудникам и фактические смены."
          >
            <WorkingDaysBlock />
          </SectionCard>
        )}

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

        {isOwner && (
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
