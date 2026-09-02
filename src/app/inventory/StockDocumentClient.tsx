"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eraser,
  Eye,
  ExternalLink,
  FilePlus2,
  History,
  Loader2,
  MapPin,
  Minus,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Square,
  Trash2,
  Truck,
  Warehouse,
  X,
} from "lucide-react";
import MoneyInput from "@/components/MoneyInput";
import { ContactActionButton } from "@/components/messenger/ContactActionButton";
import { EcoBadge, EcoButton, EcoInput, EcoSelect } from "@/components/platform/EcoUI";
import { formatServiceDate, formatServiceDateTime, toServiceDateInput, toServiceMomentString } from "@/lib/date-time";
import PriceLabelPrintDialog from "@/components/receipts/PriceLabelPrintDialog";
import RosskoReceiptWorkspace from "@/components/receipts/RosskoReceiptWorkspace";

type StockDocumentType = "receipt" | "writeoff";
type StockDocumentStatus = "draft" | "posted" | "cancelled" | "needs_review" | "blocked";
type AdjustmentType = "technical" | "expense";
type FormMode = "new" | "edit" | "view";
type SaveAction = "draft" | "conduct";
type ReceiptAction = "open" | "edit" | "post" | "delete" | "duplicate" | "unpost" | "cancel" | "correction" | "history" | "print-labels";
type DocumentListMeta = { total: number; limit: number; offset: number; mode?: "branch" | "all" };

const DOCUMENT_PAGE_SIZE = 30;

type StoreOption = { id: string; name: string; isMain?: boolean };
type CounterpartyOption = { id: string; name: string; phone?: string; legalTitle?: string; inn?: string };
type ProductOption = {
  id: string;
  name: string;
  article: string;
  code: string;
  cell?: string;
  brand?: string;
  sae?: string;
  packageVolume?: string;
  supplierName?: string;
  groupPath?: string;
  entityType: string;
  salePrice: number;
  buyPrice: number | null;
  totalAvailable: number;
  stock: { storeId: string; storeName: string; available: number; averageCost: number | null; slotName: string }[];
};

type KnownCell = { storeId: string; storeName: string; slotName: string; available: number };

type Position = {
  localId: string;
  documentPositionId?: string;
  productId: string;
  entityType: string;
  name: string;
  article: string;
  code: string;
  brand: string;
  quantity: number;
  price: number;
  salePrice: number;
  slotName: string;
  slotStoreId: string;
  defaultCell: string;
  makeDefaultCell: boolean;
  knownCells: KnownCell[];
  available: number;
  availableKnown: boolean;
};

type MovementRow = {
  id: string;
  branchId: string;
  branchName?: string;
  type: string;
  name: string;
  moment: string;
  documentDate: string;
  status?: StockDocumentStatus;
  applicable: boolean;
  sum: number;
  description: string;
  adjustmentType: AdjustmentType | null;
  adjustmentMethod: string | null;
  adjustmentReason: string;
  affectsManagementProfit: boolean;
  correctionOfId?: string | null;
  isDeleted?: boolean;
  cancelledAt?: string | null;
  deletedAt?: string | null;
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
    entityType: string;
    quantity: number;
    price: number;
    salePrice: number;
    slotName: string;
    defaultCell?: string;
    slotStoreId?: string;
    knownCells?: KnownCell[];
    makeDefaultCell?: boolean;
  }[];
};

type ReceiptActionProblem = {
  productId?: string | null;
  productName?: string;
  message: string;
  currentQuantity?: number;
  currentAvailable?: number;
  rollbackQuantity?: number;
  projectedQuantity?: number;
  projectedAvailable?: number;
};

type ReceiptActionWarning = {
  message: string;
};

type ReceiptActionCheck = {
  canProceed: boolean;
  problems: ReceiptActionProblem[];
  warnings: ReceiptActionWarning[];
};

type ReceiptAuditRow = {
  id: string;
  action: string;
  statusBefore: string | null;
  statusAfter: string | null;
  message: string;
  createdByName: string;
  createdById: string;
  createdAt: string;
};

type ReceiptDialogState =
  | { type: "edit-posted"; document: MovementRow }
  | { type: "delete-draft"; document: MovementRow; invoiceAction: "keep" | "delete" }
  | { type: "posted-delete"; document: MovementRow }
  | { type: "unpost" | "cancel"; document: MovementRow; check: ReceiptActionCheck }
  | { type: "correction"; document: MovementRow; reason: string }
  | { type: "history"; document: MovementRow; audit: ReceiptAuditRow[]; error?: string };

type CellEditorState = {
  mode: "single" | "bulk";
  localId?: string;
  selectedCell: string;
  search: string;
  createName: string;
  makeDefaultCell: boolean;
};

const technicalAdjustmentReasons = [
  "Ошибка начальных остатков",
  "Ошибка импорта",
  "Ошибка миграции",
  "Дублирующий складской документ",
  "Некорректное ручное проведение",
  "Расхождение после инвентаризации",
  "Ошибка единицы измерения",
  "Ошибка старой базы",
  "Другое техническое исправление",
];

const expenseWriteoffReasons = [
  "Порча",
  "Истёк срок хранения",
  "Утрата",
  "Кража",
  "Использовано для внутренних нужд",
  "Передано бесплатно",
  "Гарантийная замена",
  "Повреждено при работе",
  "Другое фактическое списание",
];

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
  return toServiceDateInput(new Date());
}

function formatMoney(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
}

function formatQty(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function formatPercent(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function formatProfitMoney(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function receiptProfit(position: Pick<Position, "price" | "salePrice">) {
  const amount = Number(position.salePrice) - Number(position.price);
  const margin = Number(position.salePrice) > 0 ? (amount / Number(position.salePrice)) * 100 : null;
  return { amount, margin };
}

function formatMoment(value: string) {
  const formatted = formatServiceDateTime(value);
  return formatted === "—" ? value : formatted;
}

function formatDate(value: string) {
  if (!value) return "—";
  const formatted = formatServiceDate(value);
  return formatted === "—" ? value : formatted;
}

function invoiceStatusLabel(value: string) {
  if (value === "paid") return "оплачен";
  if (value === "partial") return "частично";
  return "не оплачен";
}

function documentStatus(document: Pick<MovementRow, "status" | "applicable">): StockDocumentStatus {
  return document.status ?? (document.applicable ? "posted" : "draft");
}

function statusMeta(document: Pick<MovementRow, "status" | "applicable">) {
  const status = documentStatus(document);
  if (status === "posted") return { label: "Проведена", tone: "success" as const };
  if (status === "cancelled") return { label: "Отменена", tone: "danger" as const };
  if (status === "needs_review") return { label: "Требует проверки", tone: "warning" as const };
  if (status === "blocked") return { label: "Заблокирована", tone: "danger" as const };
  return { label: "Черновик", tone: "warning" as const };
}

function isDraftDocument(document: Pick<MovementRow, "status" | "applicable">) {
  return documentStatus(document) === "draft" && !document.applicable;
}

function isPostedDocument(document: Pick<MovementRow, "status" | "applicable">) {
  return documentStatus(document) === "posted" && document.applicable;
}

function isCancelledDocument(document: Pick<MovementRow, "status" | "applicable">) {
  return documentStatus(document) === "cancelled";
}

function adjustmentMeta(document: Pick<MovementRow, "adjustmentType" | "affectsManagementProfit">) {
  return document.adjustmentType === "technical" || document.affectsManagementProfit === false
    ? { label: "Техническая · без влияния", tone: "info" as const }
    : { label: "Списание · расход", tone: "warning" as const };
}

function cleanCell(value: string | null | undefined) {
  return (value ?? "").trim();
}

function productHref(productId: string) {
  return `/inventory/products?product=${encodeURIComponent(productId)}`;
}

function knownCellsFromProduct(product: Pick<ProductOption, "stock" | "cell">) {
  const rows = product.stock
    .map((row) => ({
      storeId: row.storeId,
      storeName: row.storeName,
      slotName: cleanCell(row.slotName),
      available: Number(row.available) || 0,
    }))
    .filter((row) => row.slotName);
  const defaultCell = cleanCell(product.cell);
  if (!defaultCell) return rows;
  if (rows.some((row) => row.slotName.toLowerCase() === defaultCell.toLowerCase())) return rows;
  return [
    ...rows,
    { storeId: "", storeName: "Основная ячейка товара", slotName: defaultCell, available: 0 },
  ];
}

function displayCells(cells: KnownCell[]) {
  const unique = [...new Map(cells.map((cell) => [cell.slotName.toLowerCase(), cell])).values()];
  if (unique.length === 0) return { label: "Не указана", extra: 0 };
  return { label: unique[0].slotName, extra: Math.max(0, unique.length - 1) };
}

export default function StockDocumentClient({ type }: { type: StockDocumentType }) {
  const searchParams = useSearchParams();
  const autoOpenedDocumentRef = useRef<string | null>(null);
  const autoOpenedRosskoRef = useRef(false);
  const isReceipt = type === "receipt";
  const title = isReceipt ? "Приёмка" : "Корректировка остатка";
  const actionLabel = isReceipt ? "Создать приёмку" : "Списать / скорректировать";
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
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>({});
  const [productsSearching, setProductsSearching] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedPositionIds, setSelectedPositionIds] = useState<string[]>([]);
  const [cellEditor, setCellEditor] = useState<CellEditorState | null>(null);

  const [documentDate, setDocumentDate] = useState(todayInput());
  const [createInvoice, setCreateInvoice] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayInput());
  const [invoiceDueDate, setInvoiceDueDate] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("unpaid");
  const [description, setDescription] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>("expense");
  const [adjustmentReason, setAdjustmentReason] = useState("");

  const [documents, setDocuments] = useState<MovementRow[]>([]);
  const [documentsMeta, setDocumentsMeta] = useState<DocumentListMeta>({ total: 0, limit: DOCUMENT_PAGE_SIZE, offset: 0 });
  const [documentPage, setDocumentPage] = useState(0);
  const [allBranchesMode, setAllBranchesMode] = useState(false);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [invoiceDraft, setInvoiceDraft] = useState<ExistingInvoiceDraft | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("new");
  const [editingDocument, setEditingDocument] = useState<MovementRow | null>(null);
  const [savingAction, setSavingAction] = useState<SaveAction | null>(null);
  const [receiptDialog, setReceiptDialog] = useState<ReceiptDialogState | null>(null);
  const [priceLabelDocument, setPriceLabelDocument] = useState<MovementRow | null>(null);
  const [rosskoReceiptOpen, setRosskoReceiptOpen] = useState(false);
  const [receiptActionBusy, setReceiptActionBusy] = useState<string | null>(null);
  const [invoiceSaving, setInvoiceSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [newSupplier, setNewSupplier] = useState(emptySupplierDraft);
  const [newSupplierSaving, setNewSupplierSaving] = useState(false);

  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newProduct, setNewProduct] = useState(emptyProductDraft);
  const [newProductSaving, setNewProductSaving] = useState(false);

  const readOnly = formMode === "view" || Boolean(editingDocument && !isDraftDocument(editingDocument));

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
  const warehouseCellOptions = useMemo(() => {
    const map = new Map<string, KnownCell>();
    const add = (cell: KnownCell) => {
      const slotName = cleanCell(cell.slotName);
      if (!slotName) return;
      const key = slotName.toLowerCase();
      if (!map.has(key)) map.set(key, { ...cell, slotName });
    };
    for (const product of products) {
      for (const cell of knownCellsFromProduct(product)) {
        if (!selectedStoreId || !cell.storeId || cell.storeId === selectedStoreId) add(cell);
      }
    }
    for (const position of positions) {
      for (const cell of position.knownCells) {
        if (!selectedStoreId || !cell.storeId || cell.storeId === selectedStoreId) add(cell);
      }
      if (position.slotName && (!selectedStoreId || !position.slotStoreId || position.slotStoreId === selectedStoreId)) {
        add({ storeId: position.slotStoreId, storeName: selectedStoreName, slotName: position.slotName, available: position.available });
      }
    }
    return [...map.values()].sort((a, b) => a.slotName.localeCompare(b.slotName, "ru"));
  }, [positions, products, selectedStoreId, selectedStoreName]);
  const lastDocument = documents[0] ?? null;
  const documentPageCount = Math.max(1, Math.ceil(documentsMeta.total / DOCUMENT_PAGE_SIZE));
  const documentsDisplayStart = documentsMeta.total === 0 ? 0 : documentsMeta.offset + 1;
  const documentsDisplayEnd = Math.min(documentsMeta.offset + documents.length, documentsMeta.total);
  const documentStats = useMemo(
    () => ({
      count: documents.length,
      conducted: documents.filter(isPostedDocument).length,
      drafts: documents.filter(isDraftDocument).length,
      cancelled: documents.filter(isCancelledDocument).length,
      invoices: documents.filter((document) => document.invoice).length,
      technical: documents.filter((document) => document.adjustmentType === "technical" || document.affectsManagementProfit === false).length,
      expense: documents.filter((document) => document.type === "writeoff" && document.adjustmentType !== "technical" && document.affectsManagementProfit !== false).length,
      technicalSum: documents
        .filter((document) => document.adjustmentType === "technical" || document.affectsManagementProfit === false)
        .reduce((acc, document) => acc + document.sum, 0),
      expenseSum: documents
        .filter((document) => document.type === "writeoff" && document.adjustmentType !== "technical" && document.affectsManagementProfit !== false)
        .reduce((acc, document) => acc + document.sum, 0),
      sum: documents.reduce((acc, document) => acc + document.sum, 0),
      quantity: documents.reduce((acc, document) => acc + document.totalQuantity, 0),
      positions: documents.reduce((acc, document) => acc + document.positionsCount, 0),
    }),
    [documents]
  );

  const hasInvalidQty = positions.some((position) => Number(position.quantity) <= 0);
  const hasInvalidReceiptPrice = isReceipt && positions.some((position) => Number(position.price) <= 0);
  const missingCellCount = isReceipt ? positions.filter((position) => !cleanCell(position.slotName)).length : 0;
  const hasKnownWriteoffOverAvailable = !isReceipt && positions.some((position) => (
    position.availableKnown && Number(position.quantity) > Number(position.available) + 0.000001
  ));
  const reasonOptions = adjustmentType === "technical" ? technicalAdjustmentReasons : expenseWriteoffReasons;
  const canSaveDraft = !readOnly && positions.length > 0 && !hasInvalidQty && !savingAction;
  const canConduct = canSaveDraft && Boolean(selectedStoreId) && !hasInvalidReceiptPrice && (isReceipt || Boolean(adjustmentReason)) && !hasKnownWriteoffOverAvailable;
  const footerHelper = (() => {
    if (readOnly) return `${editingDocument ? statusMeta(editingDocument).label : "Документ"} открыт только для просмотра. Для нового движения используйте копию или корректировку.`;
    if (positions.length === 0) return "Добавьте хотя бы одну позицию, чтобы сохранить документ.";
    if (hasInvalidQty) return "Количество по каждой позиции должно быть больше нуля.";
    if (!selectedStoreId) return "Черновик можно сохранить без движения остатков; для проведения выберите склад.";
    if (hasInvalidReceiptPrice) return "Для проведения укажите закупочную цену по каждой позиции.";
    if (missingCellCount > 0 && isReceipt) return `У ${missingCellCount} поз. не указана ячейка. Проведение разрешено, если для склада ячейки не обязательны.`;
    if (!isReceipt && !adjustmentReason) return "Для проведения выберите причину списания или корректировки.";
    if (hasKnownWriteoffOverAvailable) return "Нельзя провести списание больше доступного остатка по выбранному складу.";
    if (!isReceipt && adjustmentType === "technical") {
      return "Проведение уменьшит остаток, но не попадёт в расходы и управленческую прибыль.";
    }
    return isReceipt
      ? "Черновик не меняет остатки. Проведение увеличит остаток выбранного склада."
      : "Черновик не меняет остатки. Проведение спишет товар с выбранного склада.";
  })();

  function resetDocumentForm() {
    const today = todayInput();
    setPositions([]);
    setSelectedPositionIds([]);
    setCellEditor(null);
    setDescription("");
    setSelectedCounterparty(null);
    setCounterpartySearch("");
    setProductSearch("");
    setProducts([]);
    setProductQuantities({});
    setDocumentDate(today);
    setCreateInvoice(false);
    setInvoiceNumber("");
    setInvoiceDate(today);
    setInvoiceDueDate("");
    setInvoiceStatus("unpaid");
    setAdjustmentType("expense");
    setAdjustmentReason("");
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
    if (allBranchesMode) {
      setInfo("В режиме «Все филиалы» журнал доступен только для просмотра. Выберите конкретный филиал для создания документа.");
      return;
    }
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
      documentPositionId: position.id,
      productId: position.productId ?? "",
      entityType: position.entityType,
      name: position.name,
      article: position.article || position.code,
      code: position.code,
      brand: position.brand,
      quantity: position.quantity,
      price: position.price,
      salePrice: position.salePrice,
      slotName: position.slotName,
      slotStoreId: position.slotStoreId || (position.slotName ? document.storeId : ""),
      defaultCell: position.defaultCell || "",
      makeDefaultCell: Boolean(position.makeDefaultCell),
      knownCells: position.knownCells ?? [],
      available: 0,
      availableKnown: false,
    })));
    setSelectedPositionIds([]);
    setCellEditor(null);
    setDescription(document.description || "");
    setAdjustmentType(document.adjustmentType === "technical" ? "technical" : "expense");
    setAdjustmentReason(document.adjustmentReason || "");
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
    if (isPostedDocument(document) && isReceipt) {
      setReceiptDialog({ type: "edit-posted", document });
      return;
    }
    fillFormFromDocument(document, isDraftDocument(document) ? "edit" : "view");
  }

  function copyFromDocument(document: MovementRow) {
    fillFormFromDocument({ ...document, id: "", name: "", status: "draft", applicable: false, invoice: null }, "new");
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
      setSelectedStoreId((prev) => {
        if (prev && nextStores.some((store) => store.id === prev)) return prev;
        return nextStores.find((store) => store.isMain)?.id ?? nextStores[0]?.id ?? "";
      });
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

  async function loadDocuments(requestedPage = documentPage): Promise<MovementRow[]> {
    setDocumentsLoading(true);
    setDocumentsError(null);
    try {
      const fetchPage = async (page: number) => {
        const params = new URLSearchParams({
          type,
          limit: String(DOCUMENT_PAGE_SIZE),
          offset: String(page * DOCUMENT_PAGE_SIZE),
        });
        const res = await fetch(`/api/local-inventory/movements?${params.toString()}`, { cache: "no-store" });
        const data = await readJson<{ documents?: MovementRow[]; meta?: DocumentListMeta; error?: string }>(res);
        if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить журнал");
        const nextDocuments = Array.isArray(data?.documents) ? data.documents : [];
        const nextMeta: DocumentListMeta = {
          total: Math.max(0, Number(data?.meta?.total) || 0),
          limit: Number(data?.meta?.limit) || DOCUMENT_PAGE_SIZE,
          offset: Number(data?.meta?.offset) || 0,
          mode: data?.meta?.mode,
        };
        return { data, nextDocuments, nextMeta };
      };

      let safePage = Math.max(0, requestedPage);
      let result = await fetchPage(safePage);
      const lastAvailablePage = Math.max(0, Math.ceil(result.nextMeta.total / DOCUMENT_PAGE_SIZE) - 1);
      if (safePage > lastAvailablePage) {
        safePage = lastAvailablePage;
        result = await fetchPage(safePage);
      }

      const { data, nextDocuments, nextMeta } = result;
      setDocuments(nextDocuments);
      setDocumentsMeta(nextMeta);
      setDocumentPage(safePage);
      setAllBranchesMode(data?.meta?.mode === "all");
      return nextDocuments;
    } catch (e) {
      setDocumentsError(e instanceof Error ? e.message : "Не удалось загрузить журнал");
      setAllBranchesMode(false);
      return [];
    } finally {
      setDocumentsLoading(false);
    }
  }

  async function loadAll(resetDocumentPage = false) {
    await Promise.allSettled([loadStores(), loadCounterparties(), loadDocuments(resetDocumentPage ? 0 : documentPage)]);
  }

  function goToDocumentPage(nextPage: number) {
    if (documentsLoading || nextPage < 0 || nextPage >= documentPageCount || nextPage === documentPage) return;
    setOpenId(null);
    setInvoiceDraft(null);
    void loadDocuments(nextPage);
  }

  useEffect(() => {
    void loadAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  useEffect(() => {
    if (!isReceipt || searchParams.get("rossko") !== "1" || autoOpenedRosskoRef.current) return;
    autoOpenedRosskoRef.current = true;
    setRosskoReceiptOpen(true);
  }, [isReceipt, searchParams]);

  useEffect(() => {
    const documentId = searchParams.get("document");
    const document = documentId ? documents.find((row) => row.id === documentId) : null;
    if (document) {
      setOpenId(documentId);
      if (searchParams.get("open") === "edit" && autoOpenedDocumentRef.current !== documentId) {
        autoOpenedDocumentRef.current = documentId;
        fillFormFromDocument(document, isDraftDocument(document) ? "edit" : "view");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents, searchParams]);

  useEffect(() => {
    setSelectedPositionIds((prev) => prev.filter((id) => positions.some((position) => position.localId === id)));
  }, [positions]);

  useEffect(() => {
    if (!selectedStoreId) return;
    setPositions((prev) =>
      prev.map((position) => {
        const storeCell = position.knownCells.find((cell) => cell.storeId === selectedStoreId);
        if (!storeCell) return { ...position, available: 0, availableKnown: true };
        return {
          ...position,
          available: storeCell.available,
          availableKnown: true,
        };
      })
    );
  }, [selectedStoreId]);

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

  function stockRowForSelectedStore(product: ProductOption) {
    return selectedStoreId ? product.stock.find((row) => row.storeId === selectedStoreId) : null;
  }

  function slotForStore(product: ProductOption) {
    const warehouseCell = cleanCell(stockRowForSelectedStore(product)?.slotName);
    return warehouseCell || cleanCell(product.cell);
  }

  function slotStoreForProduct(product: ProductOption) {
    const row = stockRowForSelectedStore(product);
    return cleanCell(row?.slotName) ? row?.storeId ?? "" : "";
  }

  function productSearchCellLabel(product: ProductOption) {
    const cells = selectedStoreId
      ? knownCellsFromProduct(product).filter((cell) => cell.storeId === selectedStoreId || !cell.storeId)
      : knownCellsFromProduct(product);
    const summary = displayCells(cells);
    return summary.extra > 0 ? `${summary.label} + ещё ${summary.extra}` : summary.label;
  }

  function cellIssue(position: Position) {
    if (!position.slotName) return "missing";
    if (selectedStoreId && position.slotStoreId && position.slotStoreId !== selectedStoreId) return "wrong-store";
    return "ok";
  }

  function productSearchQuantity(productId: string) {
    return Math.max(1, Math.floor(Number(productQuantities[productId]) || 1));
  }

  function setProductSearchQuantity(productId: string, quantity: number) {
    const nextQuantity = Math.max(1, Math.min(999999, Math.floor(Number(quantity) || 1)));
    setProductQuantities((prev) => ({ ...prev, [productId]: nextQuantity }));
  }

  function addProduct(product: ProductOption, requestedQuantity = 1) {
    if (readOnly) return;
    const quantityToAdd = Math.max(1, Math.floor(Number(requestedQuantity) || 1));
    const slotName = slotForStore(product);
    const defaultCell = cleanCell(product.cell);
    const storeAverageCost = product.stock.find((row) => row.storeId === selectedStoreId)?.averageCost ?? null;
    setPositions((prev) => {
      const existing = prev.find((position) => position.productId === product.id);
      if (existing) {
        return prev.map((position) =>
          position.productId === product.id
            ? { ...position, quantity: position.quantity + quantityToAdd }
            : position
        );
      }
      return [
        ...prev,
        {
          localId: makeLocalId(),
          productId: product.id,
          entityType: product.entityType,
          name: product.name,
          article: product.article || product.code,
          code: product.code,
          brand: product.brand || product.supplierName || "",
          quantity: quantityToAdd,
          price: isReceipt ? product.buyPrice ?? 0 : storeAverageCost ?? 0,
          salePrice: product.salePrice ?? 0,
          slotName,
          slotStoreId: slotStoreForProduct(product),
          defaultCell,
          makeDefaultCell: !defaultCell && Boolean(slotName),
          knownCells: knownCellsFromProduct(product),
          available: availableForStore(product),
          availableKnown: true,
        },
      ];
    });
    setProductSearch("");
    setProducts([]);
    setProductQuantities((prev) => {
      const next = { ...prev };
      delete next[product.id];
      return next;
    });
    setNewProductOpen(false);
  }

  function updatePosition(localId: string, patch: Partial<Position>) {
    if (readOnly) return;
    setPositions((prev) =>
      prev.map((position) => (position.localId === localId ? { ...position, ...patch } : position))
    );
  }

  function togglePositionSelection(localId: string) {
    if (readOnly) return;
    setSelectedPositionIds((prev) =>
      prev.includes(localId) ? prev.filter((id) => id !== localId) : [...prev, localId]
    );
  }

  function toggleAllPositionsSelection() {
    if (readOnly) return;
    setSelectedPositionIds((prev) => (
      prev.length === positions.length ? [] : positions.map((position) => position.localId)
    ));
  }

  function openCellEditor(position: Position) {
    if (readOnly) return;
    setFormError(null);
    setCellEditor({
      mode: "single",
      localId: position.localId,
      selectedCell: position.slotName,
      search: "",
      createName: "",
      makeDefaultCell: position.makeDefaultCell || (!position.defaultCell && Boolean(position.slotName)),
    });
  }

  function openBulkCellEditor() {
    if (readOnly || selectedPositionIds.length === 0) return;
    setFormError(null);
    setCellEditor({
      mode: "bulk",
      selectedCell: "",
      search: "",
      createName: "",
      makeDefaultCell: false,
    });
  }

  function saveCellEditor() {
    if (!cellEditor || readOnly) return;
    const requestedCell = cleanCell(cellEditor.selectedCell || cellEditor.createName);
    const existingCell = warehouseCellOptions.find((cell) => cell.slotName.toLowerCase() === requestedCell.toLowerCase());
    const nextCell = existingCell?.slotName ?? requestedCell;
    if (!selectedStoreId) {
      setFormError("Выберите склад перед назначением ячейки");
      return;
    }
    if (!nextCell) {
      setFormError("Укажите ячейку");
      return;
    }
    const targetIds = cellEditor.mode === "bulk" ? selectedPositionIds : [cellEditor.localId].filter(Boolean) as string[];
    if (targetIds.length === 0) {
      setFormError("Выберите строки для назначения ячейки");
      return;
    }
    setPositions((prev) =>
      prev.map((position) => {
        if (!targetIds.includes(position.localId)) return position;
        const nextKnown = position.knownCells.some(
          (cell) => cell.storeId === selectedStoreId && cell.slotName.toLowerCase() === nextCell.toLowerCase()
        )
          ? position.knownCells
          : [
              ...position.knownCells,
              { storeId: selectedStoreId, storeName: selectedStoreName, slotName: nextCell, available: position.available },
            ];
        return {
          ...position,
          slotName: nextCell,
          slotStoreId: selectedStoreId,
          knownCells: nextKnown,
          makeDefaultCell: cellEditor.mode === "single"
            ? cellEditor.makeDefaultCell
            : cellEditor.makeDefaultCell || (!position.defaultCell && Boolean(nextCell)),
        };
      })
    );
    setInfo(targetIds.length > 1 ? `Ячейка ${nextCell} назначена для ${targetIds.length} строк.` : "Ячейка назначена.");
    setFormError(null);
    setCellEditor(null);
  }

  function renderCellEditor(targetPosition?: Position) {
    if (!cellEditor) return null;
    const query = cellEditor.search.trim().toLowerCase();
    const options = warehouseCellOptions.filter((cell) => !query || cell.slotName.toLowerCase().includes(query));
    const selectedCell = cleanCell(cellEditor.selectedCell || cellEditor.createName);
    const defaultCell = targetPosition?.defaultCell ?? "";
    const defaultWarning = cellEditor.mode === "single" && cellEditor.makeDefaultCell && defaultCell && selectedCell && defaultCell !== selectedCell;
    const exactExisting = warehouseCellOptions.find((cell) => cell.slotName.toLowerCase() === cleanCell(cellEditor.createName).toLowerCase());
    return (
      <div className="eco-receipt-cell-popover" role="dialog" aria-label="Назначение ячейки">
        <div className="eco-receipt-cell-popover-head">
          <strong>{cellEditor.mode === "bulk" ? "Назначить ячейку строкам" : "Ячейка позиции"}</strong>
          <button type="button" onClick={() => setCellEditor(null)} aria-label="Закрыть выбор ячейки">
            <X size={14} />
          </button>
        </div>
        {!selectedStoreId && (
          <div className="eco-receipt-cell-warning">Сначала выберите склад документа.</div>
        )}
        <label className="eco-receipt-cell-search">
          <Search size={14} />
          <input
            value={cellEditor.search}
            onChange={(event) => setCellEditor({ ...cellEditor, search: event.target.value })}
            placeholder="Поиск по ячейкам склада"
          />
        </label>
        <div className="eco-receipt-cell-options">
          {options.length === 0 ? (
            <span>На выбранном складе известных ячеек пока нет.</span>
          ) : options.slice(0, 8).map((cell) => (
            <button
              key={`${cell.storeId}-${cell.slotName}`}
              type="button"
              className={selectedCell === cell.slotName ? "is-active" : ""}
              onClick={() => setCellEditor({ ...cellEditor, selectedCell: cell.slotName, createName: "" })}
            >
              <MapPin size={14} />
              <strong>{cell.slotName}</strong>
              <em>{formatQty(cell.available)} шт.</em>
            </button>
          ))}
        </div>
        <label className="eco-receipt-cell-create">
          <span>Создать ячейку</span>
          <input
            value={cellEditor.createName}
            onChange={(event) => setCellEditor({ ...cellEditor, createName: event.target.value, selectedCell: "" })}
            placeholder="Например A-12"
          />
        </label>
        {exactExisting && cellEditor.createName && (
          <div className="eco-receipt-cell-warning">Такая ячейка уже есть. Будет использована существующая ячейка {exactExisting.slotName}.</div>
        )}
        {cellEditor.mode === "single" && (
          <label className="eco-receipt-cell-checkbox">
            <input
              type="checkbox"
              checked={cellEditor.makeDefaultCell}
              onChange={(event) => setCellEditor({ ...cellEditor, makeDefaultCell: event.target.checked })}
            />
            <span>Сделать основной ячейкой товара</span>
          </label>
        )}
        {defaultWarning && (
          <div className="eco-receipt-cell-warning">
            У товара уже указана ячейка {defaultCell}. Сделать {selectedCell} основной ячейкой товара?
          </div>
        )}
        <div className="eco-receipt-cell-actions">
          <button type="button" onClick={() => setCellEditor(null)}>Отмена</button>
          <button type="button" className="is-primary" onClick={saveCellEditor}>Сохранить</button>
        </div>
      </div>
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
          supplierCounterpartyId: selectedCounterparty?.id || null,
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

  function buildCurrentDocument(data: { id?: string; name?: string; status?: StockDocumentStatus; applicable?: boolean; invoice?: MovementRow["invoice"] | null }): MovementRow {
    return {
      id: data.id || editingDocument?.id || "",
      branchId: editingDocument?.branchId ?? "",
      type,
      name: data.name || editingDocument?.name || "",
      moment: editingDocument?.moment || toServiceMomentString(),
      documentDate,
      status: data.status ?? (data.applicable ? "posted" : "draft"),
      applicable: Boolean(data.applicable),
      sum: total,
      description,
      adjustmentType: isReceipt ? null : adjustmentType,
      adjustmentMethod: isReceipt ? null : "WRITE_OFF_QUANTITY",
      adjustmentReason: isReceipt ? "" : adjustmentReason,
      affectsManagementProfit: isReceipt || adjustmentType !== "technical",
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
        entityType: position.entityType,
        name: position.name,
        article: position.article,
        code: position.code,
        brand: position.brand,
        quantity: position.quantity,
        price: position.price,
        salePrice: position.salePrice,
        slotName: position.slotName,
        defaultCell: position.defaultCell,
        slotStoreId: position.slotStoreId,
        knownCells: position.knownCells,
        makeDefaultCell: position.makeDefaultCell,
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
      setFormError(`Выберите склад перед проведением ${isReceipt ? "приёмки" : "списания"}`);
      return;
    }
    if (nextApplicable && hasInvalidReceiptPrice) {
      setFormError("Укажите корректную закупочную цену перед проведением");
      return;
    }
    if (nextApplicable && !isReceipt && !adjustmentReason) {
      setFormError("Выберите причину списания или технической корректировки");
      return;
    }
    if (nextApplicable && hasKnownWriteoffOverAvailable) {
      setFormError("Нельзя списать больше доступного остатка по выбранному складу");
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
            adjustmentType: isReceipt ? undefined : adjustmentType,
            adjustmentMethod: isReceipt ? undefined : "WRITE_OFF_QUANTITY",
            adjustmentReason: isReceipt ? undefined : adjustmentReason,
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
              id: position.documentPositionId,
              productId: position.productId,
              quantity: Number(position.quantity) || 0,
              price: Number(position.price) || 0,
              salePrice: isReceipt ? Math.max(0, Number(position.salePrice) || 0) : undefined,
              slotName: position.slotName || undefined,
              makeDefaultCell: position.makeDefaultCell,
            })),
          }),
        }
      );
      const data = await readJson<{
        id?: string;
        name?: string;
        status?: StockDocumentStatus;
        applicable?: boolean;
        adjustmentType?: AdjustmentType | null;
        adjustmentMethod?: string | null;
        adjustmentReason?: string | null;
        affectsManagementProfit?: boolean;
        invoice?: MovementRow["invoice"] | null;
        error?: string;
      }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось сохранить документ");
      const nextDocument = buildCurrentDocument({
        id: data?.id,
        name: data?.name,
        status: data?.status,
        applicable: nextApplicable,
        invoice: data?.invoice ?? null,
      });
      const successMessage = nextApplicable
        ? `${title} ${nextDocument.name} проведена. Остатки обновлены.`
        : `${title} ${nextDocument.name} сохранена как черновик.`;
      const refreshedDocuments = await loadDocuments(formMode === "new" ? 0 : documentPage);
      const persistedDocument = refreshedDocuments.find((document) => document.id === nextDocument.id);
      if (persistedDocument) {
        fillFormFromDocument(persistedDocument, nextApplicable ? "view" : "edit");
      } else {
        setEditingDocument(nextDocument);
        setFormMode(nextApplicable ? "view" : "edit");
      }
      setInfo(successMessage);
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

  function receiptActionKey(document: MovementRow, action: string) {
    return `${document.id}:${action}`;
  }

  async function requestReceiptAction<T>(
    document: MovementRow,
    action: string,
    options: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {}
  ) {
    const method = options.method ?? "POST";
    const url = action
      ? `/api/warehouse/receipts/${document.id}/${action}`
      : `/api/warehouse/receipts/${document.id}`;
    const res = await fetch(url, {
      method,
      headers: options.body ? { "Content-Type": "application/json" } : undefined,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const data = await readJson<(T & {
      error?: string;
      message?: string;
      problems?: ReceiptActionProblem[];
      warnings?: ReceiptActionWarning[];
    })>(res);
    if (!res.ok) {
      const error = new Error(data?.error ?? "Не удалось выполнить действие");
      (error as Error & { payload?: typeof data }).payload = data;
      throw error;
    }
    return data;
  }

  async function runPostReceipt(document: MovementRow) {
    const key = receiptActionKey(document, "post");
    setReceiptActionBusy(key);
    setFormError(null);
    setInfo(null);
    try {
      const data = await requestReceiptAction<{ message?: string }>(document, "post");
      setInfo(data?.message || "Приёмка проведена. Остатки обновлены.");
      await loadDocuments();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Не удалось провести приёмку");
    } finally {
      setReceiptActionBusy(null);
    }
  }

  async function openReceiptDangerDialog(document: MovementRow, action: "unpost" | "cancel") {
    const key = receiptActionKey(document, `check-${action}`);
    setReceiptActionBusy(key);
    setFormError(null);
    setInfo(null);
    try {
      const endpoint = action === "unpost" ? "check-unpost" : "check-cancel";
      const data = await requestReceiptAction<ReceiptActionCheck>(document, endpoint);
      setReceiptDialog({
        type: action,
        document,
        check: {
          canProceed: Boolean(data?.canProceed),
          problems: data?.problems ?? [],
          warnings: data?.warnings ?? [],
        },
      });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Не удалось проверить приёмку");
    } finally {
      setReceiptActionBusy(null);
    }
  }

  async function openReceiptHistory(document: MovementRow) {
    const key = receiptActionKey(document, "history");
    setReceiptActionBusy(key);
    setFormError(null);
    try {
      const data = await requestReceiptAction<{ audit?: ReceiptAuditRow[] }>(document, "audit", { method: "GET" });
      setReceiptDialog({ type: "history", document, audit: data?.audit ?? [] });
    } catch (e) {
      setReceiptDialog({
        type: "history",
        document,
        audit: [],
        error: e instanceof Error ? e.message : "Не удалось загрузить историю",
      });
    } finally {
      setReceiptActionBusy(null);
    }
  }

  async function createCorrectionFromDialog(document: MovementRow, reason?: string) {
    const key = receiptActionKey(document, "correction");
    setReceiptActionBusy(key);
    setFormError(null);
    setInfo(null);
    try {
      const data = await requestReceiptAction<{ message?: string; document?: { name?: string; href?: string } }>(
        document,
        "correction",
        { body: { reason: reason?.trim() || undefined } }
      );
      setReceiptDialog(null);
      setInfo(data?.message || "Создана корректировка приёмки.");
      await loadDocuments();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Не удалось создать корректировку");
    } finally {
      setReceiptActionBusy(null);
    }
  }

  async function confirmReceiptDialog() {
    const dialog = receiptDialog;
    if (!dialog) return;
    if (dialog.type === "delete-draft") {
      const key = receiptActionKey(dialog.document, "delete");
      setReceiptActionBusy(key);
      setFormError(null);
      setInfo(null);
      try {
        const data = await requestReceiptAction<{ message?: string }>(dialog.document, "", {
          method: "DELETE",
          body: { invoiceAction: dialog.invoiceAction },
        });
        setReceiptDialog(null);
        setInfo(data?.message || "Черновик приёмки удалён.");
        await loadDocuments();
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Не удалось удалить черновик");
      } finally {
        setReceiptActionBusy(null);
      }
      return;
    }
    if (dialog.type === "unpost" || dialog.type === "cancel") {
      if (!dialog.check.canProceed) return;
      const endpoint = dialog.type === "unpost" ? "unpost" : "cancel";
      const key = receiptActionKey(dialog.document, endpoint);
      setReceiptActionBusy(key);
      setFormError(null);
      setInfo(null);
      try {
        const data = await requestReceiptAction<{ message?: string }>(dialog.document, endpoint);
        setReceiptDialog(null);
        setInfo(
          data?.message ||
          (dialog.type === "unpost"
            ? "Приёмка возвращена в черновик. Складские движения отменены."
            : "Приёмка отменена. Документ сохранён в истории.")
        );
        const nextDocuments = await loadDocuments();
        const updated = nextDocuments.find((item) => item.id === dialog.document.id);
        if (dialog.type === "unpost" && updated) fillFormFromDocument(updated, "edit");
        if (dialog.type === "cancel" && editingDocument?.id === dialog.document.id && updated) fillFormFromDocument(updated, "view");
      } catch (e) {
        const payload = e instanceof Error ? (e as Error & { payload?: { problems?: ReceiptActionProblem[]; warnings?: ReceiptActionWarning[] } }).payload : null;
        if (payload?.problems) {
          setReceiptDialog({
            type: dialog.type,
            document: dialog.document,
            check: { canProceed: false, problems: payload.problems, warnings: payload.warnings ?? [] },
          });
        }
        setFormError(e instanceof Error ? e.message : "Не удалось выполнить действие");
      } finally {
        setReceiptActionBusy(null);
      }
      return;
    }
    if (dialog.type === "correction") {
      await createCorrectionFromDialog(dialog.document, dialog.reason);
    }
  }

  function handleDocumentAction(document: MovementRow, action: ReceiptAction | "") {
    if (!action) return;
    if (action === "open") {
      fillFormFromDocument(document, "view");
      return;
    }
    if (action === "edit") {
      openExistingDocument(document);
      return;
    }
    if (action === "post") {
      void runPostReceipt(document);
      return;
    }
    if (action === "delete") {
      if (!isDraftDocument(document)) {
        setReceiptDialog({ type: "posted-delete", document });
        return;
      }
      setReceiptDialog({ type: "delete-draft", document, invoiceAction: "keep" });
      return;
    }
    if (action === "duplicate") {
      copyFromDocument(document);
      return;
    }
    if (action === "unpost") {
      void openReceiptDangerDialog(document, "unpost");
      return;
    }
    if (action === "cancel") {
      void openReceiptDangerDialog(document, "cancel");
      return;
    }
    if (action === "correction") {
      setReceiptDialog({ type: "correction", document, reason: `Исправление приёмки ${document.name}` });
      return;
    }
    if (action === "history") {
      void openReceiptHistory(document);
      return;
    }
    if (action === "print-labels") {
      setPriceLabelDocument(document);
    }
  }

  function auditActionLabel(action: string) {
    if (action === "create_draft") return "Создание черновика";
    if (action === "create_posted") return "Создание и проведение";
    if (action === "update_draft") return "Редактирование черновика";
    if (action === "post") return "Проведение";
    if (action === "unpost") return "Возврат в черновик";
    if (action === "cancel") return "Отмена";
    if (action === "delete_draft") return "Удаление черновика";
    if (action === "create_correction") return "Корректировка";
    if (action === "correction_created_from_receipt") return "Создание корректировки";
    return action;
  }

  function renderReceiptDialog() {
    if (!receiptDialog) return null;
    const dialog = receiptDialog;
    const busy = receiptActionBusy?.startsWith(`${dialog.document.id}:`);
    const close = () => {
      if (!busy) setReceiptDialog(null);
    };
    const paidInvoice = dialog.document.invoice && ["paid", "partial", "paid_manually"].includes(dialog.document.invoice.status);
    const actionTitle =
      dialog.type === "delete-draft" ? "Удалить черновик приёмки"
      : dialog.type === "posted-delete" ? "Проведённую приёмку нельзя удалить"
      : dialog.type === "edit-posted" ? "Приёмка уже проведена"
      : dialog.type === "unpost" ? "Вернуть приёмку в черновик"
      : dialog.type === "cancel" ? "Отменить приёмку"
      : dialog.type === "correction" ? "Создать корректировку"
      : "История изменений";

    return (
      <div className="eco-receipt-action-backdrop" role="dialog" aria-modal="true" aria-label={actionTitle}>
        <div className="eco-receipt-action-dialog">
          <header>
            <div>
              <span>{dialog.document.name}</span>
              <h2>{actionTitle}</h2>
            </div>
            <button type="button" onClick={close} aria-label="Закрыть" disabled={busy}>
              <X size={17} />
            </button>
          </header>

          {dialog.type === "edit-posted" && (
            <div className="eco-receipt-action-body">
              <p>Эта приёмка уже проведена и изменила остатки склада. Чтобы изменить документ, нужно вернуть его в черновик или создать корректировку.</p>
              <div className="eco-receipt-action-grid">
                <button type="button" onClick={() => void openReceiptDangerDialog(dialog.document, "unpost")}>
                  <RotateCcw size={16} /> Вернуть в черновик
                </button>
                <button type="button" onClick={() => setReceiptDialog({ type: "correction", document: dialog.document, reason: `Исправление приёмки ${dialog.document.name}` })}>
                  <FilePlus2 size={16} /> Создать корректировку
                </button>
                <button type="button" onClick={() => {
                  setReceiptDialog(null);
                  fillFormFromDocument(dialog.document, "view");
                }}>
                  <Eye size={16} /> Открыть для просмотра
                </button>
              </div>
            </div>
          )}

          {dialog.type === "posted-delete" && (
            <div className="eco-receipt-action-body">
              <p>Проведённую приёмку нельзя удалить напрямую, потому что она уже изменила остатки склада. Вы можете отменить приёмку, вернуть её в черновик или создать корректировку.</p>
              <div className="eco-receipt-action-grid">
                <button type="button" onClick={() => void openReceiptDangerDialog(dialog.document, "cancel")}>
                  <Ban size={16} /> Отменить приёмку
                </button>
                <button type="button" onClick={() => void openReceiptDangerDialog(dialog.document, "unpost")}>
                  <RotateCcw size={16} /> Вернуть в черновик
                </button>
                <button type="button" onClick={() => setReceiptDialog({ type: "correction", document: dialog.document, reason: `Исправление приёмки ${dialog.document.name}` })}>
                  <FilePlus2 size={16} /> Создать корректировку
                </button>
              </div>
            </div>
          )}

          {dialog.type === "delete-draft" && (
            <div className="eco-receipt-action-body">
              <p>Удалить черновик приёмки? Это действие нельзя будет отменить.</p>
              {dialog.document.invoice && (
                <div className="eco-receipt-action-options">
                  <strong>У этой приёмки есть связанный счёт поставщика.</strong>
                  <label>
                    <input
                      type="radio"
                      checked={dialog.invoiceAction === "keep"}
                      onChange={() => setReceiptDialog({ ...dialog, invoiceAction: "keep" })}
                    />
                    <span>Оставить счёт и пометить его как требующий проверки</span>
                  </label>
                  <label className={paidInvoice ? "is-disabled" : undefined}>
                    <input
                      type="radio"
                      checked={dialog.invoiceAction === "delete"}
                      disabled={Boolean(paidInvoice)}
                      onChange={() => setReceiptDialog({ ...dialog, invoiceAction: "delete" })}
                    />
                    <span>{paidInvoice ? "Счёт уже оплачен, удалить нельзя" : "Удалить счёт вместе с черновиком"}</span>
                  </label>
                </div>
              )}
            </div>
          )}

          {(dialog.type === "unpost" || dialog.type === "cancel") && (
            <div className="eco-receipt-action-body">
              <p>
                {dialog.type === "unpost"
                  ? "Система проверила остатки, продажи, списания, резервы и инвентаризации перед возвратом в черновик."
                  : "Отменить приёмку? Остатки по позициям будут уменьшены. Документ останется в истории."}
              </p>
              {dialog.check.warnings.length > 0 && (
                <div className="eco-receipt-action-warning">
                  {dialog.check.warnings.map((warning, index) => <span key={index}>{warning.message}</span>)}
                </div>
              )}
              {dialog.check.problems.length > 0 && (
                <div className="eco-receipt-action-problems">
                  <strong>Действие сейчас запрещено</strong>
                  {dialog.check.problems.map((problem, index) => (
                    <div key={index}>
                      <AlertTriangle size={15} />
                      <span>{problem.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {dialog.type === "correction" && (
            <div className="eco-receipt-action-body">
              <p>Корректировка будет создана отдельным черновиком и связана с исходной приёмкой.</p>
              <label className="eco-receipt-field">
                <span>Причина корректировки</span>
                <textarea
                  className="eco-input"
                  rows={3}
                  value={dialog.reason}
                  onChange={(event) => setReceiptDialog({ ...dialog, reason: event.target.value })}
                />
              </label>
            </div>
          )}

          {dialog.type === "history" && (
            <div className="eco-receipt-action-body">
              {dialog.error ? (
                <div className="eco-receipt-action-problems">
                  <div><AlertTriangle size={15} /><span>{dialog.error}</span></div>
                </div>
              ) : dialog.audit.length === 0 ? (
                <p>История изменений пока пустая. Старые документы могли быть созданы до включения аудита.</p>
              ) : (
                <div className="eco-receipt-audit-list">
                  {dialog.audit.map((row) => (
                    <div key={row.id}>
                      <time>{formatMoment(row.createdAt)}</time>
                      <strong>{auditActionLabel(row.action)}</strong>
                      <span>{row.message || "Изменение зафиксировано"}</span>
                      <em>{row.createdByName || row.createdById || "система"}</em>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <footer>
            <EcoButton type="button" onClick={close} disabled={busy}>Отмена</EcoButton>
            {dialog.type === "delete-draft" && (
              <EcoButton type="button" variant="danger" onClick={() => void confirmReceiptDialog()} disabled={busy}>
                {busy ? <Loader2 size={15} /> : <Trash2 size={15} />} Удалить черновик
              </EcoButton>
            )}
            {(dialog.type === "unpost" || dialog.type === "cancel") && (
              <>
                {!dialog.check.canProceed && (
                  <EcoButton type="button" onClick={() => setReceiptDialog({ type: "correction", document: dialog.document, reason: `Исправление приёмки ${dialog.document.name}` })}>
                    <FilePlus2 size={15} /> Создать корректировку
                  </EcoButton>
                )}
                <EcoButton type="button" variant={dialog.type === "cancel" ? "danger" : "primary"} onClick={() => void confirmReceiptDialog()} disabled={busy || !dialog.check.canProceed}>
                  {busy ? <Loader2 size={15} /> : dialog.type === "cancel" ? <Ban size={15} /> : <RotateCcw size={15} />}
                  {dialog.type === "cancel" ? "Отменить" : "Вернуть в черновик"}
                </EcoButton>
              </>
            )}
            {dialog.type === "correction" && (
              <EcoButton type="button" variant="primary" onClick={() => void confirmReceiptDialog()} disabled={busy}>
                {busy ? <Loader2 size={15} /> : <FilePlus2 size={15} />} Создать корректировку
              </EcoButton>
            )}
          </footer>
        </div>
      </div>
    );
  }

  const drawerStatus = editingDocument
    ? statusMeta(editingDocument)
    : { label: "Черновик", tone: "warning" as const };

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
      {renderReceiptDialog()}
      {priceLabelDocument && (
        <PriceLabelPrintDialog
          receiptId={priceLabelDocument.id}
          receiptNumber={priceLabelDocument.name}
          positions={priceLabelDocument.positions}
          onClose={() => setPriceLabelDocument(null)}
        />
      )}
      {isReceipt && rosskoReceiptOpen && (
        <RosskoReceiptWorkspace
          onClose={() => setRosskoReceiptOpen(false)}
          onCreated={(result) => {
            setInfo(`Черновик приёмки ${result.documentNumber} создан из заказа ROSSKO.`);
            void loadDocuments(0);
          }}
        />
      )}
      {formOpen && (
        <div className={`eco-receipt-drawer-backdrop${isReceipt ? " is-workspace" : ""}`}>
          <aside role="dialog" aria-modal="true" className={`eco-receipt-drawer${isReceipt ? " is-workspace" : ""}`}>
            <header className="eco-receipt-drawer-head">
              <div>
                <div className="eco-title-row">
                  <h2>{editingDocument?.name ? `${title} ${editingDocument.name}` : `Новая ${title.toLowerCase()}`}</h2>
                  <EcoBadge tone={drawerStatus.tone} dot>
                    {drawerStatus.label}
                  </EcoBadge>
                </div>
                <p>{isReceipt ? "Оприходование товаров на локальный склад" : "Корректировка остатков локального склада"}</p>
              </div>
              <div className="eco-receipt-drawer-head-actions">
                {isReceipt && editingDocument?.id && (
                  <EcoButton type="button" size="sm" onClick={() => setPriceLabelDocument(editingDocument)}>
                    <Printer size={15} /> Ценники
                  </EcoButton>
                )}
                <button type="button" className="eco-icon-btn eco-receipt-close" onClick={closeDocumentForm} aria-label="Закрыть">
                  <X size={18} />
                </button>
              </div>
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
                      <h3>{isReceipt ? "Склад, поставщик и основание" : "Склад, тип операции и причина"}</h3>
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
                      ) : stores.length === 0 ? (
                        <div className="eco-receipt-field-state is-warning">
                          <strong>В филиале ещё нет склада</strong>
                          <small>Создайте склад в настройках филиала, чтобы провести документ.</small>
                          <Link href="/cabinet/branches?tab=warehouses">Управление складами</Link>
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

                    {!isReceipt && (
                      <>
                        <label className="eco-receipt-field is-wide">
                          <span>Тип операции *</span>
                          <EcoSelect
                            value={adjustmentType}
                            onChange={(event) => {
                              const nextType = event.target.value === "technical" ? "technical" : "expense";
                              setAdjustmentType(nextType);
                              const nextReasons = nextType === "technical" ? technicalAdjustmentReasons : expenseWriteoffReasons;
                              setAdjustmentReason((current) => nextReasons.includes(current) ? current : "");
                            }}
                            disabled={readOnly}
                          >
                            <option value="technical">Техническая корректировка — не учитывать в управленческой прибыли</option>
                            <option value="expense">Обычное списание — учитывать как расход</option>
                          </EcoSelect>
                        </label>
                        <label className="eco-receipt-field">
                          <span>Причина *</span>
                          <EcoSelect
                            value={adjustmentReason}
                            onChange={(event) => setAdjustmentReason(event.target.value)}
                            disabled={readOnly}
                          >
                            <option value="">Выберите причину</option>
                            {reasonOptions.map((reason) => (
                              <option key={reason} value={reason}>{reason}</option>
                            ))}
                          </EcoSelect>
                        </label>
                      </>
                    )}

                    {isReceipt && (
                      <label className="eco-receipt-field">
                        <span>Номер счёта / накладной</span>
                        <EcoInput
                          value={invoiceNumber}
                          onChange={(event) => setInvoiceNumber(event.target.value)}
                          placeholder="авто или номер поставщика"
                          disabled={readOnly}
                        />
                      </label>
                    )}
                  </div>

                  {!isReceipt && adjustmentType === "technical" && (
                    <div className="eco-receipt-inline-state is-success">
                      <CheckCircle2 size={18} />
                      <span>Техническая корректировка изменит остаток, но не попадёт в расходы и расчёт управленческой прибыли.</span>
                    </div>
                  )}

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
                      {selectedCounterparty && (
                        <ContactActionButton
                          size="sm"
                          entityType="supplier"
                          counterpartyId={selectedCounterparty.id}
                          supplierId={selectedCounterparty.id}
                          phone={selectedCounterparty.phone}
                          displayName={selectedCounterparty.name}
                          context={{
                            entityType: "supplier",
                            entityId: selectedCounterparty.id,
                            amount: formatMoney(total),
                          }}
                        />
                      )}
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
                          addProduct(products[0], isReceipt ? productSearchQuantity(products[0].id) : 1);
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
                      {products.map((product) => {
                        const requestedQuantity = productSearchQuantity(product.id);
                        return (
                        <div key={product.id} className="eco-receipt-product-row">
                          <div>
                            <strong>{product.name}</strong>
                            <span>
                              {[
                                product.article || product.code || "без артикула",
                                product.brand,
                                `остаток ${formatQty(availableForStore(product))} шт`,
                                `ячейка ${productSearchCellLabel(product).toLowerCase()}`,
                              ].filter(Boolean).join(" · ")}
                            </span>
                          </div>
                          <dl>
                            <div><dt>Остаток</dt><dd>{formatQty(availableForStore(product))}</dd></div>
                            <div><dt>Ячейка</dt><dd>{productSearchCellLabel(product)}</dd></div>
                            <div><dt>Закупка</dt><dd>{formatMoney(product.buyPrice)} ₽</dd></div>
                            <div><dt>Продажа</dt><dd>{formatMoney(product.salePrice)} ₽</dd></div>
                          </dl>
                          {isReceipt ? (
                            <div className="eco-receipt-product-row-actions">
                              <div className="eco-receipt-quantity-stepper" role="group" aria-label={`Количество товара: ${product.name}`}>
                                <button
                                  type="button"
                                  onClick={() => setProductSearchQuantity(product.id, requestedQuantity - 1)}
                                  disabled={requestedQuantity <= 1}
                                  aria-label={`Уменьшить количество товара ${product.name}`}
                                >
                                  <Minus size={14} />
                                </button>
                                <input
                                  type="number"
                                  min={1}
                                  max={999999}
                                  step={1}
                                  value={requestedQuantity}
                                  onChange={(event) => setProductSearchQuantity(product.id, Number(event.target.value))}
                                  aria-label={`Количество товара ${product.name}`}
                                />
                                <button
                                  type="button"
                                  onClick={() => setProductSearchQuantity(product.id, requestedQuantity + 1)}
                                  aria-label={`Увеличить количество товара ${product.name}`}
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                              <button
                                type="button"
                                className="eco-receipt-product-add"
                                onClick={() => addProduct(product, requestedQuantity)}
                              >
                                {requestedQuantity > 1 ? `Добавить ${requestedQuantity} шт.` : "Добавить"}
                              </button>
                            </div>
                          ) : (
                            <button type="button" className="eco-receipt-product-add" onClick={() => addProduct(product)}>
                              Добавить
                            </button>
                          )}
                        </div>
                        );
                      })}
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
                      <span>{isReceipt ? "Позиции приёмки" : "Позиции корректировки"}</span>
                      <h3>{positions.length ? `${positions.length} строк` : "Позиции ещё не добавлены"}</h3>
                    </div>
                    {isReceipt && positions.length > 0 && !readOnly && (
                      <div className="eco-receipt-bulk-cells">
                        <button type="button" onClick={toggleAllPositionsSelection}>
                          {selectedPositionIds.length === positions.length ? <CheckSquare2 size={14} /> : <Square size={14} />}
                          {selectedPositionIds.length || "Выбрать"}
                        </button>
                        <button type="button" onClick={openBulkCellEditor} disabled={selectedPositionIds.length === 0}>
                          <MapPin size={14} />
                          Назначить ячейку
                        </button>
                        {cellEditor?.mode === "bulk" && renderCellEditor()}
                      </div>
                    )}
                  </div>
                  {cellEditor?.mode === "single" && (
                    <div className="eco-receipt-cell-editor-host">
                      {renderCellEditor(positions.find((position) => position.localId === cellEditor.localId))}
                    </div>
                  )}

                  <div className="eco-receipt-position-table">
                    <table>
                      <thead>
                        <tr>
                          <th className="eco-receipt-select-col" aria-label="Выбор строк" />
                          <th>Товар</th>
                          {!isReceipt && <th>Артикул / код</th>}
                          <th>Текущий остаток</th>
                          <th>Кол-во</th>
                          <th>{productPriceLabel}</th>
                          {isReceipt && <th>Цена продажи</th>}
                          <th>Сумма</th>
                          <th>Ячейка</th>
                          <th>Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {positions.map((position) => {
                          const issue = cellIssue(position);
                          const sameStoreCells = selectedStoreId
                            ? position.knownCells.filter((cell) => cell.storeId === selectedStoreId)
                            : position.knownCells;
                          const extraCells = position.slotName
                            ? sameStoreCells.filter((cell) => cell.slotName.toLowerCase() !== position.slotName.toLowerCase()).length
                            : 0;
                          const selected = selectedPositionIds.includes(position.localId);
                          const profit = receiptProfit(position);
                          return (
                          <tr key={position.localId} className={selected ? "is-selected" : undefined}>
                            <td className="eco-receipt-select-cell">
                              {!readOnly && isReceipt && (
                                <button
                                  type="button"
                                  className={selected ? "is-selected" : undefined}
                                  onClick={() => togglePositionSelection(position.localId)}
                                  aria-label={selected ? "Убрать строку из массового выбора" : "Выбрать строку"}
                                >
                                  {selected ? <CheckSquare2 size={15} /> : <Square size={15} />}
                                </button>
                              )}
                            </td>
                            <td>
                              <a
                                href={productHref(position.productId)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="eco-receipt-product-link"
                                title="Открыть карточку товара в новой вкладке"
                              >
                                <strong>{position.name}</strong>
                                <ExternalLink size={13} />
                              </a>
                              <span>{[position.brand, position.article, position.code].filter(Boolean).join(" · ") || "без дополнительных данных"}</span>
                            </td>
                            {!isReceipt && <td className="l-mono">{position.article || position.code || "—"}</td>}
                            <td className="l-number">{position.availableKnown ? formatQty(position.available) : "—"}</td>
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
                            {isReceipt && (
                              <td className="eco-receipt-sale-price-cell">
                                <MoneyInput
                                  value={position.salePrice}
                                  onValueChange={(salePrice) => updatePosition(position.localId, { salePrice: Math.max(0, salePrice) })}
                                  className="eco-input l-money"
                                  disabled={readOnly}
                                  aria-label={`Цена продажи: ${position.name}`}
                                />
                                <small
                                  className={profit.amount > 0 ? "is-positive" : profit.amount < 0 ? "is-negative" : undefined}
                                  title="Прибыль с единицы и маржинальность от цены продажи"
                                >
                                  {position.salePrice > 0
                                    ? `${profit.amount > 0 ? "+" : ""}${formatProfitMoney(profit.amount)} ₽ · ${profit.margin == null ? "—" : `${formatPercent(profit.margin)}%`}`
                                    : "Цена не задана"}
                                </small>
                              </td>
                            )}
                            <td className="l-number l-sum">{formatMoney(position.quantity * position.price)} ₽</td>
                            <td className="eco-receipt-cell-cell">
                              <div className="eco-receipt-cell-wrap">
                                <button
                                  type="button"
                                  className={`eco-receipt-cell-pill is-${issue}`}
                                  onClick={() => openCellEditor(position)}
                                  disabled={readOnly || !isReceipt}
                                  title={issue === "wrong-store" ? `Ячейка ${position.slotName} относится к другому складу` : "Назначить или изменить ячейку"}
                                >
                                  <MapPin size={13} />
                                  <span>{position.slotName || "Не указана"}</span>
                                  {extraCells > 0 && <em>+ ещё {extraCells}</em>}
                                </button>
                                {position.defaultCell && position.defaultCell !== position.slotName && (
                                  <small>осн. {position.defaultCell}</small>
                                )}
                                {issue === "wrong-store" && <small className="is-danger">другой склад</small>}
                              </div>
                            </td>
                            <td>
                              {!readOnly && (
                                <div className="eco-receipt-table-actions">
                                  {isReceipt && (
                                    <button
                                      type="button"
                                      className="eco-icon-btn"
                                      title="Назначить ячейку"
                                      aria-label="Назначить ячейку"
                                      onClick={() => openCellEditor(position)}
                                    >
                                      <MapPin size={16} />
                                    </button>
                                  )}
                                  {!isReceipt && position.availableKnown && position.available > 0 && (
                                    <button
                                      type="button"
                                      className="eco-icon-btn"
                                      title="Обнулить остаток"
                                      aria-label="Обнулить остаток"
                                      onClick={() => updatePosition(position.localId, { quantity: position.available })}
                                    >
                                      <Eraser size={16} />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="eco-icon-btn"
                                    title="Удалить позицию"
                                    aria-label="Удалить позицию"
                                    onClick={() => setPositions((prev) => prev.filter((item) => item.localId !== position.localId))}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {positions.length === 0 && (
                      <div className="eco-receipt-empty-positions">
                        <PackagePlus size={24} />
                        <strong>{isReceipt ? "Добавьте товары в приёмку" : "Добавьте товары для списания"}</strong>
                        <span>{isReceipt ? "После выбора товара здесь появятся количество, закупочная цена и сумма строки." : "После выбора товара здесь появятся доступный остаток, количество списания и сумма корректировки."}</span>
                      </div>
                    )}
                  </div>

                  <div className="eco-receipt-position-cards">
                    {positions.map((position) => {
                      const profit = receiptProfit(position);
                      return (
                      <div key={position.localId} className="eco-receipt-position-card">
                        <div>
                          <a
                            href={productHref(position.productId)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="eco-receipt-product-link"
                            title="Открыть карточку товара в новой вкладке"
                          >
                            <strong>{position.name}</strong>
                            <ExternalLink size={13} />
                          </a>
                          <span>{[position.brand, position.article || position.code].filter(Boolean).join(" · ") || "без артикула"}</span>
                        </div>
                        {isReceipt && (
                          <div className="eco-receipt-card-cell">
                            <button
                              type="button"
                              className={`eco-receipt-cell-pill is-${cellIssue(position)}`}
                              onClick={() => openCellEditor(position)}
                              disabled={readOnly}
                            >
                              <MapPin size={13} />
                              <span>{position.slotName || "Не указана"}</span>
                            </button>
                          </div>
                        )}
                        <label className="is-quantity">
                          Кол-во
                          <input type="number" min={0} step={0.001} value={position.quantity} disabled={readOnly} onChange={(event) => updatePosition(position.localId, { quantity: Number(event.target.value) || 0 })} />
                        </label>
                        <label className="is-buy-price">
                          {productPriceLabel}
                          <MoneyInput value={position.price} onValueChange={(price) => updatePosition(position.localId, { price })} className="eco-input l-money" disabled={readOnly} />
                        </label>
                        {isReceipt && (
                          <label className="is-sale-price">
                            Цена продажи
                            <MoneyInput
                              value={position.salePrice}
                              onValueChange={(salePrice) => updatePosition(position.localId, { salePrice: Math.max(0, salePrice) })}
                              className="eco-input l-money"
                              disabled={readOnly}
                            />
                            <small className={profit.amount > 0 ? "is-positive" : profit.amount < 0 ? "is-negative" : undefined}>
                              {position.salePrice > 0
                                ? `Прибыль ${profit.amount > 0 ? "+" : ""}${formatProfitMoney(profit.amount)} ₽ · ${profit.margin == null ? "—" : `${formatPercent(profit.margin)}%`}`
                                : "Цена продажи не задана"}
                            </small>
                          </label>
                        )}
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
                      );
                    })}
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
                  {isReceipt && <div><dt>Без ячейки</dt><dd>{missingCellCount}</dd></div>}
                  <div><dt>Склад</dt><dd>{selectedStoreName || "не выбран"}</dd></div>
                  <div><dt>{isReceipt ? "Поставщик" : "Основание"}</dt><dd>{selectedCounterparty?.name || counterpartySearch || "не выбран"}</dd></div>
                  {!isReceipt && (
                    <>
                      <div><dt>Тип</dt><dd>{adjustmentType === "technical" ? "Техническая" : "Обычное списание"}</dd></div>
                      <div><dt>Прибыль</dt><dd>{adjustmentType === "technical" ? "не влияет" : "учитывается расходом"}</dd></div>
                    </>
                  )}
                  <div><dt>Статус</dt><dd>{drawerStatus.label}</dd></div>
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
                    {editingDocument && isReceipt && isPostedDocument(editingDocument) && (
                      <>
                        <EcoButton type="button" onClick={() => void openReceiptDangerDialog(editingDocument, "unpost")} disabled={receiptActionBusy === receiptActionKey(editingDocument, "check-unpost")}>
                          {receiptActionBusy === receiptActionKey(editingDocument, "check-unpost") ? <Loader2 size={15} /> : <RotateCcw size={15} />}
                          В черновик
                        </EcoButton>
                        <EcoButton type="button" variant="danger" onClick={() => void openReceiptDangerDialog(editingDocument, "cancel")} disabled={receiptActionBusy === receiptActionKey(editingDocument, "check-cancel")}>
                          {receiptActionBusy === receiptActionKey(editingDocument, "check-cancel") ? <Loader2 size={15} /> : <Ban size={15} />}
                          Отменить
                        </EcoButton>
                        <EcoButton type="button" onClick={() => setReceiptDialog({ type: "correction", document: editingDocument, reason: `Исправление приёмки ${editingDocument.name}` })}>
                          <FilePlus2 size={15} /> Корректировка
                        </EcoButton>
                      </>
                    )}
                    {editingDocument && (
                      <>
                        <EcoButton type="button" onClick={() => copyFromDocument(editingDocument)}>
                          <Copy size={15} /> Дублировать
                        </EcoButton>
                        {isReceipt && (
                          <EcoButton type="button" onClick={() => void openReceiptHistory(editingDocument)}>
                            <History size={15} /> История
                          </EcoButton>
                        )}
                        {isReceipt && (
                          <EcoButton type="button" onClick={() => setPriceLabelDocument(editingDocument)}>
                            <Printer size={15} /> Напечатать ценники
                          </EcoButton>
                        )}
                      </>
                    )}
                    <EcoButton type="button" variant="primary" onClick={closeDocumentForm}>Закрыть</EcoButton>
                  </>
                ) : (
                  <>
                    <EcoButton type="button" onClick={closeDocumentForm}>Отмена</EcoButton>
                    {editingDocument?.id && isReceipt && isDraftDocument(editingDocument) && (
                      <EcoButton type="button" variant="danger" onClick={() => setReceiptDialog({ type: "delete-draft", document: editingDocument, invoiceAction: "keep" })}>
                        <Trash2 size={15} /> Удалить
                      </EcoButton>
                    )}
                    <EcoButton type="button" variant="primary" onClick={() => void submit(false)} disabled={!canSaveDraft} title={!canSaveDraft ? footerHelper : undefined}>
                      {savingAction === "draft" ? <Loader2 size={15} /> : <Save size={15} />}
                      Сохранить черновик
                    </EcoButton>
                    <EcoButton type="button" className="eco-receipt-conduct-btn" onClick={() => void submit(true)} disabled={!canConduct} title={!canConduct ? footerHelper : undefined}>
                      {savingAction === "conduct" ? <Loader2 size={15} /> : <CheckCircle2 size={15} />}
                      Провести {isReceipt ? "приёмку" : "списание"}
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
            <EcoBadge tone="neutral">{documentsMeta.total.toLocaleString("ru-RU")} документов</EcoBadge>
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
          {isReceipt && (
            <EcoButton type="button" onClick={() => setRosskoReceiptOpen(true)} disabled={allBranchesMode}>
              <Truck size={15} />
              Заказы ROSSKO
            </EcoButton>
          )}
          <EcoButton type="button" variant="primary" onClick={openDocumentForm}>
            <FilePlus2 size={15} />
            {actionLabel}
          </EcoButton>
        </div>
      </section>

      {documentsLoading ? renderSkeletonKpis() : (
        <div className="eco-receipt-kpis">
          <div className="eco-receipt-kpi is-info">
            <span>Всего документов</span>
            <strong>{documentsMeta.total.toLocaleString("ru-RU")}</strong>
            <em>{documentsDisplayStart}–{documentsDisplayEnd} на странице</em>
          </div>
          <div className="eco-receipt-kpi is-success">
            <span>Проведено на странице</span>
            <strong>{documentStats.conducted}</strong>
            <em>{documentStats.drafts} черн. · {documentStats.cancelled} отмен.</em>
          </div>
          <div className="eco-receipt-kpi is-warning">
            <span>Черновики на странице</span>
            <strong>{documentStats.drafts}</strong>
            <em>можно редактировать</em>
          </div>
          <div className="eco-receipt-kpi is-neutral">
            <span>{isReceipt ? "Количество на странице" : "Технические на странице"}</span>
            <strong>{isReceipt ? formatQty(documentStats.quantity) : documentStats.technical}</strong>
            <em>{isReceipt ? `${documentStats.positions} строк документов` : `${formatMoney(documentStats.technicalSum)} ₽ без влияния на прибыль`}</em>
          </div>
          <div className="eco-receipt-kpi is-rust">
            <span>{isReceipt ? "Счета / сумма страницы" : "Списания на странице"}</span>
            <strong>{formatMoney(isReceipt ? documentStats.sum : documentStats.expenseSum)} ₽</strong>
            <em>{isReceipt ? `${documentStats.invoices} счетов` : `${documentStats.expense} документов как расход`}</em>
          </div>
          <div className="eco-receipt-kpi is-neutral">
            <span>Самый новый на странице</span>
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
            <p>Проверьте локальную базу или повторите загрузку. Без склада нельзя провести документ.</p>
          </div>
          <EcoButton type="button" onClick={() => void loadStores()} disabled={storesLoading}>
            <RefreshCw size={15} />
            Повторить
          </EcoButton>
        </section>
      )}

      {!storesLoading && !storesError && !allBranchesMode && stores.length === 0 && (
        <section className="eco-receipt-state-card is-warning">
          <Warehouse size={20} />
          <div>
            <h2>В филиале ещё нет складов</h2>
            <p>Создайте основной склад для этого филиала. Остатки и движения других филиалов не будут перенесены.</p>
          </div>
          <Link href="/cabinet/branches?tab=warehouses" className="eco-btn eco-btn--primary">Создать склад</Link>
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
            <h2 className="eco-stock-doc-title">Документы</h2>
            <p className="eco-stock-doc-subtitle">
              {isReceipt ? "Локальные приёмки и документы поступления." : "Технические корректировки и обычные списания локального склада."}
            </p>
          </div>
          <div className="grow" />
          <span className="l-meta">
            {documentsDisplayStart}–{documentsDisplayEnd} из {documentsMeta.total.toLocaleString("ru-RU")} · {formatMoney(documentStats.sum)} ₽ на странице
          </span>
          <div className="eco-row-actions is-visible">
            <EcoButton type="button" onClick={openDocumentForm} size="sm" variant="primary" disabled={allBranchesMode}>
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
        {allBranchesMode && (
          <div className="eco-receipt-inline-state is-success eco-receipt-page-message" role="status">
            <Eye size={18} />
            <span>Режим «Все филиалы»: показан общий журнал с указанием филиала. Создание и изменение документов отключены.</span>
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
            <p>Загружаем {isReceipt ? "приёмки" : "корректировки"}…</p>
            {Array.from({ length: 5 }).map((_, index) => <span key={index} />)}
          </div>
        )}

        {!documentsLoading && documentsError && (
          <div className="eco-receipt-empty-state is-error">
            <AlertTriangle size={30} />
            <h2>Не удалось загрузить {isReceipt ? "приёмки" : "корректировки"}</h2>
            <p>Проверьте локальную базу или повторите загрузку журнала.</p>
            <EcoButton type="button" onClick={() => void loadDocuments()}>
              <RefreshCw size={15} />
              Повторить
            </EcoButton>
          </div>
        )}

        {!documentsLoading && !documentsError && documents.length === 0 && (
          <div className="eco-receipt-empty-state">
            <PackagePlus size={30} />
            <h2>{isReceipt ? "Приёмок пока нет" : "Корректировок пока нет"}</h2>
            <p>{isReceipt ? "Создайте первую приёмку, чтобы оприходовать товары на локальный склад." : "Создайте техническую корректировку или обычное списание, чтобы изменить остаток документом."}</p>
            <EcoButton type="button" variant="primary" onClick={openDocumentForm} disabled={allBranchesMode}>
              <FilePlus2 size={15} />
              {actionLabel}
            </EcoButton>
          </div>
        )}

        {!documentsLoading && documents.length > 0 && (
          <>
            <div className="eco-receipt-doc-table-wrap">
              <table className="eco-receipt-doc-table">
              <thead>
                <tr>
                  <th>№ / дата</th>
                  <th>{isReceipt ? "Поставщик" : "Тип / причина"}</th>
                  {allBranchesMode && <th>Филиал</th>}
                  <th>Склад</th>
                  <th>Позиций</th>
                  <th>{isReceipt ? "Счёт / основание" : "Влияние"}</th>
                  <th>Статус</th>
                  <th>Сумма</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document) => {
                  const open = openId === document.id;
                  const status = statusMeta(document);
                  const adjustment = adjustmentMeta(document);
                  const draft = isDraftDocument(document);
                  const posted = isPostedDocument(document);
                  const cancelled = isCancelledDocument(document);
                  const rowBusy = receiptActionBusy?.startsWith(`${document.id}:`);
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
                          <strong>{isReceipt ? document.counterpartyName || "без поставщика" : document.adjustmentReason || "без причины"}</strong>
                          <span>{isReceipt ? document.description || "поступление локального склада" : document.description || adjustment.label}</span>
                        </td>
                        {allBranchesMode && <td>{document.branchName || document.branchId}</td>}
                        <td>{document.storeName || "склад не указан"}</td>
                        <td className="l-number">{document.positionsCount} · {formatQty(document.totalQuantity)} шт.</td>
                        <td>
                          {!isReceipt ? (
                            <EcoBadge tone={adjustment.tone}>{adjustment.label}</EcoBadge>
                          ) : document.invoice ? (
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
                          {isReceipt ? (
                            <div className="eco-receipt-table-actions">
                              <label className="eco-receipt-action-select">
                                {rowBusy ? <Loader2 size={15} /> : <MoreHorizontal size={15} />}
                                <select
                                  value=""
                                  disabled={rowBusy || allBranchesMode}
                                  aria-label={`Действия ${document.name}`}
                                  onChange={(event) => {
                                    handleDocumentAction(document, event.target.value as ReceiptAction);
                                    event.currentTarget.value = "";
                                  }}
                                >
                                  <option value="">Действия</option>
                                  <option value="open">Открыть</option>
                                  <option value="print-labels">Напечатать ценники</option>
                                  {draft && <option value="edit">Редактировать</option>}
                                  {posted && <option value="edit">Редактировать…</option>}
                                  {draft && <option value="post">Провести</option>}
                                  <option value="duplicate">Дублировать</option>
                                  {posted && <option value="unpost">Вернуть в черновик</option>}
                                  {posted && <option value="cancel">Отменить приёмку</option>}
                                  {posted && <option value="correction">Создать корректировку</option>}
                                  {draft ? (
                                    <option value="delete">Удалить</option>
                                  ) : (
                                    <option value="delete" disabled>{cancelled ? "Удалить нельзя: отменена" : "Удалить нельзя: проведена"}</option>
                                  )}
                                  {!draft && <option value="history">История изменений</option>}
                                </select>
                              </label>
                              {!document.invoice && (
                                <button type="button" title="Создать счёт" aria-label="Создать счёт" onClick={() => startInvoiceForDocument(document)} disabled={allBranchesMode}>
                                  <FilePlus2 size={16} />
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="eco-receipt-table-actions">
                              <button type="button" title={document.applicable ? "Открыть" : "Редактировать"} aria-label={document.applicable ? "Открыть" : "Редактировать"} onClick={() => openExistingDocument(document)} disabled={allBranchesMode}>
                                {document.applicable ? <Eye size={16} /> : <Pencil size={16} />}
                              </button>
                              <button type="button" title="Создать на основе" aria-label="Создать на основе" onClick={() => copyFromDocument(document)} disabled={allBranchesMode}>
                                <Copy size={16} />
                              </button>
                            </div>
                          )}
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
            <nav className="eco-receipt-pagination" aria-label="Страницы журнала документов">
              <span>
                Показано {documentsDisplayStart}–{documentsDisplayEnd} из {documentsMeta.total.toLocaleString("ru-RU")}
              </span>
              <div>
                <EcoButton
                  type="button"
                  size="sm"
                  onClick={() => goToDocumentPage(documentPage - 1)}
                  disabled={documentsLoading || documentPage === 0}
                  aria-label="Предыдущая страница"
                >
                  <ChevronLeft size={15} aria-hidden />
                  Назад
                </EcoButton>
                <strong aria-live="polite">{documentPage + 1} / {documentPageCount}</strong>
                <EcoButton
                  type="button"
                  size="sm"
                  onClick={() => goToDocumentPage(documentPage + 1)}
                  disabled={documentsLoading || documentPage >= documentPageCount - 1}
                  aria-label="Следующая страница"
                >
                  Далее
                  <ChevronRight size={15} aria-hidden />
                </EcoButton>
              </div>
            </nav>
          </>
        )}
      </section>
    </div>
  );
}
