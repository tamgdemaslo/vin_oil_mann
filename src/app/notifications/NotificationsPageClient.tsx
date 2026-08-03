"use client";

import { Bell, CalendarClock, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ContactActionButton } from "@/components/messenger/ContactActionButton";
import { EcoBadge, EcoCard, EcoStatusDot, type EcoBadgeTone } from "@/components/platform/EcoUI";
import { formatServiceDateTime } from "@/lib/date-time";
import { tryResponseJson } from "@/lib/response-json";

type ClientCaseNotificationUrgency = "overdue" | "next_hour" | "today" | "info";

type DashboardNotification = {
  id: string;
  caseId: string;
  urgency: ClientCaseNotificationUrgency;
  type: "deadline_soon" | "due_now" | "overdue_repeat";
  title: string;
  body: string;
  caseTitle: string;
  client: string;
  nextAction: string;
  deadline?: string | null;
  overdueText: string | null;
  responsible: string;
  phone: string | null;
  href: string;
};

type DashboardData = {
  notifications: DashboardNotification[];
  notificationCounts: Record<ClientCaseNotificationUrgency | "total", number>;
};

const GROUPS: Array<{ id: ClientCaseNotificationUrgency; title: string; empty: string }> = [
  { id: "overdue", title: "Просроченные", empty: "Просроченных клиентских дел нет" },
  { id: "next_hour", title: "На ближайший час", empty: "На ближайший час дедлайнов нет" },
  { id: "today", title: "Сегодня", empty: "На сегодня всё спокойно" },
  { id: "info", title: "Информационные", empty: "Информационных уведомлений нет" },
];

function urgencyTone(urgency: ClientCaseNotificationUrgency): EcoBadgeTone {
  if (urgency === "overdue") return "danger";
  if (urgency === "today") return "warning";
  if (urgency === "next_hour") return "info";
  return "neutral";
}

function deadlineLabel(value?: string | null) {
  if (!value) return "без дедлайна";
  const formatted = formatServiceDateTime(value);
  return formatted === "—" ? "без дедлайна" : formatted;
}

export default function NotificationsPageClient() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/crm/deadline-notifications", { cache: "no-store" });
      setData(await tryResponseJson<DashboardData>(res));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function runAction(item: DashboardNotification, action: "acknowledge" | "snooze" | "close", minutes?: number) {
    await fetch("/api/crm/deadline-notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, notificationId: item.id, caseId: item.caseId, minutes }),
    });
    await load();
  }

  const byGroup = useMemo(() => {
    const map = new Map<ClientCaseNotificationUrgency, DashboardNotification[]>();
    for (const group of GROUPS) map.set(group.id, []);
    for (const item of data?.notifications ?? []) {
      map.get(item.urgency)?.push(item);
    }
    return map;
  }, [data]);

  return (
    <main className="eco-page eco-notifications-page">
      <div className="eco-page-head">
        <div>
          <div className="eco-page-kicker">Центр задач</div>
          <h1 className="eco-page-title">
            Уведомления <span className="muted">дела клиентов, дедлайны и просрочки.</span>
          </h1>
        </div>
        <div className="eco-actions">
          <Link href="/" className="eco-btn">
            Главная <ChevronRight aria-hidden className="eco-icon" />
          </Link>
        </div>
      </div>

      <div className="eco-notifications-kpis">
        <EcoCard className="eco-notifications-total">
          <Bell aria-hidden />
          <div>
            <span>Всего уведомлений</span>
            <strong>{loading ? "..." : data?.notificationCounts.total ?? 0}</strong>
          </div>
        </EcoCard>
        {GROUPS.map((group) => (
          <EcoCard key={group.id} className="eco-notifications-total">
            <EcoStatusDot tone={urgencyTone(group.id)} />
            <div>
              <span>{group.title}</span>
              <strong>{data?.notificationCounts[group.id] ?? 0}</strong>
            </div>
          </EcoCard>
        ))}
      </div>

      <div className="eco-notifications-grid">
        {GROUPS.map((group) => {
          const items = byGroup.get(group.id) ?? [];
          return (
            <EcoCard key={group.id} padded={false}>
              <div className="eco-card__head">
                <div className="eco-dashboard-card-title">
                  <span>{group.title}</span>
                  <EcoBadge tone={urgencyTone(group.id)}>{items.length}</EcoBadge>
                </div>
              </div>
              <div className="eco-notifications-list">
                {items.length ? (
                  items.map((item) => (
                    <article key={item.id} className={`eco-notification-card is-${item.urgency}`}>
                      <div className="eco-notification-card__top">
                        <EcoStatusDot tone={urgencyTone(item.urgency)} />
                        <strong>{item.title}</strong>
                      </div>
                      <p>{item.body}</p>
                      <div className="eco-notification-card__meta">
                        <span>
                          <CalendarClock aria-hidden className="eco-icon" />
                          {deadlineLabel(item.deadline)}
                        </span>
                        {item.overdueText && <span>Просрочено на {item.overdueText}</span>}
                        <span>{item.client}</span>
                        <span>Ответственный: {item.responsible}</span>
                      </div>
                      <div className="eco-notification-card__case">
                        <strong>{item.caseTitle}</strong>
                        <span>{item.nextAction}</span>
                      </div>
                      <div className="eco-notification-card__actions">
                        <Link href={item.href} onClick={() => void runAction(item, "acknowledge")} className="eco-btn eco-btn--primary eco-btn--sm">
                          Открыть дело
                        </Link>
                        <button type="button" onClick={() => void runAction(item, "snooze", 15)} className="eco-btn eco-btn--ghost eco-btn--sm">
                          Отложить на 15 минут
                        </button>
                        <button type="button" onClick={() => void runAction(item, "snooze", 60)} className="eco-btn eco-btn--ghost eco-btn--sm">
                          Отложить на 1 час
                        </button>
                        <button type="button" onClick={() => void runAction(item, "close")} className="eco-btn eco-btn--ghost eco-btn--sm">
                          Закрыть
                        </button>
                        <ContactActionButton
                          size="sm"
                          entityType="crm_case"
                          entityId={item.caseId}
                          phone={item.phone}
                          displayName={item.client}
                          context={{
                            entityType: "crm_case",
                            entityId: item.caseId,
                            crmCaseId: item.caseId,
                            date: item.deadline ?? null,
                          }}
                        />
                        {item.phone && (
                          <a href={`tel:${item.phone}`} className="eco-btn eco-btn--ghost eco-btn--sm">
                            Позвонить
                          </a>
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="eco-dashboard-empty">
                    <strong>{group.empty}</strong>
                    <span>Новые события появятся здесь автоматически.</span>
                  </div>
                )}
              </div>
            </EcoCard>
          );
        })}
      </div>
    </main>
  );
}
