"use client";

import { useEffect, useRef, useState } from "react";
import type { MannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";
import type { MannFluidResearchResult } from "@/lib/mann-fluid-research";
import { quoteRequirementChoices, quoteClientText, quoteExtraCents, quoteOilAmount, quoteRub, type QuoteFilterGroup, type QuoteExtra, type QuoteStockProduct } from "@/lib/maintenance-quote";
import { getProductAttributeDictionary } from "@/lib/product-attribute-values";
import { QuoteSearchField } from "./QuoteSearchField";
import styles from "./MaintenanceQuotePanel.module.css";

type Props = { vehicleTitle: string; warehouseId?: string | null; profile: MannUnifiedTechnicalProfile | null; research: MannFluidResearchResult | null; filters?: QuoteFilterGroup[]; filtersLoading?: boolean };
const number = (value: string) => Number(value.replace(",", "."));

export function MaintenanceQuotePanel({ vehicleTitle, warehouseId, profile, research, filters = [], filtersLoading = false }: Props) {
  const choices = quoteRequirementChoices(profile, research);
  const [open, setOpen] = useState(false);
  const [specificationDraft, setSpecification] = useState<string | null>(null);
  const [viscosityDraft, setViscosity] = useState<string | null>(null);
  const [volumeDraft, setVolume] = useState<string | null>(null);
  const [filterSelection, setFilterSelection] = useState<Record<string, string>>({});
  const specification = specificationDraft ?? (choices.specifications.length === 1 ? choices.specifications[0] : "");
  const viscosity = viscosityDraft ?? (choices.viscosities.length === 1 ? choices.viscosities[0] : "");
  const volume = volumeDraft ?? choices.automaticVolume;
  const referenceSpecifications = [...new Set([...getProductAttributeDictionary("engineOem"), ...getProductAttributeDictionary("acea"), ...getProductAttributeDictionary("engineApi"), ...getProductAttributeDictionary("ilsac")].filter(value => value && !choices.specifications.includes(value)))];
  const referenceViscosities = [...new Set([...getProductAttributeDictionary("engineSae")].filter(value => value && !choices.viscosities.includes(value)))];
  const referenceVolumes = [...new Set([...Array.from({length: 25}, (_, index) => String(2 + index * 0.5))].filter(value => value && !choices.volumes.map(String).includes(value)))];
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
  const requirementsKey = `${specification}|${viscosity}`;
  const previousRequirements = useRef(requirementsKey);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    if (previousRequirements.current === requirementsKey) return;
    previousRequirements.current = requirementsKey;
    requestRef.current?.abort(); setProducts([]); setSelected([]); setSearched(false); setLoading(false); setError("");
  }, [requirementsKey]);
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
      setOpen(!open);
    }}>{open ? "Свернуть расчёт" : "Рассчитать ТО"}</button></div>
    {open ? <div className={styles.body}>
      {!warehouseId ? <p role="status">Выберите склад в документе, чтобы увидеть наличие и цены.</p> : null}
      <div className={styles.fields}>
        <QuoteSearchField label="Допуск / стандарт" value={specification} options={[...choices.specifications, ...referenceSpecifications]} onChange={value => { invalidate(); setSpecification(value); }} />
        <QuoteSearchField label="Вязкость" value={viscosity} options={[...choices.viscosities, ...referenceViscosities]} onChange={value => { invalidate(); setViscosity(value); }} />
        <QuoteSearchField label="Объём замены, л" value={volume} options={[...choices.volumes.map(String), ...referenceVolumes]} onChange={setVolume} inputMode="decimal" />
      </div>
      <p className={styles.note}>Данные автомобиля подставляются после загрузки. Если вариантов несколько, выберите подходящий. Объём — с фильтром; значения из общего справочника нужно сверить с требованиями автомобиля.</p>
      <button type="button" className="eco-btn eco-btn--primary" disabled={!warehouseId || !specification.trim() || loading} onClick={() => void findOils()}>{loading ? "Проверяем наличие…" : "Подобрать масла из наличия"}</button>
      {error ? <p role="alert">{error}</p> : null}
      {searched && !products.length ? <p role="status">Совпадений по указанному допуску и вязкости нет. Проверьте требования и технические характеристики товаров на складе.</p> : null}
      {products.length ? <div className={styles.options} aria-label="Варианты масла">{products.map(oil => {
        const amount = quoteOilAmount(oil, litres);
        const chosen = selected.some(item => item.id === oil.id);
        return <div key={oil.id} className={styles.option}><div><strong>{oil.name}</strong><p>{oil.article} · Остаток {oil.available} {oil.unit} · {quoteRub(Math.round(oil.price * 100))} / {oil.unit}</p><p>{oil.sae} · {oil.oem}</p>{oil.price <= 0 ? <p>Цена продажи не указана — заполните карточку товара.</p> : null}{!oil.litresPerUnit ? <p>Не указан объём фасовки — заполните карточку товара.</p> : amount ? <p>{amount.quantity} {oil.unit} ({amount.suppliedLitres} л) — <b>{quoteRub(amount.cents)}</b>{!amount.enough ? " · Недостаточно на складе" : ""}</p> : null}</div><button type="button" className="eco-btn" disabled={!amount || !amount.enough || oil.price <= 0} aria-pressed={chosen} onClick={() => setSelected(rows => chosen ? rows.filter(item => item.id !== oil.id) : [...rows, oil])}>{chosen ? "Убрать вариант" : "Добавить вариант"}</button></div>;
      })}</div> : null}
      <div className={styles.heading}><strong>Расходники и работа</strong><button type="button" className="eco-btn" onClick={() => setExtras(rows => [...rows, { id: crypto.randomUUID(), name: "", quantity: 1, price: 0 }])}>Добавить строку вручную</button></div>
      <div className={styles.filterPicker} aria-label="Фильтры из подбора MANN">
        <strong>Фильтры для выбранного автомобиля</strong>
        {filtersLoading ? <p role="status">Загружаем подбор MANN…</p> : !filters.length ? <p className={styles.note}>После выбора модификации здесь появятся масляный, воздушный и салонный фильтры из MANN.</p> : null}
        {filters.map(group => {
          const selectedId = filterSelection[group.key] ?? "";
          const product = group.products.find(item => item.id === selectedId);
          const rowId = `mann:${group.key}`;
          const added = extras.some(row => row.id === rowId);
          return <div key={group.key} className={styles.filterRow}>
            <label>{group.label} · MANN {group.article}<select aria-label={`Товар для ${group.label} MANN ${group.article}`} value={selectedId} disabled={!warehouseId || added || filtersLoading} onChange={event => setFilterSelection(values => ({...values, [group.key]: event.target.value}))}>
              <option value="">Выберите подходящий товар</option>
              {group.products.map(item => <option key={item.id} value={item.id} disabled={item.available < 1 && !item.orderable}>{item.name} · {quoteRub(Math.round(item.price * 100))} · {item.available >= 1 ? `в наличии ${item.available} шт.` : item.orderable ? "под заказ" : "нет в наличии"}</option>)}
              <option value="reference">MANN {group.article} — указать цену</option>
            </select></label>
            <button type="button" className="eco-btn" disabled={!warehouseId || !selectedId || (!product && selectedId !== "reference") || added || filtersLoading} onClick={() => setExtras(rows => [...rows, {id: rowId, name: product ? `${product.name}${product.available < 1 ? " (под заказ)" : ""}` : `${group.label} MANN ${group.article}`, quantity: 1, price: product && product.price > 0 ? product.price : NaN}])}>{added ? "В расчёте" : "Добавить фильтр"}</button>
            {group.condition ? <p className={styles.note}>Условие MANN: {group.condition}</p> : null}
          </div>;
        })}
      </div>
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
