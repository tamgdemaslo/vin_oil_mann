"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  LogOut,
  MessageSquareText,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { EcoBadge, EcoButton, EcoCard, EcoKpi, EcoStatusDot } from "@/components/platform/EcoUI";
import { formatServiceDateTime } from "@/lib/date-time";
import { safeReadJson } from "@/lib/http-json";
import type { EcoBadgeTone } from "@/components/platform/EcoUI";
import type {
  IntegrationChannelCard,
  MessengerAccount,
  MessengerAccountStatus,
  MessengerConnectionStatus,
} from "@/lib/messenger/messenger-types";

type AccountsPayload = {
  accounts?: MessengerAccount[];
  error?: string;
};

type ChannelsPayload = {
  channels?: IntegrationChannelCard[];
  error?: string;
};

type MediaHealthPayload = {
  storageConnected?: boolean;
  workerAlive?: boolean;
  workerHeartbeatAt?: string | null;
  pendingJobs?: number;
  processingJobs?: number;
  failedJobs?: number;
  oldestPendingAt?: string | null;
  lastCompletedAt?: string | null;
  storage?: {
    enabled?: boolean;
    configured?: boolean;
    bucket?: string | null;
    missing?: string[];
  };
  error?: string;
};

type StorageProbePayload = {
  ok?: boolean;
  configured?: boolean;
  checkedAt?: string;
  durationMs?: number;
  contentLength?: number;
  cleanupError?: string | null;
  error?: string;
};

type MediaBackfillPayload = {
  ok?: boolean;
  enqueued?: number;
  error?: string;
};

type ActionPayload = {
  ok?: boolean;
  account?: MessengerAccount;
  accountId?: string;
  accounts?: MessengerAccount[];
  codeDelivery?: {
    type?: string;
    label?: string;
    nextType?: string | null;
    timeout?: number | null;
    codeLength?: number | null;
  };
  connected?: boolean;
  needsPassword?: boolean;
  qrLoginUrl?: string;
  qrImageDataUrl?: string;
  expiresAt?: string;
  processed?: Array<{ ok?: boolean; accountId?: string; conversationCount?: number; messageCount?: number; error?: string }>;
  session?: { id?: string; status?: string; currentStep?: string; dataJson?: { message?: string; capabilities?: { summary?: string } } };
  status?: string;
  nextStep?: string;
  error?: string;
};

type ActionResult = {
  tone: EcoBadgeTone;
  title: string;
  message: string;
};

const channelOrder = ["telegram", "whatsapp", "vk", "avito", "max", "sms"] as const;
const plannedOrder = ["whatsapp", "vk", "avito", "max", "sms"] as const;

type CodeDeliveryState = NonNullable<ActionPayload["codeDelivery"]> | null;

type QrLoginState = {
  accountId: string;
  loginUrl: string;
  imageDataUrl: string;
  expiresAt: string | null;
} | null;

function statusTone(status?: MessengerAccountStatus | MessengerConnectionStatus): EcoBadgeTone {
  if (status === "connected") return "success";
  if (status === "waiting_code" || status === "waiting_password" || status === "waiting_qr" || status === "not_connected") return "warning";
  if (status === "error" || status === "needs_auth") return "danger";
  return "neutral";
}

function accountStatusLabel(status?: MessengerAccountStatus) {
  if (status === "connected") return "подключён";
  if (status === "waiting_code") return "код отправлен";
  if (status === "waiting_qr") return "ожидает QR";
  if (status === "waiting_password") return "требуется 2FA";
  if (status === "needs_auth") return "нужна повторная авторизация";
  if (status === "error") return "ошибка";
  if (status === "disconnected") return "отключён";
  return "не подключён";
}

function shortText(value?: string | null, fallback = "—") {
  const text = value?.trim();
  if (!text) return fallback;
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function actionError(response: Response, error?: string | null, fallback = "Команда не выполнена") {
  if (error?.trim()) return shortText(error);
  if (response.status === 401) return "Сессия истекла. Войдите в систему заново.";
  if (response.status === 403) return "Недостаточно прав для управления Telegram.";
  return `${fallback} (HTTP ${response.status}).`;
}

function StatusRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="eco-integration-status-rows">
      {rows.map(([label, value]) => (
        <div key={label} className="eco-integration-status-row">
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

export default function MessengerIntegrationsClient() {
  const [channels, setChannels] = useState<IntegrationChannelCard[]>([]);
  const [accounts, setAccounts] = useState<MessengerAccount[]>([]);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<
    "start" | "resend" | "code" | "password" | "qrStart" | "qrCheck" | "sync" | "disconnect" | "refresh" | "channel" | "storageProbe" | "backfill" | null
  >(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastCodeDelivery, setLastCodeDelivery] = useState<CodeDeliveryState>(null);
  const [qrLogin, setQrLogin] = useState<QrLoginState>(null);
  const [mediaHealth, setMediaHealth] = useState<MediaHealthPayload | null>(null);
  const [storageProbe, setStorageProbe] = useState<StorageProbePayload | null>(null);

  const activeAccount = useMemo(
    () =>
      accounts.find((account) => account.id === selectedAccountId) ??
      accounts.find((account) => account.status === "connected") ??
      accounts[0] ??
      null,
    [accounts, selectedAccountId]
  );
  const telegramChannel = channels.find((channel) => channel.key === "telegram") ?? null;
  const channelCards = channelOrder
    .map((key) => channels.find((channel) => channel.key === key))
    .filter((channel): channel is IntegrationChannelCard => Boolean(channel));
  const plannedChannels = plannedOrder
    .map((key) => channels.find((channel) => channel.key === key))
    .filter((channel): channel is IntegrationChannelCard => Boolean(channel));

  async function loadStatus(showResult = false) {
    setLoading(true);
    setAction(showResult ? "refresh" : null);
    try {
      const [channelsRes, accountsRes, mediaHealthRes] = await Promise.all([
        fetch("/api/integrations/messenger/channels", { cache: "no-store" }),
        fetch("/api/integrations/messenger/accounts", { cache: "no-store" }),
        fetch("/api/messenger/telegram/media-health", { cache: "no-store" }),
      ]);
      const channelsData = await safeReadJson<ChannelsPayload>(channelsRes);
      const accountsData = await safeReadJson<AccountsPayload>(accountsRes);
      const mediaHealthData = await safeReadJson<MediaHealthPayload>(mediaHealthRes);
      if (!channelsRes.ok) throw new Error(actionError(channelsRes, channelsData?.error, "Не удалось получить каналы"));
      if (!accountsRes.ok) throw new Error(actionError(accountsRes, accountsData?.error, "Не удалось получить аккаунты"));
      const nextAccounts = accountsData?.accounts ?? [];
      setChannels(channelsData?.channels ?? []);
      setAccounts(nextAccounts);
      setMediaHealth(mediaHealthRes.ok ? mediaHealthData ?? null : null);
      setSelectedAccountId((current) => (current && nextAccounts.some((account) => account.id === current) ? current : nextAccounts[0]?.id ?? null));
      setLastCheckedAt(new Date().toISOString());
      if (showResult) {
        setResult({ tone: "success", title: "Проверка", message: "Статус Telegram обновлён." });
      }
    } catch (error) {
      setResult({
        tone: "danger",
        title: "Telegram",
        message: error instanceof Error ? error.message : "Не удалось обновить статус Telegram.",
      });
    } finally {
      setLoading(false);
      setAction(null);
    }
  }

  async function reloadMediaHealth() {
    const response = await fetch("/api/messenger/telegram/media-health", { cache: "no-store" });
    const data = await safeReadJson<MediaHealthPayload>(response);
    setMediaHealth(response.ok ? data ?? null : null);
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    if (!qrLogin || activeAccount?.status === "connected") return;
    const timer = window.setInterval(() => {
      void checkQrLogin(false);
    }, 4000);
    return () => window.clearInterval(timer);
    // checkQrLogin intentionally reads the latest selected account; this interval is scoped by the QR account id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrLogin?.accountId, activeAccount?.status]);

  async function postAction(endpoint: string, body: Record<string, unknown>, nextAction: typeof action, fallback: string) {
    setAction(nextAction);
    setResult(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await safeReadJson<ActionPayload>(response);
      if (!response.ok || data?.ok === false) {
        throw new Error(actionError(response, data?.error, fallback));
      }
      return data ?? {};
    } catch (error) {
      setResult({ tone: "danger", title: "Telegram", message: error instanceof Error ? error.message : fallback });
      return null;
    } finally {
      setAction(null);
    }
  }

  async function probeStorage() {
    setAction("storageProbe");
    setResult(null);
    try {
      const response = await fetch("/api/messenger/storage/probe", { method: "POST" });
      const data = await safeReadJson<StorageProbePayload>(response);
      setStorageProbe(data ?? null);
      if (!response.ok || !data?.ok) {
        throw new Error(actionError(response, data?.error, "Storage probe не прошёл"));
      }
      setResult({
        tone: data.cleanupError ? "warning" : "success",
        title: "Storage",
        message: data.cleanupError
          ? `PUT/GET прошли, но cleanup вернул ошибку: ${shortText(data.cleanupError)}`
          : `PUT/GET/DELETE прошли за ${data.durationMs ?? 0} мс.`,
      });
      await reloadMediaHealth();
    } catch (error) {
      setResult({
        tone: "danger",
        title: "Storage",
        message: error instanceof Error ? error.message : "Storage probe не прошёл.",
      });
    } finally {
      setAction(null);
    }
  }

  async function runMediaBackfill() {
    setAction("backfill");
    setResult(null);
    try {
      const response = await fetch("/api/messenger/media/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 50 }),
      });
      const data = await safeReadJson<MediaBackfillPayload>(response);
      if (!response.ok || !data?.ok) {
        throw new Error(actionError(response, data?.error, "Backfill не запущен"));
      }
      setResult({
        tone: "success",
        title: "Backfill",
        message: `Поставлено в очередь: ${data.enqueued ?? 0}.`,
      });
      await reloadMediaHealth();
    } catch (error) {
      setResult({
        tone: "danger",
        title: "Backfill",
        message: error instanceof Error ? error.message : "Backfill не запущен.",
      });
    } finally {
      setAction(null);
    }
  }

  async function startChannelOnboarding(channelKey: string) {
    if (channelKey === "telegram") {
      setResult({ tone: "info", title: "Telegram", message: "Telegram подключается ниже через рабочий аккаунт: номер, код, 2FA или QR владельца." });
      return;
    }
    const data = await postAction(
      `/api/integrations/messenger/${channelKey}/onboarding/start`,
      {},
      "channel",
      "Не удалось открыть мастер подключения канала."
    );
    if (!data) return;
    const message =
      data.session?.dataJson?.message ||
      data.session?.dataJson?.capabilities?.summary ||
      "Канал пока находится в capability audit. Подключение будет включено после утверждения официального сценария.";
    setResult({
      tone: "warning",
      title: `${channelKey.toUpperCase()} · ${data.status ?? "planned"}`,
      message,
    });
  }

  async function startAuth() {
    if (!phone.trim()) {
      setResult({ tone: "warning", title: "Номер телефона", message: "Введите рабочий Telegram-номер сервиса." });
      return;
    }
    const data = await postAction(
      "/api/messenger/telegram-user/start-auth",
      { phone },
      "start",
      "Не удалось отправить код Telegram."
    );
    if (!data) return;
    const accountId = data.account?.id ?? data.accountId;
    setSelectedAccountId(accountId ?? null);
    setLastCodeDelivery(data.codeDelivery ?? null);
    setQrLogin(null);
    const timeoutText = data.codeDelivery?.timeout ? ` Повторный запрос обычно доступен через ${data.codeDelivery.timeout} сек.` : "";
    const fallbackText = data.codeDelivery?.nextType ? "" : " Telegram не предоставил альтернативный способ доставки.";
    setResult({
      tone: "success",
      title: "Код отправлен",
      message: `${data.codeDelivery?.label ?? "Введите код из приложения Telegram."}${timeoutText}${fallbackText}`,
    });
    await loadStatus();
  }

  async function confirmCode() {
    const accountId = activeAccount?.id;
    if (!accountId) {
      setResult({ tone: "warning", title: "Telegram", message: "Сначала запросите код для рабочего номера." });
      return;
    }
    const data = await postAction(
      "/api/messenger/telegram-user/confirm-code",
      { accountId, code },
      "code",
      "Код Telegram не принят."
    );
    if (!data) return;
    setCode("");
    setQrLogin(null);
    setResult({
      tone: data.needsPassword ? "warning" : "success",
      title: data.needsPassword ? "Требуется 2FA" : "Telegram подключён",
      message: data.needsPassword ? "Введите пароль двухфакторной авторизации Telegram." : "Рабочий Telegram-аккаунт подключён.",
    });
    await loadStatus();
  }

  async function resendCode() {
    const accountId = activeAccount?.id;
    if (!accountId) {
      setResult({ tone: "warning", title: "Telegram", message: "Сначала запросите код для рабочего номера." });
      return;
    }
    const data = await postAction(
      "/api/messenger/telegram-user/resend-code",
      { accountId },
      "resend",
      "Не удалось повторно запросить код Telegram."
    );
    if (!data) return;
    setLastCodeDelivery(data.codeDelivery ?? null);
    const timeoutText = data.codeDelivery?.timeout ? ` Повторный запрос обычно доступен через ${data.codeDelivery.timeout} сек.` : "";
    setResult({
      tone: "success",
      title: "Код запрошен повторно",
      message: `${data.codeDelivery?.label ?? "Введите новый код из приложения Telegram."}${timeoutText}`,
    });
    await loadStatus();
  }

  async function confirmPassword() {
    const accountId = activeAccount?.id;
    if (!accountId) return;
    const data = await postAction(
      "/api/messenger/telegram-user/confirm-password",
      { accountId, password },
      "password",
      "Пароль 2FA Telegram не принят."
    );
    if (!data) return;
    setPassword("");
    setQrLogin(null);
    setResult({ tone: "success", title: "Telegram подключён", message: "Session сохранена на backend в зашифрованном виде." });
    await loadStatus();
  }

  async function startQrLogin() {
    const data = await postAction(
      "/api/messenger/telegram-user/start-qr",
      { phone },
      "qrStart",
      "Не удалось создать QR для Telegram."
    );
    if (!data) return;
    if (data.connected && data.account) {
      setSelectedAccountId(data.account.id);
      setQrLogin(null);
      setResult({ tone: "success", title: "Telegram подключён", message: "Рабочий аккаунт подключён через QR." });
      await loadStatus();
      return;
    }
    const accountId = data.accountId;
    if (!accountId || !data.qrLoginUrl || !data.qrImageDataUrl) {
      setResult({ tone: "danger", title: "QR Telegram", message: "Backend не вернул QR-код. Попробуйте создать QR заново." });
      return;
    }
    setSelectedAccountId(accountId);
    setQrLogin({
      accountId,
      loginUrl: data.qrLoginUrl,
      imageDataUrl: data.qrImageDataUrl,
      expiresAt: data.expiresAt ?? null,
    });
    setResult({
      tone: "warning",
      title: "QR готов",
      message: "Откройте рабочий Telegram: Настройки → Устройства → Подключить устройство, затем отсканируйте QR.",
    });
    await loadStatus();
  }

  async function checkQrLogin(showWaiting = true) {
    const accountId = qrLogin?.accountId ?? activeAccount?.id;
    if (!accountId) return;
    const data = await postAction(
      "/api/messenger/telegram-user/check-qr",
      { accountId },
      "qrCheck",
      "QR Telegram пока не подтверждён."
    );
    if (!data) return;
    if (data.needsPassword) {
      setQrLogin(null);
      setSelectedAccountId(accountId);
      setResult({ tone: "warning", title: "Требуется 2FA", message: "QR принят. Введите пароль двухфакторной авторизации Telegram." });
      await loadStatus();
      return;
    }
    if (data.connected && data.account) {
      setQrLogin(null);
      setSelectedAccountId(data.account.id);
      setResult({ tone: "success", title: "Telegram подключён", message: "Рабочий аккаунт подключён через QR." });
      await loadStatus();
      return;
    }
    if (data.qrLoginUrl && data.qrImageDataUrl) {
      setQrLogin({
        accountId,
        loginUrl: data.qrLoginUrl,
        imageDataUrl: data.qrImageDataUrl,
        expiresAt: data.expiresAt ?? null,
      });
    }
    if (showWaiting) {
      setResult({ tone: "warning", title: "QR ожидает сканирования", message: "Если QR истёк, он обновится автоматически. Сканирует владелец рабочего аккаунта." });
    }
  }

  async function syncAccount() {
    const accountId = activeAccount?.id;
    const data = await postAction(
      "/api/messenger/telegram-user/sync",
      { accountId, limit: 200 },
      "sync",
      "Не удалось синхронизировать Telegram."
    );
    if (!data) return;
    const summary = data.processed?.find((item) => !accountId || item.accountId === accountId) ?? data.processed?.[0];
    setResult({
      tone: summary?.ok === false ? "warning" : "success",
      title: "Синхронизация",
      message: summary?.ok === false
        ? shortText(summary.error, "Синхронизация завершилась с ошибкой.")
        : `Диалоги: ${summary?.conversationCount ?? 0}, сообщения: ${summary?.messageCount ?? 0}.`,
    });
    await loadStatus();
  }

  async function disconnectAccount() {
    const accountId = activeAccount?.id;
    if (!accountId) return;
    const data = await postAction(
      "/api/messenger/telegram-user/disconnect",
      { accountId },
      "disconnect",
      "Не удалось отключить Telegram."
    );
    if (!data) return;
    setQrLogin(null);
    setResult({ tone: "success", title: "Telegram отключён", message: "Session очищена, аккаунт деактивирован." });
    await loadStatus();
  }

  const isAppCodeDelivery = lastCodeDelivery?.type?.toLowerCase().includes("sentcodetypeapp");
  const canResendCode = Boolean(lastCodeDelivery?.nextType);

  const rows: Array<[string, string]> = [
    ["Режим", "рабочий Telegram-аккаунт"],
    ["Статус", accountStatusLabel(activeAccount?.status)],
    ["Номер", activeAccount?.phone ?? "—"],
    ["Username", activeAccount?.username ? `@${activeAccount.username.replace(/^@/, "")}` : "—"],
    ["Название", activeAccount?.displayName ?? "—"],
    ["Диалогов", String(activeAccount?.conversationCount ?? 0)],
    ["Последняя синхронизация", activeAccount?.lastSyncAt ? formatServiceDateTime(activeAccount.lastSyncAt) : "—"],
    ["Последняя ошибка", shortText(activeAccount?.errorMessage)],
    ["Последняя проверка", lastCheckedAt ? formatServiceDateTime(lastCheckedAt) : "—"],
  ];
  const mediaRows: Array<[string, string]> = [
    ["Storage", mediaHealth?.storageConnected ? "подключён" : "не настроен"],
    ["Bucket", mediaHealth?.storage?.bucket ?? "—"],
    ["Worker", mediaHealth?.workerAlive ? "активен" : "нет свежей активности"],
    ["В очереди", String(mediaHealth?.pendingJobs ?? 0)],
    ["Обрабатываются", String(mediaHealth?.processingJobs ?? 0)],
    ["Ошибки вложений", String(mediaHealth?.failedJobs ?? 0)],
    ["Проверка storage", storageProbe?.checkedAt ? (storageProbe.ok ? `ok, ${storageProbe.durationMs ?? 0} мс` : shortText(storageProbe.error, "ошибка")) : "—"],
    ["Последняя загрузка", mediaHealth?.lastCompletedAt ? formatServiceDateTime(mediaHealth.lastCompletedAt) : "—"],
  ];
  const mediaHasQueue = (mediaHealth?.pendingJobs ?? 0) > 0 || (mediaHealth?.processingJobs ?? 0) > 0;
  const mediaHasRecentSuccess = Boolean(mediaHealth?.lastCompletedAt);
  const mediaProblem =
    activeAccount?.status === "connected" &&
    mediaHealth &&
    (!mediaHealth.storageConnected || (mediaHasQueue && !mediaHealth.workerAlive && !mediaHasRecentSuccess));
  const mediaWarning =
    activeAccount?.status === "connected" && mediaHealth && !mediaProblem && (mediaHasQueue || (mediaHealth.failedJobs ?? 0) > 0);

  return (
    <main className="eco-page eco-messenger-integrations-page">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <Link href="/cabinet">Кабинет</Link>
            <span className="sep">/</span>
            <Link href="/cabinet/integrations">Интеграции</Link>
            <span className="sep">/</span>
            <span className="cur">Мессенджеры</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Мессенджеры</h1>
            <EcoBadge tone={statusTone(activeAccount?.status ?? telegramChannel?.connectionStatus)} dot>
              {accountStatusLabel(activeAccount?.status)}
            </EcoBadge>
          </div>
          <p className="eco-page-subtitle">
            Единый Messenger Gateway: Telegram уже работает через рабочий аккаунт, остальные каналы подключим после capability audit.
          </p>
        </div>
        <div className="eco-page-actions">
          <EcoButton type="button" variant="secondary" onClick={() => void loadStatus(true)} disabled={loading || action !== null}>
            <RefreshCw size={16} />
            {action === "refresh" || loading ? "Проверяем..." : "Проверить статус"}
          </EcoButton>
          <Link href="/messages" className="eco-btn eco-btn--ghost">
            <MessageSquareText size={16} />
            Сообщения
          </Link>
        </div>
      </section>

      <div className="eco-grid eco-grid--kpi">
        <EcoKpi label="Telegram" value={accountStatusLabel(activeAccount?.status)} tone={statusTone(activeAccount?.status)} sub="User Session / MTProto." />
        <EcoKpi label="Диалоги" value={String(activeAccount?.conversationCount ?? 0)} tone="info" sub="Подтягиваются из рабочего аккаунта." />
        <EcoKpi label="Клиент" value="ничего не делает" tone="success" sub="QR сканирует только владелец, клиентам ничего не нужно." />
      </div>

      {result && (
        <EcoCard>
          <div className="eco-card__head">
            <div>
              <div className="eco-page-kicker">{result.title}</div>
              <h2 className="eco-stock-doc-title">{result.message}</h2>
            </div>
            <EcoBadge tone={result.tone} dot>
              статус
            </EcoBadge>
          </div>
        </EcoCard>
      )}

      <section className="eco-integration-channel-grid" aria-label="Каналы Messenger Gateway">
        {channelCards.map((channel) => {
          const isTelegram = channel.key === "telegram";
          const connected = channel.healthStatus === "connected";
          return (
            <EcoCard key={channel.key} className="eco-integration-channel-card">
              <div className="eco-integration-channel-card__head">
                <span className="eco-integration-channel-card__mark" style={{ backgroundColor: channel.color }} />
                <div>
                  <strong>{channel.label}</strong>
                  <small>{channel.allowedMode ?? "Официальный adapter"}</small>
                </div>
                <EcoBadge tone={connected ? "success" : isTelegram ? "warning" : "neutral"} dot={connected || isTelegram}>
                  {connected ? "connected" : isTelegram ? accountStatusLabel(activeAccount?.status) : "planned"}
                </EcoBadge>
              </div>
              <p>{channel.capabilitySummary ?? "Канал ожидает утверждения сценария подключения."}</p>
              <div className="eco-integration-channel-card__meta">
                <span>{channel.capabilityStatus ?? (isTelegram ? "Supported" : "Requires approval")}</span>
                <span>{isTelegram ? `${activeAccount?.conversationCount ?? 0} диалогов` : "audit required"}</span>
              </div>
              <EcoButton
                type="button"
                variant={isTelegram ? "secondary" : "ghost"}
                onClick={() => void startChannelOnboarding(channel.key)}
                disabled={action !== null}
              >
                {isTelegram ? "Настроить Telegram" : "Подключить"}
              </EcoButton>
            </EcoCard>
          );
        })}
      </section>

      <section className="eco-messenger-integrations-layout">
        <EcoCard className="eco-messenger-telegram-card">
          <div className="eco-card__head">
            <div>
              <div className="eco-page-kicker">Real adapter</div>
              <h2 className="eco-stock-doc-title">Рабочий Telegram-аккаунт</h2>
            </div>
            <EcoBadge tone={statusTone(activeAccount?.status ?? telegramChannel?.connectionStatus)} dot>
              {accountStatusLabel(activeAccount?.status)}
            </EcoBadge>
          </div>

          <div className="eco-integration-hero">
            <span className="eco-integration-hero__icon" aria-hidden="true">
              <Send size={24} />
            </span>
            <div>
              <strong>{activeAccount?.displayName || activeAccount?.phone || "Telegram не подключён"}</strong>
              <span>Основной режим: Telegram User Session. Bot API и клиентские QR-ссылки не используются.</span>
            </div>
          </div>

          <StatusRows rows={rows} />

          <div className="eco-telegram-settings-form">
            <label>
              <span>Номер рабочего Telegram</span>
              <input
                className="eco-input"
                value={phone}
                placeholder="+79990000000"
                autoComplete="tel"
                onChange={(event) => setPhone(event.target.value)}
              />
            </label>
            <div className="eco-check-row eco-telegram-mode-lock">
              <Smartphone size={16} />
              <span>User Session / MTProto</span>
            </div>
            <EcoButton type="button" variant="primary" onClick={() => void startAuth()} disabled={action !== null || loading}>
              <ShieldCheck size={16} />
              {action === "start" ? "Отправляем код..." : "Получить код"}
            </EcoButton>
            <EcoButton type="button" variant="secondary" onClick={() => void startQrLogin()} disabled={action !== null || loading}>
              <QrCode size={16} />
              {action === "qrStart" ? "Готовим QR..." : "Подключить по QR"}
            </EcoButton>
          </div>

          {qrLogin && (
            <div className="eco-telegram-qr-panel">
              <div className="eco-telegram-qr-panel__image">
                <Image src={qrLogin.imageDataUrl} alt="QR для подключения рабочего Telegram" width={160} height={160} unoptimized />
              </div>
              <div className="eco-telegram-qr-panel__body">
                <div className="eco-page-kicker">QR владельца</div>
                <h3>Подключите рабочий Telegram как новое устройство</h3>
                <p>Откройте Telegram на рабочем телефоне: Настройки → Устройства → Подключить устройство. Отсканируйте этот QR один раз.</p>
                <p>Клиенты ничего не сканируют и не запускают бота. После подключения переписки пойдут из обычного рабочего аккаунта.</p>
                <div className="eco-telegram-qr-panel__actions">
                  <EcoButton type="button" variant="primary" onClick={() => void checkQrLogin()} disabled={action !== null}>
                    <CheckCircle2 size={16} />
                    {action === "qrCheck" ? "Проверяем..." : "Я отсканировал QR"}
                  </EcoButton>
                  <EcoButton type="button" variant="ghost" onClick={() => void startQrLogin()} disabled={action !== null}>
                    <RefreshCw size={16} />
                    Обновить QR
                  </EcoButton>
                </div>
                {qrLogin.expiresAt && <small>QR действителен до {formatServiceDateTime(qrLogin.expiresAt)} и обновляется при проверке.</small>}
              </div>
            </div>
          )}

          {(activeAccount?.status === "waiting_code" || activeAccount?.status === "waiting_password") && (
            <div className="eco-telegram-settings-form">
              {activeAccount.status === "waiting_code" && (
                <div className="eco-integration-note eco-integration-note--info">
                  <ShieldCheck size={16} />
                  <span>
                    {isAppCodeDelivery
                      ? "Telegram отправил код в служебный чат Telegram на устройствах, где рабочий аккаунт уже авторизован. Проверьте мобильное приложение, Telegram Desktop, архив и поиск по чату Telegram."
                      : lastCodeDelivery?.label ?? "Введите код из приложения Telegram."}
                    {lastCodeDelivery?.codeLength ? ` Длина кода: ${lastCodeDelivery.codeLength}.` : ""}
                    {!canResendCode ? " Telegram не предоставил альтернативный способ доставки." : ""}
                  </span>
                </div>
              )}
              <label>
                <span>Код Telegram</span>
                <input
                  className="eco-input"
                  value={code}
                  placeholder="Код из чата Telegram"
                  autoComplete="one-time-code"
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <EcoButton type="button" variant="secondary" onClick={() => void confirmCode()} disabled={action !== null || !activeAccount}>
                <CheckCircle2 size={16} />
                {action === "code" ? "Проверяем..." : "Подтвердить код"}
              </EcoButton>
              {activeAccount.status === "waiting_code" && canResendCode && (
                <EcoButton type="button" variant="ghost" onClick={() => void resendCode()} disabled={action !== null || !activeAccount}>
                  <RefreshCw size={16} />
                  {action === "resend" ? "Запрашиваем..." : "Запросить код ещё раз"}
                </EcoButton>
              )}
              {activeAccount.status === "waiting_code" && !canResendCode && (
                <EcoButton type="button" variant="ghost" onClick={() => void startQrLogin()} disabled={action !== null}>
                  <QrCode size={16} />
                  Подключить по QR
                </EcoButton>
              )}
              {activeAccount.status === "waiting_password" && (
                <>
                  <label>
                    <span>Пароль 2FA Telegram</span>
                    <input
                      className="eco-input"
                      type="password"
                      value={password}
                      placeholder="Пароль Telegram"
                      autoComplete="off"
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <EcoButton type="button" variant="primary" onClick={() => void confirmPassword()} disabled={action !== null || !activeAccount}>
                    <ShieldCheck size={16} />
                    {action === "password" ? "Подключаем..." : "Подключить"}
                  </EcoButton>
                </>
              )}
            </div>
          )}

          <div className="eco-messenger-settings-actions">
            <EcoButton
              type="button"
              variant="primary"
              onClick={() => void syncAccount()}
              disabled={action !== null || loading || activeAccount?.status !== "connected"}
            >
              <RefreshCw size={16} />
              {action === "sync" ? "Синхронизируем..." : "Проверить синхронизацию"}
            </EcoButton>
            <EcoButton
              type="button"
              variant="secondary"
              onClick={() => void disconnectAccount()}
              disabled={action !== null || loading || !activeAccount}
            >
              <LogOut size={16} />
              {action === "disconnect" ? "Отключаем..." : "Отключить аккаунт"}
            </EcoButton>
          </div>

          {!activeAccount && (
            <div className="eco-integration-note eco-integration-note--warning">
              <AlertTriangle size={16} />
              <span>Telegram не подключён. Введите рабочий номер и получите код авторизации либо подключите аккаунт по QR.</span>
            </div>
          )}
          {activeAccount?.status === "needs_auth" && (
            <div className="eco-integration-note eco-integration-note--danger">
              <AlertTriangle size={16} />
              <span>Session потеряна или Telegram требует повторную авторизацию. Подключите номер заново.</span>
            </div>
          )}
          {mediaProblem && (
            <div className="eco-integration-note eco-integration-note--danger">
              <AlertTriangle size={16} />
              <span>Telegram подключён, но загрузка вложений не работает. Проверьте storage и media worker ниже.</span>
            </div>
          )}
          {mediaWarning && (
            <div className="eco-integration-note eco-integration-note--warning">
              <AlertTriangle size={16} />
              <span>Загрузка вложений работает, но ещё есть старый хвост в очереди или ошибках. Backfill можно запускать повторно.</span>
            </div>
          )}
        </EcoCard>

        <EcoCard>
          <div className="eco-card__head--plain">
            <div>
              <div className="eco-page-kicker">Без действий клиента</div>
              <h2>Как это работает</h2>
              <p>Клиент продолжает писать в обычный рабочий Telegram. Gateway синхронизирует диалог и отправляет ответы из Эко-платформы от имени этого аккаунта.</p>
            </div>
            <MessageSquareText size={22} />
          </div>
          <div className="eco-integration-note eco-integration-note--info">
            <ShieldCheck size={16} />
            <span>Код авторизации, 2FA-пароль, api_hash и session не отдаются во frontend и не должны логироваться.</span>
          </div>
          <div className="eco-integration-note eco-integration-note--success">
            <QrCode size={16} />
            <span>QR в этой настройке сканирует владелец рабочего аккаунта как “подключить устройство”. Это не QR для клиента и не bot-only сценарий.</span>
          </div>
        </EcoCard>

        <EcoCard>
          <div className="eco-card__head--plain">
            <div>
              <div className="eco-page-kicker">Telegram media</div>
              <h2>Фото и файлы</h2>
              <p>Вложения проходят через очередь, скачиваются из Telegram и сохраняются в persistent object storage.</p>
            </div>
            <EcoBadge tone={mediaProblem ? "danger" : mediaWarning ? "warning" : mediaHealth?.storageConnected ? "success" : "warning"} dot>
              {mediaProblem ? "нужна проверка" : mediaWarning ? "есть хвост" : mediaHealth?.storageConnected ? "storage ok" : "storage не настроен"}
            </EcoBadge>
          </div>
          <StatusRows rows={mediaRows} />
          {mediaHealth?.storage?.missing?.length ? (
            <div className="eco-integration-note eco-integration-note--warning">
              <AlertTriangle size={16} />
              <span>Не заданы env: {mediaHealth.storage.missing.join(", ")}</span>
            </div>
          ) : null}
          <div className="eco-messenger-settings-actions">
            <EcoButton type="button" variant="secondary" onClick={() => void probeStorage()} disabled={action !== null || loading}>
              <CheckCircle2 size={16} />
              {action === "storageProbe" ? "Проверяем..." : "Проверить storage"}
            </EcoButton>
            <EcoButton type="button" variant="ghost" onClick={() => void runMediaBackfill()} disabled={action !== null || loading}>
              <RefreshCw size={16} />
              {action === "backfill" ? "Ставим в очередь..." : "Запустить backfill"}
            </EcoButton>
          </div>
        </EcoCard>

        <EcoCard>
          <div className="eco-card__head--plain">
            <div>
              <div className="eco-page-kicker">Capability audit</div>
              <h2>Будущие каналы</h2>
              <p>Подключение откроется только после утверждения официального сценария и ограничений.</p>
            </div>
            <Clock3 size={22} />
          </div>

          <div className="eco-integration-channel-list">
            {plannedChannels.map((channel) => (
              <div key={channel.key} className="eco-integration-channel">
                <span className="eco-integration-channel__mark" style={{ backgroundColor: channel.color }} />
                <span>
                  <strong>{channel.label}</strong>
                  <small>{channel.capabilitySummary ?? "будет подключено позже"}</small>
                </span>
                <EcoBadge tone="neutral">{channel.capabilityStatus ?? "planned"}</EcoBadge>
              </div>
            ))}
          </div>
        </EcoCard>

        <EcoCard>
          <div className="eco-card__head--plain">
            <div>
              <div className="eco-page-kicker">Gateway API</div>
              <h2>Новые endpoint</h2>
              <p>Frontend работает с внутренней моделью Conversation / Message.</p>
            </div>
            <EcoStatusDot tone="success" />
          </div>
          <div className="eco-action-list eco-messenger-endpoints">
            {[
              "GET /api/integrations/messenger/channels",
              "GET /api/integrations/messenger/accounts",
              "POST /api/integrations/messenger/:channel/onboarding/start",
              "GET /api/integrations/messenger/onboarding/:sessionId",
              "POST /api/integrations/messenger/accounts/:id/test",
              "POST /api/integrations/messenger/accounts/:id/disconnect",
              "GET /api/integrations/messenger/accounts/:id/health",
              "POST /api/messenger/telegram-user/start-auth",
              "POST /api/messenger/telegram-user/start-qr",
              "POST /api/messenger/telegram-user/check-qr",
              "POST /api/messenger/telegram-user/confirm-code",
              "POST /api/messenger/telegram-user/confirm-password",
              "POST /api/messenger/telegram-user/sync",
              "POST /api/messenger/conversations/:id/messages",
            ].map((endpoint) => (
              <div key={endpoint} className="eco-action-link" aria-disabled="true">
                <span className="eco-action-icon">
                  <EcoStatusDot tone="neutral" />
                </span>
                <span>
                  <strong>{endpoint}</strong>
                  <small>{endpoint.includes("/integrations/") ? "integrations gateway" : "telegram user session gateway"}</small>
                </span>
              </div>
            ))}
          </div>
        </EcoCard>
      </section>
    </main>
  );
}
