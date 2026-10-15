"use client";

import { useState } from "react";
import { ArrowRight, Copy, ExternalLink, Loader2, RefreshCw, Save } from "lucide-react";
import { EcoBadge, EcoButton, EcoInput, EcoSelect } from "@/components/platform/EcoUI";
import { AVITO_CATALOG_VERSION, AVITO_DEFAULT_SETTINGS } from "@/lib/avito-autoload/domain";
import { avitoFeedBlocker } from "@/lib/avito-autoload/feed-state";
import type { AvitoSettings, AvitoSettingsView } from "@/lib/avito-autoload/types";
import styles from "@/app/warehouse/avito/avito.module.css";
import AvitoContentSettings from "./AvitoContentSettings";

function dateLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Kaliningrad", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function settingsOnly(view: AvitoSettingsView): AvitoSettings {
  return Object.fromEntries(Object.keys(AVITO_DEFAULT_SETTINGS).map((key) => [key, view[key as keyof AvitoSettings]])) as AvitoSettings;
}

export default function AvitoSettingsForm({ settings, stores, canEditSecrets, busy, onSave, onApi, onCopyNotice, showCredentials = true }: {
  settings: AvitoSettingsView; stores: { id: string; name: string }[]; canEditSecrets: boolean; busy: boolean; showCredentials?: boolean;
  onSave: (settings: AvitoSettings, clientId: string, clientSecret: string) => Promise<boolean>; onApi: (action: "test" | "connect" | "upload") => Promise<boolean>; onCopyNotice: (message: string) => void;
}) {
  const [draft, setDraft] = useState<AvitoSettings>(() => settingsOnly(settings));
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(settingsOnly(settings)) || Boolean(clientId || clientSecret);
  const hasKeys = settings.clientIdConfigured && settings.clientSecretConfigured;
  const feedBlocker = avitoFeedBlocker(settings.enabled, Boolean(settings.lastExportAt));
  const update = <K extends keyof AvitoSettings>(key: K, value: AvitoSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));

  return <div className={styles.settingsLayout}>
    <form className={styles.settingsForm} onSubmit={(event) => { event.preventDefault(); void onSave(draft, clientId, clientSecret); }}>
      <fieldset disabled={busy}><legend>Профиль выгрузки</legend><p className={styles.help}>Один аккаунт Авито для текущего филиала. Файл обновляется из карточек и остатков при запросе Авито.</p>
        <div className={styles.twoColumns}><label className={styles.field}><span>Название подключения</span><EcoInput required maxLength={100} value={draft.name} onChange={(event) => update("name", event.target.value)} /></label><label className={styles.field}><span>Публичный адрес платформы</span><EcoInput type="url" placeholder="https://crm.example.ru" value={draft.publicBaseUrl} onChange={(event) => update("publicBaseUrl", event.target.value)} /><small>Домен, по которому Авито сможет получить файл и фотографии.</small></label></div>
        <label className={styles.checkField}><input type="checkbox" checked={draft.enabled} onChange={(event) => update("enabled", event.target.checked)} /><span><strong>Разрешить автовыгрузку по ссылке</strong><small>Для запуска сначала сохраните настройки и сформируйте первый файл.</small></span></label>
      </fieldset>
      <fieldset disabled={busy}><legend>Адрес и контакты</legend><p className={styles.help}>У каждого филиала свой аккаунт Авито и адрес объявления. Добавьте адрес этого филиала в соответствующий профиль Авито.</p>
        <label className={styles.field}><span>Откуда брать адрес</span><EcoSelect value={draft.addressSource} onChange={(event) => { const addressSource = event.target.value as AvitoSettings["addressSource"]; setDraft((current) => ({ ...current, addressSource, address: addressSource === "branch" ? settings.branchAddress : current.address })); }}><option value="branch">Из настроек текущего филиала</option><option value="manual">Отдельный адрес для Авито</option></EcoSelect></label>
        <label className={styles.field}><span>Адрес продажи</span><EcoInput maxLength={256} readOnly={draft.addressSource === "branch"} value={draft.address} onChange={(event) => update("address", event.target.value)} /><small>{draft.addressSource === "branch" ? settings.branchAddress ? "Этот адрес автоматически подставляется во все объявления филиала." : "Адрес филиала не заполнен. Выберите отдельный адрес для Авито и укажите его один раз." : "Укажите полный адрес один раз для всех объявлений этого филиала."}</small></label>
        <div className={styles.twoColumns}><label className={styles.field}><span>Идентификатор адреса Авито</span><EcoInput inputMode="numeric" maxLength={30} value={draft.sellerAddressId} onChange={(event) => update("sellerAddressId", event.target.value)} /><small>Если заполнен, используется вместо полного адреса.</small></label><label className={styles.field}><span>Контактное лицо</span><EcoInput maxLength={40} value={draft.contactPerson} onChange={(event) => update("contactPerson", event.target.value)} /></label></div>
        <div className={styles.twoColumns}><label className={styles.field}><span>Телефон</span><EcoInput type="tel" maxLength={40} value={draft.phone} onChange={(event) => update("phone", event.target.value)} /></label><label className={styles.field}><span>Способ связи</span><EcoSelect value={draft.contactMethod} onChange={(event) => update("contactMethod", event.target.value as AvitoSettings["contactMethod"])}><option>По телефону и в сообщениях</option><option>По телефону</option><option>В сообщениях</option></EcoSelect></label></div>
      </fieldset>
      <AvitoContentSettings settings={draft} busy={busy} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} />
      <fieldset disabled={busy}><legend>Остатки и размещение</legend>
        <p className={styles.help}>Выгружаются только канистры 4 и 5 л. Другие объёмы и масло на розлив исключены. Учитывается доступное количество после резервов. Если склады не выбраны, используются все действующие склады филиала.</p>
        <div className={styles.storeList}>{stores.length ? stores.map((store) => <label className={styles.checkField} key={store.id}><input type="checkbox" checked={draft.storeIds.includes(store.id)} onChange={(event) => update("storeIds", event.target.checked ? [...draft.storeIds, store.id] : draft.storeIds.filter((id) => id !== store.id))} /><span>{store.name}</span></label>) : <p className={styles.help}>Действующих складов пока нет.</p>}</div>
        <label className={styles.checkField}><input type="checkbox" checked={draft.onlyInStock} onChange={(event) => update("onlyInStock", event.target.checked)} /><span><strong>Исключать товары без доступного остатка</strong><small>Авито снимет исключённые объявления после обработки обновлённого файла.</small></span></label>
        {draft.onlyInStock && <label className={styles.field}><span>Остаток, который сохраняем для сервиса</span><EcoInput type="number" min={0} step="0.001" value={draft.stockBuffer} onChange={(event) => update("stockBuffer", event.target.value === "" ? 0 : Number(event.target.value))} /><small>Объявление включается, когда доступное количество больше этого значения. </small></label>}
        <label className={styles.field}><span>Оплата размещения</span><EcoSelect value={draft.listingFee} onChange={(event) => update("listingFee", event.target.value as AvitoSettings["listingFee"])}><option value="Package">Только из оплаченного пакета</option><option value="PackageBBL">Из пакета, иначе из кошелька Авито</option><option value="BBL">Только разовое размещение из кошелька</option></EcoSelect><small>Продвижение в первой версии выключено. Расписание обработки настраивается в кабинете Авито.</small></label>
      </fieldset>
      {showCredentials && <fieldset disabled={busy}><legend>API Авито</legend><p className={styles.help}>API нужен для запуска обработки файла и получения отчётов. Ссылку на файл также можно добавить в кабинете Авито вручную.</p>
        <div className={styles.twoColumns}><label className={styles.field}><span>Client ID {settings.clientIdConfigured && <EcoBadge tone="success">Сохранён</EcoBadge>}</span><EcoInput type="password" autoComplete="off" value={clientId} disabled={!canEditSecrets} placeholder={settings.clientIdConfigured ? "Оставьте пустым, чтобы сохранить" : "Ключ подключения"} onChange={(event) => setClientId(event.target.value)} /></label><label className={styles.field}><span>Client Secret {settings.clientSecretConfigured && <EcoBadge tone="success">Сохранён</EcoBadge>}</span><EcoInput type="password" autoComplete="new-password" value={clientSecret} disabled={!canEditSecrets} placeholder={settings.clientSecretConfigured ? "Оставьте пустым, чтобы сохранить" : "Секрет подключения"} onChange={(event) => setClientSecret(event.target.value)} /></label></div>
        {!canEditSecrets && <p className={styles.help}>Ключи подключения сохраняет владелец бизнес-группы.</p>}
      </fieldset>}
      <div className={styles.settingsSave}><EcoButton type="submit" variant="primary" disabled={busy || settings.configured && !dirty}>{busy ? <Loader2 size={16} className={styles.spinning} /> : <Save size={16} />} Сохранить настройки</EcoButton><span>Настройки принадлежат этому филиалу.</span></div>
    </form>
    <aside className={styles.connectionPane}><h2>Подключение к Авито</h2>
      <EcoBadge tone={settings.connection.status === "ok" ? "success" : settings.connection.status === "error" ? "danger" : "neutral"} dot>{settings.connection.status === "ok" ? "API доступен" : settings.connection.status === "error" ? "Ошибка подключения" : "API ещё не проверен"}</EcoBadge>
      {settings.connection.message && <p>{settings.connection.message}</p>}
      {settings.connection.checkedAt && <small>Проверено {dateLabel(settings.connection.checkedAt)}</small>}
      {settings.connection.accountId && <small>Аккаунт Авито №{settings.connection.accountId}</small>}
      <EcoButton type="button" disabled={busy || dirty || !hasKeys} onClick={() => void onApi("test")}><RefreshCw size={15} /> Проверить подключение</EcoButton>
      <h3>Ссылка XML для автозагрузки</h3><p className={styles.help}>Для Авито используйте XML. Если ранее добавили ссылку с окончанием feed.csv, замените её этой ссылкой. ID товаров сохраняются.</p>
      <EcoBadge tone={feedBlocker ? "warning" : "neutral"}>{feedBlocker ? "Файл не выдаётся" : "Выдача файла включена"}</EcoBadge>
      {feedBlocker && <p role="status">{feedBlocker.message}</p>}
      {settings.feedUrl ? <><textarea className={styles.feedUrl} readOnly rows={4} aria-label="Ссылка XML для автозагрузки" value={settings.feedUrl} onFocus={(event) => event.target.select()} /><EcoButton size="sm" onClick={async () => { try { await navigator.clipboard.writeText(settings.feedUrl!); onCopyNotice("Ссылка скопирована"); } catch { onCopyNotice("Выделите ссылку и скопируйте её вручную"); } }}><Copy size={15} /> Скопировать ссылку</EcoButton></> : <p>Ссылка появится после сохранения публичного адреса платформы.</p>}
      <p className={styles.help}>Ссылка предоставляет доступ к выгружаемым товарам и выбранным фотографиям.{!feedBlocker && " Добавьте её в свой профиль автозагрузки Авито."}</p>
      <EcoButton type="button" disabled={busy || dirty || !hasKeys || !settings.enabled || !settings.lastExportAt} onClick={() => void onApi("connect")}><ExternalLink size={15} /> Подключить файл к Авито</EcoButton>
      <EcoButton type="button" disabled={busy || dirty || !hasKeys || !settings.enabled || !settings.lastExportAt} onClick={() => void onApi("upload")}><ArrowRight size={15} /> Запросить обработку файла</EcoButton>
      {dirty && <p className={styles.help}>Сначала сохраните изменения настроек.</p>}
      <p className={styles.help}>Запрос обработки ещё не подтверждает публикацию. Проверяйте результат во вкладке «История загрузок».</p>
      <hr /><small>Справочники Авито от {AVITO_CATALOG_VERSION.split("-").reverse().join(".")}. Значения ACEA, API, ATF и OEM дополнительно проверяет площадка.</small>
    </aside>
  </div>;
}
