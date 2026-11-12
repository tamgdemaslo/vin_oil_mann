"use client";

import { useEffect, useState } from "react";
import { Warehouse } from "lucide-react";
import { MaintenanceQuotePanel, type MaintenanceQuoteVehicleContext } from "@/components/shipment/MaintenanceQuotePanel";
import { VehicleLookupPanel } from "@/components/shipment/VehicleLookupPanel";
import type { MannCatalogFilter } from "@/lib/mann-catalog";
import { ManualVehiclePicker, type QuoteVehicleSelection } from "./ManualVehiclePicker";
import type { QuoteFilterGroup } from "@/lib/maintenance-quote";
import styles from "./maintenance-quote.module.css";

type Store = { id: string; name: string; organizationId: string | null };
type Props = { branchName?: string; organizationId: string | null; stores: Store[] };
type FilterSelection = QuoteVehicleSelection & { variantIds?: string[] };
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

export function MaintenanceQuoteWorkspace({ branchName, organizationId, stores }: Props) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const store = stores.find((item) => item.id === storeId);
  const storeOrganizationId = store?.organizationId ?? organizationId;
  const [vehicle, setVehicle] = useState<MaintenanceQuoteVehicleContext | null>(null);
  const [vehicleName, setVehicleName] = useState("");
  const [selection, setSelection] = useState<FilterSelection | null>(null);
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

  const vehicleTitle = vehicle?.vehicleTitle || vehicleName.trim() || (selection ? `${selection.make} ${selection.model}` : "Автомобиль не указан");

  return <div className={`eco-page ${styles.page}`}>
    <header className={styles.pageHeader}>
      <span className={styles.kicker}>Работа / Расчёт ТО</span>
      <div className={styles.title}><h1>Расчёт ТО</h1></div>
      <p>Подберите масло, фильтры и работы. Соберите предложение, которое можно отправить клиенту.</p>
    </header>
    {!branchName ? <p role="status" className={styles.setup}>Выберите рабочий филиал в верхнем меню.</p> : <>
      <section className={styles.setup} aria-labelledby="quote-setup-title">
        <header className={styles.setupHeader}>
          <div className={styles.setupTitle}><div><h2 id="quote-setup-title">Автомобиль и склад</h2><p>{branchName}</p></div></div>
          <label className={styles.store}><span><Warehouse size={16} aria-hidden="true" /> Склад</span>
            <select value={storeId} onChange={(event) => { setFilters([]); setStoreId(event.target.value); }} disabled={!stores.length}>
              {!stores.length && <option value="">Нет доступных складов</option>}
              {stores.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </header>
        <div className={styles.lookup}>
          <VehicleLookupPanel organizationId={storeOrganizationId} warehouseId={storeId} combinedIdentifier
            onQuoteContextChange={setVehicle}
            onUseVehicle={(identity, resolution) => setSelection(resolution?.selectedApplication ? { ...resolution.selectedApplication, year: identity.year } : null)}
            onConfirmMannCandidate={(identity, candidate) => setSelection({ ...candidate, year: identity.year })}
            onLookupStart={() => { setVehicle(null); setSelection(null); setManualCatalogOpen(false); }}
            onManualMode={() => { setVehicle(null); setSelection(null); setManualCatalogOpen(true); }}
          />
        </div>
        {!vehicle && <details className={styles.lookup} open={manualCatalogOpen} onToggle={(event) => setManualCatalogOpen(event.currentTarget.open)}>
          <summary>Выбрать вручную в каталоге MANN</summary>
          <ManualVehiclePicker active={manualCatalogOpen} onSelect={setSelection} />
        </details>}
        {!vehicle && <label className={styles.manual}>Автомобиль вручную <span>Необязательно</span>
          <input id="quote-vehicle-name" value={vehicleName} onChange={(event) => setVehicleName(event.target.value)} placeholder="Например, Kia K5 2.0, 2021" />
        </label>}
        {filterState.error && <p role="status" className={styles.error}>{filterState.error} Можно указать артикул вручную.</p>}
      </section>
      <MaintenanceQuotePanel key={vehicle?.key ?? selection?.variantId ?? "manual"} vehicleTitle={vehicleTitle} warehouseId={storeId}
        profile={vehicle?.profile ?? null} research={vehicle?.research ?? null} filters={filters} filtersLoading={filterState.loading} />
    </>}
  </div>;
}
