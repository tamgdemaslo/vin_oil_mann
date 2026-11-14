"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";
import type { MannFluidResearchResult } from "@/lib/mann-fluid-research";
import { groupQuoteOils, sortQuoteFilterOffers, quoteVariantAmount, quoteRequirementChoices, quoteClientText, quoteExtraCents, quoteRub, type QuoteFilterGroup, type QuoteExtra, type QuoteStockProduct } from "@/lib/maintenance-quote";
import { getProductAttributeDictionary } from "@/lib/product-attribute-values";
import { QuoteFilterOffers } from "./QuoteFilterOffers";
import { QuoteSearchField } from "./QuoteSearchField";
import styles from "./MaintenanceQuotePanel.module.css";

export type MaintenanceQuoteVehicleContext = { key: string; vin: string | null; vehicleTitle: string; profile: MannUnifiedTechnicalProfile | null; research: MannFluidResearchResult | null };
type Props = { vehicleSetup?: ReactNode; quoteContextKey?: string; vehicleTitle: string; warehouseId?: string | null; profile: MannUnifiedTechnicalProfile | null; research: MannFluidResearchResult | null; requirements?: ReturnType<typeof quoteRequirementChoices>; filters?: QuoteFilterGroup[]; filtersLoading?: boolean };
const number = (value: string) => Number(value.replace(",", "."));

export function MaintenanceQuotePanel({ vehicleSetup, quoteContextKey, vehicleTitle, warehouseId, profile, research, requirements, filters: vehicleFilters = [], filtersLoading = false }: Props) {
  const choices = useMemo(() => profile || research ? quoteRequirementChoices(profile, research, { prefillResearchVolume: true }) : requirements ?? quoteRequirementChoices(null, null), [profile, research, requirements]);
  const [manualFilters, setManualFilters] = useState<QuoteFilterGroup[]>([]);
  const [manualArticle, setManualArticle] = useState("");
  const [manualFilterType, setManualFilterType] = useState("Масляный фильтр");
  const filters = useMemo(() => [...vehicleFilters, ...manualFilters.filter(group => !vehicleFilters.some(item => item.article.replace(/[^a-z0-9]/gi, "").toUpperCase() === group.article.replace(/[^a-z0-9]/gi, "").toUpperCase()))], [vehicleFilters, manualFilters]);
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
  }, [filterArticlesKey, supplierRefresh, warehouseId]);
  const previousVehicle = useRef(quoteContextKey);
  useEffect(() => {
    if (previousVehicle.current === quoteContextKey) return;
    previousVehicle.current = quoteContextKey;
    requestRef.current?.abort();
    setSelected([]); setProducts([]); setExtras([]); setManualFilters([]); setFilterSelection({});
    setSpecification(null); setViscosity(null); setVolume(null); setSearched(false); setError(""); setLoading(false);
    setSearch(""); setExtraProducts([]); setExtraError(""); setExtraLoading(false);
  }, [quoteContextKey]);
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
    if (!warehouseId || search.trim().length < 2) return;
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
  }, [search, warehouseId]);

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
  const ready = validExtras && (selected.length > 0 ? selected.every(oil => Number.isFinite(oil.price) && oil.price > 0) && litres > 0 && litres <= 100 && Number.isFinite(litres) && selectedVariants.every(variant => quoteVariantAmount(variant, litres)) : extras.length > 0);
  const text = ready ? quoteClientText(vehicleTitle, [specification, viscosity].filter(Boolean).join(" · "), litres, selected, extras) : "";
  useEffect(() => { setCopied(false); setCopyError(""); }, [text]);
  const extraTotal = quoteExtraCents(extras);
  const isFilter = (row: QuoteExtra) => Boolean(row.filterLabel) || /^(?:масляный|воздушный|салонный|топливный)\s+фильтр/i.test(row.name);
  const filterRows = extras.filter(isFilter);
  const otherRows = extras.filter(row => !isFilter(row));
  const variantAmounts = selectedVariants.map(variant => quoteVariantAmount(variant, litres));
  const totals = ready ? variantAmounts.flatMap(amount => amount ? [amount.cents + extraTotal] : []) : [];
  const totalLabel = !ready ? (selected.length || extras.length ? "Уточните позиции" : quoteRub(0)) : totals.length > 1 ? `${quoteRub(Math.min(...totals))} – ${quoteRub(Math.max(...totals))}` : quoteRub(totals[0] ?? extraTotal);
  function updateExtra(id: string, update: Partial<QuoteExtra>) {
    setExtras(rows => rows.map(row => row.id === id ? { ...row, ...update } : row));
  }
  return <div className={`${styles.panel} ${vehicleSetup ? styles.workspace : ""}`}>
    <div className={styles.body}>
      {vehicleSetup}
      <section id="quote-oil" className={styles.step} aria-labelledby="quote-oil-title">
      <header className={styles.stepHeader}><div><h2 id="quote-oil-title">Моторное масло</h2><p>Проверьте допуск, вязкость и объём замены.</p></div></header>
      {!warehouseId && <p className={styles.warehousePrompt} role="status">Выберите склад в блоке «Автомобиль и склад», чтобы проверить наличие.</p>}
      <div className={styles.fields}>
        <QuoteSearchField label="Допуск / стандарт" value={specification} options={referenceSpecifications} groups={specificationGroups} onChange={value => { invalidate(); setSpecification(value); }} />
        <QuoteSearchField label="Вязкость" value={viscosity} options={[...choices.viscosities, ...referenceViscosities]} onChange={value => { invalidate(); setViscosity(value); }} />
        <QuoteSearchField label="Объём замены, л" value={volume} options={[...choices.volumes.map(String), ...referenceVolumes]} onChange={setVolume} inputMode="decimal" />
      </div>
      <p className={styles.note}>{volumeDraft === null && "volumeFromResearch" in choices && choices.volumeFromResearch
        ? "Объём из предварительных данных. Сверьте его в технических сведениях автомобиля."
        : "Объём замены указан с фильтром."}</p>
      <button type="button" className="eco-btn eco-btn--primary" disabled={!warehouseId || !specification.trim() || loading} onClick={() => void findOils()}>{loading ? "Проверяем наличие…" : "Подобрать масло"}</button>
      {error ? <p role="alert">{error}</p> : null}
      {searched && !products.length ? <p role="status">Совпадений по указанному допуску и вязкости нет. Проверьте требования и технические характеристики товаров на складе.</p> : null}
      {products.length ? <div className={styles.oilTable} aria-label="Варианты масла"><div className={styles.oilColumns} aria-hidden="true"><span>Масло и фасовка</span><span>Стоимость</span><span>Вариант</span></div>{oilVariants.map(variant => {
        const amount = quoteVariantAmount(variant, litres);
        const chosen = selectedVariants.some(item => item.key === variant.key);
        return <div key={variant.key} className={styles.oilColumns} data-selected={chosen}><div><strong>{variant.name}</strong>
          {variant.products.map(oil => <p key={oil.id}>Наш склад · {oil.article || "Артикул не указан"} · фасовка {oil.litresPerUnit ?? "?"} л · остаток {oil.available} {oil.unit} · {quoteRub(Math.round(oil.price * 100))} / {oil.unit}</p>)}
          {amount ? <p>Комплект: {amount.lines.map(line=>`${line.quantity} × ${line.product.litresPerUnit} л`).join(" + ")}{!amount.enough ? " · Недостаточно на складе" : ""}</p> : <p>Уточните объём, фасовку и цену.</p>}
        </div><strong className={styles.oilPrice}>{amount ? quoteRub(amount.cents) : "—"}</strong><button type="button" className="eco-btn" disabled={!chosen && (!amount || !amount.enough)} aria-pressed={chosen} onClick={() => setSelected(rows => chosen ? rows.filter(item => !variant.products.some(product=>product.id===item.id)) : [...rows, ...variant.products.filter(item=>item.price>0 && item.litresPerUnit)])}>{chosen ? "Убрать вариант" : "Добавить в расчёт"}</button></div>;
      })}</div> : null}
      </section>
      <section className={styles.step} aria-labelledby="quote-parts-title">
      <header className={styles.stepHeader}><div><h2 id="quote-parts-title">Фильтры</h2></div></header>
      <div className={styles.filterPicker} aria-label="Фильтры из подбора MANN">
        <div className={styles.filterHeading}>{filters.length ? <button type="button" className="eco-btn" onClick={() => setSupplierRefresh(value => value + 1)}>Обновить Роско</button> : null}</div>
        {filtersLoading ? <p role="status">Загружаем подбор MANN…</p> : !filters.length ? <p className={styles.note}>Выберите автомобиль для подбора фильтров или укажите известный артикул MANN ниже.</p> : null}
        <details className={styles.articleDisclosure} open={!filters.length}>
          <summary>Найти по артикулу</summary>
          <div className={styles.filterArticleEntry}>
          <label>Тип фильтра<select value={manualFilterType} onChange={event => setManualFilterType(event.target.value)}>{["Масляный фильтр", "Воздушный фильтр", "Салонный фильтр", "Топливный фильтр"].map(label => <option key={label}>{label}</option>)}</select></label>
          <label>Артикул MANN<input value={manualArticle} onChange={event => setManualArticle(event.target.value)} placeholder="Например: CU 3172/1" maxLength={64} /></label>
          <button type="button" className="eco-btn" disabled={!/[a-z0-9]/i.test(manualArticle)} onClick={() => {
            const article = manualArticle.trim().toUpperCase();
            const key = `manual:${article.replace(/[^A-Z0-9]/g, "")}`;
            if (!key.slice(7)) return;
            setManualFilters(rows => rows.some(row => row.key === key) ? rows : [...rows, {key, label: manualFilterType, article, condition: "Артикул указан вручную — сверьте применяемость с автомобилем.", products: []}]);
            setManualArticle("");
            setSupplierRefresh(value => value + 1);
          }}>Найти предложения</button>
        </div>
        </details>
        {filters.map((group, index) => {
          const supplier = supplierResults[group.article];
          const localProducts = warehouseId ? group.products : [];
          const warehouseProducts = [...localProducts].sort((a, b) =>
            Number(b.available > 0) - Number(a.available > 0) || a.price - b.price);
          const supplierProducts = sortQuoteFilterOffers(supplier?.products ?? [], "delivery");
          const filterProducts = [...warehouseProducts, ...supplierProducts];
          const rowId = `mann:${group.key}`;
          const existingRow = extras.find(row => row.id === rowId);
          const selectedId = filterSelection[group.key] ?? existingRow?.supplierProductId ?? (existingRow && !existingRow.stockStoreId ? "reference" : "");
          function chooseFilter(value: string) {
              setFilterSelection(values => ({...values, [group.key]: value}));
              const chosen=filterProducts.find(item=>item.id===value);
              setExtras(rows => {
                const others=rows.filter(row=>row.id!==rowId);
                if (!value || (value!=="reference" && !chosen)) return others;
                return [...others,{id:rowId,filterLabel:group.label,brand:chosen ? chosen.brand : "MANN",name:chosen ? `${chosen.name}${chosen.source === "rossko" ? ` (${chosen.relation === "analogue" ? `аналог Роско для MANN ${group.article}; ` : "Роско: "}${chosen.deliveryLabel})` : chosen.available<1 ? " (под заказ)" : ""}` : `${group.label} MANN ${group.article}`,quantity:1,price:chosen && chosen.price>0 ? chosen.price : NaN,...(chosen?.source === "rossko" ? {supplierProductId:chosen.id} : {}),...(chosen && warehouseId && chosen.source !== "rossko" ? {stockStoreId:warehouseId} : {})}];
              });
          }
          return <div key={group.key} className={styles.filterRow}>
            <div className={styles.filterGroupHeading}>
              <strong>{group.label} · MANN {group.article}</strong>
              {!existingRow && <button type="button" className={styles.manualFilterPrice} disabled={filtersLoading} onClick={() => chooseFilter("reference")}>Указать цену вручную</button>}
            </div>
            {filterProducts.length > 0 && <QuoteFilterOffers products={filterProducts} selectedId={selectedId} compact={Boolean(vehicleSetup)} initiallyExpanded={Boolean(vehicleSetup) || index === 0} label={`${group.label} MANN ${group.article}`} disabled={filtersLoading} onSelect={chooseFilter} />}
            {existingRow ? <details className={styles.filterEditor} open={!Number.isFinite(existingRow.price) || undefined}><summary>В расчёте · изменить количество или цену</summary><div><label className={styles.filterPrice}>Цена фильтра, ₽<input aria-label={`Цена ${group.label} MANN ${group.article}, ₽`} type="number" min="0" step="0.01" placeholder="Укажите цену" value={Number.isFinite(existingRow.price) ? existingRow.price : ""} onChange={event=>updateExtra(rowId,{price:event.target.value ? Number(event.target.value) : NaN})} /></label><label className={styles.filterPrice}>Количество<input aria-label={`Количество ${group.label} MANN ${group.article}`} type="number" min="0.001" step="0.001" value={Number.isFinite(existingRow.quantity) ? existingRow.quantity : ""} onChange={event => updateExtra(rowId, {quantity: event.target.value ? Number(event.target.value) : NaN})} /></label><button type="button" className="eco-btn" onClick={()=>{setExtras(rows=>rows.filter(row=>row.id!==rowId));setFilterSelection(values=>({...values,[group.key]:""}));}}>Убрать фильтр</button><small className={styles.filterAdded}>{existingRow.name} · в расчёте{existingRow.supplierProductId ? " · Роско" : existingRow.stockStoreId ? " · Наш склад" : ""}{!Number.isFinite(existingRow.price) ? " — укажите цену рядом" : ""}</small></div></details> : null}
            {!supplier ? <p className={styles.note} role="status">Проверяем цену и доставку в Роско…</p> : supplier.error ? <p className={styles.note} role="status">Роско: {supplier.error}</p> : !supplier.products.length ? <p className={styles.note}>В Роско нет доступных предложений MANN {group.article} и его аналогов.</p> : null}
            {group.condition ? <p className={styles.note}>Условие MANN: {group.condition}</p> : null}
          </div>;
        })}
        {filterRows.filter(row => !filters.some(group => row.id === `mann:${group.key}`)).map(row => <div key={row.id} className={styles.extra}>
          <label>Фильтр<input value={row.name} onChange={event => updateExtra(row.id, { name: event.target.value })} /></label>
          <label>Количество<input type="number" min="0.001" step="0.001" value={Number.isFinite(row.quantity) ? row.quantity : ""} onChange={event => updateExtra(row.id, { quantity: event.target.value ? Number(event.target.value) : NaN })} /></label>
          <label>Цена, ₽<input type="number" min="0" step="0.01" value={Number.isFinite(row.price) ? row.price : ""} onChange={event => updateExtra(row.id, { price: event.target.value ? Number(event.target.value) : NaN })} /></label>
          <button type="button" className="eco-btn" aria-label={`Удалить ${row.name}`} onClick={() => setExtras(rows => rows.filter(item => item.id !== row.id))}>Удалить</button>
        </div>)}
      </div>
      </section>
      <section className={styles.step} aria-labelledby="quote-work-title">
      <header className={styles.stepHeader}><div><h2 id="quote-work-title">Работы</h2></div></header>
      <label className={styles.search}>Найти услугу или расходник<input value={search} onChange={event => { setSearch(event.target.value); setExtraProducts([]); setExtraLoading(false); setExtraError(""); }} placeholder="Название или артикул, минимум 2 символа" disabled={!warehouseId} /></label>
      {extraLoading ? <p role="status">Ищем товары и услуги…</p> : null}
      {extraError ? <p role="alert">{extraError}</p> : null}
      {extraProducts.map(product => <div key={product.id} className={styles.option}><span>{product.name} · {product.article} · {quoteRub(Math.round(product.price * 100))}</span><button type="button" className="eco-btn" onClick={() => { setExtras(rows => [...rows, { id: crypto.randomUUID(), name: product.name, brand: product.brand, quantity: 1, price: product.price, stockStoreId: warehouseId ?? undefined }]); setSearch(""); setExtraProducts([]); }}>Добавить</button></div>)}
      <p className={styles.note}>Работы и расходники включаются в каждый вариант предложения.</p>
      <button type="button" className="eco-btn" onClick={() => setExtras(rows => [...rows, { id: crypto.randomUUID(), name: "", quantity: 1, price: 0 }])}>Добавить работу</button>
      {otherRows.map(row => <div key={row.id} className={styles.extra}><label>Наименование<input value={row.name} onChange={event => updateExtra(row.id, { name: event.target.value })} placeholder="Масляный фильтр / замена масла" /></label><label>Количество<input type="number" min="0.001" step="0.001" value={Number.isFinite(row.quantity) ? row.quantity : ""} onChange={event => updateExtra(row.id, { quantity: event.target.value ? Number(event.target.value) : NaN })} /></label><label>Цена, ₽<input type="number" min="0" step="0.01" value={Number.isFinite(row.price) ? row.price : ""} onChange={event => updateExtra(row.id, { price: event.target.value ? Number(event.target.value) : NaN })} /></label><button type="button" className="eco-btn" aria-label={`Удалить строку ${row.name || "без названия"}`} onClick={() => setExtras(rows => rows.filter(item => item.id !== row.id))}>Удалить</button></div>)}
      </section>
    </div>
    <aside id="quote-summary" tabIndex={-1} className={styles.summary} aria-labelledby="quote-summary-title">
      <header className={styles.stepHeader}><div><h2 id="quote-summary-title">Предложение клиенту</h2><p>{vehicleTitle}</p></div></header>
      {!selectedVariants.length && !extras.length && <p className={styles.empty}>Добавьте позиции из подбора. Итог рассчитается автоматически.</p>}
      {!!extras.length && !validExtras && <p className={styles.note}>Проверьте наименования, количество и цены добавленных позиций.</p>}
      {selectedVariants.length ? <details className={styles.priceEditor}><summary>Изменить цены масла</summary><div className={styles.totals}>{selectedVariants.map((variant, index) => {
        const amount = quoteVariantAmount(variant, litres);
        return <div key={variant.key} className={styles.variantTotal}><span>Вариант {index + 1}: {variant.name}</span>
          {variant.products.map(oil=><label key={oil.id}>Цена {oil.litresPerUnit} л / {oil.unit}, ₽<input aria-label={`Цена ${oil.name}, ₽`} type="number" min="0.01" step="0.01" value={Number.isFinite(oil.price) ? oil.price : ""} onChange={event => setSelected(rows => rows.map(row => row.id === oil.id ? { ...row, price: event.target.value ? Number(event.target.value) : NaN } : row))} /></label>)}
          <strong>{amount && validExtras ? quoteRub(amount.cents + extraTotal) : "Уточните количество и цены"}</strong>
          {amount ? <small>Комплект: {amount.lines.map(line=>`${line.quantity} × ${line.product.litresPerUnit} л`).join(" + ")}{!amount.enough ? " · недостаточно на складе" : ""}</small> : null}
        </div>;
      })}</div></details> : null}
      {(selected.length > 0 || extras.length > 0) && <div className={styles.groupedSummary}>
        <h3>Масло</h3>
        {selectedVariants.length ? selectedVariants.map(variant => { const amount = quoteVariantAmount(variant, litres); return <div key={variant.key} className={styles.summaryLine}><span>{variant.name}</span><strong>{amount ? quoteRub(amount.cents) : "Уточните цену"}</strong></div>; }) : <p className={styles.note}>Масло не добавлено</p>}
        <h3>Фильтры</h3>
        {filterRows.length ? filterRows.map(row => <div key={row.id} className={styles.summaryLine}><span>{row.name}<small>{row.quantity} шт.</small></span><strong>{Number.isFinite(row.price) ? quoteRub(quoteExtraCents([row])) : "Укажите цену"}</strong></div>) : <p className={styles.note}>Фильтры не добавлены</p>}
        <h3>Работы и прочие позиции</h3>
        {otherRows.length ? otherRows.map(row => <div key={row.id} className={styles.summaryLine}><span>{row.name || "Без названия"}<small>Количество: {Number.isFinite(row.quantity) ? row.quantity : "—"}</small></span><strong>{Number.isFinite(row.price) && Number.isFinite(row.quantity) ? quoteRub(quoteExtraCents([row])) : "Уточните цену"}</strong></div>) : <p className={styles.note}>Работы не добавлены</p>}
      </div>}
      <div className={styles.singleTotal} aria-live="polite"><span>{totals.length > 1 ? "Итого по вариантам" : "Итого"}</span><strong>{totalLabel}</strong></div>
      {totals.length > 1 && <p className={styles.note}>Каждый вариант масла — отдельное предложение. Фильтры и работы включены в каждый вариант.</p>}
      {text ? <details className={styles.preview} open={copyError ? true : undefined}><summary>Предпросмотр предложения</summary><label>Текст для клиента<textarea readOnly rows={Math.min(18, text.split("\n").length)} value={text} /></label></details> : null}
      <button type="button" className="eco-btn eco-btn--primary" disabled={!ready} onClick={async () => {
        setCopyError(""); setCopied(false);
        try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopyError("Копирование недоступно. Выделите и скопируйте текст предложения выше."); }
      }}>Скопировать предложение</button>
      {copied ? <p role="status">Предложение скопировано.</p> : null}{copyError ? <p role="alert">{copyError}</p> : null}
      <p className={styles.note}>Скопируйте предложение перед закрытием страницы.</p>
    </aside>
    <div className={styles.mobileBar}>
      <div><span>Итого{totals.length > 1 ? " по вариантам" : ""}</span><strong aria-live="polite">{totalLabel}</strong></div>
      <button type="button" className="eco-btn eco-btn--primary" onClick={() => { const summary = document.getElementById("quote-summary"); summary?.scrollIntoView({block:"start", behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}); summary?.focus({preventScroll:true}); }}>К деталям</button>
    </div>
  </div>;
}
