"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, Database, MessageSquareText, RefreshCw, ShieldCheck } from "lucide-react";
import { EcoBadge, EcoButton, EcoCard, EcoKpi, EcoStatusDot } from "@/components/platform/EcoUI";
import { formatServiceDateTime } from "@/lib/date-time";
import { safeReadJson } from "@/lib/http-json";

type InventoryStatus = {
  isRunning?: boolean;
  mode?: string | null;
  phase?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  productsSynced?: number;
  servicesSynced?: number;
  counterpartiesSynced?: number;
  storesSynced?: number;
  stockRowsSynced?: number;
  demandsSynced?: number;
  message?: string | null;
  error?: string | null;
};

type AnalyticsStatus = {
  isRunning?: boolean;
  mode?: string | null;
  phase?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  totalDemands?: number | null;
  processedDemands?: number;
  scannedDemands?: number;
  demandsSynced?: number;
  lastDemandName?: string | null;
  message?: string | null;
  error?: string | null;
};

type StatusPayload = {
  inventory: InventoryStatus | null;
  analytics: AnalyticsStatus | null;
  inventoryError: string | null;
  analyticsError: string | null;
};

type RunResult = {
  title: string;
  message: string;
  tone: "success" | "warning" | "danger" | "info";
};

const TECHNICAL_ERROR_RE = /prisma|p\d{4}|stack|trace|econn|timeout|failed to connect|can't reach|database server|fetch failed|api\/|http/i;

function safeMessage(value: unknown, fallback = "Нет данных") {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  if (TECHNICAL_ERROR_RE.test(text)) return "Техническая ошибка. Проверьте локальную БД и конфигурацию интеграции.";
  return text.length > 260 ? `${text.slice(0, 257)}...` : text;
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  return formatServiceDateTime(value);
}

function phaseLabel(value?: string | null) {
  if (!value || value === "idle") return "ожидание";
  if (value === "done") return "готово";
  if (value === "error") return "ошибка";
  if (value === "products") return "товары";
  if (value === "stores") return "склады";
  if (value === "counterparties") return "клиенты";
  if (value === "stock") return "остатки";
  if (value === "demands") return "отгрузки";
  if (value === "fetching") return "загрузка";
  if (value === "persisting") return "сохранение";
  return value;
}

function toneForStatus(status?: { isRunning?: boolean; phase?: string | null; error?: string | null } | null) {
  if (!status) return "neutral" as const;
  if (status.isRunning) return "info" as const;
  if (status.error || status.phase === "error") return "warning" as const;
  if (status.phase === "done") return "success" as const;
  return "neutral" as const;
}

function numberValue(value?: number | null) {
  return Number.isFinite(value ?? NaN) ? String(value) : "0";
}

function StatusRows({ rows }: { rows: Array<[string, string | number]> }) {
  return (
    <div className="eco-action-list">
      {rows.map(([label, value]) => (
        <div key={label} className="eco-action-link" aria-disabled="true">
          <span className="eco-action-icon">
            <EcoStatusDot tone="neutral" />
          </span>
          <span>
            <strong>{label}</strong>
            <small>{value}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

export default function IntegrationsClient() {
  const [payload, setPayload] = useState<StatusPayload>({
    inventory: null,
    analytics: null,
    inventoryError: null,
    analyticsError: null,
  });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<"inventory" | "analytics" | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  async function loadStatus() {
    setLoading(true);
    const [inventoryRes, analyticsRes] = await Promise.allSettled([
      fetch("/api/local-inventory/sync", { cache: "no-store" }),
      fetch("/api/analytics/customers/sync-status", { cache: "no-store" }),
    ]);

    let inventory: InventoryStatus | null = null;
    let analytics: AnalyticsStatus | null = null;
    let inventoryError: string | null = null;
    let analyticsError: string | null = null;

    if (inventoryRes.status === "fulfilled") {
      const data = await safeReadJson<{ status?: InventoryStatus; error?: string }>(inventoryRes.value);
      inventory = data?.status ?? null;
      if (!inventoryRes.value.ok || data?.error) inventoryError = safeMessage(data?.error, "Статус склада временно недоступен");
    } else {
      inventoryError = "Статус склада временно недоступен";
    }

    if (analyticsRes.status === "fulfilled") {
      const data = await safeReadJson<{ sync?: AnalyticsStatus; error?: string }>(analyticsRes.value);
      analytics = data?.sync ?? null;
      if (!analyticsRes.value.ok || data?.error) analyticsError = safeMessage(data?.error, "Статус аналитики временно недоступен");
    } else {
      analyticsError = "Статус аналитики временно недоступен";
    }

    setPayload({ inventory, analytics, inventoryError, analyticsError });
    setLoading(false);
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    if (!payload.inventory?.isRunning && !payload.analytics?.isRunning) return;
    const timer = window.setInterval(() => void loadStatus(), 5000);
    return () => window.clearInterval(timer);
  }, [payload.inventory?.isRunning, payload.analytics?.isRunning]);

  async function runInventorySync() {
    setRunning("inventory");
    setRunResult(null);
    try {
      const response = await fetch("/api/local-inventory/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          includeProducts: true,
          includeStores: true,
          includeStock: true,
          includeCounterparties: true,
          includeDemands: true,
          wait: false,
        }),
      });
      const data = await safeReadJson<{ started?: boolean; status?: InventoryStatus; error?: string }>(response);
      setRunResult({
        title: "Складской импорт",
        message: data?.started ? "Ручной импорт запущен." : safeMessage(data?.error, "Ручной импорт не запущен."),
        tone: data?.started ? "success" : "warning",
      });
      setPayload((current) => ({ ...current, inventory: data?.status ?? current.inventory }));
      void loadStatus();
    } catch {
      setRunResult({
        title: "Складской импорт",
        message: "Ручной импорт не запущен. Проверьте конфигурацию интеграции.",
        tone: "danger",
      });
    } finally {
      setRunning(null);
    }
  }

  async function runAnalyticsSync() {
    setRunning("analytics");
    setRunResult(null);
    try {
      const response = await fetch("/api/analytics/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceFull: false }),
      });
      const data = await safeReadJson<{ started?: boolean; sync?: AnalyticsStatus; error?: string }>(response);
      setRunResult({
        title: "Аналитика клиентов",
        message: data?.started ? "Ручной импорт запущен." : safeMessage(data?.error, "Ручной импорт не запущен."),
        tone: data?.started ? "success" : "warning",
      });
      setPayload((current) => ({ ...current, analytics: data?.sync ?? current.analytics }));
      void loadStatus();
    } catch {
      setRunResult({
        title: "Аналитика клиентов",
        message: "Ручной импорт не запущен. Проверьте конфигурацию интеграции.",
        tone: "danger",
      });
    } finally {
      setRunning(null);
    }
  }

  const inventoryTone = toneForStatus(payload.inventory);
  const analyticsTone = toneForStatus(payload.analytics);

  return (
    <main className="eco-page">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <Link href="/cabinet">Кабинет</Link>
            <span className="sep">/</span>
            <span className="cur">Интеграции</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Интеграции</h1>
            <EcoBadge tone="warning" dot>
              admin only
            </EcoBadge>
          </div>
          <p className="eco-page-subtitle">МойСклад оставлен только для служебного статуса и ручного восстановления данных.</p>
        </div>
        <div className="eco-page-actions">
          <Link href="/cabinet/integrations/messenger" className="eco-btn eco-btn--ghost">
            <MessageSquareText size={16} />
            Мессенджеры
          </Link>
          <EcoButton type="button" variant="secondary" onClick={() => void loadStatus()} disabled={loading}>
            <RefreshCw size={16} />
            {loading ? "Обновляем..." : "Обновить статус"}
          </EcoButton>
        </div>
      </section>

      <div className="eco-grid eco-grid--kpi">
        <EcoKpi label="Основной источник" value="Локальная БД" tone="success" sub="Пользовательские сценарии работают без внешнего API." />
        <EcoKpi label="Write-интеграция" value="Отключена" tone="warning" sub="Автоматическая запись во внешний сервис не используется." />
        <EcoKpi label="Ручная синхронизация" value="Admin/debug" tone="neutral" sub="Запуск возможен только через feature flags." />
      </div>

      {runResult && (
        <EcoCard>
          <div className="eco-card__head">
            <div>
              <div className="eco-page-kicker">{runResult.title}</div>
              <h2 className="eco-stock-doc-title">{runResult.message}</h2>
            </div>
            <EcoBadge tone={runResult.tone} dot>
              статус
            </EcoBadge>
          </div>
        </EcoCard>
      )}

      <section className="eco-cabinet-grid">
        <EcoCard>
          <div className="eco-card__head">
            <div>
              <div className="eco-page-kicker">МойСклад</div>
              <h2 className="eco-stock-doc-title">Склад и документы</h2>
            </div>
            <EcoBadge tone={inventoryTone} dot>
              {payload.inventory?.isRunning ? "выполняется" : phaseLabel(payload.inventory?.phase)}
            </EcoBadge>
          </div>

          <StatusRows
            rows={[
              ["Последний старт", formatDateTime(payload.inventory?.startedAt)],
              ["Последнее завершение", formatDateTime(payload.inventory?.finishedAt)],
              ["Сообщение", safeMessage(payload.inventory?.error ?? payload.inventoryError ?? payload.inventory?.message, "Ожидание ручного запуска")],
              ["Товары", numberValue(payload.inventory?.productsSynced)],
              ["Услуги", numberValue(payload.inventory?.servicesSynced)],
              ["Клиенты", numberValue(payload.inventory?.counterpartiesSynced)],
              ["Склады", numberValue(payload.inventory?.storesSynced)],
              ["Остатки", numberValue(payload.inventory?.stockRowsSynced)],
              ["Отгрузки", numberValue(payload.inventory?.demandsSynced)],
            ]}
          />

          <div className="eco-form-actions">
            <EcoButton
              type="button"
              variant="secondary"
              onClick={() => void runInventorySync()}
              disabled={running !== null || payload.inventory?.isRunning}
            >
              <Database size={16} />
              {running === "inventory" || payload.inventory?.isRunning ? "Выполняется..." : "Ручной импорт склада"}
            </EcoButton>
          </div>
        </EcoCard>

        <EcoCard>
          <div className="eco-card__head">
            <div>
              <div className="eco-page-kicker">МойСклад</div>
              <h2 className="eco-stock-doc-title">Аналитика клиентов</h2>
            </div>
            <EcoBadge tone={analyticsTone} dot>
              {payload.analytics?.isRunning ? "выполняется" : phaseLabel(payload.analytics?.phase)}
            </EcoBadge>
          </div>

          <StatusRows
            rows={[
              ["Последний старт", formatDateTime(payload.analytics?.startedAt)],
              ["Последнее завершение", formatDateTime(payload.analytics?.finishedAt)],
              ["Сообщение", safeMessage(payload.analytics?.error ?? payload.analyticsError ?? payload.analytics?.message, "Ожидание ручного запуска")],
              ["Сканировано", numberValue(payload.analytics?.scannedDemands)],
              ["Обработано", numberValue(payload.analytics?.processedDemands)],
              ["Импортировано", numberValue(payload.analytics?.demandsSynced)],
              ["Всего документов", numberValue(payload.analytics?.totalDemands)],
              ["Последний документ", safeMessage(payload.analytics?.lastDemandName, "—")],
            ]}
          />

          <div className="eco-form-actions">
            <EcoButton
              type="button"
              variant="secondary"
              onClick={() => void runAnalyticsSync()}
              disabled={running !== null || payload.analytics?.isRunning}
            >
              <Activity size={16} />
              {running === "analytics" || payload.analytics?.isRunning ? "Выполняется..." : "Ручной импорт аналитики"}
            </EcoButton>
          </div>
        </EcoCard>
      </section>

      <EcoCard>
        <div className="eco-card__head--plain">
          <div>
            <div className="eco-page-kicker">Режим отключения</div>
            <h2>Флаги внешней интеграции</h2>
            <p>
              Для штатной работы держите внешнее чтение, запись и автоматическую синхронизацию выключенными. Ручной запуск
              используется только как контролируемый служебный сценарий.
            </p>
          </div>
          <ShieldCheck size={22} />
        </div>
        <StatusRows
          rows={[
            ["MOYSKLAD_ENABLED", "false в основном окружении"],
            ["MOYSKLAD_READ_ENABLED", "false для пользовательских страниц"],
            ["MOYSKLAD_WRITE_ENABLED", "false: документы создаются локально"],
            ["MOYSKLAD_SYNC_ENABLED", "false, кроме ручного admin/debug окна"],
          ]}
        />
      </EcoCard>
    </main>
  );
}
