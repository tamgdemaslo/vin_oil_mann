"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Warehouse } from "lucide-react";
import { MaintenanceQuotePanel, type MaintenanceQuoteVehicleContext } from "@/components/shipment/MaintenanceQuotePanel";
import { VehicleLookupPanel, type MannManualSelection } from "@/components/shipment/VehicleLookupPanel";
import type { MannCatalogFilter } from "@/lib/mann-catalog";
import { ManualVehiclePicker } from "./ManualVehiclePicker";
import type { QuoteFilterGroup, QuoteService } from "@/lib/maintenance-quote";
import styles from "./maintenance-quote.module.css";

type Store = { id: string; name: string; organizationId: string | null };
type Props = { branchName?: string; organizationId: string | null; stores: Store[]; services: QuoteService[]; timeZone?: string | null };
type FilterSelection = Pick<MannManualSelection, "variantId" | "make" | "model"> & { variantIds?: string[]; year?: number | null; modification?: string | null; engineCode?: string | null };
type Match = {
  mannArticleNormalized: string;
  compatibleProducts?: QuoteFilterGroup["products"];
  localMatches?: QuoteFilterGroup["products"];
};

const filterLabels = new Map([
  ["oil", "Масляный фильтр"],
  ["air", "Воздушный фильтр"],
  ["cabin", "Салонный фильтр"],
  ["fuel", "Топливный фильтр"],
  ["other", "Прочий фильтр"],
]);

export function MaintenanceQuoteWorkspace({ branchName, organizationId, stores, services, timeZone }: Props) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const store = stores.find((item) => item.id === storeId);
  const storeOrganizationId = store?.organizationId ?? organizationId;
  const [vehicle, setVehicle] = useState<MaintenanceQuoteVehicleContext | null>(null);
  const [activeEditor, setActiveEditor] = useState(0);
  const nextEditor = useRef(0);
  const [draftEditor, setDraftEditor] = useState<number | null>(null);
  const [draftVehicle, setDraftVehicle] = useState<MaintenanceQuoteVehicleContext | null>(null);
  const [draftLookup, setDraftLookup] = useState<FilterSelection | null>(null);
  const [draftManual, setDraftManual] = useState<MannManualSelection | null>(null);
  const [draftCatalog, setDraftCatalog] = useState(false);
  const [confirmChange, setConfirmChange] = useState(false);
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const editorTrigger = useRef<HTMLElement | null>(null);
  const draftHeading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (draftEditor !== null) draftHeading.current?.focus();
  }, [draftEditor]);
  useLayoutEffect(() => {
    const dialog = confirmDialog.current;
    if (confirmChange && !dialog?.open) dialog?.showModal();
    if (!confirmChange && dialog?.open) dialog.close();
  }, [confirmChange]);
  const [vehicleName, setVehicleName] = useState("");
  const [lookupSelection, setLookupSelection] = useState<FilterSelection | null>(null);
  const [manualSelection, setManualSelection] = useState<MannManualSelection | null>(null);
  const selection: FilterSelection | null = manualSelection ?? lookupSelection;
  const [manualCatalogOpen, setManualCatalogOpen] = useState(false);
  const [filters, setFilters] = useState<QuoteFilterGroup[]>([]);
  const [filterState, setFilterState] = useState<{ loading: boolean; error: string }>({ loading: false, error: "" });

  useEffect(() => {
    setFilters([]);
    setFilterState({ loading: Boolean(selection), error: "" });
    if (!selection) return;
    const { variantId, variantIds: selectedVariantIds, make, model, year } = selection;
    const controller = new AbortController();
    const signal = controller.signal;

    async function loadFilters() {
      try {
        const variantIds = [...new Set(selectedVariantIds?.length ? selectedVariantIds : [variantId])];
        const pages = await Promise.all(variantIds.map(async (id) => {
          const params = new URLSearchParams({ variantId: id, make, model });
          if (year) params.set("year", String(year));
          const response = await fetch(`/api/mann-catalog/filters?${params}`, { signal });
          if (!response.ok) throw new Error("Не удалось загрузить фильтры MANN.");
          const data = await response.json() as { filters: MannCatalogFilter[] };
          return data.filters;
        }));
        const references = new Map<string, { filter: MannCatalogFilter; conditions: Set<string> }>();
        for (const filter of pages.flat()) {
          const key = `${filter.filterType}:${filter.filterSubtype ?? ""}:${filter.mannArticleNormalized}`;
          const reference = references.get(key) ?? { filter, conditions: new Set<string>() };
          reference.conditions.add(filter.condition ?? "");
          references.set(key, reference);
        }
        const groups = Array.from(references, ([key, { filter, conditions }]) => ({
          key,
          label: filterLabels.get(filter.filterType) ?? "Прочий фильтр",
          article: filter.mannArticle,
          condition: conditions.has("") ? null : [...conditions].join(" / "),
          products: [],
        }));
        if (signal.aborted) return;
        setFilters(groups);
        if (!storeId || !references.size) return;
        const matchResponse = await fetch("/api/mann-catalog/match-local-products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({ organizationId: storeOrganizationId, warehouseId: storeId, mannArticles: [...references.values()].map(({ filter }) => filter) }),
        });
        if (!matchResponse.ok) throw new Error("Не удалось проверить наличие фильтров на складе.");
        const { matches = [] } = await matchResponse.json() as { matches?: Match[] };
        const byArticle = new Map(matches.map((match) => [match.mannArticleNormalized, match]));
        if (!signal.aborted) setFilters(groups.map((group) => {
          const match = byArticle.get(references.get(group.key)!.filter.mannArticleNormalized);
          return { ...group, products: match?.compatibleProducts ?? match?.localMatches ?? [] };
        }));
      } catch (error) {
        if (!signal.aborted) setFilterState({ loading: false, error: error instanceof Error ? error.message : "Ошибка подбора фильтров." });
        return;
      } finally {
        if (!signal.aborted) setFilterState((state) => ({ ...state, loading: false }));
      }
    }

    void loadFilters();
    return () => controller.abort();
  }, [selection, storeId, storeOrganizationId]);

  const vehicleTitle = (manualSelection && vehicleName.trim()) || vehicle?.vehicleTitle || vehicleName.trim() || (selection ? `${selection.make} ${selection.model}` : "Автомобиль не указан");

  function editVehicle() {
    editorTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDraftVehicle(null);
    setDraftLookup(null);
    setDraftManual(null);
    setDraftCatalog(false);
    setDraftEditor(++nextEditor.current);
  }

  function cancelEdit() {
    setConfirmChange(false);
    setDraftEditor(null);
    requestAnimationFrame(() => editorTrigger.current?.focus());
  }

  function saveVehicle() {
    if (!draftVehicle || draftEditor === null) return;
    setVehicle(draftVehicle);
    setLookupSelection(draftLookup);
    setManualSelection(draftManual);
    setManualCatalogOpen(false);
    setVehicleName("");
    setActiveEditor(draftEditor);
    setDraftEditor(null);
    setConfirmChange(false);
  }

  return <div className={`eco-page ${styles.page}`}>
    <header className={styles.pageHeader}>
      <span className={styles.kicker}>Работа / Расчёт ТО</span>
      <div className={styles.title}><h1>Расчёт ТО</h1></div>
    </header>
    {!branchName ? <p role="status" className={styles.setup}>Выберите рабочий филиал в верхнем меню.</p> : <>
      <MaintenanceQuotePanel vehicleSetup={<section className={styles.setup} aria-labelledby="quote-setup-title">
        <header className={styles.setupHeader}>
          <div className={styles.setupTitle}><div><h2 id="quote-setup-title">Автомобиль</h2></div></div>
          <label className={styles.store}><span><Warehouse size={16} aria-hidden="true" /> Склад</span>
            <select value={storeId} onChange={(event) => { setFilters([]); setStoreId(event.target.value); }} disabled={!stores.length}>
              {!stores.length && <option value="">Нет доступных складов</option>}
              {stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </header>
        {draftEditor !== null && <div className={styles.vehicleEdit}>
          <h3 ref={draftHeading} tabIndex={-1}>Изменить автомобиль</h3>
          <p>Текущий автомобиль: {vehicleTitle}</p>
          <button type="button" className="eco-btn" onClick={cancelEdit}>Отмена</button>
        </div>}
        {(draftEditor === null ? [activeEditor] : [activeEditor, draftEditor]).map(editor => {
          const draft = editor === draftEditor;
          const selectedVehicle = draft ? draftVehicle : vehicle;
          const setVehicleContext = draft ? setDraftVehicle : setVehicle;
          const setLookup = draft ? setDraftLookup : setLookupSelection;
          const setManual = draft ? setDraftManual : setManualSelection;
          const setCatalog = draft ? setDraftCatalog : setManualCatalogOpen;
          const catalogOpen = draft ? draftCatalog : manualCatalogOpen;
          const catalogId = draft ? "quote-draft-manual-catalog" : "quote-manual-catalog";
          function resetVehicle(openCatalog: boolean) {
            if (!draft) setVehicleName("");
            setVehicleContext(null);
            setLookup(null);
            setManual(null);
            setCatalog(openCatalog);
          }
          return <div key={editor} hidden={!draft && draftEditor !== null}>
            <div className={styles.lookup}>
              <VehicleLookupPanel organizationId={storeOrganizationId} warehouseId={storeId} combinedIdentifier
                manualCatalogId={catalogId} manualSelection={draft ? draftManual : manualSelection}
                onEditVehicle={draft ? undefined : editVehicle}
                onQuoteContextChange={setVehicleContext}
                onUseVehicle={(identity, resolution) => setLookup(resolution?.selectedApplication ? { ...resolution.selectedApplication, year: identity.year } : null)}
                onConfirmMannCandidate={(identity, candidate) => setLookup({ ...candidate, year: identity.year })}
                onLookupStart={() => resetVehicle(false)}
                onManualMode={() => resetVehicle(true)}
              />
            </div>
            <section id={catalogId} className={styles.manualCatalog} hidden={Boolean(selectedVehicle) || !catalogOpen} aria-label="Каталог MANN">
              <div className={styles.manualHeader}>
                <h3>Каталог MANN</h3>
                <button type="button" className="eco-btn" onClick={() => setCatalog(false)}>Свернуть</button>
              </div>
              {catalogOpen && !selectedVehicle && <ManualVehiclePicker active onSelect={setManual} />}
            </section>
            {draft && selectedVehicle && <button type="button" className="eco-btn eco-btn--primary" onClick={() => {
              if ((selectedVehicle.vin && selectedVehicle.vin === vehicle?.vin) || selectedVehicle.key === vehicle?.key) cancelEdit();
              else setConfirmChange(true);
            }}>Подтвердить выбор</button>}
          </div>;
        })}
        <dialog ref={confirmDialog} className={styles.vehicleConfirm} aria-labelledby="quote-confirm-vehicle" onCancel={event => {
          event.preventDefault();
          setConfirmChange(false);
        }}>
          <h3 id="quote-confirm-vehicle">Сменить автомобиль?</h3>
          <p>Проверьте применяемость масла и фильтров для нового автомобиля.</p>
          <p>{draftVehicle?.vehicleTitle}</p>
          <button type="button" className="eco-btn" onClick={() => setConfirmChange(false)}>Отмена</button>
          <button type="button" className="eco-btn eco-btn--primary" onClick={saveVehicle}>Сменить автомобиль</button>
        </dialog>
        {draftEditor === null && (manualSelection || (manualCatalogOpen && !vehicle)) && <label className={styles.manual}>Название для предложения <span>Необязательно</span>
          <input id="quote-vehicle-name" value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} placeholder="Например, Kia K5 2.0, 2021" />
        </label>}
      </section>} quoteContextKey={String(activeEditor)} vehicleTitle={vehicleTitle} warehouseId={storeId} organizationId={storeOrganizationId}
        filterVehicleContext={selection ? [`${selection.make} ${selection.model}`, selection.modification, selection.engineCode, selection.year].filter(Boolean).join(" · ") : undefined}
        filterStockError={filterState.error || undefined}
        profile={vehicle?.profile ?? null} research={vehicle?.research ?? null} filters={filters} filtersLoading={filterState.loading} services={services} timeZone={timeZone ?? undefined} />
    </>}
  </div>;
}
