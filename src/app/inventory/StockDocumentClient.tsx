"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  FilePlus2,
  Loader2,
  PackagePlus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import MoneyInput from "@/components/MoneyInput";
import { EcoBadge, EcoButton, EcoInput, EcoSelect } from "@/components/platform/EcoUI";

type StockDocumentType = "receipt" | "writeoff";
type FormMode = "new" | "edit" | "view";
type SaveAction = "draft" | "conduct";

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
  code: string;
  brand: string;
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
  storeId: string;
  storeName: string;
  counterpartyId: string;
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
  positions: {
    id: string;
    productId: string | null;
    name: string;
    article: string;
    code: string;
    brand: string;
    quantity: number;
    price: number;
    slotName: string;
  }[];
};

type ExistingInvoiceDraft = {
  documentId: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  status: string;
};

const emptySupplierDraft = {
  name: "",
  phone: "",
  inn: "",
  comment: "",
};

const emptyProductDraft = {
  name: "",
  article: "",
  code: "",
  brand: "",
  buyPrice: 0,
  salePrice: 0,
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
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
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

function formatDate(value: string) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function invoiceStatusLabel(value: string) {
  if (value === "paid") return "оплачен";
  if (value === "partial") return "частично";
  return "не оплачен";
}

function statusMeta(document: Pick<MovementRow, "applicable">) {
  return document.applicable
    ? { label: "Проведена", tone: "success" as const }
    : { label: "Черновик", tone: "warning" as const };
}

export default function StockDocumentClient({ type }: { type: StockDocumentType }) {
  const searchParams = useSearchParams();
  const autoOpenedDocumentRef = useRef<string | null>(null);
  const isReceipt = type === "receipt";
  const title = isReceipt ? "Приёмка" : "Списание";
  const actionLabel = isReceipt ? "Создать приёмку" : "Создать списание";
  const productPriceLabel = isReceipt ? "Закупочная цена" : "Цена учёта";

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState("");
  const [storesLoading, setStoresLoading] = useState(true);
  const [storesError, setStoresError] = useState<string | null>(null);

  const [counterpartySearch, setCounterpartySearch] = useState("");
  const [counterparties, setCounterparties] = useState<CounterpartyOption[]>([]);
  const [selectedCounterparty, setSelectedCounterparty] = useState<CounterpartyOption | null>(null);
  const [counterpartiesSearching, setCounterpartiesSearching] = useState(false);
  const [counterpartiesLoading, setCounterpartiesLoading] = useState(true);
  const [counterpartiesError, setCounterpartiesError] = useState<string | null>(null);

  const [productSearch, setProductSearch] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [productsSearching, setProductsSearching] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);

  const [documentDate, setDocumentDate] = useState(todayInput());
  const [createInvoice, setCreateInvoice] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayInput());
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("unpaid");
  const [description, setDescription] = useState("");

  const [documents, setDocuments] = useState<MovementRow[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [invoiceDraft, setInvoiceDraft] = useState<ExistingInvoiceDraft | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("new");
  const [editingDocument, setEditingDocument] = useState<MovementRow | null>(null);
  const [savingAction, setSavingAction] = useState<SaveAction | null>(null);
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [newSupplier, setNewSupplier] = useState(emptySupplierDraft);
  const [newSupplierSaving, setNewSupplierSaving] = useState(false);

  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyProductDraft);
  const [newProductSaving, setNewProductSaving] = useState(false);

  const readOnly = formMode === "view" || Boolean(editingDocument?.applicable);

  const total = useMemo(
    () => positions.reduce((sum, position) => sum + position.quantity * position.price, 0),
    [positions]
  );
  const totalQty = useMemo(
    () => positions.reduce((sum, position) => sum + position.quantity, 0),
    [positions]
  );
  const selectedStoreName = useMemo(
    () => stores.find((store) => store.id === selectedStoreId)?.name ?? "",
    [selectedStoreId, stores]
  );
  const lastDocument = documents[0] ?? null;
  const documentStats = useMemo(
    () => ({
      count: documents.length,
      conducted: documents.filter((document) => document.applicable).length,
      drafts: documents.filter((document) => !document.applicable).length,
      invoices: documents.filter((document) => document.invoice).length,
      sum: documents.reduce((acc, document) => acc + document.sum, 0),
      quantity: documents.reduce((acc, document) => acc + document.totalQuantity, 0),
      positions: documents.reduce((acc, document) => acc + document.positionsCount, 0),
    }),
    [documents]
  );

  const hasInvalidQty = positions.some((position) => Number(position.quantity) <= 0);
  const hasInvalidReceiptPrice = isReceipt && positions.some((position) => Number(position.price) <= 0);
  const canSaveDraft = !readOnly && positions.length > 0 && !hasInvalidQty && !savingAction;
  const canConduct = canSaveDraft && Boolean(selectedStoreId) && !hasInvalidReceiptPrice;
  const footerHelper = (() => {
    if (readOnly) return "Проведённый документ открыт только для просмотра. Для нового прихода используйте копию.";
    if (positions.length === 0) return "Добавьте хотя бы одну позицию, чтобы сохранить документ.";
    if (hasInvalidQty) return "Количество по каждой позиции должно быть больше нуля.";
    if (!selectedStoreId) return "Черновик можно сохранить без движения остатков; для проведения выберите склад.";
    if (hasInvalidReceiptPrice) return "Для проведения укажите закупочную цену по каждой позиции.";
    return "Черновик не меняет остатки. Проведение увеличит остаток выбранного склада.";
  })();

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
    setEditingDocument(null);
    setFormMode("new");
    setFormError(null);
    setNewSupplierOpen(false);
    setNewSupplier(emptySupplierDraft);
    setNewProductOpen(false);
    setNewProduct(emptyProductDraft);
  }

  function closeDocumentForm() {
    resetDocumentForm();
    setFormOpen(false);
  }

  function openDocumentForm() {
    resetDocumentForm();
    setInfo(null);
    setFormOpen(true);
  }

  function fillFormFromDocument(document: MovementRow, mode: FormMode) {
    const today = todayInput();
    setEditingDocument(document);
    setFormMode(mode);
    setPositions(document.positions.map((position) => ({
      localId: makeLocalId(),
      productId: position.productId ?? "",
      name: position.name,
      article: position.article || position.code,
      code: position.code,
      brand: position.brand,
      quantity: position.quantity,
      price: position.price,
      slotName: position.slotName,
      available: 0,
    })));
    setDescription(document.description || "");
    setSelectedStoreId(document.storeId || selectedStoreId);
    setSelectedCounterparty(
      document.counterpartyId
        ? { id: document.counterpartyId, name: document.counterpartyName || "Поставщик" }
        : null
    );
    setCounterpartySearch(document.counterpartyName || "");
    setProductSearch("");
    setProducts([]);
    setDocumentDate(document.documentDate || today);
    setCreateInvoice(Boolean(document.invoice));
    setInvoiceNumber(document.invoice?.number ?? "");
    setInvoiceDate(document.invoice?.invoiceDate || document.documentDate || today);
    setInvoiceDueDate(document.invoice?.dueDate ?? "");
    setInvoiceStatus(document.invoice?.status ?? "unpaid");
    setFormError(null);
    setInfo(null);
    setFormOpen(true);
  }

  function openExistingDocument(document: MovementRow) {
    fillFormFromDocument(document, document.applicable ? "view" : "edit");
  }

  function copyFromDocument(document: MovementRow) {
    fillFormFromDocument({ ...document, id: "", name: "", applicable: false, invoice: null }, "new");
    setEditingDocument(null);
    setCreateInvoice(false);
    setInvoiceNumber("");
    setInfo(`Создана форма на основе ${document.name}. Сохраните её как новый черновик.`);
  }

  async function loadStores() {
    setStoresLoading(true);
    setStoresError(null);
    try {
      const res = await fetch("/api/local-inventory/stores", { cache: "no-store" });
      const data = await readJson<{ stores?: StoreOption[]; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить склады");
      const nextStores = Array.isArray(data?.stores) ? data.stores : [];
      setStores(nextStores);
      setSelectedStoreId((prev) => prev || nextStores[0]?.id || "");
      if (nextStores.length === 0) setStoresError("В локальной базе нет доступных складов");
    } catch (e) {
      setStores([]);
      setStoresError(e instanceof Error ? e.message : "Не удалось загрузить склады");
    } finally {
      setStoresLoading(false);
    }
  }

  async function loadCounterparties(search = "") {
    const initial = !search;
    if (initial) setCounterpartiesLoading(true);
    setCounterpartiesError(null);
    try {
      const params = new URLSearchParams({ limit: initial ? "30" : "20" });
      if (search) params.set("search", search);
      const res = await fetch(`/api/local-inventory/counterparties?${params.toString()}`, { cache: "no-store" });
      const data = await readJson<{ counterparties?: CounterpartyOption[]; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить поставщиков");
      setCounterparties(Array.isArray(data?.counterparties) ? data.counterparties : []);
    } catch (e) {
      setCounterpartiesError(e instanceof Error ? e.message : "Не удалось загрузить поставщиков");
      if (initial) setCounterparties([]);
    } finally {
      if (initial) setCounterpartiesLoading(false);
    }
  }

  async function loadDocuments() {
    setDocumentsLoading(true);
    setDocumentsError(null);
    try {
      const params = new URLSearchParams({ type, limit: "30" });
      const res = await fetch(`/api/local-inventory/movements?${params.toString()}`, { cache: "no-store" });
      const data = await readJson<{ documents?: MovementRow[]; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить журнал");
      setDocuments(Array.isArray(data?.documents) ? data.documents : []);
    } catch (e) {
      setDocumentsError(e instanceof Error ? e.message : "Не удалось загрузить журнал");
    } finally {
      setDocumentsLoading(false);
    }
  }

  async function loadAll() {
    await Promise.allSettled([loadStores(), loadCounterparties(), loadDocuments()]);
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  useEffect(() => {
    const documentId = searchParams.get("document");
    const document = documentId ? documents.find((row) => row.id === documentId) : null;
    if (document) {
      setOpenId(documentId);
      if (searchParams.get("open") === "edit" && autoOpenedDocumentRef.current !== documentId) {
        autoOpenedDocumentRef.current = documentId;
        fillFormFromDocument(document, document.applicable ? "view" : "edit");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, searchParams]);

  useEffect(() => {
    const query = productSearch.trim();
    if (query.length < 2) {
      setProducts([]);
      setProductsSearching(false);
      setProductsError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setProductsSearching(true);
      setProductsError(null);
      try {
        const params = new URLSearchParams({ search: query, limit: "30" });
        const res = await fetch(`/api/local-inventory/products?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readJson<{ products?: ProductOption[]; error?: string }>(res);
        if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить товары");
        setProducts((Array.isArray(data?.products) ? data.products : []).filter((p) => p.entityType !== "service"));
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setProducts([]);
          setProductsError(e instanceof Error ? e.message : "Не удалось загрузить товары");
        }
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
    if (query.length < 2 || selectedCounterparty?.name === query) {
      setCounterpartiesSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCounterpartiesSearching(true);
      setCounterpartiesError(null);
      try {
        const params = new URLSearchParams({ search: query, limit: "20" });
        const res = await fetch(`/api/local-inventory/counterparties?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readJson<{ counterparties?: CounterpartyOption[]; error?: string }>(res);
        if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить поставщиков");
        setCounterparties(Array.isArray(data?.counterparties) ? data.counterparties : []);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setCounterparties([]);
          setCounterpartiesError(e instanceof Error ? e.message : "Не удалось загрузить поставщиков");
        }
      } finally {
        if (!controller.signal.aborted) setCounterpartiesSearching(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [counterpartySearch, selectedCounterparty?.name]);

  function availableForStore(product: ProductOption) {
    if (!selectedStoreId) return product.totalAvailable;
    return product.stock.find((row) => row.storeId === selectedStoreId)?.available ?? 0;
  }

  function slotForStore(product: ProductOption) {
    if (!selectedStoreId) return "";
    return product.stock.find((row) => row.storeId === selectedStoreId)?.slotName ?? "";
  }

  function addProduct(product: ProductOption) {
    if (readOnly) return;
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
          code: product.code,
          brand: product.brand || product.supplierName || "",
          quantity: 1,
          price: isReceipt ? product.buyPrice ?? 0 : product.buyPrice ?? product.salePrice ?? 0,
          slotName: slotForStore(product),
          available: availableForStore(product),
        },
      ];
    });
    setProductSearch("");
    setProducts([]);
    setNewProductOpen(false);
  }

  function updatePosition(localId: string, patch: Partial<Position>) {
    if (readOnly) return;
    setPositions((prev) =>
      prev.map((position) => (position.localId === localId ? { ...position, ...patch } : position))
    );
  }

  async function createNewSupplier() {
    const name = newSupplier.name.trim();
    if (!name) {
      setFormError("Укажите название поставщика");
      return;
    }
    setNewSupplierSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/local-inventory/counterparties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          legalTitle: name,
          phone: newSupplier.phone.trim() || undefined,
          inn: newSupplier.inn.trim() || undefined,
          comment: newSupplier.comment.trim() || undefined,
          companyType: "legal",
          counterpartyTypeName: "Поставщик",
        }),
      });
      const data = await readJson<(CounterpartyOption & { error?: string })>(res);
      if (!res.ok || !data?.id) throw new Error(data?.error ?? "Не удалось создать поставщика");
      const created = { id: data.id, name: data.name, phone: data.phone, legalTitle: data.legalTitle, inn: data.inn };
      setCounterparties((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setSelectedCounterparty(created);
      setCounterpartySearch(created.name);
      setNewSupplierOpen(false);
      setNewSupplier(emptySupplierDraft);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Не удалось создать поставщика");
    } finally {
      setNewSupplierSaving(false);
    }
  }

  async function createNewProduct() {
    const name = newProduct.name.trim();
    if (!name) {
      setFormError("Укажите название товара");
      return;
    }
    setNewProductSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/local-inventory/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          article: newProduct.article.trim() || undefined,
          code: newProduct.code.trim() || undefined,
          brand: newProduct.brand.trim() || undefined,
          supplierName: selectedCounterparty?.name || undefined,
          buyPrice: newProduct.buyPrice,
          salePrice: newProduct.salePrice,
          entityType: "product",
        }),
      });
      const data = await readJson<(ProductOption & { error?: string })>(res);
      if (!res.ok || !data?.id) throw new Error(data?.error ?? "Не удалось создать товар");
      addProduct(data);
      setNewProduct(emptyProductDraft);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Не удалось создать товар");
    } finally {
      setNewProductSaving(false);
    }
  }

  function buildCurrentDocument(data: { id?: string; name?: string; applicable?: boolean; invoice?: MovementRow["invoice"] | null }): MovementRow {
    return {
      id: data.id || editingDocument?.id || "",
      type,
      name: data.name || editingDocument?.name || "",
      moment: editingDocument?.moment || new Date().toISOString(),
      documentDate,
      applicable: Boolean(data.applicable),
      sum: total,
      description,
      storeId: selectedStoreId,
      storeName: selectedStoreName,
      counterpartyId: selectedCounterparty?.id || "",
      counterpartyName: selectedCounterparty?.name || counterpartySearch,
      positionsCount: positions.length,
      totalQuantity: totalQty,
      invoice: data.invoice ?? null,
      positions: positions.map((position) => ({
        id: position.localId,
        productId: position.productId,
        name: position.name,
        article: position.article,
        code: position.code,
        brand: position.brand,
        quantity: position.quantity,
        price: position.price,
        slotName: position.slotName,
      })),
    };
  }

  async function submit(nextApplicable: boolean) {
    if (readOnly) return;
    if (positions.length === 0) {
      setFormError("Добавьте хотя бы одну позицию");
      return;
    }
    if (hasInvalidQty) {
      setFormError("Количество по каждой позиции должно быть больше нуля");
      return;
    }
    if (nextApplicable && !selectedStoreId) {
      setFormError("Выберите склад перед проведением приёмки");
      return;
    }
    if (nextApplicable && hasInvalidReceiptPrice) {
      setFormError("Укажите корректную закупочную цену перед проведением");
      return;
    }
    if (isReceipt && createInvoice && !selectedCounterparty) {
      setFormError("Выберите поставщика из списка или создайте нового поставщика для счёта");
      return;
    }

    const action: SaveAction = nextApplicable ? "conduct" : "draft";
    setSavingAction(action);
    setFormError(null);
    setInfo(null);
    try {
      const isUpdate = Boolean(editingDocument?.id && !editingDocument.applicable);
      const res = await fetch(
        isUpdate ? `/api/local-inventory/movements/${editingDocument!.id}` : "/api/local-inventory/movements",
        {
          method: isUpdate ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            storeId: selectedStoreId || undefined,
            counterpartyId: selectedCounterparty?.id ?? null,
            documentDate,
            description: description.trim() || undefined,
            applicable: nextApplicable,
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
        }
      );
      const data = await readJson<{
        id?: string;
        name?: string;
        applicable?: boolean;
        invoice?: MovementRow["invoice"] | null;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось сохранить документ");
      const nextDocument = buildCurrentDocument({
        id: data?.id,
        name: data?.name,
        applicable: nextApplicable,
        invoice: data?.invoice ?? null,
      });
      setEditingDocument(nextDocument);
      setFormMode(nextApplicable ? "view" : "edit");
      setInfo(
        nextApplicable
          ? `${title} ${nextDocument.name} проведена. Остатки обновлены.`
          : `${title} ${nextDocument.name} сохранена как черновик.`
      );
      await loadDocuments();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingAction(null);
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
    setFormError(null);
    setInfo(null);
  }

  async function createInvoiceForExistingReceipt(document: MovementRow) {
    if (!invoiceDraft || invoiceDraft.documentId !== document.id) return;
    setInvoiceSaving(true);
    setFormError(null);
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
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setInvoiceSaving(false);
    }
  }

  const renderSkeletonKpis = () => (
    <div className="eco-receipt-kpis" aria-label="Загружаем приёмки…">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="eco-receipt-kpi is-skeleton">
          <span />
          <strong />
          <em />
        </div>
      ))}
    </div>
  );

  return (
    <div className="eco-stock-doc-page eco-receipt-page">
      {formOpen && (
        <div className="eco-receipt-drawer-backdrop">
          <aside role="dialog" aria-modal="true" className="eco-receipt-drawer">
            <header className="eco-receipt-drawer-head">
              <div>
                <div className="eco-title-row">
                  <h2>{editingDocument?.name ? `${title} ${editingDocument.name}` : `Новая ${title.toLowerCase()}`}</h2>
                  <EcoBadge tone={readOnly ? "success" : "warning"} dot>
                    {readOnly ? "Проведена" : "Черновик"}
                  </EcoBadge>
                </div>
                <p>{isReceipt ? "Оприходование товаров на локальный склад" : "Корректировка остатков локального склада"}</p>
              </div>
              <button type="button" className="eco-icon-btn eco-receipt-close" onClick={closeDocumentForm} aria-label="Закрыть">
                <X size={18} />
              </button>
            </header>

            <div className="eco-receipt-drawer-body">
              <main className="eco-receipt-form-main">
                {(formError || info) && (
                  <div className={formError ? "eco-receipt-inline-state is-error" : "eco-receipt-inline-state is-success"}>
                    {formError ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                    <span>{formError || info}</span>
                  </div>
                )}

                <section className="eco-receipt-form-section">
                  <div className="eco-receipt-section-head">
                    <div>
                      <span>Параметры документа</span>
                      <h3>Склад, поставщик и основание</h3>
                    </div>
                  </div>
                  <div className="eco-receipt-param-grid">
                    <label className="eco-receipt-field">
                      <span>Склад *</span>
                      {storesLoading ? (
                        <div className="eco-receipt-field-state is-loading">
                          <Loader2 size={15} />
                          Загружаем склады…
                        </div>
                      ) : storesError ? (
                        <div className="eco-receipt-field-state is-error">
                          <strong>Склад не выбран</strong>
                          <small>{storesError}</small>
                          <button type="button" onClick={() => void loadStores()}>Повторить загрузку складов</button>
                        </div>
                      ) : (
                        <EcoSelect
                          value={selectedStoreId}
                          onChange={(event) => setSelectedStoreId(event.target.value)}
                          disabled={readOnly}
                        >
                          <option value="">Не выбран</option>
                          {stores.map((store) => (
                            <option key={store.id} value={store.id}>{store.name}</option>
                          ))}
                        </EcoSelect>
                      )}
                    </label>

                    <label className="eco-receipt-field">
                      <span>{isReceipt ? "Поставщик" : "Контрагент / основание"}</span>
                      <div className="eco-receipt-search-field">
                        <Search size={16} />
                        <EcoInput
                          value={selectedCounterparty?.name ?? counterpartySearch}
                          onChange={(event) => {
                            setSelectedCounterparty(null);
                            setCounterpartySearch(event.target.value);
                          }}
                          placeholder={isReceipt ? "Найдите поставщика по названию или телефону" : "Найдите контрагента или основание"}
                          disabled={readOnly}
                        />
                      </div>
                    </label>

                    <label className="eco-receipt-field">
                      <span>Дата</span>
                      <EcoInput
                        type="date"
                        value={documentDate}
                        onChange={(event) => {
                          setDocumentDate(event.target.value);
                          if (!createInvoice) setInvoiceDate(event.target.value);
                        }}
                        disabled={readOnly}
                      />
                    </label>

                    <label className="eco-receipt-field">
                      <span>Номер счёта / накладной</span>
                      <EcoInput
                        value={invoiceNumber}
                        onChange={(event) => setInvoiceNumber(event.target.value)}
                        placeholder="авто или номер поставщика"
                        disabled={readOnly}
                      />
                    </label>
                  </div>

                  {!selectedCounterparty && counterpartySearch.trim().length >= 2 && !readOnly && (
                    <div className="eco-receipt-result-panel">
                      {counterpartiesSearching && (
                        <div className="eco-receipt-result-hint">
                          <Loader2 size={15} /> Ищем поставщиков…
                        </div>
                      )}
                      {counterpartiesError && (
                        <div className="eco-receipt-result-hint is-error">{counterpartiesError}</div>
                      )}
                      {!counterpartiesSearching && counterparties.length === 0 && (
                        <div className="eco-receipt-empty-result">
                          <strong>Поставщик не найден</strong>
                          <button type="button" onClick={() => setNewSupplierOpen(true)}>
                            <Plus size={14} /> Новый поставщик
                          </button>
                        </div>
                      )}
                      {counterparties.slice(0, 6).map((counterparty) => (
                        <button
                          key={counterparty.id}
                          type="button"
                          className="eco-receipt-counterparty-row"
                          onClick={() => {
                            setSelectedCounterparty(counterparty);
                            setCounterpartySearch(counterparty.name);
                          }}
                        >
                          <strong>{counterparty.name}</strong>
                          <span>{[counterparty.legalTitle, counterparty.inn, counterparty.phone].filter(Boolean).join(" · ") || "без реквизитов"}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {isReceipt && !readOnly && (
                    <div className="eco-receipt-supplier-actions">
                      <label>
                        <input
                          type="checkbox"
                          checked={createInvoice}
                          onChange={(event) => {
                            setCreateInvoice(event.target.checked);
                            if (event.target.checked && !invoiceDate) setInvoiceDate(documentDate);
                          }}
                        />
                        <span>Создать счёт поставщика</span>
                      </label>
                      <button type="button" onClick={() => setNewSupplierOpen((value) => !value)}>
                        <Plus size={14} /> Новый поставщик
                      </button>
                    </div>
                  )}

                  {isReceipt && createInvoice && (
                    <div className="eco-receipt-invoice-grid">
                      <label className="eco-receipt-field">
                        <span>Дата счёта</span>
                        <EcoInput type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} disabled={readOnly} />
                      </label>
                      <label className="eco-receipt-field">
                        <span>Оплатить до</span>
                        <EcoInput type="date" value={invoiceDueDate} onChange={(event) => setInvoiceDueDate(event.target.value)} disabled={readOnly} />
                      </label>
                      <label className="eco-receipt-field">
                        <span>Статус счёта</span>
                        <EcoSelect value={invoiceStatus} onChange={(event) => setInvoiceStatus(event.target.value)} disabled={readOnly}>
                          <option value="unpaid">Не оплачен</option>
                          <option value="partial">Частично</option>
                          <option value="paid">Оплачен</option>
                        </EcoSelect>
                      </label>
                    </div>
                  )}

                  {newSupplierOpen && !readOnly && (
                    <div className="eco-receipt-mini-form">
                      <label className="eco-receipt-field">
                        <span>Название</span>
                        <EcoInput value={newSupplier.name} onChange={(event) => setNewSupplier({ ...newSupplier, name: event.target.value })} />
                      </label>
                      <label className="eco-receipt-field">
                        <span>Телефон</span>
                        <EcoInput value={newSupplier.phone} onChange={(event) => setNewSupplier({ ...newSupplier, phone: event.target.value })} />
                      </label>
                      <label className="eco-receipt-field">
                        <span>ИНН</span>
                        <EcoInput value={newSupplier.inn} onChange={(event) => setNewSupplier({ ...newSupplier, inn: event.target.value })} />
                      </label>
                      <label className="eco-receipt-field is-wide">
                        <span>Комментарий</span>
                        <textarea className="eco-input" rows={2} value={newSupplier.comment} onChange={(event) => setNewSupplier({ ...newSupplier, comment: event.target.value })} />
                      </label>
                      <div className="eco-receipt-mini-actions">
                        <EcoButton type="button" variant="primary" onClick={() => void createNewSupplier()} disabled={newSupplierSaving}>
                          {newSupplierSaving ? <Loader2 size={14} /> : <Plus size={14} />}
                          Создать поставщика
                        </EcoButton>
                        <EcoButton type="button" onClick={() => setNewSupplierOpen(false)}>Отмена</EcoButton>
                      </div>
                    </div>
                  )}
                </section>

                <section className="eco-receipt-form-section">
                  <div className="eco-receipt-section-head">
                    <div>
                      <span>Добавить товар</span>
                      <h3>Поиск по каталогу и штрихкоду</h3>
                    </div>
                  </div>
                  <div className="eco-receipt-product-search">
                    <Search size={18} />
                    <input
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && products[0]) {
                          event.preventDefault();
                          addProduct(products[0]);
                        }
                      }}
                      placeholder="Поиск по названию, артикулу, коду, OEM или штрихкоду…"
                      disabled={readOnly}
                    />
                  </div>

                  {(productSearch.trim().length >= 2 || products.length > 0 || productsSearching || productsError) && !readOnly && (
                    <div className="eco-receipt-product-results">
                      {productsSearching && products.length === 0 && (
                        <>
                          <div className="eco-receipt-result-hint"><Loader2 size={15} /> Ищем товары…</div>
                          {Array.from({ length: 3 }).map((_, index) => <div key={index} className="eco-receipt-product-skeleton" />)}
                        </>
                      )}
                      {productsError && <div className="eco-receipt-result-hint is-error">{productsError}</div>}
                      {products.map((product) => (
                        <div key={product.id} className="eco-receipt-product-row">
                          <div>
                            <strong>{product.name}</strong>
                            <span>{[product.article || product.code, product.brand, product.supplierName].filter(Boolean).join(" · ") || "без артикула"}</span>
                          </div>
                          <dl>
                            <div><dt>Остаток</dt><dd>{formatQty(availableForStore(product))}</dd></div>
                            <div><dt>Закупка</dt><dd>{formatMoney(product.buyPrice)} ₽</dd></div>
                            <div><dt>Продажа</dt><dd>{formatMoney(product.salePrice)} ₽</dd></div>
                          </dl>
                          <button type="button" onClick={() => addProduct(product)}>Добавить</button>
                        </div>
                      ))}
                      {!productsSearching && products.length === 0 && productSearch.trim().length >= 2 && (
                        <div className="eco-receipt-empty-result">
                          <strong>Товар не найден</strong>
                          <button type="button" onClick={() => {
                            setNewProductOpen(true);
                            setNewProduct((prev) => ({ ...prev, name: productSearch }));
                          }}>
                            <Plus size={14} /> Создать новый товар
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {newProductOpen && !readOnly && (
                    <div className="eco-receipt-mini-form">
                      <label className="eco-receipt-field is-wide">
                        <span>Название товара</span>
                        <EcoInput value={newProduct.name} onChange={(event) => setNewProduct({ ...newProduct, name: event.target.value })} />
                      </label>
                      <label className="eco-receipt-field">
                        <span>Артикул</span>
                        <EcoInput value={newProduct.article} onChange={(event) => setNewProduct({ ...newProduct, article: event.target.value })} />
                      </label>
                      <label className="eco-receipt-field">
                        <span>Код</span>
                        <EcoInput value={newProduct.code} onChange={(event) => setNewProduct({ ...newProduct, code: event.target.value })} />
                      </label>
                      <label className="eco-receipt-field">
                        <span>Бренд</span>
                        <EcoInput value={newProduct.brand} onChange={(event) => setNewProduct({ ...newProduct, brand: event.target.value })} />
                      </label>
                      <label className="eco-receipt-field">
                        <span>Закупочная цена</span>
                        <MoneyInput value={newProduct.buyPrice} onValueChange={(buyPrice) => setNewProduct({ ...newProduct, buyPrice })} className="eco-input l-money" />
                      </label>
                      <label className="eco-receipt-field">
                        <span>Продажная цена</span>
                        <MoneyInput value={newProduct.salePrice} onValueChange={(salePrice) => setNewProduct({ ...newProduct, salePrice })} className="eco-input l-money" />
                      </label>
                      <div className="eco-receipt-mini-actions">
                        <EcoButton type="button" variant="primary" onClick={() => void createNewProduct()} disabled={newProductSaving}>
                          {newProductSaving ? <Loader2 size={14} /> : <Plus size={14} />}
                          Создать товар
                        </EcoButton>
                        <EcoButton type="button" onClick={() => setNewProductOpen(false)}>Отмена</EcoButton>
                      </div>
                    </div>
                  )}
                </section>

                <section className="eco-receipt-form-section">
                  <div className="eco-receipt-section-head">
                    <div>
                      <span>Позиции приёмки</span>
                      <h3>{positions.length ? `${positions.length} строк` : "Позиции ещё не добавлены"}</h3>
                    </div>
                  </div>

                  <div className="eco-receipt-position-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Товар</th>
                          <th>Артикул / код</th>
                          <th>Текущий остаток</th>
                          <th>Кол-во</th>
                          <th>{productPriceLabel}</th>
                          <th>Сумма</th>
                          <th>Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((position) => (
                          <tr key={position.localId}>
                            <td>
                              <strong>{position.name}</strong>
                              <span>{[position.brand, position.article, position.code].filter(Boolean).join(" · ") || "без дополнительных данных"}</span>
                            </td>
                            <td className="l-mono">{position.article || position.code || "—"}</td>
                            <td className="l-number">{formatQty(position.available)}</td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                step={0.001}
                                value={position.quantity}
                                onChange={(event) => updatePosition(position.localId, { quantity: Number(event.target.value) || 0 })}
                                disabled={readOnly}
                              />
                            </td>
                            <td>
                              <MoneyInput
                                value={position.price}
                                onValueChange={(price) => updatePosition(position.localId, { price })}
                                className="eco-input l-money"
                                disabled={readOnly}
                              />
                            </td>
                            <td className="l-number l-sum">{formatMoney(position.quantity * position.price)} ₽</td>
                            <td>
                              {!readOnly && (
                                <button
                                  type="button"
                                  className="eco-icon-btn"
                                  title="Удалить позицию"
                                  aria-label="Удалить позицию"
                                  onClick={() => setPositions((prev) => prev.filter((item) => item.localId !== position.localId))}
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {positions.length === 0 && (
                      <div className="eco-receipt-empty-positions">
                        <PackagePlus size={24} />
                        <strong>Добавьте товары в приёмку</strong>
                        <span>После выбора товара здесь появятся количество, закупочная цена и сумма строки.</span>
                      </div>
                    )}
                  </div>

                  <div className="eco-receipt-position-cards">
                    {positions.map((position) => (
                      <div key={position.localId} className="eco-receipt-position-card">
                        <div>
                          <strong>{position.name}</strong>
                          <span>{[position.brand, position.article || position.code].filter(Boolean).join(" · ") || "без артикула"}</span>
                        </div>
                        <label>
                          Кол-во
                          <input type="number" min={0} step={0.001} value={position.quantity} disabled={readOnly} onChange={(event) => updatePosition(position.localId, { quantity: Number(event.target.value) || 0 })} />
                        </label>
                        <label>
                          {productPriceLabel}
                          <MoneyInput value={position.price} onValueChange={(price) => updatePosition(position.localId, { price })} className="eco-input l-money" disabled={readOnly} />
                        </label>
                        <div className="eco-receipt-position-card-total">
                          <span>Сумма</span>
                          <strong>{formatMoney(position.quantity * position.price)} ₽</strong>
                        </div>
                        {!readOnly && (
                          <button type="button" onClick={() => setPositions((prev) => prev.filter((item) => item.localId !== position.localId))}>
                            <Trash2 size={16} /> Удалить
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <label className="eco-receipt-field is-wide">
                    <span>Комментарий</span>
                    <textarea className="eco-input" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} disabled={readOnly} />
                  </label>
                </section>
              </main>

              <aside className="eco-receipt-summary">
                <span>Итого</span>
                <dl>
                  <div><dt>Позиций</dt><dd>{positions.length}</dd></div>
                  <div><dt>Кол-во</dt><dd>{formatQty(totalQty)}</dd></div>
                  <div><dt>Сумма</dt><dd>{formatMoney(total)} ₽</dd></div>
                  <div><dt>Склад</dt><dd>{selectedStoreName || "не выбран"}</dd></div>
                  <div><dt>Поставщик</dt><dd>{selectedCounterparty?.name || counterpartySearch || "не выбран"}</dd></div>
                  <div><dt>Статус</dt><dd>{readOnly ? "Проведена" : "Черновик"}</dd></div>
                </dl>
              </aside>
            </div>

            <footer className="eco-receipt-drawer-footer">
              <div>
                <strong>{positions.length} поз. · {formatQty(totalQty)} шт. · {formatMoney(total)} ₽</strong>
                <span>{footerHelper}</span>
              </div>
              <div className="eco-receipt-footer-actions">
                {readOnly ? (
                  <>
                    {editingDocument && (
                      <EcoButton type="button" onClick={() => copyFromDocument(editingDocument)}>
                        <Copy size={15} /> Создать на основе
                      </EcoButton>
                    )}
                    <EcoButton type="button" variant="primary" onClick={closeDocumentForm}>Закрыть</EcoButton>
                  </>
                ) : (
                  <>
                    <EcoButton type="button" onClick={closeDocumentForm}>Отмена</EcoButton>
                    <EcoButton type="button" variant="primary" onClick={() => void submit(false)} disabled={!canSaveDraft} title={!canSaveDraft ? footerHelper : undefined}>
                      {savingAction === "draft" ? <Loader2 size={15} /> : <Save size={15} />}
                      Сохранить черновик
                    </EcoButton>
                    <EcoButton type="button" className="eco-receipt-conduct-btn" onClick={() => void submit(true)} disabled={!canConduct} title={!canConduct ? footerHelper : undefined}>
                      {savingAction === "conduct" ? <Loader2 size={15} /> : <CheckCircle2 size={15} />}
                      Провести приёмку
                    </EcoButton>
                  </>
                )}
              </div>
            </footer>
          </aside>
        </div>
      )}

      <section className="eco-page-head eco-stock-doc-head eco-receipt-head">
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
              {isReceipt ? "Поступление" : "Корректировка"}
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
          <EcoButton type="button" onClick={() => void loadAll()} disabled={documentsLoading || storesLoading}>
            <RefreshCw size={15} />
            Обновить
          </EcoButton>
          <EcoButton type="button" variant="primary" onClick={openDocumentForm}>
            <FilePlus2 size={15} />
            {actionLabel}
          </EcoButton>
        </div>
      </section>

      {documentsLoading ? renderSkeletonKpis() : (
        <div className="eco-receipt-kpis">
          <div className="eco-receipt-kpi is-info">
            <span>Документы</span>
            <strong>{documentStats.count}</strong>
            <em>за последние 30 дней</em>
          </div>
          <div className="eco-receipt-kpi is-success">
            <span>Проведено</span>
            <strong>{documentStats.conducted}</strong>
            <em>{documentStats.drafts} черновика</em>
          </div>
          <div className="eco-receipt-kpi is-warning">
            <span>Черновики</span>
            <strong>{documentStats.drafts}</strong>
            <em>можно редактировать</em>
          </div>
          <div className="eco-receipt-kpi is-neutral">
            <span>Количество позиций</span>
            <strong>{formatQty(documentStats.quantity)}</strong>
            <em>{documentStats.positions} строк документов</em>
          </div>
          <div className="eco-receipt-kpi is-rust">
            <span>Счета / сумма</span>
            <strong>{formatMoney(documentStats.sum)} ₽</strong>
            <em>{isReceipt ? `${documentStats.invoices} счетов` : "учётная сумма"}</em>
          </div>
          <div className="eco-receipt-kpi is-neutral">
            <span>Последнее поступление</span>
            <strong>{lastDocument ? formatDate(lastDocument.documentDate) : "—"}</strong>
            <em>{lastDocument?.name || "документов пока нет"}</em>
          </div>
        </div>
      )}

      {storesError && (
        <section className="eco-receipt-state-card is-warning">
          <AlertTriangle size={20} />
          <div>
            <h2>Не удалось загрузить склады</h2>
            <p>Проверьте локальную базу или повторите загрузку. Без склада нельзя провести приёмку.</p>
          </div>
          <EcoButton type="button" onClick={() => void loadStores()} disabled={storesLoading}>
            <RefreshCw size={15} />
            Повторить
          </EcoButton>
        </section>
      )}

      {counterpartiesError && (
        <section className="eco-receipt-state-card is-warning">
          <AlertTriangle size={20} />
          <div>
            <h2>Не удалось загрузить поставщиков</h2>
            <p>Поиск поставщика временно недоступен. Черновик можно сохранить, но счёт поставщика потребует выбранного поставщика.</p>
          </div>
          <EcoButton type="button" onClick={() => void loadCounterparties()} disabled={counterpartiesLoading}>
            <RefreshCw size={15} />
            Повторить
          </EcoButton>
        </section>
      )}

      <section className="eco-card eco-stock-doc-journal eco-receipt-journal">
        <div className="eco-table-toolbar eco-receipt-journal-head">
          <div>
            <div className="eco-page-kicker">Журнал</div>
            <h2 className="eco-stock-doc-title">Последние документы</h2>
            <p className="eco-stock-doc-subtitle">
              Последние локальные приёмки и документы поступления.
            </p>
          </div>
          <div className="grow" />
          <span className="l-meta">{documents.length} строк · {formatMoney(documentStats.sum)} ₽</span>
          <div className="eco-row-actions is-visible">
            <EcoButton type="button" onClick={openDocumentForm} size="sm" variant="primary">
              <PackagePlus size={14} />
              {actionLabel}
            </EcoButton>
            <EcoButton type="button" onClick={() => void loadDocuments()} size="sm" disabled={documentsLoading}>
              <RefreshCw size={14} />
              Обновить
            </EcoButton>
          </div>
        </div>

        {info && !formOpen && (
          <div className="eco-receipt-inline-state is-success eco-receipt-page-message">
            <CheckCircle2 size={18} />
            <span>{info}</span>
          </div>
        )}
        {(documentsError || formError) && !formOpen && (
          <div className="eco-receipt-inline-state is-error eco-receipt-page-message">
            <AlertTriangle size={18} />
            <span>{documentsError || formError}</span>
          </div>
        )}

        {documentsLoading && (
          <div className="eco-receipt-table-skeleton">
            <p>Загружаем приёмки…</p>
            {Array.from({ length: 5 }).map((_, index) => <span key={index} />)}
          </div>
        )}

        {!documentsLoading && documentsError && (
          <div className="eco-receipt-empty-state is-error">
            <AlertTriangle size={30} />
            <h2>Не удалось загрузить приёмки</h2>
            <p>Проверьте локальную базу или повторите загрузку журнала поступлений.</p>
            <EcoButton type="button" onClick={() => void loadDocuments()}>
              <RefreshCw size={15} />
              Повторить
            </EcoButton>
          </div>
        )}

        {!documentsLoading && !documentsError && documents.length === 0 && (
          <div className="eco-receipt-empty-state">
            <PackagePlus size={30} />
            <h2>Приёмок пока нет</h2>
            <p>Создайте первую приёмку, чтобы оприходовать товары на локальный склад.</p>
            <EcoButton type="button" variant="primary" onClick={openDocumentForm}>
              <FilePlus2 size={15} />
              Создать приёмку
            </EcoButton>
          </div>
        )}

        {!documentsLoading && documents.length > 0 && (
          <div className="eco-receipt-doc-table-wrap">
            <table className="eco-receipt-doc-table">
              <thead>
                <tr>
                  <th>№ / дата</th>
                  <th>Поставщик</th>
                  <th>Склад</th>
                  <th>Позиций</th>
                  <th>Счёт / основание</th>
                  <th>Статус</th>
                  <th>Сумма</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => {
                  const open = openId === document.id;
                  const status = statusMeta(document);
                  return (
                    <Fragment key={document.id}>
                      <tr key={document.id}>
                        <td className="l-mono">
                          <button type="button" onClick={() => setOpenId(open ? null : document.id)}>
                            <strong>{document.name}</strong>
                            <span>{formatMoment(document.moment)}</span>
                          </button>
                        </td>
                        <td>
                          <strong>{document.counterpartyName || "без поставщика"}</strong>
                          <span>{document.description || "поступление локального склада"}</span>
                        </td>
                        <td>{document.storeName || "склад не указан"}</td>
                        <td className="l-number">{document.positionsCount} · {formatQty(document.totalQuantity)} шт.</td>
                        <td>
                          {document.invoice ? (
                            <Link href={`/finance/invoices?invoice=${document.invoice.id}`}>
                              счёт {document.invoice.number || "без номера"}
                            </Link>
                          ) : (
                            <span className="l-muted">нет счёта</span>
                          )}
                        </td>
                        <td><EcoBadge tone={status.tone}>{status.label}</EcoBadge></td>
                        <td className="l-number l-sum">{formatMoney(document.sum)} ₽</td>
                        <td>
                          <div className="eco-receipt-table-actions">
                            <button type="button" title={document.applicable ? "Открыть" : "Редактировать"} aria-label={document.applicable ? "Открыть" : "Редактировать"} onClick={() => openExistingDocument(document)}>
                              {document.applicable ? <Eye size={16} /> : <Pencil size={16} />}
                            </button>
                            <button type="button" title="Создать на основе" aria-label="Создать на основе" onClick={() => copyFromDocument(document)}>
                              <Copy size={16} />
                            </button>
                            {isReceipt && !document.invoice && (
                              <button type="button" title="Создать счёт" aria-label="Создать счёт" onClick={() => startInvoiceForDocument(document)}>
                                <FilePlus2 size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="eco-receipt-details-row">
                          <td colSpan={8}>
                            <div className="eco-receipt-details">
                              <div>
                                <h3>Позиции</h3>
                                {document.positions.map((position) => (
                                  <div key={position.id} className="eco-receipt-details-position">
                                    <span>{position.name}</span>
                                    <strong>{formatQty(position.quantity)} × {formatMoney(position.price)} ₽</strong>
                                  </div>
                                ))}
                              </div>
                              {isReceipt && (
                                <div className="eco-receipt-details-side">
                                  <h3>Связанные документы</h3>
                                  {document.invoice ? (
                                    <Link href={`/finance/invoices?invoice=${document.invoice.id}`}>
                                      Счёт {document.invoice.number || "без номера"} · {formatMoney(document.invoice.sum)} ₽ · {invoiceStatusLabel(document.invoice.status)}
                                    </Link>
                                  ) : (
                                    <p>Связанных счетов пока нет.</p>
                                  )}
                                  {invoiceDraft?.documentId === document.id && (
                                    <div className="eco-receipt-invoice-draft">
                                      <EcoInput value={invoiceDraft.number} onChange={(event) => setInvoiceDraft({ ...invoiceDraft, number: event.target.value })} placeholder="Номер счёта" />
                                      <EcoInput type="date" value={invoiceDraft.invoiceDate} onChange={(event) => setInvoiceDraft({ ...invoiceDraft, invoiceDate: event.target.value })} />
                                      <EcoInput type="date" value={invoiceDraft.dueDate} onChange={(event) => setInvoiceDraft({ ...invoiceDraft, dueDate: event.target.value })} />
                                      <EcoSelect value={invoiceDraft.status} onChange={(event) => setInvoiceDraft({ ...invoiceDraft, status: event.target.value })}>
                                        <option value="unpaid">Не оплачен</option>
                                        <option value="partial">Частично</option>
                                        <option value="paid">Оплачен</option>
                                      </EcoSelect>
                                      <EcoButton type="button" variant="primary" onClick={() => void createInvoiceForExistingReceipt(document)} disabled={invoiceSaving}>
                                        {invoiceSaving ? <Loader2 size={14} /> : <Save size={14} />}
                                        Сохранить счёт
                                      </EcoButton>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
