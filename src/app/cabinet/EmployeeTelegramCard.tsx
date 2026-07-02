"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BellRing, Settings, Send } from "lucide-react";
import { EcoBadge } from "@/components/platform/EcoUI";

type TelegramStatus =
  | { connected: false }
  | {
      connected: true;
      connectionId: string;
      externalUsername?: string | null;
      displayName?: string | null;
      linkedAt?: string | null;
      lastSeenAt?: string | null;
      blockedAt?: string | null;
    };

type TelegramError = {
  message: string;
  code?: string;
  settingsUrl?: string;
};

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const notificationTypes = [
  "назначенные задачи",
  "просроченные задачи",
  "уведомления по делам клиентов",
  "напоминания по записям",
  "кассовые уведомления",
  "системные уведомления",
];

export default function EmployeeTelegramCard() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<TelegramError | null>(null);

  useEffect(() => {
    let alive = true;
    async function loadStatus() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/cabinet/telegram-link", { cache: "no-store" });
        const data = await readJson<{ telegram?: TelegramStatus; error?: string }>(res);
        if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить Telegram");
        if (alive) setStatus(data?.telegram ?? { connected: false });
      } catch (e) {
        if (alive) setError({ message: e instanceof Error ? e.message : "Не удалось загрузить Telegram" });
      } finally {
        if (alive) setLoading(false);
      }
    }
    void loadStatus();
    return () => {
      alive = false;
    };
  }, []);

  const connected = status?.connected;

  return (
    <div className="eco-card eco-card--padded eco-employee-telegram-card">
      <div className="eco-card__head--plain">
        <div>
          <div className="eco-page-kicker">Уведомления</div>
          <h2>Telegram сотрудника</h2>
          <p>Привязка нужна для задач, записей, кассы и системных уведомлений.</p>
        </div>
        <Send size={22} />
      </div>

      <div className="eco-employee-telegram-status">
        {loading ? (
          <span className="eco-muted-value">Проверяем привязку...</span>
        ) : connected ? (
          <>
            <EcoBadge tone="success" dot>
              Telegram connected
            </EcoBadge>
            <span>{status.externalUsername ? `@${status.externalUsername}` : status.displayName ?? "Telegram сотрудника"}</span>
            {status.linkedAt && <small>Привязан {formatDate(status.linkedAt)}</small>}
          </>
        ) : (
          <>
            <EcoBadge tone="neutral" dot>
              не привязан
            </EcoBadge>
            <span>Bot-привязка скрыта. Используется рабочий Telegram-аккаунт сервиса.</span>
          </>
        )}
      </div>

      <div className="eco-employee-telegram-actions">
        <Link href="/cabinet/integrations/messenger" className="eco-btn eco-btn--secondary">
          <Settings aria-hidden className="eco-icon" />
          Настроить рабочий Telegram
        </Link>
      </div>

      {error && (
        <div className="eco-client-telegram-error">
          <span>{error.message}</span>
          {error.settingsUrl && (
            <Link href={error.settingsUrl} className="eco-btn eco-btn--sm eco-btn--secondary">
              <Settings aria-hidden className="eco-icon" />
              Открыть настройки Telegram
            </Link>
          )}
        </div>
      )}

      <div className="eco-employee-telegram-notifications">
        <div className="eco-page-kicker">
          <BellRing aria-hidden size={14} />
          Будет получать
        </div>
        <div>
          {notificationTypes.map((item) => (
            <EcoBadge key={item} tone="info">
              {item}
            </EcoBadge>
          ))}
        </div>
      </div>
    </div>
  );
}
