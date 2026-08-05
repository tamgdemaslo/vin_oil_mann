"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { BellRing, Link2, RefreshCw, Send, Unlink } from "lucide-react";
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

type TelegramLink = {
  linkUrl: string;
  qrDataUrl: string;
  expiresAt: string;
};

type TelegramError = {
  message: string;
  hint?: string;
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
  "дела клиентов",
  "напоминания по записям",
  "кассовые события",
  "системные уведомления",
];

export default function EmployeeTelegramCard() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"link" | "disconnect" | null>(null);
  const [error, setError] = useState<TelegramError | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/cabinet/telegram-link", { cache: "no-store" });
      const data = await readJson<{ telegram?: TelegramStatus; error?: string; hint?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить личный Telegram");
      setStatus(data?.telegram ?? { connected: false });
      if (data?.telegram?.connected) setLink(null);
    } catch (caught) {
      setError({ message: caught instanceof Error ? caught.message : "Не удалось загрузить личный Telegram" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function createPersonalLink() {
    setAction("link");
    setError(null);
    try {
      const res = await fetch("/api/cabinet/telegram-link", { method: "POST" });
      const data = await readJson<{ link?: TelegramLink; error?: string; hint?: string }>(res);
      if (!res.ok || !data?.link) {
        setError({
          message: data?.error ?? "Не удалось создать личную ссылку Telegram",
          hint: data?.hint,
        });
        return;
      }
      setLink(data.link);
    } catch (caught) {
      setError({ message: caught instanceof Error ? caught.message : "Не удалось создать личную ссылку Telegram" });
    } finally {
      setAction(null);
    }
  }

  async function disconnectPersonalTelegram() {
    setAction("disconnect");
    setError(null);
    try {
      const res = await fetch("/api/cabinet/telegram-link", { method: "DELETE" });
      const data = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось отключить личный Telegram");
      setStatus({ connected: false });
      setLink(null);
    } catch (caught) {
      setError({ message: caught instanceof Error ? caught.message : "Не удалось отключить личный Telegram" });
    } finally {
      setAction(null);
    }
  }

  const connected = status?.connected;

  return (
    <section className="eco-card eco-card--padded eco-employee-telegram-card" aria-labelledby="personal-telegram-title">
      <div className="eco-card__head--plain">
        <div>
          <div className="eco-page-kicker">Персональные уведомления</div>
          <h2 id="personal-telegram-title">Мой Telegram</h2>
          <p>Связан только с вашей учётной записью сотрудника и не изменяет рабочий Telegram филиала.</p>
        </div>
        <Send aria-hidden size={22} />
      </div>

      <div className="eco-employee-telegram-status">
        {loading ? (
          <span className="eco-muted-value">Проверяем личную привязку…</span>
        ) : connected ? (
          <>
            <EcoBadge tone="success" dot>подключён</EcoBadge>
            <span>{status.externalUsername ? `@${status.externalUsername}` : status.displayName ?? "Личный Telegram"}</span>
            {status.linkedAt && <small>Привязан {formatDate(status.linkedAt)}</small>}
          </>
        ) : (
          <>
            <EcoBadge tone="neutral" dot>не подключён</EcoBadge>
            <span>Создайте одноразовую персональную ссылку и подтвердите её в Telegram.</span>
          </>
        )}
      </div>

      {!connected && link && (
        <div className="eco-personal-telegram-link" role="status">
          <Image src={link.qrDataUrl} width={180} height={180} unoptimized alt="QR-код для подключения личного Telegram" />
          <div>
            <strong>Ссылка действует до {formatDate(link.expiresAt)}</strong>
            <p>Откройте ссылку на телефоне или отсканируйте QR-код. После подтверждения обновите статус.</p>
            <a href={link.linkUrl} target="_blank" rel="noreferrer" className="eco-btn eco-btn--primary">
              <Link2 aria-hidden className="eco-icon" />
              Открыть мой Telegram
            </a>
          </div>
        </div>
      )}

      <div className="eco-employee-telegram-actions">
        {connected ? (
          <button type="button" className="eco-btn eco-btn--secondary" onClick={() => void disconnectPersonalTelegram()} disabled={action !== null}>
            <Unlink aria-hidden className="eco-icon" />
            {action === "disconnect" ? "Отключаем…" : "Отключить мой Telegram"}
          </button>
        ) : (
          <button type="button" className="eco-btn eco-btn--primary" onClick={() => void createPersonalLink()} disabled={action !== null}>
            <Send aria-hidden className="eco-icon" />
            {action === "link" ? "Создаём ссылку…" : link ? "Создать новую ссылку" : "Настроить мой Telegram"}
          </button>
        )}
        <button type="button" className="eco-btn eco-btn--quiet" onClick={() => void loadStatus()} disabled={loading || action !== null}>
          <RefreshCw aria-hidden className="eco-icon" />
          Обновить статус
        </button>
      </div>

      {error && (
        <div className="eco-client-telegram-error" role="alert">
          <strong>{error.message}</strong>
          {error.hint && <span>{error.hint}</span>}
        </div>
      )}

      <div className="eco-employee-telegram-notifications">
        <div className="eco-page-kicker">
          <BellRing aria-hidden size={14} />
          Персонально получаете
        </div>
        <div>
          {notificationTypes.map((notification) => (
            <EcoBadge key={notification} tone="info">{notification}</EcoBadge>
          ))}
        </div>
      </div>
    </section>
  );
}
