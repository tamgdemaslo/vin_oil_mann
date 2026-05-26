"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FilePlus2, PackagePlus, RefreshCw } from "lucide-react";
import MoneyInput from "@/components/MoneyInput";
import { EcoBadge, EcoButton, EcoKpi } from "@/components/platform/EcoUI";

type StockDocumentType = "receipt" | "writeoff";

type StoreOption = { id: string; name: string };
type CounterpartyOption = { id: string; name: string; phone?: string; legalTitle?: string; inn?: string };
type ProductOption = {
  id: string;
  name: string;
  article: string;
  code: string;
  brand?: string;
  sae?: string;
  packageVolume?: string;
  supplierName?: string;
  groupPath?: string;
  entityType: string;
  salePrice: number;
  buyPrice: number | null;
  totalAvailable: number;
  stock: { storeId: string; storeName: string; available: number; slotName: string }[];
};

type Position = {
  localId: string;
  productId: string;
  name: string;
  article: string;
  quantity: number;
  price: number;
  slotName: string;
  available: number;
};

type MovementRow = {
  id: string;
  type: string;
  name: string;
  moment: string;
  documentDate: string;
  applicable: boolean;
  sum: number;
  description: string;
  storeName: string;
  counterpartyName: string;
  positionsCount: number;
  totalQuantity: number;
  invoice: {
    id: string;
    number: string;
    invoiceDate: string;
    dueDate: string;
    status: string;
    sum: number;
  } | null;
  positions: { id: string; name: string; quantity: number; price: number; slotName: string }[];
};
type ExistingInvoiceDraft = {
  documentId: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
};

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function makeLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQty(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function formatMoment(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function invoiceStatusLabel(value: string) {
  if (value === "paid") return "оплачен";
  if (value === "partial") return "частично";
  return "не оплачен";
}

export default function StockDocumentClient({ type }: { type: StockDocumentType }) {
  const searchParams = useSearchParams();
  const isReceipt = type === "receipt";
  const title = isReceipt ? "Приёмка" : "Списание";
  const actionLabel = isReceipt ? "Создать приёмку" : "Создать списание";
  const productPriceLabel = isReceipt ? "Цена закупки" : "Цена учёта";

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [counterpartySearch, setCounterpartySearch] = useState("");
  const [counterparties, setCounterparties] = useState<CounterpartyOption[]>([]);
  const [selectedCounterparty, setSelectedCounterparty] = useState<CounterpartyOption | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productsSearching, setProductsSearching] = useState(false);
  const [counterpartiesSearching, setCounterpartiesSearching] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const [documentDate, setDocumentDate] = useState(todayInput());
  const [createInvoice, setCreateInvoice] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayInput());
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("unpaid");
  const [description, setDescription] = useState("");
  const [applicable, setApplicable] = useState(true);
  const [documents, setDocuments] = useState<MovementRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [invoiceDraft, setInvoiceDraft] = useState<ExistingInvoiceDraft | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const total = useMemo(
    () => positions.reduce((sum, position) => sum + position.quantity * position.price, 0),
    [positions]
  );
  const totalQty = useMemo(
    () => positions.reduce((sum, position) => sum + position.quantity, 0),
    [positions]
  );
  const documentStats = useMemo(
    () => ({
      count: documents.length,
      conducted: documents.filter((document) => document.applicable).length,
      drafts: documents.filter((document) => !document.applicable).length,
      invoices: documents.filter((document) => document.invoice).length,
      sum: documents.reduce((acc, document) => acc + document.sum, 0),
      quantity: documents.reduce((acc, document) => acc + document.totalQuantity, 0),
    }),
    [documents]
  );

  function resetDocumentForm() {
    const today = todayInput();
    setPositions([]);
    setDescription("");
    setSelectedCounterparty(null);
    setCounterpartySearch("");
    setProductSearch("");
    setProducts([]);
    setDocumentDate(today);
    setCreateInvoice(false);
    setInvoiceNumber("");
    setInvoiceDate(today);
    setInvoiceDueDate("");
    setInvoiceStatus("unpaid");
    setApplicable(true);
    setFormOpen(false);
  }

  function openDocumentForm() {
    resetDocumentForm();
    setInfo(null);
    setError(null);
    setFormOpen(true);
  }

  async function loadRefs() {
    const [storeRes, counterpartyRes] = await Promise.all([
      fetch("/api/local-inventory/stores", { cache: "no-store" }),
      fetch("/api/local-inventory/counterparties?limit=30", { cache: "no-store" }),
    ]);
    const [storeData, counterpartyData] = await Promise.all([
      readJson<{ stores?: StoreOption[]; error?: string }>(storeRes),
      readJson<{ counterparties?: CounterpartyOption[]; error?: string }>(counterpartyRes),
    ]);
    if (!storeRes.ok) throw new Error(storeData?.error ?? "Не удалось загрузить склады");
    if (!counterpartyRes.ok) throw new Error(counterpartyData?.error ?? "Не удалось загрузить контрагентов");
    const nextStores = Array.isArray(storeData?.stores) ? storeData.stores : [];
    setStores(nextStores);
    setSelectedStoreId((prev) => prev || nextStores[0]?.id || "");
    setCounterparties(Array.isArray(counterpartyData?.counterparties) ? counterpartyData.counterparties : []);
  }

  async function loadDocuments() {
    const params = new URLSearchParams({ type, limit: "30" });
    const res = await fetch(`/api/local-inventory/movements?${params.toString()}`, { cache: "no-store" });
    const data = await readJson<{ documents?: MovementRow[]; error?: string }>(res);
    if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить журнал");
    setDocuments(Array.isArray(data?.documents) ? data.documents : []);
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadRefs(), loadDocuments()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  useEffect(() => {
    const documentId = searchParams.get("document");
    if (documentId && documents.some((document) => document.id === documentId)) {
      setOpenId(documentId);
    }
  }, [documents, searchParams]);

  useEffect(() => {
    const query = productSearch.trim();
    if (query.length < 2) {
      setProducts([]);
      setProductsSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setProductsSearching(true);
      try {
        const params = new URLSearchParams({ search: query, limit: "30" });
        const res = await fetch(`/api/local-inventory/products?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readJson<{ products?: ProductOption[] }>(res);
        if (res.ok) {
          setProducts((Array.isArray(data?.products) ? data.products : []).filter((p) => p.entityType !== "service"));
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setProducts([]);
      } finally {
        if (!controller.signal.aborted) setProductsSearching(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [productSearch]);

  useEffect(() => {
    const query = counterpartySearch.trim();
    if (query.length < 2) {
      setCounterpartiesSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCounterpartiesSearching(true);
      try {
        const params = new URLSearchParams({ search: query, limit: "20" });
        const res = await fetch(`/api/local-inventory/counterparties?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readJson<{ counterparties?: CounterpartyOption[] }>(res);
        if (res.ok) setCounterparties(Array.isArray(data?.counterparties) ? data.counterparties : []);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setCounterparties([]);
      } finally {
        if (!controller.signal.aborted) setCounterpartiesSearching(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [counterpartySearch]);

  function availableForStore(product: ProductOption) {
    if (!selectedStoreId) return product.totalAvailable;
    return product.stock.find((row) => row.storeId === selectedStoreId)?.available ?? 0;
  }

  function slotForStore(product: ProductOption) {
    if (!selectedStoreId) return "";
    return product.stock.find((row) => row.storeId === selectedStoreId)?.slotName ?? "";
  }

  function addProduct(product: ProductOption) {
    setPositions((prev) => {
      const existing = prev.find((position) => position.productId === product.id);
      if (existing) {
        return prev.map((position) =>
          position.productId === product.id
            ? { ...position, quantity: position.quantity + 1 }
            : position
        );
      }
      return [
        ...prev,
        {
          localId: makeLocalId(),
          productId: product.id,
          name: product.name,
          article: product.article || product.code,
          quantity: 1,
          price: isReceipt ? product.buyPrice ?? 0 : product.buyPrice ?? product.salePrice ?? 0,
          slotName: slotForStore(product),
          available: availableForStore(product),
        },
      ];
    });
    setProductSearch("");
    setProducts([]);
  }

  function updatePosition(localId: string, patch: Partial<Position>) {
    setPositions((prev) =>
      prev.map((position) => (position.localId === localId ? { ...position, ...patch } : position))
    );
  }

  async function submit() {
    if (!selectedStoreId) {
      setError("Выберите склад");
      return;
    }
    if (positions.length === 0) {
      setError("Добавьте хотя бы одну позицию");
      return;
    }
    if (isReceipt && createInvoice && !selectedCounterparty) {
      setError("Выберите поставщика из выпадающего списка для счёта");
      return;
    }
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/local-inventory/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          storeId: selectedStoreId,
          counterpartyId: selectedCounterparty?.id ?? null,
          documentDate,
          description: description.trim() || undefined,
          applicable,
          invoice: isReceipt && createInvoice
            ? {
                create: true,
                number: invoiceNumber.trim() || undefined,
                invoiceDate,
                dueDate: invoiceDueDate || undefined,
                status: invoiceStatus,
              }
            : undefined,
          positions: positions.map((position) => ({
            productId: position.productId,
            quantity: Number(position.quantity) || 0,
            price: Number(position.price) || 0,
            slotName: position.slotName || undefined,
          })),
        }),
      });
      const data = await readJson<{ name?: string; invoice?: { number?: string | null }; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось создать документ");
      setInfo(`${title} ${data?.name ?? ""} создана${data?.invoice ? `, счёт ${data.invoice.number ?? ""} добавлен` : ""}`);
      resetDocumentForm();
      await loadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function startInvoiceForDocument(document: MovementRow) {
    setOpenId(document.id);
    setInvoiceDraft({
      documentId: document.id,
      number: "",
      invoiceDate: document.documentDate,
      dueDate: "",
      status: "unpaid",
    });
    setError(null);
    setInfo(null);
  }

  async function createInvoiceForExistingReceipt(document: MovementRow) {
    if (!invoiceDraft || invoiceDraft.documentId !== document.id) return;
    setInvoiceSaving(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/local-inventory/supplier-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: document.id,
          number: invoiceDraft.number.trim() || undefined,
          invoiceDate: invoiceDraft.invoiceDate || document.documentDate,
          dueDate: invoiceDraft.dueDate || undefined,
          status: invoiceDraft.status,
        }),
      });
      const data = await readJson<{ number?: string; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось создать счёт");
      setInfo(`Счёт ${data?.number || ""} создан по приёмке ${document.name}`);
      setInvoiceDraft(null);
      await loadDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInvoiceSaving(false);
    }
  }

  return (
    <div className="eco-stock-doc-page">
      {formOpen && (
        <div className="eco-stock-modal fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 px-3 py-6 backdrop-blur-sm sm:px-6">
          <section
            role="dialog"
            aria-modal="true"
            className="eco-stock-dialog w-full max-w-5xl rounded-lg border border-zinc-200 bg-white p-4 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
          >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">{title}</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {isReceipt
                ? "Поступление увеличивает остаток по выбранному складу."
                : "Списание уменьшает остаток по выбранному складу."}
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200">
            <input
              type="checkbox"
              checked={applicable}
              onChange={(event) => setApplicable(event.target.checked)}
              className="size-4 rounded border-zinc-300"
            />
            Провести
          </label>
        </div>

        {(error || info) && (
          <div className={`mt-4 rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
              : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
          }`}>
            {error || info}
          </div>
        )}

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">Склад *</span>
            <select
              value={selectedStoreId}
              onChange={(event) => setSelectedStoreId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            >
              <option value="">Не выбран</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">
              {isReceipt ? "Поставщик" : "Контрагент / основание"}
            </span>
            <input
              value={selectedCounterparty?.name ?? counterpartySearch}
              onChange={(event) => {
                setSelectedCounterparty(null);
                setCounterpartySearch(event.target.value);
              }}
              placeholder="Поиск"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">Дата</span>
            <input
              type="date"
              value={documentDate}
              onChange={(event) => {
                setDocumentDate(event.target.value);
                if (!createInvoice) setInvoiceDate(event.target.value);
              }}
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
        </div>

        {isReceipt && (
          <div className="mt-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-100">
              <input
                type="checkbox"
                checked={createInvoice}
                onChange={(event) => {
                  setCreateInvoice(event.target.checked);
                  if (event.target.checked && !invoiceDate) setInvoiceDate(documentDate);
                }}
                className="size-4 rounded border-zinc-300"
              />
              Создать счёт поставщика
            </label>
            {createInvoice && (
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <label className="block text-sm">
                  <span className="text-xs font-medium text-zinc-500">Номер счёта</span>
                  <input
                    value={invoiceNumber}
                    onChange={(event) => setInvoiceNumber(event.target.value)}
                    placeholder="авто"
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-zinc-500">Дата счёта</span>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(event) => setInvoiceDate(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-zinc-500">Оплатить до</span>
                  <input
                    type="date"
                    value={invoiceDueDate}
                    onChange={(event) => setInvoiceDueDate(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-medium text-zinc-500">Статус</span>
                  <select
                    value={invoiceStatus}
                    onChange={(event) => setInvoiceStatus(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                  >
                    <option value="unpaid">Не оплачен</option>
                    <option value="partial">Частично</option>
                    <option value="paid">Оплачен</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        )}

        {!selectedCounterparty && counterpartySearch.trim().length >= 2 && (
          <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
            {counterpartiesSearching && counterparties.length === 0 && (
              <div className="px-3 py-2 text-sm text-zinc-500">Ищем контрагента...</div>
            )}
            {!counterpartiesSearching && counterparties.length === 0 && (
              <div className="px-3 py-2 text-sm text-zinc-500">Контрагенты не найдены</div>
            )}
            {counterparties.slice(0, 6).map((counterparty) => (
              <button
                key={counterparty.id}
                type="button"
                onClick={() => {
                  setSelectedCounterparty(counterparty);
                  setCounterpartySearch(counterparty.name);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <span className="font-medium text-zinc-950 dark:text-zinc-50">{counterparty.name}</span>
                {(counterparty.legalTitle || counterparty.inn || counterparty.phone) && (
                  <span className="ml-2 text-xs text-zinc-500">
                    {[counterparty.legalTitle, counterparty.inn, counterparty.phone].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4">
          <label className="block text-sm">
            <span className="text-xs font-medium text-zinc-500">Добавить товар *</span>
            <input
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Название, артикул или код"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          {(productSearch.trim().length >= 2 || products.length > 0) && (
            <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
              {productsSearching && products.length === 0 && (
                <div className="px-3 py-2 text-sm text-zinc-500">Ищем товар...</div>
              )}
              {products.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addProduct(product)}
                  className="flex w-full flex-col gap-1 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span>
                    <span className="font-medium text-zinc-950 dark:text-zinc-50">{product.name}</span>
                    <span className="ml-2 text-xs text-zinc-500">{product.article || product.code}</span>
                    {(product.brand || product.sae || product.packageVolume || product.supplierName) && (
                      <span className="ml-2 text-xs text-zinc-500">
                        {[product.brand, product.sae, product.packageVolume, product.supplierName].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-zinc-500">
                    доступно: {formatQty(availableForStore(product))}
                  </span>
                </button>
              ))}
              {!productsSearching && products.length === 0 && productSearch.trim().length >= 2 && (
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
                <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">{productPriceLabel}</th>
                <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Ячейка</th>
                <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Сумма</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 bg-white dark:divide-zinc-800 dark:bg-zinc-900">
              {positions.map((position) => (
                <tr key={position.localId}>
                  <td className="min-w-[240px] px-3 py-2">
                    <div className="font-medium text-zinc-950 dark:text-zinc-50">{position.name}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">
                      {position.article || "без артикула"} · доступно {formatQty(position.available)}
                    </div>
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
                    <MoneyInput
                      value={position.price}
                      onValueChange={(price) => updatePosition(position.localId, { price })}
                      className="w-28 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-right dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <input
                      value={position.slotName}
                      onChange={(event) => updatePosition(position.localId, { slotName: event.target.value })}
                      className="w-28 rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                    {formatMoney(position.quantity * position.price)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setPositions((prev) => prev.filter((item) => item.localId !== position.localId))}
                      className="rounded-lg px-2 py-1 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              ))}
              {positions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-zinc-500">Позиции ещё не добавлены.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <label className="mt-4 block text-sm">
          <span className="text-xs font-medium text-zinc-500">Комментарий</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>

        <div className="mt-5 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            {positions.length} строк · {formatQty(totalQty)} шт. · {formatMoney(total)} ₽
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving || loading}
              className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-950"
            >
              {saving ? "Создание..." : actionLabel}
            </button>
            <button
              type="button"
              onClick={resetDocumentForm}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Отмена
            </button>
          </div>
        </div>
      </section>
        </div>
      )}

      <section className="eco-page-head eco-stock-doc-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <span>Склад</span>
            <span className="sep">/</span>
            <span className="cur">{title}</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">{title}</h1>
            <EcoBadge tone={isReceipt ? "success" : "warning"} dot>
              {isReceipt ? "поступление" : "корректировка"}
            </EcoBadge>
            <EcoBadge tone="neutral">{documentStats.count} документов</EcoBadge>
          </div>
          <p className="eco-page-subtitle">
            {isReceipt
              ? "Поступления, поставщики, счета и приходные позиции локального склада."
              : "Списания, основания и корректировки остатков локального склада."}
          </p>
        </div>
        <div className="eco-page-actions">
          <EcoButton type="button" onClick={() => void loadDocuments()}>
            <RefreshCw size={15} />
            Обновить
          </EcoButton>
          <EcoButton type="button" variant="primary" onClick={openDocumentForm}>
            <FilePlus2 size={15} />
            {actionLabel}
          </EcoButton>
        </div>
      </section>

      <div className="eco-grid eco-grid--kpi eco-stock-doc-metrics">
        <EcoKpi label="Документы" value={documentStats.count} tone="info" />
        <EcoKpi label="Проведено" value={documentStats.conducted} sub={`${documentStats.drafts} черновиков`} tone="success" />
        <EcoKpi label="Количество" value={formatQty(documentStats.quantity)} tone="neutral" />
        <EcoKpi
          label={isReceipt ? "Счета / сумма" : "Сумма"}
          value={`${formatMoney(documentStats.sum)} ₽`}
          sub={isReceipt ? `${documentStats.invoices} счетов` : undefined}
          tone="rust"
        />
      </div>

      <section className="eco-card eco-stock-doc-journal">
        <div className="eco-table-toolbar">
          <div>
            <div className="eco-page-kicker">Журнал</div>
            <h2 className="eco-stock-doc-title">Последние локальные документы</h2>
            <p className="eco-stock-doc-subtitle">
              Последние локальные документы.
            </p>
          </div>
          <div className="grow" />
          <span className="l-meta">{documents.length} строк · {formatMoney(documentStats.sum)} ₽</span>
          <div className="eco-row-actions is-visible">
            <EcoButton
              type="button"
              onClick={openDocumentForm}
              size="sm"
              variant="primary"
            >
              <PackagePlus size={14} />
              {actionLabel}
            </EcoButton>
            <EcoButton
              type="button"
              onClick={() => void loadDocuments()}
              size="sm"
            >
              <RefreshCw size={14} />
              Обновить
            </EcoButton>
          </div>
        </div>

        {(error || info) && (
          <div className={error ? "eco-form-error eco-stock-message" : "eco-form-hint eco-stock-message is-info"}>
            {error || info}
          </div>
        )}

        <div className="eco-stock-doc-list">
          {loading && (
            <div className="rounded-lg border border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
              Загрузка...
            </div>
          )}
          {!loading && documents.length === 0 && (
            <div className="rounded-lg border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Документов пока нет.
            </div>
          )}
          {!loading && documents.map((document) => {
            const open = openId === document.id;
            return (
              <div key={document.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : document.id)}
                  className="block w-full px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-zinc-950 dark:text-zinc-50">{document.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          document.applicable
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}>
                          {document.applicable ? "проведён" : "черновик"}
                        </span>
                        {document.invoice && (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
                            счёт {document.invoice.number || "без номера"}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                        {formatMoment(document.moment)} · {document.storeName || "склад не указан"}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        {document.counterpartyName || "без контрагента"} · {formatQty(document.totalQuantity)} шт.
                      </div>
                    </div>
                    <div className="shrink-0 text-left sm:text-right">
                      <div className="font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
                        {formatMoney(document.sum)} ₽
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">{document.positionsCount} поз.</div>
                    </div>
                  </div>
                </button>
                {open && (
                  <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                    <div className="space-y-2">
                      {document.positions.map((position) => (
                        <div key={position.id} className="flex gap-3 text-sm">
                          <div className="min-w-0 flex-1 text-zinc-800 dark:text-zinc-100">{position.name}</div>
                          <div className="shrink-0 tabular-nums text-zinc-500">
                            {formatQty(position.quantity)} × {formatMoney(position.price)}
                          </div>
                        </div>
                      ))}
                    </div>
                    {document.description && (
                      <div className="mt-3 text-sm text-zinc-500">{document.description}</div>
                    )}
                    {isReceipt && (
                      <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="font-medium text-zinc-950 dark:text-zinc-50">Связанные документы</div>
                            <div className="mt-0.5 text-xs text-zinc-500">
                              Счета поставщиков по этой приёмке хранятся в разделе Финансы.
                            </div>
                          </div>
                          {!document.invoice && invoiceDraft?.documentId !== document.id && (
                            <button
                              type="button"
                              onClick={() => startInvoiceForDocument(document)}
                              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                            >
                              Создать счёт
                            </button>
                          )}
                        </div>

                        {document.invoice ? (
                          <Link
                            href={`/finance/invoices?invoice=${document.invoice.id}`}
                            className="mt-3 block rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-sky-950 hover:bg-sky-100 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100 dark:hover:bg-sky-950/50"
                          >
                            <div className="font-medium">
                              Счёт {document.invoice.number || "без номера"} · {formatMoney(document.invoice.sum)} ₽
                            </div>
                            <div className="mt-1 text-xs text-sky-700 dark:text-sky-300">
                              Дата: {document.invoice.invoiceDate}
                              {document.invoice.dueDate ? ` · оплатить до ${document.invoice.dueDate}` : ""}
                              {" · "}
                              {invoiceStatusLabel(document.invoice.status)}
                            </div>
                          </Link>
                        ) : (
                          <div className="mt-3 text-xs text-zinc-500">Связанных счетов пока нет.</div>
                        )}

                        {invoiceDraft?.documentId === document.id && (
                          <div className="mt-3 grid gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 sm:grid-cols-4">
                            <label className="block text-sm">
                              <span className="text-xs font-medium text-zinc-500">Номер счёта</span>
                              <input
                                value={invoiceDraft.number}
                                onChange={(event) => setInvoiceDraft({ ...invoiceDraft, number: event.target.value })}
                                placeholder="авто"
                                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="text-xs font-medium text-zinc-500">Дата счёта</span>
                              <input
                                type="date"
                                value={invoiceDraft.invoiceDate}
                                onChange={(event) => setInvoiceDraft({ ...invoiceDraft, invoiceDate: event.target.value })}
                                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="text-xs font-medium text-zinc-500">Оплатить до</span>
                              <input
                                type="date"
                                value={invoiceDraft.dueDate}
                                onChange={(event) => setInvoiceDraft({ ...invoiceDraft, dueDate: event.target.value })}
                                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                              />
                            </label>
                            <label className="block text-sm">
                              <span className="text-xs font-medium text-zinc-500">Статус</span>
                              <select
                                value={invoiceDraft.status}
                                onChange={(event) => setInvoiceDraft({ ...invoiceDraft, status: event.target.value })}
                                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                              >
                                <option value="unpaid">Не оплачен</option>
                                <option value="partial">Частично</option>
                                <option value="paid">Оплачен</option>
                              </select>
                            </label>
                            <div className="flex flex-wrap gap-2 sm:col-span-4">
                              <button
                                type="button"
                                onClick={() => void createInvoiceForExistingReceipt(document)}
                                disabled={invoiceSaving}
                                className="rounded-lg bg-zinc-950 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-950"
                              >
                                {invoiceSaving ? "Создаю..." : "Сохранить счёт"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setInvoiceDraft(null)}
                                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                              >
                                Отмена
                              </button>
                            </div>
                          </div>
                        )}
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
  );
}
