"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Building2, Landmark, MessageSquareText, RefreshCw, ShieldCheck } from "lucide-react";
import { EcoBadge, EcoButton, EcoCard, EcoInput, EcoKpi, EcoSelect, EcoStatusDot } from "@/components/platform/EcoUI";
import { formatServiceDateTime } from "@/lib/date-time";
import { safeReadJson } from "@/lib/http-json";
import OperationalIntegrationsPanel from "./OperationalIntegrationsPanel";

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
  deliveryId: string;
  addressId: string;
  paymentId: string;
  requisiteId: string;
  contactName: string;
  contactPhone: string;
  contactComment: string;
  deliveryParts: boolean;
  offerPriority: "optimal" | "fastest" | "lowest_price" | "local_stock";
  timeoutMs: string;
  requestsPerSecond: string;
  markupRules: Array<{ fromCents: number; toCents: number | null; marginPercent: number; category?: string | null }>;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  lastCheckStatus: "never" | "ok" | "error";
  lastErrorCode: string | null;
};

type RosskoForm = Omit<RosskoStatus, "configured" | "connected" | "key1Configured" | "key2Configured" | "key1Masked" | "key2Masked" | "markupRules" | "lastCheckedAt" | "lastSuccessAt" | "lastErrorAt" | "lastErrorMessage" | "lastCheckStatus" | "lastErrorCode"> & {
  key1: string;
  key2: string;
};

type RosskoCheckoutOptions = {
  delivery: Array<{ id: string; name: string }>;
  payment: Array<{ id: string; name: string }>;
  address: Array<{ id: string; city: string; street: string; house: string; office: string; deliveryIds: string[]; label: string }>;
  company: Array<{ id: string; name: string; requisite: string }>;
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
  deliveryId: "",
  addressId: "",
  paymentId: "",
  requisiteId: "",
  contactName: "",
  contactPhone: "",
  contactComment: "",
  deliveryParts: true,
  offerPriority: "optimal",
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
  return value ? formatServiceDateTime(value) : "—";
}

function StatusRows({ rows }: { rows: Array<[string, string | number]> }) {
  return (
    <div className="eco-action-list">
      {rows.map(([label, value]) => (
        <div key={label} className="eco-action-link" aria-disabled="true">
          <span className="eco-action-icon"><EcoStatusDot tone="neutral" /></span>
          <span><strong>{label}</strong><small>{value}</small></span>
        </div>
      ))}
    </div>
  );
}

export default function IntegrationsClient({
  branchName,
  canEditSecrets,
  organizationConfigured,
  employeesConfigured,
}: {
  branchName: string;
  canEditSecrets: boolean;
  organizationConfigured: boolean;
  employeesConfigured: boolean;
}) {
  const [tbank, setTbank] = useState<TBankStatus | null>(null);
  const [tbankError, setTbankError] = useState<string | null>(null);
  const [tbankForm, setTbankForm] = useState<TBankForm>(DEFAULT_TBANK_FORM);
  const [rossko, setRossko] = useState<RosskoStatus | null>(null);
  const [rosskoError, setRosskoError] = useState<string | null>(null);
  const [rosskoForm, setRosskoForm] = useState<RosskoForm>(DEFAULT_ROSSKO_FORM);
  const [rosskoCheckout, setRosskoCheckout] = useState<RosskoCheckoutOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<"tbank-save" | "tbank-test" | "rossko-save" | "rossko-test" | "rossko-disconnect" | "rossko-markup" | null>(null);
  const [rosskoMarkupRules, setRosskoMarkupRules] = useState<RosskoStatus["markupRules"]>([]);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  async function loadStatus() {
    setLoading(true);
    const [tbankRes, rosskoRes] = await Promise.allSettled([
      fetch("/api/integrations/tbank/status", { cache: "no-store" }),
      fetch("/api/integrations/rossko", { cache: "no-store" }),
    ]);

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
      deliveryId: rossko.deliveryId,
      addressId: rossko.addressId,
      paymentId: rossko.paymentId,
      requisiteId: rossko.requisiteId,
      contactName: rossko.contactName,
      contactPhone: rossko.contactPhone,
      contactComment: rossko.contactComment,
      deliveryParts: rossko.deliveryParts,
      offerPriority: rossko.offerPriority,
      timeoutMs: rossko.timeoutMs,
      requestsPerSecond: rossko.requestsPerSecond,
    });
    setRosskoMarkupRules(rossko.markupRules);
  }, [rossko]);


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
      if (disconnect) {
        setRosskoCheckout(null);
        setRunResult({ title: "ROSSKO", message: "ROSSKO отключён только для текущего филиала.", tone: "success" });
        return;
      }

      const testResponse = await fetch("/api/integrations/rossko/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifySearch: true }),
      });
      const test = await safeReadJson<{
        ok?: boolean;
        message?: string;
        error?: string;
        integration?: RosskoStatus;
        checkout?: RosskoCheckoutOptions;
        search?: { query: string; offers: number; stocks: number; prices: number; deliveries: number };
      }>(testResponse);
      if (test?.integration) setRossko(test.integration);
      if (test?.checkout) setRosskoCheckout(test.checkout);
      if (!testResponse.ok || !test?.ok) throw new Error(safeMessage(test?.error, "Настройки сохранены, но поиск ROSSKO не прошёл проверку."));
      const offerText = typeof test.search?.offers === "number"
        ? ` Предложений: ${test.search.offers}; складов: ${test.search.stocks}; цен: ${test.search.prices}; сроков: ${test.search.deliveries}.`
        : "";
      setRunResult({ title: "ROSSKO", message: `${test.message || "Настройки сохранены и проверены."}${offerText}`, tone: "success" });
    } catch (error) {
      setRunResult({ title: "ROSSKO", message: error instanceof Error ? error.message : "Настройки ROSSKO не сохранены.", tone: "danger" });
    } finally {
      setRunning(null);
    }
  }

  async function loadRosskoCheckout() {
    setRunning("rossko-test");
    setRunResult(null);
    try {
      const key1 = rosskoForm.key1.trim();
      const key2 = rosskoForm.key2.trim();
      if ((key1 || key2) && (!key1 || !key2)) throw new Error("Введите оба ключа API ROSSKO.");
      if (!key1 && !key2 && !rossko?.configured) throw new Error("Введите KEY1 и KEY2 API ROSSKO.");
      const response = await fetch("/api/integrations/rossko/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(key1 ? { key1 } : {}), ...(key2 ? { key2 } : {}) }),
      });
      const data = await safeReadJson<{ ok?: boolean; message?: string; error?: string; integration?: RosskoStatus; checkout?: RosskoCheckoutOptions }>(response);
      if (data?.integration) setRossko(data.integration);
      if (!response.ok || !data?.ok) throw new Error(safeMessage(data?.error, "Не удалось проверить ROSSKO."));
      if (!data.checkout) throw new Error("ROSSKO не вернул настройки оформления заказа.");
      setRosskoCheckout(data.checkout);
      setRosskoForm((current) => ({
        ...current,
        deliveryId: data.checkout!.delivery.some((row) => row.id === current.deliveryId) ? current.deliveryId : "",
        addressId: data.checkout!.address.some((row) => row.id === current.addressId) ? current.addressId : "",
        paymentId: data.checkout!.payment.some((row) => row.id === current.paymentId) ? current.paymentId : "",
        requisiteId: data.checkout!.company.some((row) => row.id === current.requisiteId)
          ? current.requisiteId
          : data.checkout!.company.length === 1
            ? data.checkout!.company[0].id
            : "",
      }));
      setRunResult({
        title: "ROSSKO",
        message: data.checkout.company.length ? (data.message || "Ключи проверены, настройки загружены.") : "Ключи проверены. В аккаунте ROSSKO не найдены реквизиты — добавьте их в личном кабинете или обратитесь к менеджеру ROSSKO.",
        tone: data.checkout.company.length ? "success" : "warning",
      });
    } catch (error) {
      setRunResult({ title: "ROSSKO", message: error instanceof Error ? error.message : "Не удалось проверить ROSSKO.", tone: "danger" });
    } finally {
      setRunning(null);
    }
  }

  async function saveRosskoMarkup() {
    setRunning("rossko-markup");
    setRunResult(null);
    const response = await fetch("/api/integrations/rossko/markup", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules: rosskoMarkupRules }),
    });
    const data = await safeReadJson<RosskoStatus & { error?: string }>(response);
    if (response.ok && data) {
      setRossko(data);
      setRunResult({ title: "ROSSKO", message: "Филиальные правила наценки сохранены.", tone: "success" });
    } else {
      setRunResult({ title: "ROSSKO", message: safeMessage(data?.error, "Правила наценки не сохранены."), tone: "danger" });
    }
    setRunning(null);
  }

  const tbankTone = tbank?.connected ? "success" as const : tbank?.configured ? "warning" as const : "neutral" as const;
  const rosskoTone = rossko?.connected ? "success" as const : rossko?.configured ? "warning" as const : "neutral" as const;
  const selectedRosskoAddress = rosskoCheckout?.address.find((row) => row.id === rosskoForm.addressId);
  const rosskoDeliveries = selectedRosskoAddress?.deliveryIds.length
    ? (rosskoCheckout?.delivery.filter((row) => selectedRosskoAddress.deliveryIds.includes(row.id)) ?? [])
    : (rosskoCheckout?.delivery ?? []);
  const rosskoAddresses = rosskoForm.deliveryId
    ? (rosskoCheckout?.address.filter((row) => !row.deliveryIds.length || row.deliveryIds.includes(rosskoForm.deliveryId)) ?? [])
    : (rosskoCheckout?.address ?? []);

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
          <p className="eco-page-subtitle">Рабочие подключения принадлежат выбранному филиалу. Новый филиал начинает без скопированных секретов и сессий.</p>
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
        <EcoKpi label="Источник настроек" value="PostgreSQL" tone="success" sub="Реквизиты разрешаются только по активному филиалу." />
        <EcoKpi label="Секреты" value="Зашифрованы" tone="success" sub="Маски и реальные значения не возвращаются из API." />
        <EcoKpi label="Изоляция" value={branchName} tone="neutral" sub="Подключения другого филиала недоступны." />
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

      <OperationalIntegrationsPanel
        branchName={branchName}
        canEditSecrets={canEditSecrets}
        organizationConfigured={organizationConfigured}
        employeesConfigured={employeesConfigured}
      />

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
            {rossko?.connected ? "подключено" : rossko?.configured ? "настройка не завершена" : "не настроено"}
          </EcoBadge>
        </div>

        {rosskoError && <div className="eco-form-error eco-tbank-settings-error">{rosskoError}</div>}

        <div className="eco-tbank-settings-grid eco-rossko-key-grid">
          <label>
            <span>KEY1</span>
            <EcoInput type="password" autoComplete="off" disabled={!canEditSecrets} value={rosskoForm.key1} onChange={(event) => updateRosskoForm("key1", event.target.value)} placeholder={rossko?.key1Configured ? "сохранён: ••••••••" : "вставьте KEY1"} />
          </label>
          <label>
            <span>KEY2</span>
            <EcoInput type="password" autoComplete="off" disabled={!canEditSecrets} value={rosskoForm.key2} onChange={(event) => updateRosskoForm("key2", event.target.value)} placeholder={rossko?.key2Configured ? "сохранён: ••••••••" : "вставьте KEY2"} />
          </label>
          <p className="eco-rossko-form-hint eco-tbank-settings-wide">Введите API-ключи ROSSKO. Они находятся в личном кабинете ROSSKO в разделе API либо выдаются персональным менеджером.</p>
        </div>

        <div className="eco-rossko-key-actions">
          <EcoButton type="button" onClick={() => void loadRosskoCheckout()} disabled={running !== null}>
            <ShieldCheck size={16} />
            {running === "rossko-test" ? "Проверяем и загружаем..." : "Проверить ключи и загрузить настройки"}
          </EcoButton>
        </div>

        {rosskoCheckout ? (
          <>
            <div className="eco-rossko-step-head"><strong>Настройки оформления заказа</strong><span>Выберите значения, которые вернул ROSSKO для этого аккаунта.</span></div>
            {rosskoCheckout.company.length === 0 && (
              <div className="eco-form-error eco-tbank-settings-error">В аккаунте ROSSKO не найдены реквизиты. Добавьте организацию и реквизиты в личном кабинете ROSSKO либо обратитесь к менеджеру ROSSKO.</div>
            )}
            <div className="eco-tbank-settings-grid">
              <label>
                <span>Организация для оформления заказа</span>
                <EcoSelect value={rosskoForm.requisiteId} onChange={(event) => updateRosskoForm("requisiteId", event.target.value)} disabled={rosskoCheckout.company.length === 0}>
                  <option value="">{rosskoCheckout.company.length ? "Выберите реквизиты ROSSKO" : "Реквизиты не найдены"}</option>
                  {rosskoCheckout.company.map((company) => <option key={company.id} value={company.id}>{company.requisite ? `${company.name} · ${company.requisite}` : company.name}</option>)}
                </EcoSelect>
                <small className="eco-rossko-form-hint">Ничего вводить вручную не нужно. Список загружается из реквизитов, заранее созданных в личном кабинете ROSSKO.</small>
              </label>
              <label>
                <span>Способ доставки</span>
                <EcoSelect
                  value={rosskoForm.deliveryId}
                  onChange={(event) => setRosskoForm((current) => {
                    const deliveryId = event.target.value;
                    const addressStillFits = !current.addressId || !rosskoCheckout.address.find((row) => row.id === current.addressId)?.deliveryIds.length || rosskoCheckout.address.find((row) => row.id === current.addressId)?.deliveryIds.includes(deliveryId);
                    return { ...current, deliveryId, addressId: addressStillFits ? current.addressId : "" };
                  })}
                >
                  <option value="">Выберите способ доставки</option>
                  {rosskoDeliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{delivery.name}</option>)}
                </EcoSelect>
                <small className="eco-rossko-form-hint">Выберите один из вариантов, доступных для вашего аккаунта и адреса.</small>
              </label>
              <label>
                <span>Адрес доставки</span>
                <EcoSelect value={rosskoForm.addressId} onChange={(event) => updateRosskoForm("addressId", event.target.value)}>
                  <option value="">{rosskoForm.deliveryId ? "Самовывоз или выберите адрес" : "Выберите адрес из ROSSKO"}</option>
                  {rosskoAddresses.map((address) => <option key={address.id} value={address.id}>{address.label}</option>)}
                </EcoSelect>
                <small className="eco-rossko-form-hint">Выберите адрес из списка ROSSKO. Адреса добавляются и изменяются в личном кабинете ROSSKO.</small>
              </label>
              <label>
                <span>Способ оплаты</span>
                <EcoSelect value={rosskoForm.paymentId} onChange={(event) => updateRosskoForm("paymentId", event.target.value)}>
                  <option value="">Выберите способ оплаты</option>
                  {rosskoCheckout.payment.map((payment) => <option key={payment.id} value={payment.id}>{payment.name}</option>)}
                </EcoSelect>
                <small className="eco-rossko-form-hint">Выберите вариант, который ROSSKO вернул для вашего аккаунта.</small>
              </label>
            </div>

            <div className="eco-rossko-step-head"><strong>Контакт и поиск предложений</strong><span>Контакт передаётся при оформлении; склад берётся только из выбранного предложения GetSearch.</span></div>
            <div className="eco-tbank-settings-grid">
              <label><span>ФИО</span><EcoInput value={rosskoForm.contactName} onChange={(event) => updateRosskoForm("contactName", event.target.value)} placeholder="ФИО покупателя" /></label>
              <label><span>Телефон</span><EcoInput value={rosskoForm.contactPhone} onChange={(event) => updateRosskoForm("contactPhone", event.target.value)} placeholder="+7…" /></label>
              <label className="eco-tbank-settings-wide"><span>Комментарий к заказу</span><textarea className="eco-input" value={rosskoForm.contactComment} onChange={(event) => updateRosskoForm("contactComment", event.target.value)} placeholder="Необязательно; увидит оператор ROSSKO" maxLength={200} /></label>
              <label>
                <span>Приоритет предложения</span>
                <EcoSelect value={rosskoForm.offerPriority} onChange={(event) => updateRosskoForm("offerPriority", event.target.value as RosskoForm["offerPriority"])}>
                  <option value="optimal">Оптимальное предложение</option>
                  <option value="fastest">Минимальный срок</option>
                  <option value="lowest_price">Минимальная цена</option>
                  <option value="local_stock">Локальный склад</option>
                </EcoSelect>
              </label>
            </div>
            <div className="eco-tbank-settings-flags">
              <label className="eco-check-row"><input type="checkbox" checked={rosskoForm.deliveryParts} onChange={(event) => updateRosskoForm("deliveryParts", event.target.checked)} /><span>Разрешить частичную поставку</span></label>
            </div>
            <div className="eco-rossko-step-head"><strong>Филиальные правила наценки</strong><span>Используются существующим движком расчёта ROSSKO в ИИ‑помощнике; закупочная цена остаётся внутренней.</span></div>
            <div className="eco-tbank-settings-grid">
              {rosskoMarkupRules.map((rule, index) => (
                <label key={`${rule.fromCents}-${index}`}>
                  <span>{rule.toCents == null ? `От ${Math.round(rule.fromCents / 100).toLocaleString("ru-RU")} ₽` : `${Math.round(rule.fromCents / 100).toLocaleString("ru-RU")}–${Math.round(rule.toCents / 100).toLocaleString("ru-RU")} ₽`}</span>
                  <EcoInput type="number" min={0} max={300} value={rule.marginPercent} onChange={(event) => setRosskoMarkupRules((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, marginPercent: Math.max(0, Math.min(300, Number(event.target.value) || 0)) } : item))} />
                  <small className="eco-rossko-form-hint">Наценка, %</small>
                </label>
              ))}
            </div>
            <div className="eco-form-actions"><EcoButton type="button" variant="secondary" onClick={() => void saveRosskoMarkup()} disabled={running !== null || !rosskoMarkupRules.length}>{running === "rossko-markup" ? "Сохраняем наценки…" : "Сохранить наценки"}</EcoButton></div>
          </>
        ) : (
          <p className="eco-rossko-awaiting">Сначала проверьте ключи: после этого ROSSKO загрузит доступные реквизиты, доставку, адреса и способы оплаты.</p>
        )}

        <StatusRows rows={[
          ["Ключи", rossko?.key1Configured && rossko?.key2Configured ? "оба ключа сохранены в зашифрованном виде" : "нужны Key 1 и Key 2"],
          ["Последняя проверка", formatDateTime(rossko?.lastCheckedAt)],
          ["Последний успех", formatDateTime(rossko?.lastSuccessAt)],
          ["Последняя ошибка", rossko?.lastErrorAt ? `${formatDateTime(rossko.lastErrorAt)} · ${rossko.lastErrorMessage ?? "ошибка проверки"}` : "—"],
          ["Результат проверки", rossko?.lastCheckStatus === "ok" ? "авторизация подтверждена" : rossko?.lastCheckStatus === "error" ? "нужна проверка ключей или доступности" : "проверка ещё не выполнялась"],
          ["Выбор предложения", "склад (stock) берётся из выбранного предложения GetSearch"],
        ]} />

        <div className="eco-form-actions">
          <EcoButton type="button" variant="primary" onClick={() => void saveRosskoSettings()} disabled={running !== null || !rosskoCheckout}><Building2 size={16} />{running === "rossko-save" ? "Сохраняем и проверяем..." : "Сохранить и проверить поиск"}</EcoButton>
          {canEditSecrets && rossko?.configured && <EcoButton type="button" variant="secondary" onClick={() => void saveRosskoSettings(true)} disabled={running !== null}>{running === "rossko-disconnect" ? "Отключаем..." : "Отключить филиал"}</EcoButton>}
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

    </main>
  );
}
