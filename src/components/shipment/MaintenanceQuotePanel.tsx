"use client";

import { Check, Plus, ArrowRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { MannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";
import type { MannFluidResearchResult } from "@/lib/mann-fluid-research";
import { groupQuoteOils, quoteVariantAmount, quoteRequirementChoices, quoteClientText, quoteExtraCents, quoteRub, quoteServiceGroups, quoteSupplierDeliveryAt, type QuoteService, type QuoteFilterGroup, type QuoteExtra, type QuoteStockProduct } from "@/lib/maintenance-quote";
import { getProductAttributeDictionary } from "@/lib/product-attribute-values";
import { mannQuoteServiceCapacities } from "@/lib/mann-quote-service-capacities";
import { quoteFluidLineCurrent } from "@/lib/maintenance-fluid-quote";
import { FluidQuotePicker } from "./FluidQuotePicker";
import { QuoteFilterOffers } from "./QuoteFilterOffers";
import { QuoteSearchField } from "./QuoteSearchField";
import { InlineOilPrice } from "./InlineOilPrice";
import styles from "./MaintenanceQuotePanel.module.css";

export type MaintenanceQuoteVehicleContext = { key: string; vin: string | null; vehicleTitle: string; profile: MannUnifiedTechnicalProfile | null; research: MannFluidResearchResult | null };
export type MaintenanceQuoteSnapshot = {
  products?: QuoteStockProduct[];
  selected?: QuoteStockProduct[];
  extras?: QuoteExtra[];
  specification?: string;
  viscosity?: string;
  volume?: string;
  filterSelection?: Record<string, string>;
};
type Props = { initialState?: MaintenanceQuoteSnapshot; vehicleSetup?: ReactNode; quoteContextKey?: string; vehicleTitle: string; filterVehicleContext?: string; filterStockError?: string; warehouseId?: string | null; organizationId?: string | null; profile: MannUnifiedTechnicalProfile | null; research: MannFluidResearchResult | null; requirements?: ReturnType<typeof quoteRequirementChoices>; filters?: QuoteFilterGroup[]; filtersLoading?: boolean; services?: QuoteService[]; timeZone?: string };
const isFilter = (row: QuoteExtra) => Boolean(row.filterLabel) || /^(?:масляный|воздушный|салонный|топливный)\s+фильтр/i.test(row.name);
const number = (value: string) => Number(value.replace(",", "."));

const filterTypes = { oil: "Масляный фильтр", air: "Воздушный фильтр", cabin: "Салонный фильтр", fuel: "Топливный фильтр" } as const;
const articleKey = (article: string) => article.replace(/[^a-z0-9]/gi, "").toUpperCase();

export function MaintenanceQuotePanel({ initialState, vehicleSetup, quoteContextKey, vehicleTitle, filterVehicleContext, filterStockError, warehouseId, organizationId, profile, research, requirements, filters: vehicleFilters = [], filtersLoading = false, services, timeZone }: Props) {
  const choices = useMemo(() => profile || research ? quoteRequirementChoices(profile, research) : requirements ?? quoteRequirementChoices(null, null), [profile, research, requirements]);
  const [activeSection, setActiveSection] = useState<"oil" | "fluids" | "filters" | "work">("oil");
  const [manualQuery, setManualQuery] = useState<{ article: string; type: keyof typeof filterTypes; revision: number } | null>(null);
  const [manualArticle, setManualArticle] = useState("");
  const [manualFilterType, setManualFilterType] = useState<keyof typeof filterTypes>("oil");
  const [editingArticle, setEditingArticle] = useState(false);
  const articleInput = useRef<HTMLInputElement>(null);
  const [manualStock, setManualStock] = useState<{
    query: typeof manualQuery; warehouseId: typeof warehouseId; products: QuoteFilterGroup["products"]; error?: string;
  } | null>(null);
  const matchingVehicleGroup = manualQuery && vehicleFilters.find(group =>
    group.label === filterTypes[manualQuery.type] && articleKey(group.article) === articleKey(manualQuery.article));
  const stockResult = manualStock?.query === manualQuery && manualStock?.warehouseId === warehouseId ? manualStock : null;
  const manualGroup: QuoteFilterGroup | null = manualQuery && {
    key: matchingVehicleGroup?.key ?? `manual:${articleKey(manualQuery.article)}`,
    label: filterTypes[manualQuery.type],
    article: manualQuery.article,
    condition: matchingVehicleGroup?.condition ?? "Артикул указан вручную. Сверьте применяемость с автомобилем.",
    products: stockResult?.products ?? [],
  };
  const filters = manualGroup ? [manualGroup, ...vehicleFilters.filter(group => group.key !== manualGroup.key)] : vehicleFilters;
  const showArticleForm = editingArticle || (!manualQuery && !filterVehicleContext);
  const searchContext = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!manualQuery || !warehouseId) return;
    const controller = new AbortController();
    const query = manualQuery;
    async function loadStock() {
      try {
        const response = await fetch("/api/mann-catalog/match-local-products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            organizationId, warehouseId,
            mannArticles: [{ mannArticle: query.article, filterType: query.type }],
          }),
        });
        if (!response.ok) throw new Error("Не удалось проверить наличие на складе.");
        const { matches = [] } = await response.json() as { matches?: { compatibleProducts?: QuoteFilterGroup["products"]; localMatches?: QuoteFilterGroup["products"] }[] };
        const match = matches[0];
        if (!controller.signal.aborted) setManualStock({
          query, warehouseId, products: match?.compatibleProducts ?? match?.localMatches ?? [],
        });
      } catch {
        if (!controller.signal.aborted) setManualStock({ query, warehouseId, products: [], error: "Не удалось проверить наличие на складе." });
      }
    }
    void loadStock();
    return () => controller.abort();
  }, [manualQuery, warehouseId, organizationId]);

  useEffect(() => {
    if (editingArticle) articleInput.current?.focus();
  }, [editingArticle]);

  function submitArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const article = manualArticle.trim().toUpperCase();
    if (article.length < 2 || !articleKey(article)) return;
    setManualArticle(article);
    setManualQuery(previous => ({ article, type: manualFilterType, revision: (previous?.revision ?? 0) + 1 }));
    setEditingArticle(false);
    requestAnimationFrame(() => searchContext.current?.focus());
  }
  const [specificationDraft, setSpecification] = useState<string | null>(initialState?.specification ?? null);
  const [viscosityDraft, setViscosity] = useState<string | null>(initialState?.viscosity ?? null);
  const [volumeDraft, setVolume] = useState<string | null>(initialState?.volume ?? null);
  const [serviceMethodKey, setServiceMethodKey] = useState("");
  const serviceMethods = useMemo(() => mannQuoteServiceCapacities(profile, "ENGINE_OIL"), [profile]);
  const [filterSelection, setFilterSelection] = useState<Record<string, string>>(initialState?.filterSelection ?? {});
  const specification = specificationDraft ?? choices.automaticSpecification;
  const viscosity = viscosityDraft ?? choices.automaticViscosity;
  const volume = volumeDraft ?? choices.automaticVolume;
  const serviceMethod = serviceMethods.find(method => method.key === serviceMethodKey && String(method.litres) === volume);
  const specificationGroups = useMemo(() => [
    {label: "Допуски для автомобиля", options: choices.specifications},
    {label: "OEM", options: [...getProductAttributeDictionary("engineOem")]},
    {label: "ACEA", options: getProductAttributeDictionary("acea").map(value => `ACEA ${value}`)},
    {label: "API", options: getProductAttributeDictionary("engineApi").map(value => `API ${value}`)},
    {label: "ILSAC", options: getProductAttributeDictionary("ilsac").map(value => `ILSAC ${value}`)},
  ], [choices]);
  const referenceSpecifications = useMemo(() => [...new Set(specificationGroups.flatMap(group => group.options))], [specificationGroups]);
  const referenceViscosities = [...new Set([...getProductAttributeDictionary("engineSae")].filter(value => value && !choices.viscosities.includes(value)))];
  const referenceVolumes = [...new Set([...Array.from({length: 25}, (_, index) => String(2 + index * 0.5))].filter(value => value && !choices.volumes.map(String).includes(value)))];
  const [products, setProducts] = useState<QuoteStockProduct[]>(initialState?.products ?? []);
  const [selected, setSelected] = useState<QuoteStockProduct[]>(initialState?.selected ?? []);
  const [extras, setExtras] = useState<QuoteExtra[]>(initialState?.extras ?? []);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(Boolean(initialState?.products?.length));
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const quickServices = useMemo(() => quoteServiceGroups(services ?? []), [services]);
  const [extraProducts, setExtraProducts] = useState<QuoteStockProduct[]>([]);
  const [extraLoading, setExtraLoading] = useState(false);
  const [extraError, setExtraError] = useState("");
  const [extraSearchCompleted, setExtraSearchCompleted] = useState(false);
  const [pendingReview, setPendingReview] = useState<Array<{ id: string; name: string; amount?: number }>>([]);
  const previousVehicle = useRef(quoteContextKey);
  useEffect(() => {
    if (previousVehicle.current === quoteContextKey) return;
    previousVehicle.current = quoteContextKey;
    requestRef.current?.abort();
    const oils = groupQuoteOils(selected).map(variant => ({
      id: `oil:${variant.key}`, name: variant.name, amount: quoteVariantAmount(variant, number(volume))?.cents,
    }));
    const parts = extras.filter(row => isFilter(row) || row.fluid).map(row => ({ id: row.id, name: row.name, amount: Number.isFinite(row.price) ? quoteExtraCents([row]) : undefined }));
    setPendingReview(rows => [...new Map([...rows, ...oils, ...parts].map(row => [row.id, row])).values()]);
    setSelected([]); setProducts([]); setExtras(rows => rows.filter(row => !isFilter(row) && !row.fluid)); setManualQuery(null); setEditingArticle(false); setManualArticle(""); setFilterSelection({});
    setSpecification(null); setViscosity(null); setVolume(null); setServiceMethodKey(""); setSearched(false); setError(""); setLoading(false);
    setSearch(""); setExtraProducts([]); setExtraError(""); setExtraLoading(false);
  }, [quoteContextKey]);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const requirementsKey = `${specification}|${viscosity}`;
  const previousRequirements = useRef(requirementsKey);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  const previousWarehouse = useRef(warehouseId);
  useEffect(() => {
    if (previousWarehouse.current === warehouseId) return;
    previousWarehouse.current = warehouseId;
    requestRef.current?.abort(); setProducts([]); setSelected([]); setSearched(false); setLoading(false); setExtraProducts([]); setExtraLoading(false); setExtraError(""); setError(""); setFilterSelection({});
    setExtras(rows => rows.filter(row => !row.stockStoreId || row.stockStoreId === warehouseId));
  }, [warehouseId]);
  useEffect(() => {
    if (previousRequirements.current === requirementsKey) return;
    previousRequirements.current = requirementsKey;
    requestRef.current?.abort(); setProducts([]); setSelected([]); setSearched(false); setLoading(false); setError("");
  }, [requirementsKey]);
  useEffect(() => {
    setExtraSearchCompleted(false);
    if (!warehouseId || search.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setExtraLoading(true); setExtraError("");
      try {
        const params = new URLSearchParams({ storeId: warehouseId, kind: "extra", search });
        const response = await fetch(`/api/maintenance-quote/stock?${params}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось найти расходники");
        if (!controller.signal.aborted) {
          setExtraProducts(data.products);
          setExtraSearchCompleted(true);
        }
      } catch (reason) {
        if (!controller.signal.aborted) { setExtraProducts([]); setExtraError(reason instanceof Error ? reason.message : "Ошибка поиска"); setExtraSearchCompleted(true); }
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
  const fluidRows = extras.filter(row => row.fluid);
  const staleFluidRows = fluidRows.filter(row => !quoteFluidLineCurrent(row, profile, warehouseId));
  const ready = validExtras && !staleFluidRows.length && (selected.length > 0 ? selected.every(oil => Number.isFinite(oil.price) && oil.price > 0) && litres > 0 && litres <= 100 && Number.isFinite(litres) && selectedVariants.every(variant => quoteVariantAmount(variant, litres)) : extras.length > 0);
  const text = ready && !pendingReview.length ? quoteClientText(vehicleTitle, [specification, viscosity].filter(Boolean).join(" · "), litres, selected, extras, { timeZone, serviceMethodLabel: serviceMethod?.label }) : "";
  useEffect(() => { setCopied(false); setCopyError(""); }, [text]);
  const extraTotal = quoteExtraCents(extras);
  const filterRows = extras.filter(isFilter);
  const otherRows = extras.filter(row => !isFilter(row) && !row.fluid);
  const variantAmounts = selectedVariants.map(variant => quoteVariantAmount(variant, litres));
  const totals = ready ? variantAmounts.flatMap(amount => amount ? [amount.cents + extraTotal] : []) : [];
  const totalLabel = !ready ? (selected.length || extras.length ? "Уточните позиции" : quoteRub(0)) : totals.length > 1 && Math.min(...totals) !== Math.max(...totals) ? `от ${quoteRub(Math.min(...totals))}` : quoteRub(totals[0] ?? extraTotal);
  function goToSection(section: "oil" | "fluids" | "filters" | "work") {
    setActiveSection(section);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`quote-${section}`);
      target?.scrollIntoView({ block: "start", behavior: "auto" });
      target?.focus({ preventScroll: true });
    });
  }
  async function copyQuote(value: string) {
    setCopyError("");
    setCopied(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopyError("Копирование недоступно. Выделите и скопируйте текст предложения выше.");
    }
  }
  function copyPosition(row: QuoteExtra) {
    void copyQuote(quoteClientText(vehicleTitle, "", 0, [], [row], { timeZone }));
  }
  function updateOilPrices(prices: Record<string, number>) {
    const apply = (rows: QuoteStockProduct[]) => rows.map(row => row.id in prices ? { ...row, price: prices[row.id] } : row);
    setProducts(apply);
    setSelected(apply);
  }
  function serviceButton(service: QuoteService) {
    const id = `service:${service.id}`;
    return <button key={id} type="button" className="eco-btn" disabled={extras.some(row => row.id === id)} onClick={() => {
      setExtras(rows => rows.some(row => row.id === id) ? rows : [...rows, {
        id, name: service.name, quantity: 1, price: service.salePriceCents / 100,
      }]);
    }}>{service.name}</button>;
  }


  function addManualWork() {
    const name = search.trim();
    if (!name || !extraSearchCompleted || extraLoading || extraProducts.length) return;
    const id = crypto.randomUUID();
    setExtras(rows => [...rows, { id, name, quantity: 1, price: 0 }]);
    setSearch(""); setExtraProducts([]); setExtraSearchCompleted(false);
    window.requestAnimationFrame(() => document.getElementById(`quote-extra-${id}`)?.querySelector<HTMLInputElement>("label:last-of-type input")?.focus());
  }
  function updateExtra(id: string, update: Partial<QuoteExtra>) {
    setExtras(rows => rows.map(row => row.id === id ? { ...row, ...update } : row));
  }
  return <div className={`${styles.panel} ${vehicleSetup ? styles.workspace : ""}`} data-active-section={activeSection}>
    <div className={styles.body}>
      {vehicleSetup}
      {vehicleSetup && <nav className={styles.stageNav} aria-label="Этапы подбора">
        <button type="button" aria-current={activeSection === "oil" ? "step" : undefined} onClick={() => goToSection("oil")}>Масло<small>{selectedVariants.length || ""}</small></button>
        <button type="button" aria-current={activeSection === "fluids" ? "step" : undefined} onClick={() => goToSection("fluids")}>Жидкости<small>{fluidRows.length || ""}</small></button>
        <button type="button" aria-current={activeSection === "filters" ? "step" : undefined} onClick={() => goToSection("filters")}>Фильтры<small>{filterRows.length || ""}</small></button>
        <button type="button" aria-current={activeSection === "work" ? "step" : undefined} onClick={() => goToSection("work")}>Работы<small>{otherRows.length || ""}</small></button>
      </nav>}
      <section id="quote-oil" tabIndex={-1} data-quote-section="oil" className={styles.step} aria-labelledby="quote-oil-title">
      <header className={styles.stepHeader}><div><h2 id="quote-oil-title">Моторное масло</h2></div></header>
      {!warehouseId && <p className={styles.warehousePrompt} role="status">Выберите склад в блоке «Автомобиль и склад», чтобы проверить наличие.</p>}
      {serviceMethods.length > 0 && <label className={styles.serviceMethod}>Способ обслуживания
        <select value={serviceMethod?.key ?? ""} onChange={event => {
          const method = serviceMethods.find(option => option.key === event.target.value);
          setServiceMethodKey(method?.key ?? "");
          setVolume(method ? String(method.litres) : null);
        }}>
          <option value="">Выберите способ обслуживания</option>
          {serviceMethods.map(method => <option key={method.key} value={method.key}>{method.label} · {method.litres.toLocaleString("ru-RU")} л</option>)}
        </select>
      </label>}
      <div className={styles.fields}>
        <QuoteSearchField preferredGroup={choices.specifications.length ? "Допуски для автомобиля" : undefined} hint={specification ? (specificationDraft === null ? "Подставлено по автомобилю" : undefined) : "Выберите или введите допуск"} label="Допуск / стандарт" value={specification} options={referenceSpecifications} groups={specificationGroups} onChange={value => { invalidate(); setSpecification(value); }} />
        <QuoteSearchField placeholder="Выберите" hint={viscosity ? (viscosityDraft === null ? "Подставлено по автомобилю" : undefined) : "Укажите вязкость, если она известна"} label="Вязкость" value={viscosity} options={[...choices.viscosities, ...referenceViscosities]} onChange={value => { invalidate(); setViscosity(value); }} />
        <QuoteSearchField placeholder="Например, 4" hint={!volume ? "Укажите объём замены, чтобы рассчитать фасовку и цену" : serviceMethod ? serviceMethod.label : volumeDraft === null ? "Подставлено по автомобилю" : undefined} label="Объём с фильтром, л" value={volume} options={[...choices.volumes.map(String), ...referenceVolumes]} onChange={value => { setServiceMethodKey(""); setVolume(value); }} inputMode="decimal" />
      </div>
      {volumeDraft === null && "volumeFromResearch" in choices && choices.volumeFromResearch && <p className={styles.note}>Сверьте предварительный объём по данным автомобиля.</p>}
      {!specification.trim() ? <p className={styles.note} role="status">Сначала укажите допуск масла.</p> : !(litres > 0) ? <p className={styles.note} role="status">Теперь укажите объём замены.</p> : null}
      <button type="button" className="eco-btn eco-btn--primary" disabled={!warehouseId || !specification.trim() || loading} onClick={() => void findOils()}>{loading ? "Проверяем наличие…" : "Подобрать масло"}</button>
      {error ? <p role="alert">{error}</p> : null}
      {searched && !products.length ? <p role="status">Совпадений по указанному допуску и вязкости нет. Проверьте требования и технические характеристики товаров на складе.</p> : null}
      {!!products.length && !(litres > 0) && <p role="status" className={styles.note}>Показано наличие. Фасовка и цена появятся после ввода объёма.</p>}
      {products.length ? <div className={styles.oilTable} aria-label="Варианты масла"><div className={styles.oilColumns} aria-hidden="true"><span>Масло</span><span>Стоимость</span><span aria-label="Добавить" /></div>{oilVariants.map(variant => {
        const amount = quoteVariantAmount(variant, litres);
        const chosen = selectedVariants.some(item => item.key === variant.key);
        return <div key={variant.key} className={styles.oilColumns} data-selected={chosen}><div><strong>{variant.name}</strong>
          <p>{variant.products.map(oil => `${oil.available} ${oil.unit} в наличии`).join(" · ")}</p>
          {amount ? <p>Комплект: {amount.lines.map(line=>`${line.quantity} × ${line.product.litresPerUnit} л`).join(" + ")}{!amount.enough ? " · Недостаточно на складе" : ""}</p> : <p>Уточните объём, фасовку и цену.</p>}
        </div><InlineOilPrice name={variant.name} products={variant.products} cents={amount?.cents ?? null} onCommit={updateOilPrices} /><button type="button" className="eco-btn" disabled={!chosen && (!amount || !amount.enough)} aria-pressed={chosen} onClick={() => setSelected(rows => chosen ? rows.filter(item => !variant.products.some(product=>product.id===item.id)) : [...rows, ...variant.products.filter(item=>item.price>0 && item.litresPerUnit)])} aria-label={`${chosen ? "Убрать" : "Добавить"} ${variant.name}`}>{chosen ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}</button></div>;
      })}</div> : null}
      {vehicleSetup && <div className={styles.nextStep}><span /><button type="button" className="eco-btn" onClick={() => goToSection("filters")}>К фильтрам <ArrowRight size={16} aria-hidden="true" /></button></div>}
      </section>
      <section id="quote-fluids" tabIndex={-1} data-quote-section="fluids" className={styles.step} aria-labelledby="quote-fluids-title">
        <header className={styles.stepHeader}><h2 id="quote-fluids-title">Жидкости по агрегатам</h2></header>
        <FluidQuotePicker profile={profile} warehouseId={warehouseId} organizationId={organizationId}
          selectedSystemCodes={fluidRows.map(row => row.fluid!.systemCode)}
          onAdd={row => setExtras(rows => [...rows.filter(item => item.id !== row.id), row])} />
        {fluidRows.map(row => <div key={row.id} className={styles.fluidLine}>
          <div><strong>{row.fluid!.systemLabel} · {row.name}</strong>
            <p>{row.fluid!.serviceMethodLabel} · для замены {row.fluid!.serviceLitres} л · к покупке {row.fluid!.suppliedLitres} л</p>
            {row.fluid!.source === "rossko" && <p>РОССКО · {row.fluid!.deliveryLabel || "Срок поставки уточняется"}</p>}
            {!quoteFluidLineCurrent(row, profile, warehouseId) && <p role="alert">Требования или условия агрегата изменились. Уберите позицию и подберите жидкость заново.</p>}
          </div>
          <strong>{quoteRub(quoteExtraCents([row]))}</strong>
          <button type="button" className="eco-btn" onClick={() => setExtras(rows => rows.filter(item => item.id !== row.id))}>Убрать {row.fluid!.systemLabel}</button>
        </div>)}
      </section>
      <section id="quote-filters" tabIndex={-1} data-quote-section="filters" className={`${styles.step} ${styles.filterStep}`} aria-labelledby="quote-parts-title">
      <header className={styles.stepHeader}><h2 id="quote-parts-title">Фильтры</h2></header>
      <div className={styles.filterPicker}>
        {manualGroup ? <div className={styles.filterGroupHeading}>
          <h3 className={styles.filterGroupTitle}>{manualGroup.label} · {manualGroup.article}</h3>
          <button ref={searchContext} type="button" className="eco-btn" aria-expanded={showArticleForm} aria-controls="quote-filter-search"
            onClick={() => { setManualArticle(manualQuery?.article ?? ""); setManualFilterType(manualQuery?.type ?? "oil"); setEditingArticle(true); articleInput.current?.focus(); }}>Изменить</button>
        </div> : filterVehicleContext ? <div className={styles.filterGroupHeading}>
          <h3 className={styles.filterGroupTitle}>Подбор для {filterVehicleContext}</h3>
          <button type="button" className="eco-btn" aria-expanded={showArticleForm} aria-controls="quote-filter-search"
            onClick={() => { setEditingArticle(!editingArticle); }}>Найти по артикулу</button>
        </div> : <p className={styles.filterHint}>Выберите <a href="#quote-setup-title">автомобиль</a> или найдите фильтр по известному артикулу MANN.</p>}
        <form id="quote-filter-search" className={styles.filterArticleEntry} hidden={!showArticleForm} onSubmit={submitArticle}>
          <label>Тип фильтра<select value={manualFilterType} onChange={event => setManualFilterType(event.target.value as keyof typeof filterTypes)}>
            {Object.entries(filterTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>Артикул MANN<input ref={articleInput} value={manualArticle} onChange={event => setManualArticle(event.target.value)}
            placeholder="Например, CU 3172/1" maxLength={64} /></label>
          <button type="submit" className="eco-btn eco-btn--primary" disabled={manualArticle.trim().length < 2 || !articleKey(manualArticle)}>Найти предложения</button>
        </form>
        {filterStockError && !vehicleFilters.length && <p className={styles.filterHint} role="status">{filterStockError}</p>}
        {filtersLoading && <p className={styles.filterHint} role="status">Загружаем подбор MANN…</p>}
        {filterVehicleContext && !filtersLoading && !vehicleFilters.length && !filterStockError && !manualGroup &&
          <p className={styles.filterHint}>В каталоге MANN нет фильтров для этого автомобиля. Можно искать по артикулу.</p>}
        {filters.map(group => {
          const manual = group === manualGroup;
          const rowId = `mann:${group.key}`;
          const existingRow = extras.find(row => row.id === rowId);
          const selectedId = filterSelection[group.key] ?? existingRow?.supplierProductId ?? "";
          const warehouse = warehouseId ? [...group.products].sort((a, b) =>
            Number(b.available > 0) - Number(a.available > 0) || a.price - b.price) : [];
          const warehouseStatus = !warehouseId ? "Выберите склад в блоке «Автомобиль»."
            : manual ? stockResult?.error ?? (!stockResult ? "Проверяем наличие на складе…" : undefined)
            : filtersLoading ? "Проверяем наличие на складе…" : filterStockError;
          function chooseFilter(chosen?: QuoteFilterGroup["products"][number]) {
            setFilterSelection(values => ({ ...values, [group.key]: chosen?.id ?? "reference" }));
            const fromSupplier = chosen?.source === "rossko";
            const name = !chosen ? `${group.label} MANN ${group.article}`
              : fromSupplier ? `${chosen.name} (${chosen.relation === "analogue" ? `аналог Росско для MANN ${group.article}` : "Росско"})`
              : chosen.available < 1 ? `${chosen.name} (под заказ)` : chosen.name;
            setExtras(rows => [...rows.filter(row => row.id !== rowId), {
              id: rowId, filterLabel: group.label, brand: chosen ? chosen.brand : "MANN",
              name, quantity: 1, price: chosen && chosen.price > 0 ? chosen.price : NaN,
              ...(fromSupplier && chosen ? { supplierProductId: chosen.id, supplierDeliveryAt: quoteSupplierDeliveryAt(chosen), supplierDeliveryLabel: chosen.deliveryLabel } : {}),
              ...(chosen && warehouseId && !fromSupplier ? { stockStoreId: warehouseId } : {}),
            }]);
          }
          return <div key={group.key} className={styles.filterRow}>
            {!manual && <h3 className={styles.filterGroupTitle}>{group.label} · {group.article}</h3>}
            {group.condition && <p className={styles.filterHint}>Условие MANN: {group.condition}</p>}
            <QuoteFilterOffers key={manual ? manualQuery?.revision : undefined} warehouse={warehouse} article={group.article} selectedId={selectedId}
              label={`${group.label} ${group.article}`} warehouseStatus={warehouseStatus} onSelect={chooseFilter} />
            {!existingRow && <button type="button" className={`eco-btn ${styles.filterSecondary}`} onClick={() => chooseFilter()}>Указать цену вручную</button>}
            {existingRow ? <details className={styles.filterEditor} open={!Number.isFinite(existingRow.price) || undefined}><summary>В расчёте · изменить количество или цену</summary><div><label className={styles.filterPrice}>Цена фильтра, ₽<input aria-label={`Цена ${group.label} MANN ${group.article}, ₽`} type="number" min="0" step="0.01" placeholder="Укажите цену" value={Number.isFinite(existingRow.price) ? existingRow.price : ""} onChange={event=>updateExtra(rowId,{price:event.target.value ? Number(event.target.value) : NaN})} /></label><label className={styles.filterPrice}>Количество<input aria-label={`Количество ${group.label} MANN ${group.article}`} type="number" min="0.001" step="0.001" value={Number.isFinite(existingRow.quantity) ? existingRow.quantity : ""} onChange={event => updateExtra(rowId, {quantity: event.target.value ? Number(event.target.value) : NaN})} /></label><button type="button" className="eco-btn" onClick={()=>{setExtras(rows=>rows.filter(row=>row.id!==rowId));setFilterSelection(values=>({...values,[group.key]:""}));}}>Убрать фильтр</button><small className={styles.filterAdded}>{existingRow.name} · в расчёте{existingRow.supplierProductId ? " · Росско" : existingRow.stockStoreId ? " · Наш склад" : ""}{!Number.isFinite(existingRow.price) ? " — укажите цену рядом" : ""}</small></div></details> : null}
          </div>;
        })}
        {filterRows.filter(row => !filters.some(group => row.id === `mann:${group.key}`)).map(row => <div key={row.id} className={styles.extra}>
          <label>Фильтр<input value={row.name} onChange={event => updateExtra(row.id, { name: event.target.value })} /></label>
          <label>Количество<input type="number" min="0.001" step="0.001" value={Number.isFinite(row.quantity) ? row.quantity : ""} onChange={event => updateExtra(row.id, { quantity: event.target.value ? Number(event.target.value) : NaN })} /></label>
          <label>Цена, ₽<input type="number" min="0" step="0.01" value={Number.isFinite(row.price) ? row.price : ""} onChange={event => updateExtra(row.id, { price: event.target.value ? Number(event.target.value) : NaN })} /></label>
          <button type="button" className="eco-btn" aria-label={`Удалить ${row.name}`} onClick={() => setExtras(rows => rows.filter(item => item.id !== row.id))}>Удалить</button>
        </div>)}
      </div>
      {vehicleSetup && <div className={styles.nextStep}><span /><button type="button" className="eco-btn" onClick={() => goToSection("work")}>К работам <ArrowRight size={16} aria-hidden="true" /></button></div>}
      </section>
      <section id="quote-work" tabIndex={-1} data-quote-section="work" className={styles.step} aria-labelledby="quote-work-title">
      <header className={styles.stepHeader}><div><h2 id="quote-work-title">Работы</h2></div></header>
      {quickServices.popular.length > 0 && <div className={styles.quickServices}>{quickServices.popular.map(serviceButton)}</div>}
      {quickServices.other.length > 0 && <details className={styles.quickServiceMore}>
        <summary>Все остальные услуги</summary>
        <div className={styles.quickServices}>{quickServices.other.map(serviceButton)}</div>
      </details>}
      <label className={styles.search}>Найти услугу или расходник
        <span className={styles.workSearchControl}>
          <Search size={16} aria-hidden="true" />
          <input value={search} onChange={event => { setSearch(event.target.value); setExtraProducts([]); setExtraLoading(false); setExtraError(""); setExtraSearchCompleted(false); }}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addManualWork(); } }}
            placeholder="Название или артикул" disabled={!warehouseId} />
        </span>
      </label>
      {extraLoading ? <p role="status">Ищем товары и услуги…</p> : null}
      {extraError ? <p role="alert">{extraError}</p> : null}
      {extraProducts.map(product => <div key={product.id} className={styles.option}><span>{product.name} · {product.article} · {quoteRub(Math.round(product.price * 100))}</span><button type="button" className="eco-btn" onClick={() => { setExtras(rows => [...rows, { id: crypto.randomUUID(), name: product.name, brand: product.brand, quantity: 1, price: product.price, stockStoreId: warehouseId ?? undefined }]); setSearch(""); setExtraProducts([]); }}>Добавить</button></div>)}
      {extraSearchCompleted && !extraLoading && !extraProducts.length && search.trim().length >= 2 && <div className={styles.option}>
        <span>{search.trim()}<small className={styles.manualWorkHint}>Добавить вручную</small></span>
        <button type="button" className={`eco-btn ${styles.manualWorkAdd}`} aria-label={`Добавить работу ${search.trim()}`} onClick={addManualWork}><Plus size={16} aria-hidden="true" /></button>
      </div>}
      {otherRows.map(row => <div key={row.id} id={`quote-extra-${row.id}`} className={styles.extra}><label>Наименование<input value={row.name} onChange={event => updateExtra(row.id, { name: event.target.value })} placeholder="Масляный фильтр / замена масла" /></label><label>Количество<input type="number" min="0.001" step="0.001" value={Number.isFinite(row.quantity) ? row.quantity : ""} onChange={event => updateExtra(row.id, { quantity: event.target.value ? Number(event.target.value) : NaN })} /></label><label>Цена, ₽<input type="number" min="0" step="0.01" value={Number.isFinite(row.price) ? row.price : ""} onChange={event => updateExtra(row.id, { price: event.target.value ? Number(event.target.value) : NaN })} /></label><button type="button" className="eco-btn" aria-label={`Удалить строку ${row.name || "без названия"}`} onClick={() => setExtras(rows => rows.filter(item => item.id !== row.id))}>Удалить</button></div>)}
      </section>
    </div>
    <aside id="quote-summary" tabIndex={-1} className={styles.summary} aria-labelledby="quote-summary-title">
      <header className={styles.stepHeader}><h2 id="quote-summary-title">Расчёт</h2></header>
      {!!pendingReview.length && <section className={styles.review} aria-label="Позиции для повторной проверки">
        <h3>Проверьте применяемость</h3>
        <p>Подберите масло, жидкости и фильтры для нового автомобиля. Позиции ниже ожидают проверки.</p>
        {pendingReview.map(row => <div key={row.id}>
          <span>{row.name}<small>Требует повторной проверки{row.amount === undefined ? "" : ` · ${quoteRub(row.amount)}`}</small></span>
          <button className="eco-btn" type="button" aria-label={`Убрать из проверки ${row.name}`} onClick={() => setPendingReview(rows => rows.filter(item => item.id !== row.id))}>Убрать</button>
        </div>)}
      </section>}
      {!selectedVariants.length && !extras.length && !pendingReview.length && <p className={styles.empty}>Добавьте позиции из подбора.</p>}
      {!!extras.length && !validExtras && <p className={styles.note}>Проверьте количество и цены позиций.</p>}
      {!!staleFluidRows.length && <p role="alert" className={styles.note}>Изменились условия подбора жидкостей. Уберите устаревшие позиции и подберите их заново.</p>}
      {(selected.length > 0 || extras.length > 0) && <div className={styles.groupedSummary}>
        {selectedVariants.length > 0 && <section className={styles.summaryGroup} aria-labelledby="summary-oil-group">
          <h3 id="summary-oil-group" className={styles.summaryGroupTitle}>{vehicleSetup ? <button type="button" aria-label="Перейти к подбору масла" onClick={() => goToSection("oil")}>Масло</button> : "Масло"}</h3>
          {selectedVariants.map((variant, index) => {
            const amount = quoteVariantAmount(variant, litres);
            return <div key={variant.key} className={styles.summaryLine} data-stripe={index % 2 === 1}>
              <span>{variant.name}{amount && ready && selectedVariants.length > 1 && <small>{fluidRows.length ? "С жидкостями, фильтрами и работами" : "С фильтрами и работами"} {quoteRub(amount.cents + extraTotal)}</small>}</span>
              <div><InlineOilPrice name={variant.name} products={variant.products} cents={amount?.cents ?? null} onCommit={updateOilPrices} />
                {amount && <button type="button" className="eco-btn" aria-label={`Скопировать ${variant.name}`} onClick={() => void copyQuote(quoteClientText(vehicleTitle, [specification, viscosity].filter(Boolean).join(" · "), litres, variant.products, [], { timeZone, serviceMethodLabel: serviceMethod?.label }))}>Копировать</button>}
              </div>
            </div>;
          })}
        </section>}
        {fluidRows.length > 0 && <section className={styles.summaryGroup} aria-labelledby="summary-fluid-group">
          <h3 id="summary-fluid-group" className={styles.summaryGroupTitle}>{vehicleSetup ? <button type="button" onClick={() => goToSection("fluids")}>Жидкости</button> : "Жидкости"}</h3>
          {fluidRows.map(row => <div key={row.id} className={styles.summaryLine}>
            <span>{row.fluid!.systemLabel}<small>{row.name} · {row.fluid!.serviceMethodLabel} · {row.fluid!.serviceLitres} л для замены</small>{row.fluid!.source === "rossko" && <small>РОССКО · {row.fluid!.deliveryLabel || "Срок поставки уточняется"}</small>}</span>
            <strong>{quoteRub(quoteExtraCents([row]))}</strong>
            <button type="button" className="eco-btn" disabled={!quoteFluidLineCurrent(row, profile, warehouseId)} onClick={() => copyPosition(row)}>Копировать</button>
          </div>)}
        </section>}
        {filterRows.length > 0 && <section className={styles.summaryGroup} aria-labelledby="summary-filter-group">
          <h3 id="summary-filter-group" className={styles.summaryGroupTitle}>{vehicleSetup ? <button type="button" aria-label="Перейти к подбору фильтров" onClick={() => goToSection("filters")}>Фильтры</button> : "Фильтры"}</h3>
          {filterRows.map((row, index) => <div key={row.id} className={styles.summaryLine} data-stripe={(selectedVariants.length + index) % 2 === 1}>
            <span>{row.name}{row.supplierDeliveryLabel && row.supplierDeliveryLabel !== "срок доставки не указан" && <small>Ориентировочная поставка: {row.supplierDeliveryLabel.replace(/^доставка:\s*/i, "")}</small>}{row.quantity !== 1 && <small>× {Number.isFinite(row.quantity) ? row.quantity : "—"}</small>}</span>
            <strong>{Number.isFinite(row.price) && Number.isFinite(row.quantity) ? quoteRub(quoteExtraCents([row])) : "Укажите цену"}</strong>
            {Number.isFinite(row.price) && Number.isFinite(row.quantity) && row.quantity > 0 && <button type="button" className="eco-btn" aria-label={`Скопировать ${row.name}`} onClick={() => copyPosition(row)}>Копировать</button>}
          </div>)}
        </section>}
        {otherRows.length > 0 && <section className={styles.summaryGroup} aria-labelledby="summary-work-group">
          <h3 id="summary-work-group" className={styles.summaryGroupTitle}>{vehicleSetup ? <button type="button" aria-label="Перейти к работам" onClick={() => goToSection("work")}>Работы</button> : "Работы"}</h3>
          {otherRows.map((row, index) => <div key={row.id} className={styles.summaryLine} data-stripe={(selectedVariants.length + filterRows.length + index) % 2 === 1}>
            <span>{row.name || "Без названия"}{row.quantity !== 1 && <small>× {Number.isFinite(row.quantity) ? row.quantity : "—"}</small>}</span>
            <strong>{Number.isFinite(row.price) && Number.isFinite(row.quantity) ? quoteRub(quoteExtraCents([row])) : "Уточните цену"}</strong>
            {Number.isFinite(row.price) && Number.isFinite(row.quantity) && row.quantity > 0 && <button type="button" className="eco-btn" aria-label={`Скопировать ${row.name}`} onClick={() => copyPosition(row)}>Копировать</button>}
          </div>)}
        </section>}
      </div>}
      <div className={styles.singleTotal} aria-live="polite"><span>{totals.length > 1 ? "Итого по вариантам" : "Итого"}</span><strong>{totalLabel}</strong></div>
      {totals.length > 1 && <p className={styles.note}>Каждый вариант масла — отдельное предложение. {fluidRows.length ? "Жидкости, фильтры и работы включены" : "Фильтры и работы включены"} в каждый вариант.</p>}
      {text ? <details className={styles.preview} open={copyError ? true : undefined}><summary>Посмотреть текст для клиента</summary><label><textarea aria-label="Текст предложения для клиента" readOnly rows={Math.min(18, text.split("\n").length)} value={text} /></label></details> : null}
      <button type="button" className="eco-btn eco-btn--primary" disabled={!text} onClick={() => void copyQuote(text)}>Скопировать предложение</button>
      {copied ? <p role="status">Предложение скопировано.</p> : null}{copyError ? <p role="alert">{copyError}</p> : null}
    </aside>
    <div className={styles.mobileBar}>
      <div><span>Итого{totals.length > 1 ? " по вариантам" : ""}</span><strong aria-live="polite">{totalLabel}</strong></div>
      <button type="button" className="eco-btn eco-btn--primary" onClick={() => { const summary = document.getElementById("quote-summary"); summary?.scrollIntoView({block:"start", behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"}); summary?.focus({preventScroll:true}); }}>К деталям</button>
    </div>
  </div>;
}
