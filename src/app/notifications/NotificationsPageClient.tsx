"use client";

import { Bell, CalendarClock, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EcoBadge, EcoCard, EcoStatusDot, type EcoBadgeTone } from "@/components/platform/EcoUI";
import { formatServiceDateTime } from "@/lib/date-time";
import { tryResponseJson } from "@/lib/response-json";

type NotificationUrgency = "urgent" | "today" | "soon" | "info";

type DashboardNotification = {
  id: string;
  urgency: NotificationUrgency;
  title: string;
  description: string;
  deadline?: string | null;
  entityLabel: string;
  entityHref: string;
  actionLabel: string;
};

type DashboardData = {
  notifications: DashboardNotification[];
  notificationCounts: Record<NotificationUrgency | "total", number>;
};

const GROUPS: Array<{ id: NotificationUrgency; title: string; empty: string }> = [
  { id: "urgent", title: "Срочно", empty: "Срочных задач нет" },
  { id: "today", title: "Сегодня", empty: "На сегодня всё спокойно" },
  { id: "soon", title: "Скоро", empty: "Ближайших дедлайнов нет" },
  { id: "info", title: "Информационные", empty: "Информационных уведомлений нет" },
];

function urgencyTone(urgency: NotificationUrgency): EcoBadgeTone {
  if (urgency === "urgent") return "danger";
  if (urgency === "today") return "warning";
  if (urgency === "soon") return "info";
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/dashboard/operations", { cache: "no-store" });
        if (cancelled) return;
        setData(await tryResponseJson<DashboardData>(res));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const byGroup = useMemo(() => {
    const map = new Map<NotificationUrgency, DashboardNotification[]>();
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
            Уведомления <span className="muted">дедлайны, просрочки и контроль дня.</span>
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
                      <p>{item.description}</p>
                      <div className="eco-notification-card__meta">
                        <span>
                          <CalendarClock aria-hidden className="eco-icon" />
                          {deadlineLabel(item.deadline)}
                        </span>
                        <span>{item.entityLabel}</span>
                      </div>
                      <div className="eco-notification-card__actions">
                        <Link href={item.entityHref} className="eco-btn eco-btn--primary eco-btn--sm">
                          {item.actionLabel}
                        </Link>
                        {item.actionLabel !== "Открыть" && (
                          <Link href={item.entityHref} className="eco-btn eco-btn--ghost eco-btn--sm">
                            Открыть
                          </Link>
                        )}
                        <Link href={`${item.entityHref}${item.entityHref.includes("?") ? "&" : "?"}action=close`} className="eco-btn eco-btn--ghost eco-btn--sm">
                          Закрыть
                        </Link>
                        <Link href={`${item.entityHref}${item.entityHref.includes("?") ? "&" : "?"}action=snooze`} className="eco-btn eco-btn--ghost eco-btn--sm">
                          Отложить
                        </Link>
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
