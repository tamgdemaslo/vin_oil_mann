"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { isLiterSaleUnit } from "@/lib/product-marking";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, FileCheck2, ImagePlus, Loader2, RefreshCw, Save, Search, Settings2, TriangleAlert, X } from "lucide-react";
import { EcoBadge, EcoButton, EcoInput, EcoSelect } from "@/components/platform/EcoUI";
import { AVITO_TYPE_LABELS, avitoCatalog, avitoRemoteLabel, buildAvitoListing } from "@/lib/avito-autoload/domain";
import type { AvitoFeedStats, AvitoHistoryItem, AvitoListing, AvitoOverrides, AvitoSettings, AvitoWorkspaceData } from "@/lib/avito-autoload/types";
import AvitoSettingsForm from "@/components/integrations/AvitoSettingsForm";
import styles from "./avito.module.css";

type Tab = "products" | "settings" | "history";
type View = "all" | "selected" | "errors" | "ready" | "published";
type ActionResult = { message?: string; downloadUrl?: string; stats?: AvitoFeedStats };

class RequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

async function request<T>(url: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET", cache: "no-store", signal,
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({ error: "Сервер вернул ответ неизвестного формата" }));
  if (!response.ok) throw new RequestError(data.error ?? "Не удалось выполнить запрос", data.code);
  return data as T;
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Kaliningrad", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function money(value: number | null) { return value === null ? "Не задана" : `${new Intl.NumberFormat("ru-RU").format(value)} ₽`; }
function amount(value: number) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value); }
function errorCount(value: number) { const forms = { one: "ошибка", few: "ошибки", many: "ошибок", other: "ошибок", zero: "ошибок", two: "ошибки" }; return `${value} ${forms[new Intl.PluralRules("ru").select(value)]}`; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Не удалось выполнить действие"; }

const historyLabels: Record<string, string> = {
  settings_saved: "Настройки", listing_saved: "Объявление", selection_saved: "Выбор товаров", feed_generated: "Файл сформирован",
  feed_fetched: "Файл получен Авито", feed_failed: "Выгрузка остановлена", connection_checked: "Подключение проверено",
  feed_connected: "Файл подключён", upload_requested: "Загрузка запрошена", report_received: "Отчёт Авито",
  test_failed: "Ошибка подключения", connect_failed: "Ошибка подключения файла", upload_failed: "Ошибка запуска", reports_failed: "Ошибка получения отчёта",
};

export default function AvitoWorkspace({ branchName, canEdit, canEditSecrets, initialTab = "products", initialData }: {
  branchName: string; canEdit: boolean; canEditSecrets: boolean; initialTab?: Tab; initialData?: AvitoWorkspaceData;
}) {
  const [data, setData] = useState<AvitoWorkspaceData | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<View>("all");
  const [type, setType] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const next = await request<AvitoWorkspaceData>(`/api/avito-autoload?search=${encodeURIComponent(search)}&offset=${offset}&type=${type}&view=${view}`, undefined, signal);
    setData(next);
    return next;
  }, [search, offset, type, view]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchDraft), 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal).then(() => { setLoading(false); setError(""); }).catch((failure) => {
      if (!controller.signal.aborted) { setError(errorMessage(failure)); setLoading(false); }
    });
    return () => controller.abort();
  }, [refresh]);

  const perform = async (action: string, payload: Record<string, unknown> = {}): Promise<boolean> => {
    if (busy) return false;
    setBusy(action); setError(""); setNotice(""); setDownloadUrl(null);
    try {
      const result = await request<ActionResult>("/api/avito-autoload", { operation: action, ...payload });
      setNotice(result.message ?? (result.downloadUrl ? `Файл готов: ${result.stats?.included ?? 0} объявлений` : "Изменения сохранены"));
      setDownloadUrl(result.downloadUrl ?? null);
      await refresh();
      return true;
    } catch (failure) { setError(errorMessage(failure)); return false; }
    finally { setBusy(null); }
  };

  const filtered = useMemo(() => (data?.products ?? []).filter((item) => {
    if (type !== "all" && item.type !== type) return false;
    const invalid = item.issues.some((issue) => issue.severity === "error");
    return view === "all" || view === "selected" && item.enabled || view === "errors" && invalid
      || view === "ready" && !invalid && !item.archived || view === "published" && ["active", "old"].includes(item.remote?.status ?? "");
  }), [data, type, view]);
  const editing = data?.products.find((item) => item.id === editingId) ?? null;
  const editable = data?.canEdit ?? canEdit;
  const tabButton = (value: Tab, label: string) => <button type="button" role="tab" aria-selected={tab === value} aria-controls={`avito-${value}`} id={`avito-tab-${value}`} className={tab === value ? styles.activeTab : ""} onClick={() => { setTab(value); setEditingId(null); }} key={value}>{label}</button>;
  const closeEditor = () => { setEditingId(null); requestAnimationFrame(() => opener.current?.focus()); };

  return <div className={styles.workspace}>
    <header className={styles.header}>
      <div>
        <div className="eco-page-crumbs"><Link href="/">Главная</Link><span className="sep">/</span><Link href="/inventory/products">Склад</Link><span className="sep">/</span><span className="cur">Авито</span></div>
        <div className={styles.titleRow}><h1>Авито</h1><EcoBadge tone={data?.settings.enabled ? "success" : "neutral"} dot>{data?.settings.enabled ? "Автовыгрузка включена" : "Автовыгрузка выключена"}</EcoBadge></div>
        <p>Объявления из товаров филиала <strong>{data?.branchName ?? branchName}</strong></p>
      </div>
      <div className={styles.headerActions}>
        <EcoButton type="button" disabled={Boolean(busy) || loading} onClick={() => { setBusy("refresh"); setError(""); refresh().catch((failure) => setError(errorMessage(failure))).finally(() => setBusy(null)); }}><RefreshCw size={15} className={busy === "refresh" ? styles.spinning : ""} /> Обновить</EcoButton>
        {editable && <EcoButton variant="primary" type="button" disabled={!data || Boolean(busy) || data.stats.invalid > 0} onClick={() => setReviewOpen(true)} title={data?.stats.invalid ? "Исправьте ошибки выбранных объявлений" : undefined}><FileCheck2 size={16} /> Сформировать файл</EcoButton>}
      </div>
    </header>

    {error && <div role="alert" className={styles.error}><TriangleAlert size={18} /><span>{error}</span><button type="button" aria-label="Закрыть сообщение об ошибке" onClick={() => setError("")}><X size={17} /></button></div>}
    {notice && <div role="status" className={styles.notice}><CheckCircle2 size={18} /><span>{notice}</span>{downloadUrl && <a href={downloadUrl}><Download size={15} /> Скачать CSV</a>}<button type="button" aria-label="Закрыть сообщение" onClick={() => setNotice("")}><X size={17} /></button></div>}

    <nav className={styles.tabs} role="tablist" aria-label="Разделы Авито">{tabButton("products", "Товары")}{editable && tabButton("settings", "Настройки")}{tabButton("history", "История загрузок")}</nav>

    {loading && !data ? <div className={styles.loading} role="status" aria-label="Загружаем товары"><div /><div /><div /><div /><div /><div /></div> : !data ? <div className={styles.empty}><TriangleAlert size={24} /><h2>Не удалось загрузить раздел</h2><p>Обновите страницу или повторите запрос.</p><EcoButton onClick={() => { setLoading(true); refresh().then(() => { setError(""); setLoading(false); }).catch((failure) => { setError(errorMessage(failure)); setLoading(false); }); }}>Повторить</EcoButton></div> : <>
      {tab === "products" && <section role="tabpanel" id="avito-products" aria-labelledby="avito-tab-products">
        <div className={styles.summary}>
          <span><strong>{data.stats.selected}</strong> выбрано для Авито</span>
          <span><strong>{data.stats.included}</strong> попадут в файл</span>
          <button type="button" onClick={() => { setView("errors"); setOffset(0); setSelected(new Set()); }} className={data.stats.invalid ? styles.summaryError : ""}><strong>{data.stats.invalid}</strong> с ошибками</button>
          <span><strong>{data.stats.outOfStock}</strong> без доступного остатка</span>
          <small>Последний файл: {dateLabel(data.settings.lastExportAt)}</small>
        </div>
        {!data.settings.configured && editable && <div className={styles.setupHint}><Settings2 size={18} /><span>Для первой выгрузки укажите адрес продажи и публичный адрес платформы.</span><button type="button" onClick={() => setTab("settings")}>Открыть настройки <ArrowRight size={15} /></button></div>}
        <div className={styles.filters}>
          <label className={styles.search}><Search size={17} /><input aria-label="Поиск товаров Авито" placeholder="Товар, артикул или производитель" value={searchDraft} onChange={(event) => { setSearchDraft(event.target.value); setOffset(0); setSelected(new Set()); }} /></label>
          <EcoSelect aria-label="Тип масла" value={type} onChange={(event) => { setType(event.target.value); setOffset(0); setSelected(new Set()); }}><option value="all">Все масла</option><option value="motor">Моторные</option><option value="transmission">Трансмиссионные</option></EcoSelect>
          <EcoSelect aria-label="Состояние объявлений" value={view} onChange={(event) => { setView(event.target.value as View); setOffset(0); setSelected(new Set()); }}><option value="all">Все товары</option><option value="selected">Выбраны для Авито</option><option value="errors">Есть ошибки</option><option value="ready">Данные заполнены</option><option value="published">Опубликованы</option></EcoSelect>
        </div>
        {selected.size > 0 && editable && <div className={styles.bulk}><span>Выбрано для действия: <strong>{selected.size}</strong></span><EcoButton size="sm" disabled={Boolean(busy)} onClick={async () => { if (await perform("selection", { ids: [...selected], enabled: true })) setSelected(new Set()); }}>Включить в выгрузку</EcoButton><EcoButton size="sm" disabled={Boolean(busy)} onClick={async () => { if (await perform("selection", { ids: [...selected], enabled: false })) setSelected(new Set()); }}>Исключить</EcoButton><button type="button" className={styles.textButton} onClick={() => setSelected(new Set())}>Сбросить выбор</button></div>}
        <div className={`${styles.layout} ${editing ? styles.withInspector : ""}`}>
          <div className={styles.tablePane}>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead><tr>{editable && <th className={styles.checkColumn}><input type="checkbox" aria-label="Выбрать все показанные товары" checked={filtered.length > 0 && filtered.every((item) => selected.has(item.id))} ref={(node) => { if (node) node.indeterminate = filtered.some((item) => selected.has(item.id)) && !filtered.every((item) => selected.has(item.id)); }} onChange={(event) => setSelected(event.target.checked ? new Set(filtered.map((item) => item.id)) : new Set())} /></th>}<th>Товар</th><th className={styles.numeric}>Цена Авито</th><th className={styles.numeric}>Доступно</th><th>Подготовка</th><th>На Авито</th></tr></thead>
                <tbody>{filtered.map((item) => {
                  const errors = item.issues.filter((issue) => issue.severity === "error");
                  const warnings = item.issues.filter((issue) => issue.severity === "warning");
                  return <tr key={item.id} className={editingId === item.id ? styles.currentRow : ""}>
                    {editable && <td><input type="checkbox" aria-label={`Выбрать ${item.name}`} checked={selected.has(item.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} /></td>}
                    <td><button type="button" className={styles.productButton} onClick={(event) => { opener.current = event.currentTarget; setEditingId(item.id); }}>
                      {item.photos[0] && <Image src={item.photos[0].url} alt="" width={40} height={40} unoptimized />}
                      <span><strong>{item.name}</strong><small>{item.article ?? "Без артикула"} · {item.type === "motor" ? "Моторное" : "Трансмиссионное"}</small><em className={item.enabled ? styles.includedLabel : ""}>{item.archived ? "Архивный товар" : item.enabled ? "Выбран для Авито" : "Не выбран для Авито"}</em></span>
                    </button></td>
                    <td className={styles.numeric}>{money(item.values.priceRubles)}{item.overrides.priceRubles != null && <small>Отдельная цена</small>}</td>
                    <td className={styles.numeric}><span className={item.available <= data.settings.stockBuffer ? styles.zeroStock : ""}>{amount(item.available)}</span></td>
                    <td><button type="button" className={styles.statusButton} onClick={() => setEditingId(item.id)}><EcoBadge tone={errors.length ? "danger" : item.archived || !item.included && item.enabled ? "neutral" : "success"}>{errors.length ? errorCount(errors.length) : item.archived ? "В архиве" : item.enabled && !item.included ? "Исключён по остатку" : "Данные заполнены"}</EcoBadge>{errors[0] ? <small>{errors[0].message}</small> : warnings.length ? <small>{warnings.some((issue) => issue.field === "photos") ? "Фото не добавлены" : "Допуски проверит Авито"}</small> : null}</button></td>
                    <td><EcoBadge tone={["active", "old"].includes(item.remote?.status ?? "") ? "success" : ["error", "rejected", "blocked"].includes(item.remote?.status ?? "") ? "danger" : "neutral"}>{avitoRemoteLabel(item.remote?.status)}</EcoBadge>{item.remote && <small>{dateLabel(item.remote.checkedAt)}</small>}{item.remote?.url && <a className={styles.adLink} href={item.remote.url} target="_blank" rel="noopener noreferrer">Объявление <ExternalLink size={12} /></a>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            {!filtered.length && <div className={styles.empty}><Search size={23} /><h2>{data.total ? "Нет товаров по выбранным фильтрам" : "Масла пока не найдены"}</h2><p>{data.total ? "Измените тип масла или состояние объявления." : search ? "Попробуйте другой запрос." : "Товары появятся здесь после добавления в группы моторных или трансмиссионных масел."}</p>{data.total ? <EcoButton onClick={() => { setView("all"); setType("all"); }}>Сбросить фильтры</EcoButton> : <Link href="/inventory/products" className="eco-btn">Открыть товары</Link>}</div>}
            <footer className={styles.pagination}><span>Показано {filtered.length} · всего по поиску {data.total}</span><div><EcoButton size="sm" disabled={offset === 0 || Boolean(busy)} aria-label="Предыдущая страница" onClick={() => { setOffset(Math.max(0, offset - data.limit)); setSelected(new Set()); setEditingId(null); }}><ChevronLeft size={16} /></EcoButton><span>{Math.floor(offset / data.limit) + 1}</span><EcoButton size="sm" disabled={offset + data.limit >= data.total || Boolean(busy)} aria-label="Следующая страница" onClick={() => { setOffset(offset + data.limit); setSelected(new Set()); setEditingId(null); }}><ChevronRight size={16} /></EcoButton></div></footer>
          </div>
          {editing && <ListingEditor key={editing.id} listing={editing} settings={data.settings} canEdit={editable} busy={Boolean(busy)} error={error} onClose={closeEditor} onSave={async (enabled, overrides) => { if (await perform("listing", { id: editing.id, enabled, overrides, sourceUpdatedAt: editing.sourceUpdatedAt })) closeEditor(); }} />}
        </div>
        <p className={styles.footnote}>Готовность данных и публикация — разные этапы. Результат размещения появляется после получения отчёта Авито.</p>
      </section>}

      {tab === "settings" && editable && <section role="tabpanel" id="avito-settings" aria-labelledby="avito-tab-settings"><AvitoSettingsForm key={JSON.stringify(data.settings)} settings={data.settings} stores={data.stores} canEditSecrets={data.canEditSecrets ?? canEditSecrets} busy={Boolean(busy)} onSave={(settings, clientId, clientSecret) => perform("settings", { settings, clientId, clientSecret })} onApi={(action) => perform("api", { action })} onCopyNotice={setNotice} /></section>}
      {tab === "history" && <section role="tabpanel" id="avito-history" aria-labelledby="avito-tab-history"><History items={data.history} busy={Boolean(busy)} canEdit={editable} hasKeys={data.settings.clientIdConfigured && data.settings.clientSecretConfigured} onReports={() => perform("api", { action: "reports" })} /></section>}
      {reviewOpen && <ExportReview stats={data.stats} hasPrevious={Boolean(data.settings.lastExportAt)} busy={Boolean(busy)} error={error} onClose={() => setReviewOpen(false)} onConfirm={async (allowEmpty) => { if (await perform("generate", { allowEmpty })) setReviewOpen(false); }} />}
    </>}
  </div>;
}

function ListingEditor({ listing, settings, canEdit, busy, error, onClose, onSave }: {
  listing: AvitoListing; settings: AvitoSettings; canEdit: boolean; busy: boolean; error: string; onClose: () => void; onSave: (enabled: boolean, overrides: AvitoOverrides) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<AvitoOverrides>(listing.overrides);
  const [enabled, setEnabled] = useState(listing.enabled);
  const [section, setSection] = useState<"edit" | "preview">("edit");
  const live = buildAvitoListing({ ...listing.source, avito: enabled }, draft, settings, listing.adId, listing.remote);
  const catalog = avitoCatalog(live.type);
  const selectedPhotos = draft.photoIds ?? listing.allPhotos.slice(0, 10).map((photo) => photo.id);

  useEffect(() => {
    const element = dialog.current!;
    const media = window.matchMedia("(max-width: 980px)");
    const open = () => { if (element.open) element.close(); if (media.matches) element.showModal(); else element.show(); };
    open(); media.addEventListener("change", open);
    return () => { media.removeEventListener("change", open); element.close(); };
  }, []);

  const update = <K extends keyof AvitoOverrides>(key: K, value: AvitoOverrides[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const fieldError = (key: string) => live.issues.find((issue) => issue.field === key && issue.severity === "error")?.message;
  const input = (key: "title" | "brand" | "sae" | "volume" | "avitoId" | "multiName", label: string, options?: string[]) => <label className={styles.field} key={key}><span>{label}</span><input className="eco-input" value={live.values[key]} list={options ? `avito-options-${key}` : undefined} disabled={!canEdit || busy} aria-invalid={Boolean(fieldError(key))} aria-describedby={fieldError(key) ? `avito-error-${key}` : undefined} onChange={(event) => update(key, event.target.value)} />{options && <datalist id={`avito-options-${key}`}>{options.map((option) => <option key={option} value={option} />)}</datalist>}{fieldError(key) && <small id={`avito-error-${key}`} className={styles.fieldError}>{fieldError(key)}</small>}</label>;
  const standard = (key: "acea" | "api" | "atf" | "oem", label: string) => <label className={styles.field} key={key}><span>{label}</span><textarea className="eco-input" rows={2} value={live.values[key]} disabled={!canEdit || busy} onChange={(event) => update(key, event.target.value)} placeholder="Разделяйте значения символом | или ;" /></label>;
  const selectPhoto = (id: string) => {
    if (!canEdit || busy) return;
    const next = selectedPhotos.includes(id) ? selectedPhotos.filter((value) => value !== id) : selectedPhotos.length < 10 ? [...selectedPhotos, id] : selectedPhotos;
    update("photoIds", next);
  };

  return <dialog ref={dialog} className={styles.inspector} aria-labelledby="avito-editor-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header className={styles.inspectorHeader}><div><small>Объявление Авито</small><h2 id="avito-editor-title">{listing.name}</h2></div><button type="button" className={styles.iconButton} aria-label="Закрыть редактор" onClick={onClose}><X size={20} /></button></header>
    <div className={styles.inspectorTabs}><button type="button" className={section === "edit" ? styles.activeTab : ""} onClick={() => setSection("edit")}>Данные объявления</button><button type="button" className={section === "preview" ? styles.activeTab : ""} onClick={() => setSection("preview")}>Предпросмотр</button></div>
    {section === "edit" ? <form id="avito-listing-form" onSubmit={(event: FormEvent) => { event.preventDefault(); if (canEdit && !busy) void onSave(enabled, draft); }}>
      <div className={styles.inspectorBody}>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <p className={styles.help}>Правки здесь используются в объявлении. Карточка товара и складская цена сохраняются.</p>
        {isLiterSaleUnit(listing.source.uomName) && <p className={styles.issueWarning}>Масло продаётся на розлив. Укажите объём продажи и полную цену за этот объём; складской остаток учитывается в литрах.</p>}
        <label className={styles.checkField}><input type="checkbox" checked={enabled} disabled={!canEdit || busy || listing.archived} onChange={(event) => setEnabled(event.target.checked)} /><span>Включить товар в выгрузку</span></label>
        <label className={styles.field}><span>Тип масла</span><EcoSelect disabled={!canEdit || busy} value={live.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as AvitoOverrides["type"], acea: "", atf: "", api: "", oem: "", sae: "" }))}><option value="motor">Моторные масла</option><option value="transmission">Трансмиссионные масла</option></EcoSelect></label>
        {input("title", "Заголовок")}
        <div className={styles.counter}>{[...live.values.title].length} / 50 символов</div>
        <label className={styles.field}><span>Описание</span><textarea className="eco-input" rows={5} value={live.values.description} disabled={!canEdit || busy} aria-invalid={Boolean(fieldError("description"))} onChange={(event) => update("description", event.target.value)} />{fieldError("description") && <small className={styles.fieldError}>{fieldError("description")}</small>}</label>
        <div className={styles.counter}>{[...live.values.description].length} / 7 500 символов</div>
        <div className={styles.twoColumns}><label className={styles.field}><span>Цена Авито, ₽</span><EcoInput type="number" min="1" step="1" value={live.values.priceRubles ?? ""} disabled={!canEdit || busy} aria-invalid={Boolean(fieldError("priceRubles"))} onChange={(event) => update("priceRubles", event.target.value === "" ? null : Number(event.target.value))} />{fieldError("priceRubles") && <small className={styles.fieldError}>{fieldError("priceRubles")}</small>}<small>В карточке: {money(listing.sourcePriceCents / 100)}</small></label><label className={styles.field}><span>Состояние</span><EcoSelect disabled={!canEdit || busy} value={live.values.condition} onChange={(event) => update("condition", event.target.value as "Новое" | "Б/у")}><option>Новое</option><option>Б/у</option></EcoSelect></label></div>
        <h3>Характеристики масла</h3>
        {input("brand", "Производитель", catalog.Brand)}
        <div className={styles.twoColumns}>{input("sae", "SAE", catalog.SAE)}{input("volume", "Объём", catalog.Volume)}</div>
        <p className={styles.help}>{live.type === "motor" ? "Заполните хотя бы один блок: ACEA, API или OEM." : "Заполните хотя бы один блок: ATF, API или OEM."} Составные допуски с / остаются одним значением.</p>
        {live.type === "motor" ? standard("acea", "ACEA") : standard("atf", "ATF")}
        {standard("api", "API")}{standard("oem", "Допуски OEM")}
        {fieldError("standards") && <p className={styles.fieldError}>{fieldError("standards")}</p>}
        <h3>Фотографии <small>{selectedPhotos.length} / 10</small></h3>
        {listing.allPhotos.length ? <div className={styles.photos}>{listing.allPhotos.map((photo) => <div key={photo.id}><button type="button" className={selectedPhotos.includes(photo.id) ? styles.pickedPhoto : styles.photoButton} disabled={!canEdit || busy || !selectedPhotos.includes(photo.id) && selectedPhotos.length >= 10} onClick={() => selectPhoto(photo.id)} aria-label={`${selectedPhotos.includes(photo.id) ? "Исключить" : "Выбрать"} фото ${photo.name}`} aria-pressed={selectedPhotos.includes(photo.id)}><Image src={photo.url} alt={photo.name} width={140} height={140} unoptimized />{selectedPhotos.includes(photo.id) && <span><Check size={13} /> {selectedPhotos.indexOf(photo.id) === 0 ? "Обложка" : selectedPhotos.indexOf(photo.id) + 1}</span>}</button>{selectedPhotos.includes(photo.id) && selectedPhotos[0] !== photo.id && canEdit && <button type="button" className={styles.textButton} disabled={busy} onClick={() => update("photoIds", [photo.id, ...selectedPhotos.filter((id) => id !== photo.id)])}>Сделать первым</button>}</div>)}</div> : <p className={styles.help}>Фотографий Авито пока нет. Их можно добавить в карточке товара.</p>}
        <Link className={styles.inlineLink} href={`/inventory/products?search=${encodeURIComponent(listing.article ?? listing.name)}`}><ImagePlus size={15} /> Открыть товар и фотографии</Link>
        <details className={styles.details}><summary>Связь с Авито и варианты товара</summary>
          {input("avitoId", "Номер уже размещённого объявления")}
          <p className={styles.help}>Для нового объявления оставьте пустым. Для существующего укажите его номер, чтобы связать с товаром.</p>
          <label className={styles.checkField}><input type="checkbox" checked={live.values.multiItem} disabled={!canEdit || busy} onChange={(event) => update("multiItem", event.target.checked)} /><span>Объединять с вариантами этого товара</span></label>
          {live.values.multiItem && input("multiName", "Общее название вариантов")}
          <small className={styles.help}>Идентификатор выгрузки: {listing.adId}</small>
        </details>
        {live.issues.length > 0 && <div className={styles.issues}><h3>Проверка объявления</h3>{live.issues.map((issue, index) => <p key={`${issue.field}-${index}`} className={issue.severity === "error" ? styles.issueError : styles.issueWarning}>{issue.severity === "error" ? <TriangleAlert size={15} /> : <span className={styles.warningDot} />}<span>{issue.message}</span></p>)}</div>}
        {listing.remote?.messages.length ? <div className={styles.issues}><h3>Сообщения Авито</h3>{listing.remote.messages.map((message, index) => <p key={index}>{message}</p>)}</div> : null}
      </div>
      <footer className={styles.inspectorFooter}><EcoButton type="button" disabled={busy} onClick={onClose}>Закрыть</EcoButton>{canEdit && <><button type="button" className={styles.textButton} disabled={busy} onClick={() => setDraft({})}>Из карточки</button><EcoButton type="submit" variant="primary" disabled={busy}>{busy ? <Loader2 size={16} className={styles.spinning} /> : <Save size={16} />} Сохранить</EcoButton></>}</footer>
    </form> : <><div className={styles.inspectorBody}><div className={styles.preview}>
      {live.photos[0] && <Image className={styles.previewImage} src={live.photos[0].url} alt={live.values.title} width={600} height={600} unoptimized />}
      <h3>{live.values.title || "Добавьте заголовок"}</h3><strong className={styles.previewPrice}>{money(live.values.priceRubles)}</strong><p>{settings.address || `Адрес №${settings.sellerAddressId || "не указан"}`}</p>
      <dl><dt>Тип</dt><dd>{AVITO_TYPE_LABELS[live.type]}</dd><dt>Производитель</dt><dd>{live.values.brand || "—"}</dd><dt>SAE</dt><dd>{live.values.sae || "—"}</dd><dt>Объём</dt><dd>{live.values.volume || "—"}</dd><dt>Состояние</dt><dd>{live.values.condition}</dd></dl>
      <div className={styles.descriptionPreview}>{live.values.description}</div>
      <p className={styles.help}>Предпросмотр данных объявления. Оформление на Авито может отличаться.</p>
    </div></div><footer className={styles.inspectorFooter}><EcoButton onClick={() => setSection("edit")}><ArrowLeft size={15} /> Вернуться к данным</EcoButton></footer></>}
  </dialog>;
}


function History({ items, busy, canEdit, hasKeys, onReports }: { items: AvitoHistoryItem[]; busy: boolean; canEdit: boolean; hasKeys: boolean; onReports: () => Promise<boolean> }) {
  return <>
    <div className={styles.historyHeader}><div><h2>История загрузок</h2><p>Формирование файлов, запросы Авито и результаты обработки.</p></div>{canEdit && <EcoButton disabled={busy || !hasKeys} onClick={() => void onReports()}><RefreshCw size={15} /> Получить отчёт Авито</EcoButton>}</div>
    {!items.length ? <div className={styles.empty}><FileCheck2 size={24} /><h2>Загрузок пока нет</h2><p>Сформируйте первый файл. Здесь появятся его состав и результат обработки Авито.</p></div> : <div className={styles.tableScroll}><table className={styles.table}><thead><tr><th>Время</th><th>Событие</th><th>Результат</th><th>Файл</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{dateLabel(item.createdAt)}</td><td><strong>{historyLabels[item.action] ?? item.action}</strong><small>{item.message}</small></td><td><EcoBadge tone={item.status === "error" ? "danger" : item.status === "pending" ? "warning" : "success"}>{item.status === "error" ? "Ошибка" : item.status === "pending" ? "Обрабатывается" : "Выполнено"}</EcoBadge>{item.stats && <small>{item.stats.included} объявлений · {item.stats.withdrawals} исключений</small>}{item.reportId && <small>Отчёт №{item.reportId}</small>}</td><td>{item.downloadUrl && <a className="eco-btn eco-btn--sm" href={item.downloadUrl}><Download size={15} /> Скачать CSV</a>}</td></tr>)}</tbody></table></div>}
  </>;
}

function ExportReview({ stats, hasPrevious, busy, error, onClose, onConfirm }: { stats: AvitoFeedStats; hasPrevious: boolean; busy: boolean; error: string; onClose: () => void; onConfirm: (allowEmpty: boolean) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [allowEmpty, setAllowEmpty] = useState(false);
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  return <dialog ref={dialog} className={styles.review} aria-labelledby="avito-review-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id="avito-review-title">Проверка перед выгрузкой</h2><button type="button" className={styles.iconButton} disabled={busy} aria-label="Закрыть проверку выгрузки" onClick={onClose}><X size={20} /></button></header>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <dl><dt>Добавить или обновить в файле</dt><dd>{stats.included}</dd><dt>Исключить из предыдущего файла</dt><dd>{stats.withdrawals}</dd><dt>Не включать по остатку</dt><dd>{stats.outOfStock}</dd></dl>
    <p>Формирование файла сохраняет проверенный состав выгрузки. Если автовыгрузка включена, Авито сможет получить обновлённые данные по ссылке.</p>
    {stats.warnings > 0 && <p className={styles.issueWarning}><TriangleAlert size={16} /> {stats.warnings} объявлений с предупреждениями. Допуски и публикацию дополнительно проверит Авито.</p>}
    {stats.included === 0 && hasPrevious && <label className={styles.checkField}><input type="checkbox" checked={allowEmpty} disabled={busy} onChange={(event) => setAllowEmpty(event.target.checked)} /><span>Подтверждаю пустой файл: прежние объявления будут сняты после обработки Авито.</span></label>}
    {stats.included === 0 && !hasPrevious && <p className={styles.fieldError}>Для первой выгрузки выберите хотя бы один товар с доступным остатком.</p>}
    <footer><EcoButton disabled={busy} onClick={onClose}>Отмена</EcoButton><EcoButton variant="primary" disabled={busy || stats.invalid > 0 || stats.included === 0 && (!hasPrevious || !allowEmpty)} onClick={() => void onConfirm(allowEmpty)}>{busy ? <Loader2 size={16} className={styles.spinning} /> : <FileCheck2 size={16} />} Сформировать CSV</EcoButton></footer>
  </dialog>;
}
