"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Layers, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { EcoBadge, EcoButton, EcoInput, EcoSelect } from "@/components/platform/EcoUI";
import type { ProductKitView } from "@/lib/product-kits";
import { calculateKit, validateKitInput } from "@/lib/product-kit-calculation";
import KitTabs from "./KitTabs";
import styles from "./ProductKits.module.css";

const number = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const money = (cents: number) => `${(cents / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
type Store = { id: string; name: string };
type DraftItem = { productId: string; name: string; article: string; unit: string; quantity: number; priceCents: number; available: number; blocked?: boolean };
type Draft = { id?: string; version?: number; name: string; items: DraftItem[] };

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { cache: "no-store", ...init }); }
  catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new Error("Нет связи с сервером. Повторите попытку");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Не удалось выполнить запрос. Повторите попытку");
  if (!data) throw new Error("Сервер вернул неполный ответ. Повторите попытку");
  return data as T;
}

export default function ProductKitsWorkspace({ mode = "catalog", storeId: externalStore, onAdd }: {
  mode?: "catalog" | "restock" | "picker";
  storeId?: string;
  onAdd?: (kit: ProductKitView) => Promise<void>;
}) {
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState(externalStore || "");
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [kits, setKits] = useState<ProductKitView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [addingId, setAddingId] = useState<string | null>(null);
  const picker = mode === "picker";

  useEffect(() => {
    if (picker) return;
    const controller = new AbortController();
    jsonRequest<{ stores: Store[] }>("/api/local-inventory/store-options", { signal: controller.signal })
      .then((data) => { setStores(data.stores); setStoreId((id) => id || data.stores[0]?.id || ""); })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [picker]);

  const selectedStore = picker ? externalStore || "" : storeId;
  useEffect(() => {
    const controller = new AbortController();
    if (!selectedStore) { setLoading(false); return; }
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ storeId: selectedStore, q: query, page: String(page), archived: archived ? "1" : "0" });
      jsonRequest<{ kits: ProductKitView[]; total: number }>(`/api/product-kits?${params}`, { signal: controller.signal })
        .then((data) => { if (!controller.signal.aborted) { setKits(data.kits); setTotal(data.total); } })
        .catch((e) => { if (!controller.signal.aborted) setError(e.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [selectedStore, query, page, archived, revision]);

  async function mutate(kit: ProductKitView, action: "archive" | "restore" | "target") {
    setBusy(kit.id); setError(""); setNotice("");
    try {
      const rawTarget = targets[kit.id] ?? String(kit.target);
      if (action === "target" && (!rawTarget.trim() || !Number.isSafeInteger(Number(rawTarget)) || Number(rawTarget) < 0)) throw new Error("Укажите целевой запас целым числом от 0");
      await jsonRequest(`/api/product-kits/${kit.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, version: kit.version, storeId: selectedStore, quantity: Number(rawTarget) }) });
      setTargets((current) => { const next = { ...current }; delete next[kit.id]; return next; });
      setNotice(action === "target" ? "Целевой запас сохранён для выбранного склада" : action === "archive" ? "Комплект перенесён в архив. Его можно восстановить" : "Комплект восстановлен");
      setRevision((value) => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка сохранения"); }
    finally { setBusy(null); }
  }

  async function addKit(kit: ProductKitView) {
    if (!onAdd) return;
    setAddingId(kit.id); setError(""); setNotice("");
    try {
      // Fetch again on click: never expand stale composition, price, or availability.
      const data = await jsonRequest<{ kit: ProductKitView }>(`/api/product-kits/${kit.id}?storeId=${encodeURIComponent(selectedStore)}`);
      if (data.kit.archived || data.kit.items.some((item) => item.blocked)) throw new Error("В комплекте есть недоступные товары или он архивирован. Проверьте его состав");
      await onAdd(data.kit);
      setNotice(`«${data.kit.name}»: товары добавлены в отгрузку`);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось добавить комплект"); }
    finally { setAddingId(null); }
  }

  return <section className={`${styles.workspace} ${picker ? "" : mode === "restock" ? "eco-restock-page" : "eco-products-page"}`} aria-label="Комплекты">
    {!picker && <>
      <header className={styles.heading}>
        <div><p className={styles.crumbs}>Склад / {mode === "restock" ? "Пополнение" : "Товары"}</p><h1 className="eco-page-title">{mode === "restock" ? "Пополнение комплектов" : "Комплекты"}</h1>
          <p className={styles.description}>{mode === "restock" ? "Поддерживайте нужный запас: проверьте доступность и недостающие товары." : "Сохранённые наборы товаров для быстрого добавления в отгрузку."}</p></div>
        {mode === "catalog" ? <EcoButton variant="primary" disabled={!!draft} onClick={() => { setDraft({ name: "", items: [] }); setNotice(""); }}><Plus size={16} /> Создать комплект</EcoButton>
          : <Link className="eco-btn" href="/inventory/products?tab=kits">Управление комплектами</Link>}
      </header>
      <KitTabs section={mode === "restock" ? "restock" : "catalog"} kits />
    </>}
    {draft ? <KitEditor key={draft.id || "new"} initial={draft} storeId={selectedStore} onCancel={() => setDraft(null)} onSaved={() => { setDraft(null); setPage(0); setRevision((n) => n + 1); setNotice("Комплект сохранён"); }} /> : <>
      <div className={styles.toolbar}>
        <label className={styles.search}><Search size={16} aria-hidden /><span className={styles.srOnly}>Поиск комплекта</span><EcoInput value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder="Найти комплект по названию" /></label>
        {!picker && <label className={styles.field}>Склад<EcoSelect value={storeId} onChange={(e) => { setStoreId(e.target.value); setPage(0); setNotice(""); setTargets({}); }}><option value="" disabled>Выберите склад</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</EcoSelect></label>}
        {mode === "catalog" && <label className={styles.check}><input type="checkbox" checked={archived} onChange={(e) => { setArchived(e.target.checked); setPage(0); }} /> Архив</label>}
        <EcoButton size="sm" onClick={() => setRevision((n) => n + 1)} disabled={loading} aria-label="Обновить комплекты"><RefreshCw size={16} /></EcoButton>
      </div>
      {picker && !selectedStore && <p className={styles.empty}>Сначала выберите склад отгрузки.</p>}
      <p className={styles.hint}>Доступность каждого комплекта рассчитана независимо по свободным остаткам выбранного склада. Товары не резервируются.</p>
      {error && <div className={styles.error} role="alert">{error} <EcoButton size="sm" onClick={() => setRevision((n) => n + 1)}>Повторить</EcoButton></div>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {loading ? <div className={styles.loading} role="status">Загружаем составы и остатки…</div> : !error && selectedStore && kits.length === 0 ? <div className={styles.empty}><Layers size={28} aria-hidden /><h2>{query ? "Комплекты не найдены" : archived ? "Архив пуст" : "Создайте первый комплект"}</h2><p>{query ? "Попробуйте другое название." : "Добавьте товары из каталога и укажите количество каждого."}</p>{!archived && <Link className="eco-btn" href="/inventory/products?tab=kits">Перейти к комплектам</Link>}</div> : !error && selectedStore ? <>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Комплект / состав</th><th>Доступно</th>{!picker && <th>Цена комплекта</th>}{mode === "restock" && <th>Целевой запас</th>}<th>{mode === "restock" ? "До целевого запаса" : "Действия"}</th></tr></thead><tbody>
          {kits.map((kit) => <Fragment key={kit.id}>
            <tr>
              <td><button className={styles.expand} onClick={() => setExpanded(expanded === kit.id ? null : kit.id)} aria-expanded={expanded === kit.id} aria-controls={`kit-${kit.id}`}>
                {expanded === kit.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<span><strong>{kit.name}</strong><small>{kit.items.length} поз. · {kit.items.map((item) => `${item.name} × ${number(item.quantity)}`).join("; ")}</small></span></button></td>
              <td><div className={styles.availability}><strong>{number(kit.ready)} компл.</strong><EcoBadge tone={kit.status === "ready" ? "success" : kit.status === "partial" ? "warning" : "neutral"}>{kit.status === "ready" ? "Доступен" : kit.status === "partial" ? "Частично" : "Нет в наличии"}</EcoBadge></div></td>
              {!picker && <td className={styles.numeric}>{money(kit.priceCents)}</td>}
              {mode === "restock" && <td><form className={styles.target} onSubmit={(e) => { e.preventDefault(); void mutate(kit, "target"); }}><label><span className={styles.srOnly}>Целевой запас: {kit.name}</span><EcoInput type="number" min="0" max="1000000" step="1" value={targets[kit.id] ?? kit.target} onChange={(e) => setTargets((old) => ({ ...old, [kit.id]: e.target.value }))} /></label><EcoButton size="sm" type="submit" disabled={busy !== null || loading || targets[kit.id] === undefined || targets[kit.id] === String(kit.target)}>Сохранить</EcoButton></form></td>}
              <td>{mode === "restock" ? <div className={styles.need}><strong>{kit.target === 0 ? "Запас не задан" : kit.missingKits === 0 ? "Запас обеспечен" : `Не хватает ${number(kit.missingKits)} компл.`}</strong>{kit.items.filter((item) => item.missingTarget > 0).map((item) => <span key={item.productId}>{item.name}: {number(item.missingTarget)} {item.unit}{item.blocked ? " · товар недоступен" : ""}</span>)}</div>
                : picker ? <EcoButton size="sm" variant="primary" disabled={addingId !== null || kit.items.some((item) => item.blocked)} onClick={() => void addKit(kit)}>{addingId === kit.id ? "Добавляем…" : "Добавить"}</EcoButton>
                  : <div className={styles.actions}>{!archived && <EcoButton size="sm" onClick={() => { setDraft({ id: kit.id, version: kit.version, name: kit.name, items: kit.items }); setError(""); }}><Pencil size={14} /> Изменить</EcoButton>}<EcoButton size="sm" disabled={busy !== null} onClick={() => void mutate(kit, archived ? "restore" : "archive")} aria-label={`${archived ? "Восстановить" : "В архив"}: ${kit.name}`}>{archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}</EcoButton></div>}</td>
            </tr>
            {expanded === kit.id && <tr id={`kit-${kit.id}`}><td colSpan={mode === "restock" ? 5 : picker ? 3 : 4} className={styles.detail}>
              <div className={styles.detailHead}><strong>Состав комплекта</strong><span>{kit.ready > 0 ? `Для следующего, ${number(kit.ready + 1)}-го комплекта` : "Для одного полного комплекта"}</span></div>
              <table className={styles.composition}><thead><tr><th>Товар</th><th>В комплекте</th><th>Свободно</th><th>Не хватает</th></tr></thead><tbody>{kit.items.map((item) => <tr key={item.productId}><td>{item.name}<small>{item.article}{item.blocked ? " · Товар недоступен: измените состав" : ""}</small></td><td>{number(item.quantity)} {item.unit}</td><td>{number(item.available)} {item.unit}</td><td>{item.missingNext > 0 ? <span className={styles.shortage}>{number(item.missingNext)} {item.unit}</span> : "—"}</td></tr>)}</tbody></table>
              {picker && <p className={styles.hint}>Весь состав добавится обычными строками, даже при дефиците. Совпадающие товары объединятся.</p>}
            </td></tr>}
          </Fragment>)}
        </tbody></table></div>
        {total > 30 && <nav className={styles.pagination} aria-label="Страницы комплектов"><EcoButton disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Назад</EcoButton><span>{page * 30 + 1}–{Math.min(total, (page + 1) * 30)} из {total}</span><EcoButton disabled={(page + 1) * 30 >= total} onClick={() => setPage((n) => n + 1)}>Далее</EcoButton></nav>}
      </> : null}
    </>}
  </section>;
}

function KitEditor({ initial, storeId, onCancel, onSaved }: { initial: Draft; storeId: string; onCancel: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<DraftItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const summary = calculateKit(draft.items, 0);
  useEffect(() => {
    const controller = new AbortController();
    if (!query.trim()) { setProducts([]); setSearchLoading(false); setSearchError(""); return; }
    setSearchLoading(true); setSearchError("");
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, type: "product", context: "shipment", storeId, limit: "15" });
      jsonRequest<{ products: Array<{ id: string; name: string; article?: string; uomName?: string; price: number; availableQuantity?: number; meta: { type: string } }> }>(`/api/catalog/search?${params}`, { signal: controller.signal })
        .then((data) => { if (!controller.signal.aborted) setProducts((data.products ?? []).filter((product) => ["product", "variant"].includes(product.meta.type)).map((product) => ({ productId: product.id, name: product.name, article: product.article || "", unit: product.uomName || "шт.", quantity: 1, priceCents: Math.round(product.price * 100), available: product.availableQuantity ?? 0 }))); })
        .catch((e) => { if (!controller.signal.aborted) setSearchError(e.message); })
        .finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, storeId]);

  async function save() {
    setError("");
    try {
      const input = validateKitInput(draft);
      setSaving(true);
      await jsonRequest(initial.id ? `/api/product-kits/${initial.id}` : "/api/product-kits", { method: initial.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, version: initial.version }) });
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить комплект"); }
    finally { setSaving(false); }
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  return <section className={styles.editor} aria-labelledby="kit-editor-title">
    <header className={styles.editorHead}><h2 id="kit-editor-title">{initial.id ? "Редактирование комплекта" : "Новый комплект"}</h2><EcoButton aria-label="Закрыть редактор комплекта" disabled={saving} onClick={() => dirty ? setCancelPending(true) : onCancel()}><X size={16} /></EcoButton></header>
    <label className={styles.nameField}>Название комплекта<EcoInput autoFocus maxLength={200} value={draft.name} placeholder="Например, замена масла АКПП 6HP" disabled={saving} onChange={(e) => setDraft((old) => ({ ...old, name: e.target.value }))} /></label>
    <div className={styles.detailHead}><h3>Состав</h3><span>Количество в единицах учёта товара</span></div>
    {draft.items.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Товар</th><th>Количество</th><th>Цена за единицу</th><th>Сумма</th><th><span className={styles.srOnly}>Удаление</span></th></tr></thead><tbody>{draft.items.map((item) => <tr key={item.productId}><td><strong>{item.name}</strong><small>{item.article}{item.blocked ? " · Недоступен: замените товар" : ""}</small></td><td><label className={styles.quantity}><span className={styles.srOnly}>Количество: {item.name}</span><EcoInput type="number" min="0.001" max="1000000" step="0.001" value={Number.isNaN(item.quantity) ? "" : item.quantity} disabled={saving} onChange={(e) => setDraft((old) => ({ ...old, items: old.items.map((row) => row.productId === item.productId ? { ...row, quantity: e.target.value === "" ? NaN : Number(e.target.value) } : row) }))} /><span>{item.unit}</span></label></td><td className={styles.numeric}>{money(item.priceCents)}</td><td className={styles.numeric}>{money(Math.round(item.priceCents * (Number.isFinite(item.quantity) ? item.quantity : 0)))}</td><td><EcoButton aria-label={`Убрать ${item.name}`} disabled={saving} onClick={() => setDraft((old) => ({ ...old, items: old.items.filter((row) => row.productId !== item.productId) }))}><Trash2 size={15} /></EcoButton></td></tr>)}</tbody></table></div> : <p className={styles.emptyComposition}>В составе пока нет товаров. Найдите первый товар ниже.</p>}
    <label className={styles.nameField}>Добавить товар из каталога<EcoInput value={query} disabled={saving} onChange={(e) => setQuery(e.target.value)} placeholder="Название, артикул или OEM" /></label>
    {searchLoading ? <p role="status">Ищем товары…</p> : searchError ? <p className={styles.error} role="alert">{searchError}</p> : query.trim() && <div className={styles.results}>{products.length ? products.map((product) => {
      const added = draft.items.some((item) => item.productId === product.productId);
      return <button key={product.productId} type="button" disabled={added || saving || draft.items.length >= 100} onClick={() => setDraft((old) => ({ ...old, items: [...old.items, product] }))}><span><strong>{product.name}</strong><small>{product.article} · свободно {number(product.available)} {product.unit} · {money(product.priceCents)}</small></span><span>{added ? "В составе" : <Plus size={16} />}</span></button>;
    }) : <p>Товары не найдены. Попробуйте другое название или артикул.</p>}</div>}
    <p className={styles.hint}>Цена — сумма текущих цен товаров. Остаток комплекта рассчитывается по его составу.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {cancelPending && <div className={styles.error} role="alert"><span>Изменения ещё не сохранены. Закрыть редактор?</span><EcoButton onClick={onCancel}>Не сохранять</EcoButton><EcoButton onClick={() => setCancelPending(false)}>Продолжить редактирование</EcoButton></div>}
    <footer className={styles.editorFooter}><span>Стоимость комплекта <strong>{money(Number.isFinite(summary.priceCents) ? summary.priceCents : 0)}</strong></span><div className={styles.actions}><EcoButton disabled={saving} onClick={() => dirty ? setCancelPending(true) : onCancel()}>Отмена</EcoButton><EcoButton variant="primary" disabled={saving || !draft.name.trim() || !draft.items.length || draft.items.some((item) => item.blocked)} onClick={() => void save()}>{saving ? "Сохраняем…" : "Сохранить комплект"}</EcoButton></div></footer>
  </section>;
}
