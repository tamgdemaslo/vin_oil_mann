"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { MannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";
import type { MannFluidResearchResult } from "@/lib/mann-fluid-research";
import { quoteClientText, quoteExtraCents, quoteOilAmount, quoteRub, type QuoteExtra, type QuoteStockProduct } from "@/lib/maintenance-quote";
import styles from "./MaintenanceQuotePanel.module.css";

type Props = { vehicleTitle: string; warehouseId?: string | null; profile: MannUnifiedTechnicalProfile | null; research: MannFluidResearchResult | null };
const number = (value: string) => Number(value.replace(",", "."));

export function MaintenanceQuotePanel({ vehicleTitle, warehouseId, profile, research }: Props) {
  const specificationListId = useId();
  const engines = profile?.items.filter(item => item.systemCode === "ENGINE_OIL") ?? [];
  const discoveries = research?.items.filter(item => item.systemCode === "ENGINE_OIL") ?? [];
  const specifications = [...new Set([...engines.flatMap(item => item.specifications), ...discoveries.map(item => item.specification)].filter(Boolean))];
  const viscosities = [...new Set(engines.flatMap(item => item.viscosityGrades))];
  const capacities = engines.filter(item => !item.requiresReview).flatMap(item => item.capacities).filter(capacity => capacity.qualifier === "EXACT" && capacity.nominalLiters);
  const uniqueVolumes = [...new Set(capacities.map(capacity => capacity.nominalLiters!))];
  const volumeHint = uniqueVolumes.length === 1 ? String(uniqueVolumes[0]) : "";
  const [open, setOpen] = useState(false);
  const [specification, setSpecification] = useState("");
  const [viscosity, setViscosity] = useState("");
  const [volume, setVolume] = useState("");
  const [products, setProducts] = useState<QuoteStockProduct[]>([]);
  const [selected, setSelected] = useState<QuoteStockProduct[]>([]);
  const [extras, setExtras] = useState<QuoteExtra[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [extraProducts, setExtraProducts] = useState<QuoteStockProduct[]>([]);
  const [extraLoading, setExtraLoading] = useState(false);
  const [extraError, setExtraError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (!open || !warehouseId || search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setExtraLoading(true); setExtraError("");
      try {
        const params = new URLSearchParams({ storeId: warehouseId, kind: "extra", search });
        const response = await fetch(`/api/maintenance-quote/stock?${params}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось найти расходники");
        setExtraProducts(data.products);
      } catch (reason) {
        if (!controller.signal.aborted) { setExtraProducts([]); setExtraError(reason instanceof Error ? reason.message : "Ошибка поиска"); }
      } finally { if (!controller.signal.aborted) setExtraLoading(false); }
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, open, warehouseId]);

  function invalidate() {
    requestRef.current?.abort(); setProducts([]); setSelected([]); setSearched(false); setLoading(false); setError("");
  }
  async function findOils() {
    requestRef.current?.abort();
    const controller = new AbortController(); requestRef.current = controller;
    setLoading(true); setError(""); setSelected([]); setProducts([]); setSearched(false);
    try {
      const params = new URLSearchParams({ storeId: warehouseId ?? "", specification, viscosity });
      const response = await fetch(`/api/maintenance-quote/stock?${params}`, { signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить масла");
      if (!controller.signal.aborted) { setProducts(data.products); setSearched(true); }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Ошибка поиска");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  const litres = number(volume);
  const validExtras = extras.every(row => row.name.trim() && Number.isFinite(row.quantity) && row.quantity > 0 && Number.isFinite(row.price) && row.price >= 0);
  const ready = selected.every(oil => Number.isFinite(oil.price) && oil.price > 0) && selected.length > 0 && litres > 0 && litres <= 100 && Number.isFinite(litres) && validExtras && selected.every(oil => quoteOilAmount(oil, litres));
  const text = ready ? quoteClientText(vehicleTitle, [specification, viscosity].filter(Boolean).join(" · "), litres, selected, extras) : "";
  useEffect(() => { setCopied(false); setCopyError(""); }, [text]);
  const extraTotal = quoteExtraCents(extras);
  function updateExtra(id: string, update: Partial<QuoteExtra>) {
    setExtras(rows => rows.map(row => row.id === id ? { ...row, ...update } : row));
  }
  return <section className={styles.panel} aria-label="Расчёт ТО">
    <div className={styles.heading}><div><strong>Расчёт ТО</strong><p>Выберите масло из наличия и подготовьте предложение клиенту.</p></div><button type="button" className="eco-btn" aria-expanded={open} onClick={() => {
      if (!open) { if (!specification) setSpecification(specifications[0] ?? ""); if (!viscosity && viscosities.length === 1) setViscosity(viscosities[0]); if (!volume) setVolume(volumeHint); }
      setOpen(!open);
    }}>{open ? "Свернуть расчёт" : "Рассчитать ТО"}</button></div>
    {open ? <div className={styles.body}>
      {!warehouseId ? <p role="status">Выберите склад в документе, чтобы увидеть наличие и цены.</p> : null}
      <div className={styles.fields}>
        <label>Допуск / стандарт<input list={specificationListId} value={specification} onChange={event => { invalidate(); setSpecification(event.target.value); }} placeholder="Например, VW 504.00" /><datalist id={specificationListId}>{specifications.map(value => <option key={value} value={value} />)}</datalist></label>
        <label>Вязкость<input value={viscosity} onChange={event => { invalidate(); setViscosity(event.target.value); }} placeholder="Например, 5W-30" /></label>
        <label>Объём замены, л<input inputMode="decimal" value={volume} onChange={event => setVolume(event.target.value)} placeholder="Укажите объём с фильтром" /></label>
      </div>
      <p className={styles.note}>Проверьте допуск и сервисный объём с фильтром. Диапазоны и предварительные объёмы нужно указать вручную. Для поиска достаточно одного требуемого допуска; вязкость уточняет выбор.</p>
      <button type="button" className="eco-btn eco-btn--primary" disabled={!warehouseId || !specification.trim() || loading} onClick={() => void findOils()}>{loading ? "Проверяем наличие…" : "Подобрать масла из наличия"}</button>
      {error ? <p role="alert">{error}</p> : null}
      {searched && !products.length ? <p role="status">Совпадений по указанному допуску и вязкости нет. Проверьте требования и технические характеристики товаров на складе.</p> : null}
      {products.length ? <div className={styles.options} aria-label="Варианты масла">{products.map(oil => {
        const amount = quoteOilAmount(oil, litres);
        const chosen = selected.some(item => item.id === oil.id);
        return <div key={oil.id} className={styles.option}><div><strong>{oil.name}</strong><p>{oil.article} · Остаток {oil.available} {oil.unit} · {quoteRub(Math.round(oil.price * 100))} / {oil.unit}</p><p>{oil.sae} · {oil.oem}</p>{oil.price <= 0 ? <p>Цена продажи не указана — заполните карточку товара.</p> : null}{!oil.litresPerUnit ? <p>Не указан объём фасовки — заполните карточку товара.</p> : amount ? <p>{amount.quantity} {oil.unit} ({amount.suppliedLitres} л) — <b>{quoteRub(amount.cents)}</b>{!amount.enough ? " · Недостаточно на складе" : ""}</p> : null}</div><button type="button" className="eco-btn" disabled={!amount || !amount.enough || oil.price <= 0} aria-pressed={chosen} onClick={() => setSelected(rows => chosen ? rows.filter(item => item.id !== oil.id) : [...rows, oil])}>{chosen ? "Убрать вариант" : "Добавить вариант"}</button></div>;
      })}</div> : null}
      <div className={styles.heading}><strong>Расходники и работа</strong><button type="button" className="eco-btn" onClick={() => setExtras(rows => [...rows, { id: crypto.randomUUID(), name: "", quantity: 1, price: 0 }])}>Добавить строку вручную</button></div>
      <label className={styles.search}>Найти фильтр, расходник или услугу на складе<input value={search} onChange={event => { setSearch(event.target.value); setExtraProducts([]); setExtraLoading(false); setExtraError(""); }} placeholder="Название или артикул, минимум 2 символа" disabled={!warehouseId} /></label>
      {extraLoading ? <p role="status">Ищем товары и услуги…</p> : null}
      {extraError ? <p role="alert">{extraError}</p> : null}
      {extraProducts.map(product => <div key={product.id} className={styles.option}><span>{product.name} · {product.article} · {quoteRub(Math.round(product.price * 100))}</span><button type="button" className="eco-btn" onClick={() => { setExtras(rows => [...rows, { id: crypto.randomUUID(), name: product.name, quantity: 1, price: product.price }]); setSearch(""); setExtraProducts([]); }}>Добавить</button></div>)}
      <p className={styles.note}>Применяемость фильтра проверьте по подбору автомобиля. Все строки ниже входят в каждый вариант.</p>
      {extras.map(row => <div key={row.id} className={styles.extra}><label>Наименование<input value={row.name} onChange={event => updateExtra(row.id, { name: event.target.value })} placeholder="Масляный фильтр / замена масла" /></label><label>Количество<input type="number" min="0.001" step="0.001" value={Number.isFinite(row.quantity) ? row.quantity : ""} onChange={event => updateExtra(row.id, { quantity: event.target.value ? Number(event.target.value) : NaN })} /></label><label>Цена, ₽<input type="number" min="0" step="0.01" value={Number.isFinite(row.price) ? row.price : ""} onChange={event => updateExtra(row.id, { price: event.target.value ? Number(event.target.value) : NaN })} /></label><button type="button" className="eco-btn" aria-label={`Удалить строку ${row.name || "без названия"}`} onClick={() => setExtras(rows => rows.filter(item => item.id !== row.id))}>Удалить</button></div>)}
      {selected.length ? <div className={styles.totals}>{selected.map((oil, index) => {
        const amount = quoteOilAmount(oil, litres);
        return <p key={oil.id}><span>Вариант {index + 1}: {oil.name}</span><label>Цена масла за {oil.unit}, ₽<input type="number" min="0.01" step="0.01" value={Number.isFinite(oil.price) ? oil.price : ""} onChange={event => setSelected(rows => rows.map(row => row.id === oil.id ? { ...row, price: event.target.value ? Number(event.target.value) : NaN } : row))} /></label><strong>{amount && validExtras ? quoteRub(amount.cents + extraTotal) : "Уточните количество и цены"}</strong>{amount && !amount.enough ? <small>Недостаточно масла на складе — предложение будет помечено «под заказ».</small> : null}</p>;
      })}</div> : null}
      {text ? <label className={styles.preview}>Предложение клиенту<textarea readOnly rows={Math.min(18, text.split("\n").length)} value={text} /></label> : null}
      <button type="button" className="eco-btn eco-btn--primary" disabled={!ready} onClick={async () => {
        setCopyError(""); setCopied(false);
        try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopyError("Копирование недоступно. Выделите и скопируйте текст предложения выше."); }
      }}>Скопировать предложение</button>
      {copied ? <p role="status">Предложение скопировано.</p> : null}{copyError ? <p role="alert">{copyError}</p> : null}
      <p className={styles.note}>Расчёт не резервирует и не списывает товары. Черновик действует, пока открыт подбор автомобиля.</p>
    </div> : null}
  </section>;
}
