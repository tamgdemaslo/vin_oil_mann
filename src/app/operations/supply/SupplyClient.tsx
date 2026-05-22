"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Meta = { href: string; type: string; mediaType: string };
type RefOption = { id: string; name: string; meta: Meta };
type ProductOption = {
  id: string;
  name: string;
  code?: string;
  price: number;
  salePrice?: number;
  currency: string;
  meta: Meta;
};
type SupplyPosition = {
  localId: string;
  name: string;
  code?: string;
  quantity: number;
  price: number;
  discount: number;
  assortmentMeta: Meta;
};
type SupplyRow = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  sum: number;
  incomingNumber?: string;
  incomingDate?: string;
  agentName: string;
  organizationName: string;
  storeName: string;
};
type SupplyDetail = {
  header: SupplyRow & {
    description?: string;
    payedSum?: number;
  };
  positions: {
    id?: string;
    name: string;
    code?: string;
    quantity: number;
    price: number;
    discount?: number;
  }[];
};

function makeLocalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function formatMoney(value: number | null | undefined, currency = "руб."): string {
  const n = Number(value ?? 0);
  return `${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatMoment(value?: string): string {
  if (!value) return "—";
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateForInput(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatMoyskladMoment(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function dateInputToMoyskladMoment(value: string): string | undefined {
  return value ? `${value} 00:00:00` : undefined;
}

function positionTotal(position: SupplyPosition): number {
  const quantity = Math.max(0, Number(position.quantity) || 0);
  const price = Math.max(0, Number(position.price) || 0);
  const discount = Math.min(100, Math.max(0, Number(position.discount) || 0));
  return quantity * price * (1 - discount / 100);
}

export default function SupplyClient() {
  const [supplies, setSupplies] = useState<SupplyRow[]>([]);
  const [suppliesLoading, setSuppliesLoading] = useState(true);
  const [suppliesError, setSuppliesError] = useState<string | null>(null);
  const [supplySearch, setSupplySearch] = useState("");
  const [openSupplyId, setOpenSupplyId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, SupplyDetail>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  const [organizations, setOrganizations] = useState<RefOption[]>([]);
  const [stores, setStores] = useState<RefOption[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<RefOption | null>(null);
  const [selectedStore, setSelectedStore] = useState<RefOption | null>(null);
  const [refsLoading, setRefsLoading] = useState(true);
  const [refsError, setRefsError] = useState<string | null>(null);

  const [agentSearch, setAgentSearch] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<RefOption | null>(null);
  const [agentOptions, setAgentOptions] = useState<RefOption[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentCreateLoading, setAgentCreateLoading] = useState(false);

  const [productSearch, setProductSearch] = useState("");
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [productLoading, setProductLoading] = useState(false);

  const [positions, setPositions] = useState<SupplyPosition[]>([]);
  const [incomingNumber, setIncomingNumber] = useState("");
  const [incomingDate, setIncomingDate] = useState(formatDateForInput());
  const [description, setDescription] = useState("");
  const [applicable, setApplicable] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitInfo, setSubmitInfo] = useState<string | null>(null);

  const total = useMemo(() => positions.reduce((sum, position) => sum + positionTotal(position), 0), [positions]);
  const totalQty = useMemo(
    () => positions.reduce((sum, position) => sum + Math.max(0, Number(position.quantity) || 0), 0),
    [positions]
  );

  const loadSupplies = useCallback(async (search = "") => {
    setSuppliesLoading(true);
    setSuppliesError(null);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/supplies?${params.toString()}`, { cache: "no-store" });
      const data = await readJson<{ rows?: SupplyRow[]; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить приёмки");
      setSupplies(Array.isArray(data?.rows) ? data.rows : []);
    } catch (error) {
      setSuppliesError(error instanceof Error ? error.message : String(error));
      setSupplies([]);
    } finally {
      setSuppliesLoading(false);
    }
  }, []);

  const loadRefs = useCallback(async () => {
    setRefsLoading(true);
    setRefsError(null);
    try {
      const [orgRes, storeRes, agentRes] = await Promise.all([
        fetch("/api/moysklad/organizations", { cache: "no-store" }),
        fetch("/api/moysklad/stores", { cache: "no-store" }),
        fetch("/api/moysklad/counterparties?limit=30", { cache: "no-store" }),
      ]);
      const [orgData, storeData, agentData] = await Promise.all([
        readJson<{ organizations?: RefOption[]; error?: string }>(orgRes),
        readJson<{ stores?: RefOption[]; error?: string }>(storeRes),
        readJson<{ counterparties?: RefOption[]; error?: string }>(agentRes),
      ]);
      if (!orgRes.ok) throw new Error(orgData?.error ?? "Не удалось загрузить организации");
      if (!storeRes.ok) throw new Error(storeData?.error ?? "Не удалось загрузить склады");
      if (!agentRes.ok) throw new Error(agentData?.error ?? "Не удалось загрузить поставщиков");

      const orgs = Array.isArray(orgData?.organizations) ? orgData.organizations : [];
      const loadedStores = Array.isArray(storeData?.stores) ? storeData.stores : [];
      const loadedAgents = Array.isArray(agentData?.counterparties) ? agentData.counterparties : [];
      setOrganizations(orgs);
      setStores(loadedStores);
      setAgentOptions(loadedAgents);
      setSelectedOrg((prev) => prev ?? orgs[0] ?? null);
      setSelectedStore((prev) => {
        if (prev) return prev;
        const main = loadedStores.find((store) => (store.name ?? "").toLowerCase().includes("основной"));
        return main ?? loadedStores[0] ?? null;
      });
    } catch (error) {
      setRefsError(error instanceof Error ? error.message : String(error));
    } finally {
      setRefsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRefs();
    void loadSupplies("");
  }, [loadRefs, loadSupplies]);

  useEffect(() => {
    if (!agentSearch.trim()) return;
    const timer = window.setTimeout(async () => {
      setAgentLoading(true);
      try {
        const params = new URLSearchParams({ search: agentSearch.trim(), limit: "20" });
        const res = await fetch(`/api/moysklad/counterparties?${params.toString()}`, { cache: "no-store" });
        const data = await readJson<{ counterparties?: RefOption[] }>(res);
        if (res.ok) setAgentOptions(Array.isArray(data?.counterparties) ? data.counterparties : []);
      } finally {
        setAgentLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [agentSearch]);

  useEffect(() => {
    const query = productSearch.trim();
    if (query.length < 2) {
      setProductOptions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setProductLoading(true);
      try {
        const params = new URLSearchParams({ search: query, limit: "20" });
        const res = await fetch(`/api/moysklad/supply-products?${params.toString()}`, { cache: "no-store" });
        const data = await readJson<{ products?: ProductOption[] }>(res);
        if (res.ok) setProductOptions(Array.isArray(data?.products) ? data.products : []);
      } finally {
        setProductLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [productSearch]);

  function addProduct(product: ProductOption) {
    setPositions((prev) => {
      const existingIndex = prev.findIndex((position) => position.assortmentMeta.href === product.meta.href);
      if (existingIndex >= 0) {
        return prev.map((position, index) =>
          index === existingIndex ? { ...position, quantity: position.quantity + 1 } : position
        );
      }
      return [
        ...prev,
        {
          localId: makeLocalId(),
          name: product.name,
          code: product.code,
          quantity: 1,
          price: Number(product.price) || 0,
          discount: 0,
          assortmentMeta: product.meta,
        },
      ];
    });
    setProductSearch("");
    setProductOptions([]);
  }

  function updatePosition(localId: string, patch: Partial<SupplyPosition>) {
    setPositions((prev) =>
      prev.map((position) => (position.localId === localId ? { ...position, ...patch } : position))
    );
  }

  async function createAgent() {
    const name = agentSearch.trim();
    if (!name) return;
    setAgentCreateLoading(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/moysklad/counterparties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, companyType: "legal" }),
      });
      const data = await readJson<RefOption & { error?: string }>(res);
      if (!res.ok || !data?.meta) throw new Error(data?.error ?? "Не удалось создать поставщика");
      setSelectedAgent({ id: data.id, name: data.name, meta: data.meta });
      setAgentSearch(data.name);
      setAgentOptions([]);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentCreateLoading(false);
    }
  }

  async function toggleSupplyDetail(id: string) {
    if (openSupplyId === id) {
      setOpenSupplyId(null);
      return;
    }
    setOpenSupplyId(id);
    if (detailById[id]) return;
    setDetailLoadingId(id);
    try {
      const res = await fetch(`/api/supplies/${id}`, { cache: "no-store" });
      const data = await readJson<SupplyDetail & { error?: string }>(res);
      if (!res.ok || !data) throw new Error(data?.error ?? "Не удалось загрузить состав приёмки");
      setDetailById((prev) => ({ ...prev, [id]: data }));
    } catch (error) {
      setSuppliesError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoadingId(null);
    }
  }

  async function submitSupply() {
    if (!selectedOrg || !selectedStore || !selectedAgent) {
      setSubmitError("Укажите организацию, склад и поставщика");
      return;
    }
    const validPositions = positions.filter((position) => position.assortmentMeta?.href && Number(position.quantity) > 0);
    if (validPositions.length === 0) {
      setSubmitError("Добавьте хотя бы одну позицию с количеством больше нуля");
      return;
    }

    setSubmitLoading(true);
    setSubmitError(null);
    setSubmitInfo(null);
    try {
      const res = await fetch("/api/supplies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: { meta: selectedOrg.meta },
          agent: { meta: selectedAgent.meta },
          store: { meta: selectedStore.meta },
          description: description.trim() || undefined,
          incomingNumber: incomingNumber.trim() || undefined,
          incomingDate: dateInputToMoyskladMoment(incomingDate),
          moment: formatMoyskladMoment(),
          applicable,
          vatEnabled: false,
          positions: validPositions.map((position) => ({
            quantity: Number(position.quantity) || 1,
            price: Number(position.price) || 0,
            discount: Number(position.discount) || 0,
            vat: 0,
            vatEnabled: false,
            assortment: { meta: position.assortmentMeta },
          })),
        }),
      });
      const data = await readJson<{ id?: string; name?: string; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось создать приёмку");
      setSubmitInfo(`Приёмка ${data?.name ?? ""} создана`);
      setPositions([]);
      setIncomingNumber("");
      setIncomingDate(formatDateForInput());
      setDescription("");
      await loadSupplies("");
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Приёмка
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Создание документов поступления товаров в МойСклад и быстрый контроль последних приёмок.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadRefs()}
            disabled={refsLoading}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Обновить справочники
          </button>
          <button
            type="button"
            onClick={() => void loadSupplies(supplySearch)}
            disabled={suppliesLoading}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60 dark:bg-amber-600 dark:hover:bg-amber-700"
          >
            Обновить журнал
          </button>
        </div>
      </div>

      {(refsError || submitError || suppliesError) && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          {refsError || submitError || suppliesError}
        </div>
      )}
      {submitInfo && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/35 dark:text-emerald-100">
          {submitInfo}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
        <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Новая приёмка</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Итого: {formatMoney(total)}, количество: {totalQty.toLocaleString("ru-RU")}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={applicable}
                onChange={(event) => setApplicable(event.target.checked)}
                className="size-4 rounded border-zinc-300 text-amber-600"
              />
              Провести документ
            </label>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Организация *</span>
              <select
                value={selectedOrg?.id ?? ""}
                onChange={(event) => setSelectedOrg(organizations.find((item) => item.id === event.target.value) ?? null)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">Не выбрана</option>
                {organizations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Склад *</span>
              <select
                value={selectedStore?.id ?? ""}
                onChange={(event) => setSelectedStore(stores.find((item) => item.id === event.target.value) ?? null)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              >
                <option value="">Не выбран</option>
                {stores.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Дата входящего документа</span>
              <input
                type="date"
                value={incomingDate}
                onChange={(event) => setIncomingDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(180px,0.8fr)]">
            <div>
              <label className="block text-sm">
                <span className="text-xs font-medium text-zinc-500">Поставщик *</span>
                <input
                  type="text"
                  value={agentSearch}
                  onChange={(event) => {
                    setAgentSearch(event.target.value);
                    setSelectedAgent(null);
                  }}
                  onFocus={() => {
                    if (selectedAgent) setAgentSearch(selectedAgent.name);
                  }}
                  placeholder="Поиск поставщика"
                  className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </label>
              {selectedAgent ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                  <span>Выбран: <strong className="text-zinc-900 dark:text-zinc-100">{selectedAgent.name}</strong></span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAgent(null);
                      setAgentSearch("");
                    }}
                    className="font-medium text-amber-700 hover:underline dark:text-amber-400"
                  >
                    сбросить
                  </button>
                </div>
              ) : (
                <div className="mt-1 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                  {agentLoading && <div className="px-3 py-2 text-sm text-zinc-500">Загрузка...</div>}
                  {!agentLoading && agentOptions.slice(0, 8).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedAgent(item);
                        setAgentSearch(item.name);
                        setAgentOptions([]);
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      {item.name}
                    </button>
                  ))}
                  {!agentLoading && agentSearch.trim() && agentOptions.length === 0 && (
                    <div className="px-3 py-2 text-sm text-zinc-500">Ничего не найдено</div>
                  )}
                </div>
              )}
              {!selectedAgent && agentSearch.trim() && (
                <button
                  type="button"
                  onClick={() => void createAgent()}
                  disabled={agentCreateLoading}
                  className="mt-2 text-sm font-medium text-amber-700 hover:underline disabled:opacity-60 dark:text-amber-400"
                >
                  {agentCreateLoading ? "Создание..." : `Создать поставщика "${agentSearch.trim()}"`}
                </button>
              )}
            </div>
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Входящий номер</span>
              <input
                type="text"
                value={incomingNumber}
                onChange={(event) => setIncomingNumber(event.target.value)}
                placeholder="Номер УПД/накладной"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
          </div>

          <div className="mt-5">
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Добавить товар *</span>
              <input
                type="text"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Название, артикул или код"
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            {(productLoading || productOptions.length > 0 || productSearch.trim().length >= 2) && (
              <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                {productLoading && <div className="px-3 py-2 text-sm text-zinc-500">Ищем товары...</div>}
                {!productLoading && productOptions.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProduct(product)}
                    className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {product.name}
                      {product.code ? <span className="ml-2 font-mono text-xs text-zinc-500">{product.code}</span> : null}
                    </span>
                    <span className="shrink-0 text-sm text-zinc-600 dark:text-zinc-300">
                      закуп: {formatMoney(product.price, product.currency)}
                    </span>
                  </button>
                ))}
                {!productLoading && productOptions.length === 0 && productSearch.trim().length >= 2 && (
                  <div className="px-3 py-2 text-sm text-zinc-500">Товары не найдены</div>
                )}
              </div>
            )}
          </div>

          <div className="mt-5 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-950">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Товар</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Кол-во</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Цена закупки</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Скидка, %</th>
                  <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Сумма</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
                {positions.map((position) => (
                  <tr key={position.localId}>
                    <td className="min-w-[260px] px-3 py-2">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{position.name}</div>
                      {position.code && <div className="mt-0.5 font-mono text-xs text-zinc-500">{position.code}</div>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={0.001}
                        value={position.quantity}
                        onChange={(event) => updatePosition(position.localId, { quantity: Number(event.target.value) || 0 })}
                        className="w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-right dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={position.price}
                        onChange={(event) => updatePosition(position.localId, { price: Number(event.target.value) || 0 })}
                        className="w-28 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-right dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={position.discount}
                        onChange={(event) => updatePosition(position.localId, { discount: Number(event.target.value) || 0 })}
                        className="w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-right dark:border-zinc-700 dark:bg-zinc-950"
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                      {formatMoney(positionTotal(position))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setPositions((prev) => prev.filter((item) => item.localId !== position.localId))}
                        className="rounded-lg px-2 py-1 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
                {positions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                      Позиции ещё не добавлены.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4">
            <label className="block text-sm">
              <span className="text-xs font-medium text-zinc-500">Комментарий</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
          </div>

          <div className="mt-5 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              К созданию: <span className="font-semibold text-zinc-900 dark:text-zinc-100">{positions.length}</span> строк,
              сумма <span className="font-semibold text-zinc-900 dark:text-zinc-100">{formatMoney(total)}</span>
            </div>
            <button
              type="button"
              onClick={() => void submitSupply()}
              disabled={submitLoading || refsLoading}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
            >
              {submitLoading ? "Создаём..." : "Создать приёмку"}
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Журнал приёмок</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Последние документы из МойСклад.</p>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void loadSupplies(supplySearch);
              }}
            >
              <input
                type="search"
                value={supplySearch}
                onChange={(event) => setSupplySearch(event.target.value)}
                placeholder="Поиск"
                className="w-40 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 sm:w-52"
              />
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Найти
              </button>
            </form>
          </div>

          <div className="mt-4 space-y-3">
            {suppliesLoading && (
              <div className="rounded-lg border border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
                Загружаем приёмки...
              </div>
            )}
            {!suppliesLoading && supplies.length === 0 && (
              <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
                Приёмки не найдены.
              </div>
            )}
            {!suppliesLoading && supplies.map((supply) => {
              const open = openSupplyId === supply.id;
              const detail = detailById[supply.id];
              return (
                <div key={supply.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => void toggleSupplyDetail(supply.id)}
                    className="block w-full px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-900 dark:text-zinc-100">{supply.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            supply.applicable
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                          }`}>
                            {supply.applicable ? "проведена" : "черновик"}
                          </span>
                        </div>
                        <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                          {formatMoment(supply.moment)} · {supply.agentName || "поставщик не указан"}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                          {supply.storeName || "склад не указан"}
                          {supply.incomingNumber ? ` · вх. ${supply.incomingNumber}` : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-left sm:text-right">
                        <div className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                          {formatMoney(supply.sum / 100)}
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">{open ? "Скрыть состав" : "Показать состав"}</div>
                      </div>
                    </div>
                  </button>
                  {open && (
                    <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                      {detailLoadingId === supply.id && (
                        <div className="py-4 text-sm text-zinc-500">Загружаем состав...</div>
                      )}
                      {detail && (
                        <div className="space-y-3">
                          {detail.header.description && (
                            <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
                              {detail.header.description}
                            </div>
                          )}
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                              <thead>
                                <tr className="text-left text-xs text-zinc-500">
                                  <th className="py-1 pr-3 font-medium">Товар</th>
                                  <th className="py-1 px-3 text-right font-medium">Кол-во</th>
                                  <th className="py-1 px-3 text-right font-medium">Цена</th>
                                  <th className="py-1 pl-3 text-right font-medium">Сумма</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {detail.positions.map((position, index) => (
                                  <tr key={position.id ?? `${supply.id}-${index}`}>
                                    <td className="py-2 pr-3">
                                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{position.name}</div>
                                      {position.code && <div className="font-mono text-xs text-zinc-500">{position.code}</div>}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{position.quantity}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(position.price)}</td>
                                    <td className="whitespace-nowrap py-2 pl-3 text-right font-medium tabular-nums">
                                      {formatMoney(position.quantity * position.price * (1 - (position.discount ?? 0) / 100))}
                                    </td>
                                  </tr>
                                ))}
                                {detail.positions.length === 0 && (
                                  <tr>
                                    <td colSpan={4} className="py-5 text-center text-sm text-zinc-500">
                                      В документе нет позиций.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
