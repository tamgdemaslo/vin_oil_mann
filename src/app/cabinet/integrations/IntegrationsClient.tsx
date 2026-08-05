"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, Building2, Database, Landmark, MessageSquareText, RefreshCw, ShieldCheck } from "lucide-react";
import { EcoBadge, EcoButton, EcoCard, EcoInput, EcoKpi, EcoSelect, EcoStatusDot } from "@/components/platform/EcoUI";
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

type TBankStatus = {
  configured: boolean;
  connected: boolean;
  inn: string;
  kpp: string;
  tokenConfigured: boolean;
  tokenPreview: string;
  debitAccountNumberMasked: string;
  mode: string;
  directPaymentsEnabled: boolean;
  maxSinglePayment: string;
  dailyPaymentLimit: string;
  allowedSupplierInns: string;
  webhookUrl: string;
  sandbox: boolean;
  productionMode: boolean;
  lastCheckedAt: string;
  lastCheckStatus: string;
  lastCheckMessage: string;
  accounts: Array<{
    id: string;
    accountNumberMasked: string;
    accountName: string;
    bankName: string;
    currency: string;
    isDefault: boolean;
  }>;
};

type TBankForm = {
  inn: string;
  kpp: string;
  debitAccountNumber: string;
  token: string;
  mode: string;
  maxSinglePayment: string;
  dailyPaymentLimit: string;
  allowedSupplierInns: string;
  webhookUrl: string;
  sandbox: boolean;
  productionMode: boolean;
};

type RosskoStatus = {
  configured: boolean;
  connected: boolean;
  key1Configured: boolean;
  key2Configured: boolean;
  key1Masked: string | null;
  key2Masked: string | null;
  profile: string;
  deliveryId: string;
  addressId: string;
  paymentId: string;
  requisiteId: string;
  preferredStore: string;
  contactName: string;
  contactPhone: string;
  deliveryParts: boolean;
  timeoutMs: string;
  requestsPerSecond: string;
  lastCheckedAt: string | null;
  lastCheckStatus: "never" | "ok" | "error";
  lastErrorCode: string | null;
};

type RosskoForm = Omit<RosskoStatus, "configured" | "connected" | "key1Configured" | "key2Configured" | "key1Masked" | "key2Masked" | "lastCheckedAt" | "lastCheckStatus" | "lastErrorCode"> & {
  key1: string;
  key2: string;
};

type RunResult = {
  title: string;
  message: string;
  tone: "success" | "warning" | "danger" | "info";
};

const DEFAULT_TBANK_FORM: TBankForm = {
  inn: "",
  kpp: "",
  debitAccountNumber: "",
  token: "",
  mode: "draft_only",
  maxSinglePayment: "",
  dailyPaymentLimit: "",
  allowedSupplierInns: "",
  webhookUrl: "",
  sandbox: false,
  productionMode: false,
};

const DEFAULT_ROSSKO_FORM: RosskoForm = {
  key1: "",
  key2: "",
  profile: "",
  deliveryId: "",
  addressId: "",
  paymentId: "",
  requisiteId: "",
  preferredStore: "",
  contactName: "",
  contactPhone: "",
  deliveryParts: true,
  timeoutMs: "20000",
  requestsPerSecond: "4",
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
  const [tbank, setTbank] = useState<TBankStatus | null>(null);
  const [tbankError, setTbankError] = useState<string | null>(null);
  const [tbankForm, setTbankForm] = useState<TBankForm>(DEFAULT_TBANK_FORM);
  const [rossko, setRossko] = useState<RosskoStatus | null>(null);
  const [rosskoError, setRosskoError] = useState<string | null>(null);
  const [rosskoForm, setRosskoForm] = useState<RosskoForm>(DEFAULT_ROSSKO_FORM);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<"inventory" | "analytics" | "tbank-save" | "tbank-test" | "rossko-save" | "rossko-test" | "rossko-disconnect" | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  async function loadStatus() {
    setLoading(true);
    const [inventoryRes, analyticsRes, tbankRes, rosskoRes] = await Promise.allSettled([
      fetch("/api/local-inventory/sync", { cache: "no-store" }),
      fetch("/api/analytics/customers/sync-status", { cache: "no-store" }),
      fetch("/api/integrations/tbank/status", { cache: "no-store" }),
      fetch("/api/integrations/rossko", { cache: "no-store" }),
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

    if (tbankRes.status === "fulfilled") {
      const data = await safeReadJson<TBankStatus & { error?: string }>(tbankRes.value);
      if (tbankRes.value.ok && data) {
        setTbank(data);
        setTbankError(null);
      } else {
        setTbankError(safeMessage(data?.error, "Статус T-Bank временно недоступен"));
      }
    } else {
      setTbankError("Статус T-Bank временно недоступен");
    }

    if (rosskoRes.status === "fulfilled") {
      const data = await safeReadJson<RosskoStatus & { error?: string }>(rosskoRes.value);
      if (rosskoRes.value.ok && data) {
        setRossko(data);
        setRosskoError(null);
      } else {
        setRosskoError(safeMessage(data?.error, "Статус ROSSKO временно недоступен"));
      }
    } else {
      setRosskoError("Статус ROSSKO временно недоступен");
    }

    setPayload({ inventory, analytics, inventoryError, analyticsError });
    setLoading(false);
  }

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    if (!tbank) return;
    setTbankForm({
      inn: tbank.inn,
      kpp: tbank.kpp,
      debitAccountNumber: "",
      token: "",
      mode: tbank.mode || "draft_only",
      maxSinglePayment: tbank.maxSinglePayment,
      dailyPaymentLimit: tbank.dailyPaymentLimit,
      allowedSupplierInns: tbank.allowedSupplierInns,
      webhookUrl: tbank.webhookUrl,
      sandbox: tbank.sandbox,
      productionMode: tbank.productionMode,
    });
  }, [tbank]);

  useEffect(() => {
    if (!rossko) return;
    setRosskoForm({
      key1: "",
      key2: "",
      profile: rossko.profile,
      deliveryId: rossko.deliveryId,
      addressId: rossko.addressId,
      paymentId: rossko.paymentId,
      requisiteId: rossko.requisiteId,
      preferredStore: rossko.preferredStore,
      contactName: rossko.contactName,
      contactPhone: rossko.contactPhone,
      deliveryParts: rossko.deliveryParts,
      timeoutMs: rossko.timeoutMs,
      requestsPerSecond: rossko.requestsPerSecond,
    });
  }, [rossko]);

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

  function updateTBankForm<K extends keyof TBankForm>(key: K, value: TBankForm[K]) {
    setTbankForm((current) => ({ ...current, [key]: value }));
  }

  async function saveTBankSettings() {
    setRunning("tbank-save");
    setRunResult(null);
    try {
      const response = await fetch("/api/integrations/tbank/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tbankForm),
      });
      const data = await safeReadJson<TBankStatus & { error?: string }>(response);
      if (!response.ok || !data?.configured) {
        throw new Error(safeMessage(data?.error, "Настройки T-Bank не сохранены."));
      }
      setTbank(data);
      setRunResult({
        title: "T-Bank",
        message: "Настройки интеграции сохранены.",
        tone: "success",
      });
    } catch (error) {
      setRunResult({
        title: "T-Bank",
        message: error instanceof Error ? error.message : "Настройки T-Bank не сохранены.",
        tone: "danger",
      });
    } finally {
      setRunning(null);
    }
  }

  async function testTBankConnection() {
    setRunning("tbank-test");
    setRunResult(null);
    try {
      const response = await fetch("/api/integrations/tbank/test", { method: "POST" });
      const data = await safeReadJson<{ ok?: boolean; message?: string; error?: string; integration?: TBankStatus }>(response);
      if (!response.ok || !data?.ok) {
        if (data?.integration) setTbank(data.integration);
        throw new Error(safeMessage(data?.error, "Не удалось проверить T-Bank."));
      }
      if (data.integration) setTbank(data.integration);
      setRunResult({
        title: "T-Bank",
        message: data.message || "Подключение T-Bank проверено.",
        tone: "success",
      });
    } catch (error) {
      setRunResult({
        title: "T-Bank",
        message: error instanceof Error ? error.message : "Не удалось проверить T-Bank.",
        tone: "danger",
      });
    } finally {
      setRunning(null);
    }
  }

  function updateRosskoForm<K extends keyof RosskoForm>(key: K, value: RosskoForm[K]) {
    setRosskoForm((current) => ({ ...current, [key]: value }));
  }

  async function saveRosskoSettings(disconnect = false) {
    const action = disconnect ? "rossko-disconnect" : "rossko-save";
    setRunning(action);
    setRunResult(null);
    try {
      const response = await fetch("/api/integrations/rossko", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(disconnect ? { disconnect: true } : rosskoForm),
      });
      const data = await safeReadJson<RosskoStatus & { error?: string }>(response);
      if (!response.ok || !data) throw new Error(safeMessage(data?.error, "Настройки ROSSKO не сохранены."));
      setRossko(data);
      setRunResult({ title: "ROSSKO", message: disconnect ? "ROSSKO отключён только для текущего филиала." : "Настройки ROSSKO сохранены для текущего филиала.", tone: "success" });
    } catch (error) {
      setRunResult({ title: "ROSSKO", message: error instanceof Error ? error.message : "Настройки ROSSKO не сохранены.", tone: "danger" });
    } finally {
      setRunning(null);
    }
  }

  async function testRosskoConnection() {
    setRunning("rossko-test");
    setRunResult(null);
    try {
      const response = await fetch("/api/integrations/rossko/test", { method: "POST" });
      const data = await safeReadJson<{ ok?: boolean; message?: string; error?: string; integration?: RosskoStatus }>(response);
      if (data?.integration) setRossko(data.integration);
      if (!response.ok || !data?.ok) throw new Error(safeMessage(data?.error, "Не удалось проверить ROSSKO."));
      setRunResult({ title: "ROSSKO", message: data.message || "ROSSKO подключён.", tone: "success" });
    } catch (error) {
      setRunResult({ title: "ROSSKO", message: error instanceof Error ? error.message : "Не удалось проверить ROSSKO.", tone: "danger" });
    } finally {
      setRunning(null);
    }
  }

  const inventoryTone = toneForStatus(payload.inventory);
  const analyticsTone = toneForStatus(payload.analytics);
  const tbankTone = tbank?.connected ? "success" as const : tbank?.configured ? "warning" as const : "neutral" as const;
  const rosskoTone = rossko?.connected ? "success" as const : rossko?.configured ? "warning" as const : "neutral" as const;

  return (
    <main className="eco-page">
      <section className="eco-page-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <Link href="/management">Управление</Link>
            <span className="sep">/</span>
            <span className="cur">Интеграции</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Интеграции</h1>
            <EcoBadge tone="warning" dot>
              управление подключениями
            </EcoBadge>
          </div>
          <p className="eco-page-subtitle">Подключения сгруппированы по бизнес-задаче. Личный Telegram сотрудника настраивается только в личном меню.</p>
        </div>
        <div className="eco-page-actions">
          <Link href="/cabinet/integrations/messenger" className="eco-btn eco-btn--ghost">
            <MessageSquareText size={16} />
            Каналы связи
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

      <section id="finance" className="eco-integration-group">
        <header><div><p className="eco-page-kicker">Финансы</p><h2>Банковские подключения</h2></div><span>T-Bank, счета и безопасные лимиты платежей.</span></header>
      <EcoCard className="eco-tbank-settings">
        <div className="eco-card__head">
          <div>
            <div className="eco-page-kicker">Поставщики / каталог</div>
            <h2 className="eco-stock-doc-title">ROSSKO</h2>
            <p>Ключи, условия доставки и наценка работают только в текущем филиале. Поиск ИИ выполняется в режиме чтения.</p>
          </div>
          <EcoBadge tone={rosskoTone} dot>
            {rossko?.connected ? "подключено" : rossko?.configured ? "требует проверки" : "не настроено"}
          </EcoBadge>
        </div>

        {rosskoError && <div className="eco-form-error eco-tbank-settings-error">{rosskoError}</div>}

        <div className="eco-tbank-settings-grid">
          <label><span>Профиль ROSSKO</span><EcoInput value={rosskoForm.profile} onChange={(event) => updateRosskoForm("profile", event.target.value)} placeholder="например основной кабинет" /></label>
          <label><span>Предпочитаемый склад</span><EcoInput value={rosskoForm.preferredStore} onChange={(event) => updateRosskoForm("preferredStore", event.target.value)} placeholder="идентификатор или название" /></label>
          <label><span>Key 1</span><EcoInput type="password" value={rosskoForm.key1} onChange={(event) => updateRosskoForm("key1", event.target.value)} placeholder={rossko?.key1Configured ? "сохранён: ••••••••" : "вставьте Key 1"} /></label>
          <label><span>Key 2</span><EcoInput type="password" value={rosskoForm.key2} onChange={(event) => updateRosskoForm("key2", event.target.value)} placeholder={rossko?.key2Configured ? "сохранён: ••••••••" : "вставьте Key 2"} /></label>
          <label><span>Способ доставки</span><EcoInput value={rosskoForm.deliveryId} onChange={(event) => updateRosskoForm("deliveryId", event.target.value)} placeholder="delivery_id" /></label>
          <label><span>Адрес доставки</span><EcoInput value={rosskoForm.addressId} onChange={(event) => updateRosskoForm("addressId", event.target.value)} placeholder="address_id" /></label>
          <label><span>Способ оплаты</span><EcoInput value={rosskoForm.paymentId} onChange={(event) => updateRosskoForm("paymentId", event.target.value)} placeholder="payment_id" /></label>
          <label><span>Реквизиты</span><EcoInput value={rosskoForm.requisiteId} onChange={(event) => updateRosskoForm("requisiteId", event.target.value)} placeholder="requisite_id" /></label>
          <label><span>Контакт доставки</span><EcoInput value={rosskoForm.contactName} onChange={(event) => updateRosskoForm("contactName", event.target.value)} placeholder="ФИО" /></label>
          <label><span>Телефон доставки</span><EcoInput value={rosskoForm.contactPhone} onChange={(event) => updateRosskoForm("contactPhone", event.target.value)} placeholder="+7…" /></label>
        </div>

        <div className="eco-tbank-settings-flags">
          <label className="eco-check-row"><input type="checkbox" checked={rosskoForm.deliveryParts} onChange={(event) => updateRosskoForm("deliveryParts", event.target.checked)} /><span>Разрешить частичную поставку</span></label>
        </div>

        <StatusRows rows={[
          ["Ключи", rossko?.key1Configured && rossko?.key2Configured ? "оба ключа сохранены в зашифрованном виде" : "нужны Key 1 и Key 2"],
          ["Последняя проверка", formatDateTime(rossko?.lastCheckedAt)],
          ["Результат проверки", rossko?.lastCheckStatus === "ok" ? "авторизация подтверждена" : rossko?.lastCheckStatus === "error" ? "нужна проверка ключей или доступности" : "проверка ещё не выполнялась"],
          ["Наценка", "используются правила ИИ-помощника текущего филиала"],
        ]} />

        <div className="eco-form-actions">
          <EcoButton type="button" variant="primary" onClick={() => void saveRosskoSettings()} disabled={running !== null}><Building2 size={16} />{running === "rossko-save" ? "Сохраняем..." : "Сохранить ROSSKO"}</EcoButton>
          <EcoButton type="button" onClick={() => void testRosskoConnection()} disabled={running !== null || !rossko?.configured}><ShieldCheck size={16} />{running === "rossko-test" ? "Проверяем..." : "Проверить подключение"}</EcoButton>
          {rossko?.configured && <EcoButton type="button" variant="secondary" onClick={() => void saveRosskoSettings(true)} disabled={running !== null}>{running === "rossko-disconnect" ? "Отключаем..." : "Отключить филиал"}</EcoButton>}
        </div>
      </EcoCard>

      <EcoCard className="eco-tbank-settings">
        <div className="eco-card__head">
          <div>
            <div className="eco-page-kicker">T-Bank</div>
            <h2 className="eco-stock-doc-title">Оплата счетов поставщиков</h2>
            <p>Безопасный режим создаёт черновик платёжного поручения, а подтверждение остаётся в T-Business.</p>
          </div>
          <EcoBadge tone={tbankTone} dot>
            {tbank?.connected ? "подключено" : tbank?.configured ? "требует проверки" : "не настроено"}
          </EcoBadge>
        </div>

        {tbankError && <div className="eco-form-error eco-tbank-settings-error">{tbankError}</div>}

        <div className="eco-tbank-settings-grid">
          <label>
            <span>ИНН организации</span>
            <EcoInput value={tbankForm.inn} onChange={(event) => updateTBankForm("inn", event.target.value)} placeholder="10 или 12 цифр" />
          </label>
          <label>
            <span>КПП</span>
            <EcoInput value={tbankForm.kpp} onChange={(event) => updateTBankForm("kpp", event.target.value)} placeholder="если есть" />
          </label>
          <label>
            <span>Расчётный счёт списания</span>
            <EcoInput
              value={tbankForm.debitAccountNumber}
              onChange={(event) => updateTBankForm("debitAccountNumber", event.target.value)}
              placeholder={tbank?.debitAccountNumberMasked || "20 цифр"}
            />
          </label>
          <label>
            <span>T-API токен</span>
            <EcoInput
              type="password"
              value={tbankForm.token}
              onChange={(event) => updateTBankForm("token", event.target.value)}
              placeholder={tbank?.tokenConfigured ? `сохранён: ${tbank.tokenPreview}` : "вставьте токен T-API"}
            />
          </label>
          <label>
            <span>Режим оплаты</span>
            <EcoSelect value={tbankForm.mode} onChange={(event) => updateTBankForm("mode", event.target.value)}>
              <option value="draft_only">Только черновики</option>
              <option value="direct_enabled">Прямые платежи после отдельного включения</option>
            </EcoSelect>
          </label>
          <label>
            <span>Лимит одного платежа</span>
            <EcoInput value={tbankForm.maxSinglePayment} onChange={(event) => updateTBankForm("maxSinglePayment", event.target.value)} placeholder="например 100000" />
          </label>
          <label>
            <span>Лимит в день</span>
            <EcoInput value={tbankForm.dailyPaymentLimit} onChange={(event) => updateTBankForm("dailyPaymentLimit", event.target.value)} placeholder="например 300000" />
          </label>
          <label>
            <span>Разрешённые ИНН поставщиков</span>
            <EcoInput value={tbankForm.allowedSupplierInns} onChange={(event) => updateTBankForm("allowedSupplierInns", event.target.value)} placeholder="через запятую, пусто = все" />
          </label>
          <label className="eco-tbank-settings-wide">
            <span>Webhook URL</span>
            <EcoInput value={tbankForm.webhookUrl} onChange={(event) => updateTBankForm("webhookUrl", event.target.value)} placeholder="/api/integrations/tbank/webhook/payment-status" />
          </label>
        </div>

        <div className="eco-tbank-settings-flags">
          <label className="eco-check-row">
            <input type="checkbox" checked={tbankForm.sandbox} onChange={(event) => updateTBankForm("sandbox", event.target.checked)} />
            <span>Тестовый режим / sandbox</span>
          </label>
          <label className="eco-check-row">
            <input type="checkbox" checked={tbankForm.productionMode} onChange={(event) => updateTBankForm("productionMode", event.target.checked)} />
            <span>Production mode</span>
          </label>
        </div>

        <StatusRows
          rows={[
            ["Статус подключения", tbank?.connected ? "готово к созданию черновиков" : "требуется токен и счёт списания"],
            ["Счета T-Bank", tbank?.accounts.length ? tbank.accounts.map((account) => account.accountNumberMasked).join(", ") : "не загружены"],
            ["Последняя проверка", tbank?.lastCheckedAt ? formatDateTime(tbank.lastCheckedAt) : "—"],
            ["Результат проверки", safeMessage(tbank?.lastCheckMessage, "Проверка ещё не выполнялась")],
          ]}
        />

        <div className="eco-form-actions">
          <EcoButton type="button" variant="primary" onClick={() => void saveTBankSettings()} disabled={running !== null}>
            <Building2 size={16} />
            {running === "tbank-save" ? "Сохраняем..." : "Сохранить T-Bank"}
          </EcoButton>
          <EcoButton type="button" onClick={() => void testTBankConnection()} disabled={running !== null || !tbank?.configured}>
            <Landmark size={16} />
            {running === "tbank-test" ? "Проверяем..." : "Проверить подключение"}
          </EcoButton>
        </div>
      </EcoCard>
      </section>

      <section id="inventory" className="eco-integration-group">
        <header><div><p className="eco-page-kicker">Учёт и склад</p><h2>МойСклад и синхронизации</h2></div><span>Складские данные и аналитика клиентов в одном подключении.</span></header>
      <div className="eco-cabinet-grid">
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
      </div>
      </section>

      <section id="system" className="eco-integration-group">
        <header><div><p className="eco-page-kicker">Система</p><h2>Техническая диагностика</h2></div><span>Служебные статусы для владельца платформы.</span></header>
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
      </section>
    </main>
  );
}
