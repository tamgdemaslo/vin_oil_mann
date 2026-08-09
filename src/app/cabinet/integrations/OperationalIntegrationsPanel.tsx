"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, QrCode, RefreshCw, Save, TestTube2, Unplug } from "lucide-react";
import { EcoBadge, EcoButton, EcoCard, EcoInput, EcoSelect } from "@/components/platform/EcoUI";
import { safeReadJson } from "@/lib/http-json";

type AqsiRegister = {
  id: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  apiKeyConfigured: boolean;
  markingBypassPasswordConfigured: boolean;
  baseUrl: string;
  ordersPath: string;
  pendingOrderPath: string;
  devicesPath: string;
  deviceId?: string;
  shopId?: string;
  cashierId?: string;
  status: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  connectedAt: string;
};

type AqsiAlert = {
  id: string;
  documentId: string;
  status: string;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  nextAttemptAt: string | null;
  updatedAt: string;
};
type AqsiDevice = { id: string; label: string; shopId?: string };

type AqsiStatus = { configured: boolean; pendingFiscalizations: number; alerts: AqsiAlert[]; registers: AqsiRegister[] };
type TelegramStatus = {
  configured: boolean;
  apiIdConfigured: boolean;
  apiHashConfigured: boolean;
  status: string;
  account: { id: string; displayName: string; phoneMasked: string | null; username: string | null; status: string; lastSyncAt: string | null; lastError: string | null; updatedAt: string } | null;
};

type IntegrationActivity = {
  id: string;
  channel: string | null;
  action: string;
  status: string;
  message: string | null;
  actorName: string;
  createdAt: string;
};

type AqsiForm = {
  id?: string;
  name: string;
  apiKey: string;
  markingBypassPassword: string;
  baseUrl: string;
  ordersPath: string;
  pendingOrderPath: string;
  devicesPath: string;
  deviceId: string;
  shopId: string;
  cashierId: string;
  isDefault: boolean;
  enabled: boolean;
};

const EMPTY_AQSI: AqsiForm = {
  name: "Основная касса",
  apiKey: "",
  markingBypassPassword: "",
  baseUrl: "https://api.aqsi.ru/pub",
  ordersPath: "/v2/Receipts",
  pendingOrderPath: "/v2/Orders/simple",
  devicesPath: "/v1/Devices",
  deviceId: "",
  shopId: "",
  cashierId: "",
  isDefault: true,
  enabled: true,
};

function registerForm(row: AqsiRegister): AqsiForm {
  return {
    id: row.id,
    name: row.name,
    apiKey: "",
    markingBypassPassword: "",
    baseUrl: row.baseUrl,
    ordersPath: row.ordersPath,
    pendingOrderPath: row.pendingOrderPath,
    devicesPath: row.devicesPath,
    deviceId: row.deviceId ?? "",
    shopId: row.shopId ?? "",
    cashierId: row.cashierId ?? "",
    isDefault: row.isDefault,
    enabled: row.enabled,
  };
}

function label(status: string, configured: boolean) {
  if (!configured) return "не настроено";
  if (status === "connected") return "подключено";
  if (status === "needs_auth") return "нужна повторная авторизация";
  if (status === "error") return "ошибка";
  if (status === "disabled" || status === "disconnected") return "отключено";
  return "настройка не завершена";
}

function dateTime(value?: string | null) {
  return value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
}

function actionLabel(action: string) {
  const labels: Record<string, string> = {
    aqsi_register_saved: "Настройки кассы AQSI сохранены",
    aqsi_register_disabled: "Касса AQSI отключена",
    aqsi_connection_verified: "Соединение AQSI проверено",
    aqsi_connection_failed: "Проверка AQSI завершилась ошибкой",
    aqsi_fiscalization_succeeded: "Заказ передан в AQSI",
    aqsi_fiscalization_pending: "Фискализация ожидает повтора",
    telegram_user_settings_saved: "Настройки рабочего Telegram сохранены",
    telegram_user_connected: "Рабочий Telegram подключён",
    telegram_user_disconnected: "Рабочий Telegram отключён",
    telegram_user_sync_failed: "Синхронизация Telegram завершилась ошибкой",
    rossko_settings_saved: "Настройки ROSSKO сохранены",
    rossko_disconnected: "ROSSKO отключён",
    rossko_connection_verified: "Соединение ROSSKO проверено",
    rossko_connection_failed: "Проверка ROSSKO завершилась ошибкой",
  };
  return labels[action] ?? action.replaceAll("_", " ");
}

export default function OperationalIntegrationsPanel({
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
  const [aqsi, setAqsi] = useState<AqsiStatus | null>(null);
  const [telegram, setTelegram] = useState<TelegramStatus | null>(null);
  const [rosskoConfigured, setRosskoConfigured] = useState(false);
  const [aqsiForm, setAqsiForm] = useState<AqsiForm>(EMPTY_AQSI);
  const [telegramForm, setTelegramForm] = useState({ apiId: "", apiHash: "" });
  const [aqsiDevices, setAqsiDevices] = useState<AqsiDevice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [activity, setActivity] = useState<IntegrationActivity[]>([]);
  const telegramCredentialsFormRef = useRef<HTMLFormElement>(null);

  const selected = useMemo(() => aqsi?.registers.find((row) => row.id === aqsiForm.id) ?? null, [aqsi, aqsiForm.id]);

  const load = useCallback(async () => {
    try {
      const [aqsiRes, telegramRes, rosskoRes] = await Promise.all([
        fetch("/api/integrations/aqsi", { cache: "no-store" }),
        fetch("/api/integrations/telegram-user", { cache: "no-store" }),
        fetch("/api/integrations/rossko", { cache: "no-store" }),
      ]);
      const aqsiData = await safeReadJson<AqsiStatus & { error?: string }>(aqsiRes);
      const telegramData = await safeReadJson<TelegramStatus & { error?: string }>(telegramRes);
      const rosskoData = await safeReadJson<{ configured?: boolean }>(rosskoRes);
      if (aqsiRes.ok && aqsiData) {
        setAqsi(aqsiData);
        setAqsiForm((current) => current.id ? current : aqsiData.registers[0] ? registerForm(aqsiData.registers[0]) : EMPTY_AQSI);
      }
      if (telegramRes.ok && telegramData) setTelegram(telegramData);
      if (rosskoRes.ok) setRosskoConfigured(rosskoData?.configured === true);
      if (canEditSecrets) {
        const activityRes = await fetch("/api/integrations/activity", { cache: "no-store" });
        const activityData = await safeReadJson<{ items?: IntegrationActivity[] }>(activityRes);
        if (activityRes.ok) setActivity(activityData?.items ?? []);
      }
    } catch {
      setMessage("Связь с сервером временно прервалась. Обновите статус и повторите действие.");
    }
  }, [canEditSecrets]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function saveAqsi() {
    setBusy("aqsi-save"); setMessage(null);
    try {
      const { apiKey, markingBypassPassword, enabled, ...nonSecretForm } = aqsiForm;
      const payload = canEditSecrets ? { ...nonSecretForm, apiKey, markingBypassPassword, enabled } : nonSecretForm;
      const response = await fetch("/api/integrations/aqsi", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await safeReadJson<AqsiStatus & { error?: string }>(response);
      if (response.ok && data) {
        setAqsi(data);
        const saved = data.registers.find((row) => row.id === aqsiForm.id) ?? data.registers.find((row) => row.name === aqsiForm.name) ?? data.registers[0];
        if (saved) setAqsiForm(registerForm(saved));
        setMessage("Настройки кассы AQSI сохранены для текущего филиала.");
      } else setMessage(data?.error ?? "Настройки AQSI не сохранены.");
    } catch {
      setMessage("Связь с сервером прервалась. Настройки AQSI не сохранены; повторите после восстановления соединения.");
    } finally {
      setBusy(null);
    }
  }

  async function testAqsi() {
    if (!aqsiForm.id && !aqsiForm.apiKey.trim()) { setMessage("Введите API-ключ AQSI для безопасной проверки."); return; }
    setBusy("aqsi-test"); setMessage(null);
    try {
      const response = await fetch("/api/integrations/aqsi/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...aqsiForm, registerId: aqsiForm.id || undefined, apiKey: aqsiForm.apiKey || undefined }) });
      const data = await safeReadJson<{ message?: string; error?: string; integration?: AqsiStatus; devices?: AqsiDevice[]; binding?: { deviceId?: string; shopId?: string; cashierId?: string } }>(response);
      if (data?.integration) setAqsi(data.integration);
      if (response.ok && data?.devices) {
        setAqsiDevices(data.devices);
        if (!aqsiForm.deviceId && data.binding?.deviceId) setAqsiForm((current) => ({ ...current, deviceId: data.binding!.deviceId ?? "", shopId: data.binding!.shopId ?? current.shopId }));
      }
      setMessage(response.ok ? data?.message ?? "AQSI отвечает." : data?.error ?? "Проверка AQSI не выполнена.");
      await load();
    } catch {
      setMessage("Связь с сервером прервалась во время проверки AQSI. Повторите после восстановления соединения.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnectAqsi() {
    if (!aqsiForm.id) return;
    setBusy("aqsi-disconnect"); setMessage(null);
    const response = await fetch("/api/integrations/aqsi", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: aqsiForm.id, disconnect: true }) });
    const data = await safeReadJson<AqsiStatus & { error?: string }>(response);
    if (response.ok && data) {
      setAqsi(data);
      const next = data.registers.find((row) => row.enabled && row.isDefault) ?? data.registers.find((row) => row.enabled) ?? data.registers[0];
      setAqsiForm(next ? registerForm(next) : EMPTY_AQSI);
      setMessage("Касса AQSI отключена. История фискализации сохранена.");
    } else setMessage(data?.error ?? "Касса AQSI не отключена.");
    setBusy(null);
  }

  async function retryFiscalization(id: string) {
    setBusy(`aqsi-retry:${id}`); setMessage(null);
    const response = await fetch(`/api/integrations/aqsi/fiscalizations/${encodeURIComponent(id)}/retry`, { method: "POST" });
    const data = await safeReadJson<{ pending?: boolean; error?: string }>(response);
    setMessage(response.ok ? (data?.pending ? "Повтор запущен; AQSI пока недоступен, запись останется в очереди." : "Фискализация успешно отправлена в AQSI.") : data?.error ?? "Повторная отправка не выполнена.");
    setBusy(null);
    await load();
  }

  async function saveTelegram() {
    const nativeForm = telegramCredentialsFormRef.current;
    const nativeValues = nativeForm ? new FormData(nativeForm) : null;
    const credentials = {
      apiId: String(nativeValues?.get("apiId") ?? telegramForm.apiId).trim(),
      apiHash: String(nativeValues?.get("apiHash") ?? telegramForm.apiHash).trim(),
    };
    if (!credentials.apiId || !credentials.apiHash) {
      setMessage("Введите API ID и API Hash Telegram в оба поля.");
      return;
    }
    if (!/^\d+$/.test(credentials.apiId) || Number(credentials.apiId) <= 0) {
      setMessage("API ID Telegram должен быть положительным числом.");
      return;
    }
    if (credentials.apiHash.length < 16) {
      setMessage("Проверьте API Hash Telegram: значение выглядит слишком коротким.");
      return;
    }
    setBusy("telegram-save"); setMessage(null);
    try {
      const response = await fetch("/api/integrations/telegram-user", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials) });
      const data = await safeReadJson<TelegramStatus & { error?: string }>(response);
      if (response.ok && data) {
        setTelegram(data); setTelegramForm({ apiId: "", apiHash: "" });
        setMessage("API-реквизиты Telegram сохранены. Теперь подключите рабочий аккаунт по QR.");
      } else setMessage(data?.error ?? "Настройки Telegram не сохранены.");
    } catch {
      setMessage("Связь с сервером прервалась. Реквизиты Telegram не сохранены; повторите после восстановления соединения.");
    } finally {
      setBusy(null);
    }
  }

  async function checkTelegram() {
    if (!telegram?.account?.id) return;
    setBusy("telegram-check"); setMessage(null);
    const response = await fetch("/api/messenger/telegram-user/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: telegram.account.id, limit: 5, force: true }),
    });
    const data = await safeReadJson<{ ok?: boolean; error?: string }>(response);
    setMessage(response.ok && data?.ok ? "Рабочий Telegram отвечает; синхронизация проверена." : data?.error ?? "Проверка Telegram не выполнена.");
    setBusy(null);
    await load();
  }

  async function disconnectTelegram() {
    if (!telegram?.account?.id) return;
    setBusy("telegram-disconnect"); setMessage(null);
    const response = await fetch("/api/messenger/telegram-user/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: telegram.account.id }),
    });
    const data = await safeReadJson<{ ok?: boolean; error?: string }>(response);
    setMessage(response.ok && data?.ok ? "Рабочий Telegram отключён. Диалоги и сообщения сохранены." : data?.error ?? "Telegram не отключён.");
    setBusy(null);
    await load();
  }

  const telegramReady = Boolean(telegram?.configured && telegram.account?.status === "connected");
  const configuredSteps = Number(Boolean(aqsi?.configured)) + Number(telegramReady) + Number(rosskoConfigured);
  const coreReady = organizationConfigured && employeesConfigured;
  const onboardingSteps = 1 + Number(organizationConfigured) + configuredSteps + Number(employeesConfigured) + Number(coreReady);
  const ownerNotifications = activity.filter((item) => item.action === "owner_notification");
  const auditItems = activity.filter((item) => item.action !== "owner_notification");

  return (
    <section className="eco-integration-group">
      <header><div><p className="eco-page-kicker">Филиал: {branchName}</p><h2>Рабочие интеграции</h2></div><span>{configuredSteps}/3 подключений готовы.</span></header>
      {onboardingSteps < 7 ? (
        <EcoCard>
          <div className="eco-card__head"><div><div className="eco-page-kicker">Мастер настройки нового филиала</div><h2>Готовность филиала по шагам</h2></div><EcoBadge tone="warning">{onboardingSteps}/7</EcoBadge></div>
          <ol className="eco-action-list">
            <li className="eco-action-link"><span>1.</span><span><strong>Основные данные филиала</strong><small>филиал «{branchName}» создан</small></span></li>
            <li className="eco-action-link"><span>2.</span><span><strong>Юридическая организация</strong><small>{organizationConfigured ? "настроена" : "не настроена"}</small></span></li>
            <li className="eco-action-link"><span>3.</span><span><strong>Кассы AQSI</strong><small>{aqsi?.configured ? "подключены" : "не подключены — можно пропустить"}</small></span></li>
            <li className="eco-action-link"><span>4.</span><span><strong>Рабочий Telegram</strong><small>{telegramReady ? "подключён" : "не подключён — можно пропустить"}</small></span></li>
            <li className="eco-action-link"><span>5.</span><span><strong>ROSSKO</strong><small>{rosskoConfigured ? "подключён" : "не подключён — можно пропустить"}</small></span></li>
            <li className="eco-action-link"><span>6.</span><span><strong>Сотрудники</strong><small>{employeesConfigured ? "добавлены" : "добавьте хотя бы одного сотрудника помимо владельца"}</small></span></li>
            <li className="eco-action-link"><span>7.</span><span><strong>Проверка готовности</strong><small>{coreReady ? "основные настройки готовы; пропущенные интеграции можно подключить позже" : "завершите организацию и сотрудников"}</small></span></li>
          </ol>
        </EcoCard>
      ) : null}
      {message ? <div className="eco-integration-note eco-integration-note--info"><CheckCircle2 size={16} /><span>{message}</span></div> : null}
      <div className="eco-grid eco-grid--2">
        <EcoCard>
          <div className="eco-card__head"><div><div className="eco-page-kicker">Кассы и фискализация</div><h2>AQSI</h2><p>Несколько касс на филиал; одна касса используется по умолчанию.</p></div><EcoBadge tone={aqsi?.configured ? "success" : "warning"} dot>{label(selected?.status ?? "not_configured", Boolean(aqsi?.configured))}</EcoBadge></div>
          {selected ? <div className="eco-integration-note eco-integration-note--info"><span>Последний успех: {dateTime(selected.lastSuccessAt)} · последняя ошибка: {dateTime(selected.lastErrorAt)}{selected.lastErrorMessage ? ` · ${selected.lastErrorMessage}` : ""}</span></div> : null}
          {aqsi?.pendingFiscalizations ? <div className="eco-form-error"><AlertTriangle size={16} /> Владельцу: {aqsi.pendingFiscalizations} фискализаций ожидают отправки или проверки.</div> : null}
          {aqsi?.alerts.map((alert) => (
            <div className="eco-integration-note eco-integration-note--warning" key={alert.id}>
              <AlertTriangle size={16} />
              <span>Отгрузка {alert.documentId}: {alert.errorMessage ?? "ошибка AQSI"} · попыток {alert.attempts}</span>
              <EcoButton type="button" variant="secondary" onClick={() => void retryFiscalization(alert.id)} disabled={busy !== null}>
                <RefreshCw size={14} />{busy === `aqsi-retry:${alert.id}` ? "Повторяем…" : "Повторить"}
              </EcoButton>
            </div>
          ))}
          <div className="eco-messenger-settings-actions">
            {aqsi?.registers.map((row) => <EcoButton key={row.id} type="button" variant={row.id === aqsiForm.id ? "secondary" : "ghost"} onClick={() => setAqsiForm(registerForm(row))}>{row.name}{row.isDefault ? " · основная" : ""}</EcoButton>)}
            {canEditSecrets ? <EcoButton type="button" variant="ghost" onClick={() => setAqsiForm({ ...EMPTY_AQSI, name: `Касса ${(aqsi?.registers.length ?? 0) + 1}`, isDefault: !(aqsi?.registers.length) })}><Plus size={15} />Добавить кассу</EcoButton> : null}
          </div>
          <div className="eco-tbank-settings-grid">
            <label><span>Название кассы</span><EcoInput value={aqsiForm.name} onChange={(e) => setAqsiForm((v) => ({ ...v, name: e.target.value }))} /></label>
            <label><span>API-ключ</span><EcoInput type="password" autoComplete="off" value={aqsiForm.apiKey} disabled={!canEditSecrets} placeholder={selected?.apiKeyConfigured ? "сохранён: ••••••••" : "вставьте ключ"} onChange={(e) => setAqsiForm((v) => ({ ...v, apiKey: e.target.value }))} /></label>
            <label><span>Устройство</span>{aqsiDevices.length ? <EcoSelect value={aqsiForm.deviceId} onChange={(e) => { const device = aqsiDevices.find((row) => row.id === e.target.value); setAqsiForm((v) => ({ ...v, deviceId: e.target.value, shopId: device?.shopId ?? v.shopId })); }}><option value="">Выберите устройство AQSI</option>{aqsiDevices.map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}</EcoSelect> : <EcoInput value={aqsiForm.deviceId} placeholder="загрузится после проверки" onChange={(e) => setAqsiForm((v) => ({ ...v, deviceId: e.target.value }))} />}</label>
            <label><span>Магазин</span><EcoInput value={aqsiForm.shopId} onChange={(e) => setAqsiForm((v) => ({ ...v, shopId: e.target.value }))} /></label>
            <label><span>Кассир</span><EcoInput value={aqsiForm.cashierId} placeholder="необязательно · UUID из AQSI" onChange={(e) => setAqsiForm((v) => ({ ...v, cashierId: e.target.value }))} /></label>
            <label><span>Пароль пропуска маркировки</span><EcoInput type="password" autoComplete="off" value={aqsiForm.markingBypassPassword} disabled={!canEditSecrets} placeholder={selected?.markingBypassPasswordConfigured ? "сохранён: ••••••••" : "не задан"} onChange={(e) => setAqsiForm((v) => ({ ...v, markingBypassPassword: e.target.value }))} /></label>
          </div>
          <details>
            <summary>Расширенные адреса API</summary>
            <div className="eco-tbank-settings-grid">
              <label><span>Базовый адрес</span><EcoInput value={aqsiForm.baseUrl} onChange={(e) => setAqsiForm((v) => ({ ...v, baseUrl: e.target.value }))} /></label>
              <label><span>Путь чеков</span><EcoInput value={aqsiForm.ordersPath} onChange={(e) => setAqsiForm((v) => ({ ...v, ordersPath: e.target.value }))} /></label>
              <label><span>Путь отложенных заказов</span><EcoInput value={aqsiForm.pendingOrderPath} onChange={(e) => setAqsiForm((v) => ({ ...v, pendingOrderPath: e.target.value }))} /></label>
              <label><span>Путь устройств</span><EcoInput value={aqsiForm.devicesPath} onChange={(e) => setAqsiForm((v) => ({ ...v, devicesPath: e.target.value }))} /></label>
            </div>
          </details>
          <div className="eco-messenger-settings-actions">
            <label className="eco-check-row"><input type="checkbox" checked={aqsiForm.isDefault} onChange={(e) => setAqsiForm((v) => ({ ...v, isDefault: e.target.checked }))} /><span>Основная касса филиала</span></label>
            <EcoButton type="button" onClick={() => void saveAqsi()} disabled={busy !== null || (!canEditSecrets && !aqsiForm.id)}><Save size={15} />{busy === "aqsi-save" ? "Сохраняем…" : "Сохранить"}</EcoButton>
            <EcoButton type="button" variant="secondary" onClick={() => void testAqsi()} disabled={busy !== null || (!aqsiForm.id && (!canEditSecrets || !aqsiForm.apiKey.trim()))}><TestTube2 size={15} />{busy === "aqsi-test" ? "Проверяем…" : "Проверить и загрузить устройства"}</EcoButton>
            {canEditSecrets && selected?.enabled ? <EcoButton type="button" variant="ghost" onClick={() => void disconnectAqsi()} disabled={busy !== null}><Unplug size={15} />{busy === "aqsi-disconnect" ? "Отключаем…" : "Отключить"}</EcoButton> : null}
          </div>
        </EcoCard>

        <EcoCard>
          <div className="eco-card__head"><div><div className="eco-page-kicker">Рабочий аккаунт</div><h2>Telegram по QR</h2><p>Один рабочий user account на филиал. История сохраняется при отключении.</p></div><EcoBadge tone={telegram?.account?.status === "connected" ? "success" : telegram?.configured ? "warning" : "neutral"} dot>{label(telegram?.status ?? "not_configured", Boolean(telegram?.configured))}</EcoBadge></div>
          <form ref={telegramCredentialsFormRef} onSubmit={(event) => { event.preventDefault(); void saveTelegram(); }}>
            <div className="eco-tbank-settings-grid">
              <label><span>API ID</span><EcoInput name="apiId" type="password" autoComplete="off" value={telegramForm.apiId} disabled={!canEditSecrets} placeholder={telegram?.apiIdConfigured ? "сохранён: ••••••••" : "my.telegram.org"} onChange={(e) => setTelegramForm((v) => ({ ...v, apiId: e.target.value }))} /></label>
              <label><span>API Hash</span><EcoInput name="apiHash" type="password" autoComplete="off" value={telegramForm.apiHash} disabled={!canEditSecrets} placeholder={telegram?.apiHashConfigured ? "сохранён: ••••••••" : "my.telegram.org"} onChange={(e) => setTelegramForm((v) => ({ ...v, apiHash: e.target.value }))} /></label>
            </div>
            {telegram?.account ? <div className="eco-integration-note eco-integration-note--info"><span>{telegram.account.displayName} · {telegram.account.phoneMasked ?? telegram.account.username ?? "номер скрыт"}</span></div> : null}
            {telegram?.account ? <div className="eco-integration-note eco-integration-note--info"><span>Последний успех: {dateTime(telegram.account.lastSyncAt)} · последняя ошибка: {telegram.account.lastError ? `${dateTime(telegram.account.updatedAt)} · ${telegram.account.lastError}` : "—"}</span></div> : null}
            <div className="eco-messenger-settings-actions">
              {canEditSecrets ? <EcoButton type="submit" disabled={busy !== null}><Save size={15} />{busy === "telegram-save" ? "Сохраняем…" : "Сохранить реквизиты"}</EcoButton> : null}
              {telegram?.account?.status === "connected" ? <EcoButton type="button" variant="secondary" onClick={() => void checkTelegram()} disabled={busy !== null}><TestTube2 size={15} />{busy === "telegram-check" ? "Проверяем…" : "Проверить"}</EcoButton> : null}
              {canEditSecrets && telegram?.account?.status !== "disconnected" ? <EcoButton type="button" variant="ghost" onClick={() => void disconnectTelegram()} disabled={busy !== null}><Unplug size={15} />{busy === "telegram-disconnect" ? "Отключаем…" : "Отключить"}</EcoButton> : null}
              <Link href="/cabinet/integrations/messenger" className="eco-btn eco-btn--secondary"><QrCode size={15} />Открыть подключение по QR</Link>
            </div>
          </form>
        </EcoCard>
      </div>
      {canEditSecrets ? (
        <EcoCard>
          <div className="eco-card__head"><div><div className="eco-page-kicker">Только владельцу</div><h2>Уведомления и журнал изменений</h2><p>Секретные значения и ответы провайдеров в журнал не попадают.</p></div><EcoBadge tone={ownerNotifications.length ? "warning" : "neutral"}>{ownerNotifications.length} уведомлений</EcoBadge></div>
          {ownerNotifications.map((item) => <div className="eco-integration-note eco-integration-note--warning" key={item.id}><AlertTriangle size={16} /><span>{item.message} · {dateTime(item.createdAt)}</span></div>)}
          <details>
            <summary>Показать последние изменения ({auditItems.length})</summary>
            <div className="eco-action-list">
              {auditItems.map((item) => <div className="eco-action-link" key={item.id}><span>{item.channel === "telegram_user" ? "Telegram" : item.channel?.toUpperCase()}</span><span><strong>{actionLabel(item.action)}</strong><small>{item.actorName} · {dateTime(item.createdAt)} · {item.status === "error" ? "ошибка" : "успешно"}</small></span></div>)}
            </div>
          </details>
        </EcoCard>
      ) : null}
    </section>
  );
}
