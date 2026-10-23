"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";
import type { MannFluidResearchResult } from "@/lib/mann-fluid-research";
import { groupQuoteOils, quoteVariantAmount, quoteRequirementChoices, quoteClientText, quoteExtraCents, quoteRub, type QuoteFilterGroup, type QuoteExtra, type QuoteStockProduct } from "@/lib/maintenance-quote";
import { getProductAttributeDictionary } from "@/lib/product-attribute-values";
import { QuoteSearchField } from "./QuoteSearchField";
import styles from "./MaintenanceQuotePanel.module.css";

type Props = { vehicleTitle: string; warehouseId?: string | null; profile: MannUnifiedTechnicalProfile | null; research: MannFluidResearchResult | null; filters?: QuoteFilterGroup[]; filtersLoading?: boolean; onChooseWarehouse?: () => void };
const number = (value: string) => Number(value.replace(",", "."));

export function MaintenanceQuotePanel({ vehicleTitle, warehouseId, profile, research, filters = [], filtersLoading = false, onChooseWarehouse }: Props) {
  const choices = useMemo(() => quoteRequirementChoices(profile, research), [profile, research]);
  const [open, setOpen] = useState(false);
  const [specificationDraft, setSpecification] = useState<string | null>(null);
  const [viscosityDraft, setViscosity] = useState<string | null>(null);
  const [volumeDraft, setVolume] = useState<string | null>(null);
  const [filterSelection, setFilterSelection] = useState<Record<string, string>>({});
  const specification = specificationDraft ?? (choices.specifications.length === 1 ? choices.specifications[0] : "");
  const viscosity = viscosityDraft ?? (choices.viscosities.length === 1 ? choices.viscosities[0] : "");
  const volume = volumeDraft ?? choices.automaticVolume;
  const specificationGroups = useMemo(() => [
    {label: "Автомобиль", options: choices.specifications},
    {label: "OEM", options: [...getProductAttributeDictionary("engineOem")]},
    {label: "ACEA", options: getProductAttributeDictionary("acea").map(value => `ACEA ${value}`)},
    {label: "API", options: getProductAttributeDictionary("engineApi").map(value => `API ${value}`)},
    {label: "ILSAC", options: getProductAttributeDictionary("ilsac").map(value => `ILSAC ${value}`)},
  ], [choices]);
  const referenceSpecifications = useMemo(() => [...new Set(specificationGroups.flatMap(group => group.options))], [specificationGroups]);
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
  const [supplierRefresh, setSupplierRefresh] = useState(0);
  const [supplierResults, setSupplierResults] = useState<Record<string, { products: QuoteFilterGroup["products"]; error?: string }>>({});
  const filterArticlesKey = JSON.stringify([...new Set(filters.map(group => group.article))].sort());
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setSupplierResults({});
    const articles = JSON.parse(filterArticlesKey) as string[];
    void Promise.all(articles.map(async article => {
      try {
        const response = await fetch(`/api/maintenance-quote/rossko?${new URLSearchParams({article})}`, {signal: controller.signal});
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось проверить Роско");
        if (!controller.signal.aborted) setSupplierResults(rows => ({...rows, [article]: {products: data.products}}));
      } catch (error) {
        if (!controller.signal.aborted) setSupplierResults(rows => ({...rows, [article]: {products: [], error: error instanceof Error ? error.message : "Ошибка Роско"}}));
      }
    }));
    return () => controller.abort();
  }, [open, filterArticlesKey, supplierRefresh, warehouseId]);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const requirementsKey = `${specification}|${viscosity}`;
  const previousRequirements = useRef(requirementsKey);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => {
    requestRef.current?.abort(); setProducts([]); setSelected([]); setSearched(false); setLoading(false); setExtraProducts([]); setExtraLoading(false); setExtraError(""); setError(""); setFilterSelection({});
    setExtras(rows => rows.filter(row => !row.stockStoreId || row.stockStoreId === warehouseId));
  }, [warehouseId]);
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
  const selectedVariants = useMemo(() => groupQuoteOils(selected), [selected]);
  const oilVariants = useMemo(() => groupQuoteOils(products), [products]);
  const validExtras = extras.every(row => row.name.trim() && Number.isFinite(row.quantity) && row.quantity > 0 && Number.isFinite(row.price) && row.price >= 0);
  const ready = selected.every(oil => Number.isFinite(oil.price) && oil.price > 0) && selected.length > 0 && litres > 0 && litres <= 100 && Number.isFinite(litres) && validExtras && selectedVariants.every(variant => quoteVariantAmount(variant, litres));
  const text = ready ? quoteClientText(vehicleTitle, [specification, viscosity].filter(Boolean).join(" · "), litres, selected, extras) : "";
  useEffect(() => { setCopied(false); setCopyError(""); }, [text]);
  const extraTotal = quoteExtraCents(extras);
  function updateExtra(id: string, update: Partial<QuoteExtra>) {
    setExtras(rows => rows.map(row => row.id === id ? { ...row, ...update } : row));
  }
  return <section className={styles.panel} aria-label="Расчёт ТО">
    <div className={styles.heading}><div><strong>Расчёт ТО</strong><p>Подберите масло и фильтры, проверьте наличие и подготовьте предложение клиенту.</p></div><button type="button" className="eco-btn" aria-expanded={open} onClick={() => {
      setOpen(!open);
    }}>{open ? "Свернуть расчёт" : "Рассчитать ТО"}</button></div>
    {open ? <div className={styles.body}>
      {!warehouseId ? <div className={styles.warehousePrompt}><p role="status">Для подбора из наличия выберите склад. Параметры масла и артикулы MANN можно заполнить заранее.</p>{onChooseWarehouse ? <button type="button" className="eco-btn" onClick={onChooseWarehouse}>Выбрать склад</button> : null}</div> : null}
      <div className={styles.fields}>
        <QuoteSearchField label="Допуск / стандарт" value={specification} options={referenceSpecifications} groups={specificationGroups} onChange={value => { invalidate(); setSpecification(value); }} />
        <QuoteSearchField label="Вязкость" value={viscosity} options={[...choices.viscosities, ...referenceViscosities]} onChange={value => { invalidate(); setViscosity(value); }} />
        <QuoteSearchField label="Объём замены, л" value={volume} options={[...choices.volumes.map(String), ...referenceVolumes]} onChange={setVolume} inputMode="decimal" />
      </div>
      <p className={styles.note}>Данные автомобиля подставляются после загрузки. Если вариантов несколько, выберите подходящий. Объём — с фильтром; значения из общего справочника нужно сверить с требованиями автомобиля.</p>
      <button type="button" className="eco-btn eco-btn--primary" disabled={!warehouseId || !specification.trim() || loading} onClick={() => void findOils()}>{loading ? "Проверяем наличие…" : "Подобрать масла из наличия"}</button>
      {error ? <p role="alert">{error}</p> : null}
      {searched && !products.length ? <p role="status">Совпадений по указанному допуску и вязкости нет. Проверьте требования и технические характеристики товаров на складе.</p> : null}
      {products.length ? <div className={styles.options} aria-label="Варианты масла">{oilVariants.map(variant => {
        const amount = quoteVariantAmount(variant, litres);
        const chosen = selectedVariants.some(item => item.key === variant.key);
        return <div key={variant.key} className={styles.option}><div><strong>{variant.name}</strong>
          {variant.products.map(oil => <p key={oil.id}>Фасовка {oil.litresPerUnit ?? "?"} л · остаток {oil.available} {oil.unit} · {quoteRub(Math.round(oil.price * 100))} / {oil.unit}</p>)}
          {amount ? <p>Комплект: {amount.lines.map(line=>`${line.quantity} × ${line.product.litresPerUnit} л`).join(" + ")} — <b>{quoteRub(amount.cents)}</b>{!amount.enough ? " · Недостаточно на складе" : ""}</p> : <p>Уточните объём, фасовку и цену.</p>}
        </div><button type="button" className="eco-btn" disabled={!chosen && (!amount || !amount.enough)} aria-pressed={chosen} onClick={() => setSelected(rows => chosen ? rows.filter(item => !variant.products.some(product=>product.id===item.id)) : [...rows, ...variant.products.filter(item=>item.price>0 && item.litresPerUnit)])}>{chosen ? "Убрать вариант" : "Добавить вариант"}</button></div>;
      })}</div> : null}
      <div className={styles.heading}><strong>Расходники и работа</strong><button type="button" className="eco-btn" onClick={() => setExtras(rows => [...rows, { id: crypto.randomUUID(), name: "", quantity: 1, price: 0 }])}>Добавить строку вручную</button></div>
      <div className={styles.filterPicker} aria-label="Фильтры из подбора MANN">
        <div className={styles.filterHeading}><strong>Фильтры для выбранного автомобиля</strong>{filters.length ? <button type="button" className="eco-btn" onClick={() => setSupplierRefresh(value => value + 1)}>Обновить Роско</button> : null}</div>
        {filtersLoading ? <p role="status">Загружаем подбор MANN…</p> : !filters.length ? <p className={styles.note}>После выбора модификации здесь появятся масляный, воздушный и салонный фильтры из MANN.</p> : null}
        {filters.map(group => {
          const supplier = supplierResults[group.article];
          const bestSupplier = supplier?.products.reduce<QuoteFilterGroup["products"][number] | undefined>((best, item) => !best || item.price < best.price ? item : best, undefined);
          const filterProducts = [...(warehouseId ? group.products : []), ...(supplier?.products ?? [])];
          const rowId = `mann:${group.key}`;
          const existingRow = extras.find(row => row.id === rowId);
          const selectedId = filterSelection[group.key] ?? (existingRow && !existingRow.stockStoreId ? "reference" : "");
          return <div key={group.key} className={styles.filterRow}>
            <label>{group.label} · MANN {group.article}<select aria-label={`Товар для ${group.label} MANN ${group.article}`} value={selectedId} disabled={filtersLoading} onChange={event => {
              const value=event.target.value;
              setFilterSelection(values => ({...values, [group.key]: value}));
              const chosen=filterProducts.find(item=>item.id===value);
              setExtras(rows => {
                const others=rows.filter(row=>row.id!==rowId);
                if (!value || (value!=="reference" && !chosen)) return others;
                return [...others,{id:rowId,name:chosen ? `${chosen.name}${chosen.source === "rossko" ? ` (Роско: ${chosen.deliveryLabel})` : chosen.available<1 ? " (под заказ)" : ""}` : `${group.label} MANN ${group.article}`,quantity:1,price:chosen && chosen.price>0 ? chosen.price : NaN,...(chosen && warehouseId && chosen.source !== "rossko" ? {stockStoreId:warehouseId} : {})}];
              });
            }}>
              <option value="">Выберите подходящий товар</option>
              {filterProducts.map(item => <option key={item.id} value={item.id} disabled={item.available < 1 && !item.orderable}>{item.name} · {quoteRub(Math.round(item.price * 100))} · {item.source === "rossko" ? `Роско · ${item.available} шт. · ${item.deliveryLabel}` : item.available >= 1 ? `наш склад: ${item.available} шт.` : item.orderable ? "под заказ" : "нет в наличии"}</option>)}
              <option value="reference">MANN {group.article} — указать цену</option>
            </select></label>
            {existingRow ? <><label className={styles.filterPrice}>Цена фильтра, ₽<input aria-label={`Цена ${group.label} MANN ${group.article}, ₽`} type="number" min="0" step="0.01" placeholder="Укажите цену" value={Number.isFinite(existingRow.price) ? existingRow.price : ""} onChange={event=>updateExtra(rowId,{price:event.target.value ? Number(event.target.value) : NaN})} /></label><button type="button" className="eco-btn" onClick={()=>{setExtras(rows=>rows.filter(row=>row.id!==rowId));setFilterSelection(values=>({...values,[group.key]:""}));}}>Убрать фильтр</button><small className={styles.filterAdded}>Добавлен в расчёт{!Number.isFinite(existingRow.price) ? " — укажите цену рядом" : ""}</small></> : null}
            {!supplier ? <p className={styles.note} role="status">Проверяем цену и доставку в Роско…</p> : supplier.error ? <p className={styles.note} role="status">Роско: {supplier.error}</p> : !supplier.products.length ? <p className={styles.note}>В Роско нет доступных предложений MANN {group.article}.</p> : <p className={styles.note}>Роско: {quoteRub(Math.round(bestSupplier!.price * 100))} · {bestSupplier!.available} шт. · {bestSupplier!.deliveryLabel}. Выберите предложение в списке — цена и срок добавятся в расчёт.</p>}
            {group.condition ? <p className={styles.note}>Условие MANN: {group.condition}</p> : null}
          </div>;
        })}
      </div>
      <label className={styles.search}>Найти фильтр, расходник или услугу на складе<input value={search} onChange={event => { setSearch(event.target.value); setExtraProducts([]); setExtraLoading(false); setExtraError(""); }} placeholder="Название или артикул, минимум 2 символа" disabled={!warehouseId} /></label>
      {extraLoading ? <p role="status">Ищем товары и услуги…</p> : null}
      {extraError ? <p role="alert">{extraError}</p> : null}
      {extraProducts.map(product => <div key={product.id} className={styles.option}><span>{product.name} · {product.article} · {quoteRub(Math.round(product.price * 100))}</span><button type="button" className="eco-btn" onClick={() => { setExtras(rows => [...rows, { id: crypto.randomUUID(), name: product.name, quantity: 1, price: product.price, stockStoreId: warehouseId ?? undefined }]); setSearch(""); setExtraProducts([]); }}>Добавить</button></div>)}
      <p className={styles.note}>Применяемость фильтра проверьте по подбору автомобиля. Все строки ниже входят в каждый вариант.</p>
      {extras.map(row => <div key={row.id} className={styles.extra}><label>Наименование<input value={row.name} onChange={event => updateExtra(row.id, { name: event.target.value })} placeholder="Масляный фильтр / замена масла" /></label><label>Количество<input type="number" min="0.001" step="0.001" value={Number.isFinite(row.quantity) ? row.quantity : ""} onChange={event => updateExtra(row.id, { quantity: event.target.value ? Number(event.target.value) : NaN })} /></label><label>Цена, ₽<input type="number" min="0" step="0.01" value={Number.isFinite(row.price) ? row.price : ""} onChange={event => updateExtra(row.id, { price: event.target.value ? Number(event.target.value) : NaN })} /></label><button type="button" className="eco-btn" aria-label={`Удалить строку ${row.name || "без названия"}`} onClick={() => setExtras(rows => rows.filter(item => item.id !== row.id))}>Удалить</button></div>)}
      {selectedVariants.length ? <div className={styles.totals}>{selectedVariants.map((variant, index) => {
        const amount = quoteVariantAmount(variant, litres);
        return <div key={variant.key} className={styles.variantTotal}><span>Вариант {index + 1}: {variant.name}</span>
          {variant.products.map(oil=><label key={oil.id}>Цена {oil.litresPerUnit} л / {oil.unit}, ₽<input aria-label={`Цена ${oil.name}, ₽`} type="number" min="0.01" step="0.01" value={Number.isFinite(oil.price) ? oil.price : ""} onChange={event => setSelected(rows => rows.map(row => row.id === oil.id ? { ...row, price: event.target.value ? Number(event.target.value) : NaN } : row))} /></label>)}
          <strong>{amount && validExtras ? quoteRub(amount.cents + extraTotal) : "Уточните количество и цены"}</strong>
          {amount ? <small>Комплект: {amount.lines.map(line=>`${line.quantity} × ${line.product.litresPerUnit} л`).join(" + ")}{!amount.enough ? " · недостаточно на складе" : ""}</small> : null}
        </div>;
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
