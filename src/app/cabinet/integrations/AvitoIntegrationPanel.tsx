"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Circle, FileCheck2, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { EcoBadge, EcoButton, EcoInput } from "@/components/platform/EcoUI";
import AvitoSettingsForm from "@/components/integrations/AvitoSettingsForm";
import { avitoLinkStatus } from "@/lib/avito-autoload/feed-state";
import type { AvitoIntegrationData, AvitoSettings } from "@/lib/avito-autoload/types";
import settingsStyles from "@/app/warehouse/avito/avito.module.css";
import styles from "./avito-integration.module.css";

const ENDPOINT = "/api/integrations/avito";
type ApiAction = "test" | "connect" | "upload" | "reports";

async function request<T>(body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: body ? "POST" : "GET", cache: "no-store", signal,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({ error: "Не удалось прочитать ответ сервера" }));
  if (!response.ok) throw new Error(data.error ?? "Не удалось выполнить действие Авито");
  return data as T;
}

function message(error: unknown) { return error instanceof Error ? error.message : "Не удалось выполнить действие Авито"; }
function checkedAt(value: string | null) {
  return value ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Kaliningrad", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Проверка ещё не выполнялась";
}

export default function AvitoIntegrationPanel({ branchName, canEditSecrets, refreshVersion = 0 }: { branchName: string; canEditSecrets: boolean; refreshVersion?: number }) {
  const [data, setData] = useState<AvitoIntegrationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const readVersion = useRef(0);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState("");
  const [apiError, setApiError] = useState("");
  const [notice, setNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsVersion, setSettingsVersion] = useState(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++readVersion.current;
    const next = await request<AvitoIntegrationData>(undefined, signal);
    if (version === readVersion.current && mounted.current) setData(next);
    return next;
  }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    refresh(controller.signal).then(() => { setLoading(false); setError(""); }).catch((failure) => {
      if (!controller.signal.aborted) { setLoading(false); setError(message(failure)); }
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [refresh, refreshVersion]);

  const settings = data?.settings;
  const hasKeys = Boolean(settings?.clientIdConfigured && settings.clientSecretConfigured);
  const owner = data?.canEditSecrets ?? canEditSecrets;
  const credentialsDirty = Boolean(clientId.trim() || clientSecret.trim());
  const connected = hasKeys && settings?.connection.status === "ok";
  const apiLabel = connected ? "API подключён" : settings?.connection.status === "error" ? "API: ошибка доступа" : hasKeys ? "API: нужна проверка" : "API не подключён · необязательно";

  const linkStatus = avitoLinkStatus(settings);

  async function run(label: string, operation: () => Promise<string>) {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(label); setError(""); setApiError(""); setNotice("");
    let success = false;
    try { setNotice(await operation()); success = true; }
    catch (failure) { (["credentials", "test", "connect", "upload", "reports"].includes(label) ? setApiError : setError)(message(failure)); }
    try { if (mounted.current) await refresh(); }
    catch (failure) { setError((current) => current || `Не удалось обновить статус. ${message(failure)}`); }
    finally { busyRef.current = false; setBusy(null); }
    return success;
  }

  async function saveAndCheck() {
    await run("credentials", async () => {
      await request({ operation: "credentials", clientId, clientSecret, publicBaseUrl: window.location.protocol === "https:" ? window.location.origin : "" });
      if (!mounted.current) return "Ключи API Авито сохранены";
      // Clear the form only after the server confirms encrypted persistence.
      setClientId(""); setClientSecret("");
      try {
        const result = await request<{ message: string }>({ operation: "api", action: "test" });
        return result.message;
      } catch (failure) { throw new Error(`Ключи сохранены. ${message(failure)}`); }
    });
  }

  const api = (action: ApiAction) => run(action, async () => {
    const result = await request<{ message: string }>({ operation: "api", action });
    return result.message;
  });

  async function saveSettings(next: AvitoSettings) {
    const success = await run("settings", async () => {
      const result = await request<{ message: string }>({ operation: "settings", settings: next });
      return result.message;
    });
    if (success) setSettingsVersion((current) => current + 1);
    return success;
  }

  return <section id="avito" className={styles.panel} aria-labelledby="avito-integration-title">
    <header className={styles.header}>
      <div><h2 id="avito-integration-title">Авито · товары</h2><p>Автовыгрузка по XML-ссылке для филиала <strong>{data?.branchName ?? branchName}</strong>.</p></div>
      <EcoBadge tone={linkStatus.tone} dot>{linkStatus.label}</EcoBadge>
    </header>

    {error && <div role="alert" className={styles.error}>{error}</div>}
    {notice && <div role="status" className={styles.notice}>{notice}</div>}
    {!data && loading ? <div className={styles.skeleton} role="status" aria-label="Загружаем подключение Авито"><div /><div /><div /></div> : !data ? <EcoButton type="button" onClick={() => { setLoading(true); refresh().then(() => { setLoading(false); setError(""); }).catch((failure) => { setError(message(failure)); setLoading(false); }); }}><RefreshCw size={15} /> Повторить загрузку</EcoButton> : <>
      <div className={styles.linkSetup}>
        <div><h3>Подготовка автовыгрузки</h3><p className={styles.help}>API-ключи не требуются. Сохраните настройки, сформируйте первый файл и добавьте XML-ссылку в кабинет нужного аккаунта Авито. Там включите загрузку по расписанию.</p></div>
        <ul>
          <li>{settings!.lastExportAt ? <CheckCircle2 size={17} /> : <Circle size={17} />}<span>{settings!.lastExportAt ? `Файл подготовлен: ${data.reviewedAds} объявлений` : "Первый файл ещё не подготовлен"}</span><Link href="/warehouse/avito">Подготовить товары <ArrowRight size={13} /></Link></li>
          <li>{settings!.enabled && settings!.feedUrl ? <CheckCircle2 size={17} /> : <Circle size={17} />}<span>{settings!.enabled && settings!.feedUrl ? "Выдача файла по ссылке включена" : "Выдачу файла нужно включить в настройках"}</span></li>
        </ul>
        <div className={styles.actions}><Link className="eco-btn" href="/warehouse/avito?tab=history"><FileCheck2 size={16} /> История и отчёты</Link></div>
        {settings!.feedUrl && <><label className={styles.help} htmlFor="avito-integration-feed-url">XML-ссылка для кабинета Авито</label><textarea id="avito-integration-feed-url" className={settingsStyles.feedUrl} readOnly rows={3} value={settings!.feedUrl} /><EcoButton type="button" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(settings!.feedUrl!); setNotice("XML-ссылка скопирована. Добавьте её в кабинет Авито и настройте расписание."); } catch { setError("Выделите ссылку и скопируйте её вручную"); } }}>Скопировать XML-ссылку</EcoButton></>}
        <p className={styles.help}>Статус XML показывает настройки выдачи файла в CRM. Получение файла и публикацию подтверждает Авито.</p>
      </div>

      <details className={styles.settings} open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)}>
        <summary>Настройки выгрузки и ссылка на файл</summary>
        {settingsOpen && <div className={settingsStyles.workspace}><AvitoSettingsForm key={settingsVersion} settings={settings!} stores={data.stores} canEditSecrets={owner} showCredentials={false} busy={Boolean(busy)} onSave={(next) => saveSettings(next)} onApi={api} onCopyNotice={setNotice} /></div>}
      </details>
      <section className={styles.workflow} aria-label="Необязательное API Авито">
        <EcoBadge tone={connected ? "success" : settings?.connection.status === "error" ? "warning" : "neutral"}>{apiLabel}</EcoBadge>
        {apiError && <div role="alert" className={styles.error}><strong>Ошибка API Авито.</strong> {apiError}<br />Она не отключает XML-ссылку. Недоступны только функции API, для которых Авито отклонил запрос.</div>}
        <form className={styles.credentials} onSubmit={(event) => { event.preventDefault(); if (owner && credentialsDirty && !busyRef.current) void saveAndCheck(); }}>
        <fieldset disabled={Boolean(busy)}><legend>API Авито — необязательно</legend>
          <p className={styles.help}>Ключи нужны только для отчётов, подключения ссылки и ручного запуска из CRM. Для выгрузки по ссылке они не требуются.</p>
          <div className={styles.keyFields}>
            <label><span>Client ID {settings?.clientIdConfigured && <EcoBadge tone="success">Сохранён</EcoBadge>}</span><EcoInput name="avito-client-id" type="password" autoComplete="off" maxLength={1000} required={!settings?.clientIdConfigured} disabled={!owner} value={clientId} placeholder={settings?.clientIdConfigured ? "Оставьте пустым, чтобы сохранить" : "Введите Client ID"} onChange={(event) => setClientId(event.target.value)} /></label>
            <label><span>Client Secret {settings?.clientSecretConfigured && <EcoBadge tone="success">Сохранён</EcoBadge>}</span><EcoInput name="avito-client-secret" type="password" autoComplete="new-password" maxLength={2000} required={!settings?.clientSecretConfigured} disabled={!owner} value={clientSecret} placeholder={settings?.clientSecretConfigured ? "Оставьте пустым, чтобы сохранить" : "Введите Client Secret"} onChange={(event) => setClientSecret(event.target.value)} /></label>
          </div>
          <div className={styles.actions}>
            {owner && <EcoButton type="submit" variant="primary" disabled={!credentialsDirty || Boolean(busy)}>{busy === "credentials" ? <Loader2 size={16} className={styles.spinning} /> : <ShieldCheck size={16} />} Сохранить и проверить</EcoButton>}
            <EcoButton type="button" disabled={!hasKeys || credentialsDirty || Boolean(busy)} onClick={() => void api("test")}><RefreshCw size={16} className={busy === "test" ? styles.spinning : ""} /> Проверить подключение</EcoButton>
          </div>
          {!owner && <p className={styles.help}>Ключи подключения может сохранить или заменить владелец бизнес-группы.</p>}
          {credentialsDirty && hasKeys && <p className={styles.help}>Новые ключи применятся после нажатия «Сохранить и проверить».</p>}
        </fieldset>
      </form>

      <div className={styles.connectionMeta}>
        <span>{checkedAt(settings!.connection.checkedAt)}</span>
        {settings!.connection.accountId && <span>Аккаунт Авито №{settings!.connection.accountId}</span>}
        {settings!.connection.message && <span>{settings!.connection.message}</span>}
      </div>

        <p className={styles.help}>Если Авито уже настроен на загрузку по ссылке, повторно подключать API не нужно. Принятие и публикацию объявлений проверяйте в кабинете Авито.</p>
        <EcoButton type="button" disabled={!hasKeys || credentialsDirty || Boolean(busy)} onClick={() => void api("reports")}><RefreshCw size={15} className={busy === "reports" ? styles.spinning : ""} /> Получить отчёт через API</EcoButton>
      </section>
    </>}
  </section>;
}
