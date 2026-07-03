import { prisma } from "@/lib/db";
import { getLocalInventoryFinance, type LocalInventoryFinanceResult } from "@/lib/local-inventory-finance";
import { getCachedPayrollSummary, type PayrollSummary } from "@/lib/payroll";

export type FinanceMode = "manager" | "cfo" | "owner";
export type FinanceCalculationMode = "accrual" | "payment";
export type FinanceTone = "neutral" | "success" | "warning" | "danger" | "info" | "rust";

export type FinanceCenterParams = {
  dateFrom?: string;
  dateTo?: string;
  organizationId?: string;
  warehouseId?: string;
  calculationMode?: FinanceCalculationMode;
};

export type FinanceMetric = {
  id: string;
  label: string;
  value: number | null;
  display: string;
  sub: string;
  tone: FinanceTone;
  tab?: FinanceTabId;
};

export type FinancePnlRow = {
  id: string;
  label: string;
  amount: number | null;
  display: string;
  ratio: number | null;
  displayRatio: string;
  change: number | null;
  displayChange: string;
  level: 0 | 1 | 2;
  kind: "income" | "expense" | "subtotal" | "total" | "warning";
  tab?: FinanceTabId;
  description: string;
};

export type FinanceCashflowLine = {
  id: string;
  label: string;
  amount: number;
  display: string;
  group: "incoming" | "outgoing" | "summary";
  description: string;
};

export type FinanceExpenseCategory = {
  id: string;
  name: string;
  group: "fixed" | "variable" | "payroll" | "purchase" | "tax" | "other";
  affectsProfit: boolean;
  affectsCashflow: boolean;
  costBehavior: "fixed" | "variable" | "mixed";
  operationScope: "operating" | "non_operating" | "technical";
  pnlLine: string;
  cashflowLine: string;
  keywords: string[];
};

export type FinanceExpenseRow = {
  id: string;
  date: string;
  number: string;
  categoryId: string;
  categoryName: string;
  group: FinanceExpenseCategory["group"];
  amount: number;
  displayAmount: string;
  counterparty: string;
  comment: string;
  paymentType: string;
  affectsProfit: boolean;
  affectsCashflow: boolean;
  source: string;
  href: string;
};

export type FinanceProblem = {
  id: string;
  severity: "warning" | "danger";
  title: string;
  description: string;
  amount: number | null;
  displayAmount: string;
  href: string | null;
  action: string;
  source: string;
};

export type FinanceDocumentRow = {
  id: string;
  date: string;
  type: string;
  number: string;
  counterparty: string;
  category: string;
  amount: number;
  displayAmount: string;
  status: string;
  affectsProfit: boolean;
  affectsCashflow: boolean;
  href: string;
};

export type FinanceTaxSettings = {
  configured: boolean;
  organizationName: string;
  regime: string;
  basis: "revenue" | "profit" | "fixed" | "manual";
  rate: number | null;
  base: number | null;
  calculated: number | null;
  paid: number;
  remaining: number | null;
  dueDate: string | null;
  warning: string | null;
};

export type FinanceAcquiringSettings = {
  configured: boolean;
  provider: string;
  percentRate: number | null;
  fixedFee: number;
};

export type FinanceTabId =
  | "overview"
  | "pnl"
  | "cashflow"
  | "expenses"
  | "taxes"
  | "acquiring"
  | "payroll"
  | "purchases"
  | "breakEven"
  | "planFact"
  | "documents"
  | "problems"
  | "export"
  | "settings";

export type FinanceCenterResult = {
  period: {
    dateFrom: string;
    dateTo: string;
    days: number;
    elapsedDays: number;
    calculatedAt: string;
    calculationMode: FinanceCalculationMode;
    closed: boolean;
    snapshotStatus: "open" | "ready_to_close" | "blocked";
    sourceNote: string;
  };
  filters: {
    organizations: { id: string; name: string; isDefault?: boolean }[];
    warehouses: { id: string; name: string; organizationId: string | null }[];
  };
  permissions: {
    manager: string[];
    cfo: string[];
    owner: string[];
  };
  metrics: FinanceMetric[];
  managerMetrics: FinanceMetric[];
  pnl: {
    rows: FinancePnlRow[];
    revenue: number;
    paidRevenue: number;
    unpaidRevenue: number;
    grossProfit: number;
    operatingProfit: number;
    knownNetProfit: number;
    taxConfigured: boolean;
  };
  cashflow: {
    beginningBalance: number;
    incoming: number;
    outgoing: number;
    endingBalance: number;
    netFlow: number;
    lines: FinanceCashflowLine[];
  };
  expenses: {
    total: number;
    fixed: number;
    variable: number;
    payrollAccrued: number;
    payrollPaid: number;
    taxes: number | null;
    acquiring: number;
    purchasesCashflow: number;
    categories: FinanceExpenseCategory[];
    rows: FinanceExpenseRow[];
    byCategory: { id: string; name: string; group: FinanceExpenseCategory["group"]; amount: number; displayAmount: string; share: number }[];
  };
  taxes: FinanceTaxSettings;
  acquiring: {
    configured: boolean;
    provider: string;
    percentRate: number | null;
    fixedFee: number;
    grossCardPayments: number;
    commission: number;
    netToSettle: number;
    expectedSettlementDate: string | null;
    status: "awaiting" | "settled" | "mismatch" | "not_configured";
    operations: {
      id: string;
      date: string;
      label: string;
      amount: number;
      commission: number;
      net: number;
      status: "awaiting" | "settled" | "mismatch";
    }[];
  };
  payroll: {
    accrued: number;
    paid: number;
    remaining: number;
    fixed: number;
    piecework: number;
    bonusPenalty: number;
    percentOfRevenue: number | null;
    employees: { login: string; name: string; accrued: number; paid: number; remaining: number; shifts: number }[];
    payments: PayrollSummary["cashoutHistory"];
  };
  purchases: {
    receiptValue: number;
    paidToSuppliers: number;
    unpaidToSuppliers: number;
    inventoryPurchaseCashflow: number;
    invoices: {
      id: string;
      number: string;
      supplier: string;
      invoiceDate: string;
      dueDate: string | null;
      sum: number;
      paid: number;
      remaining: number;
      status: string;
      href: string;
    }[];
  };
  breakEven: {
    fixedExpenses: number;
    contributionMarginPercent: number | null;
    monthlyRevenue: number | null;
    dailyRevenue: number | null;
    shipmentsPerDay: number | null;
    averageTicket: number | null;
    safetyMargin: number | null;
    progressPercent: number | null;
    leftToZero: number | null;
    formulas: string[];
  };
  planFact: {
    rows: {
      id: string;
      label: string;
      plan: number;
      fact: number;
      forecast: number;
      deviation: number;
      status: "above" | "risk" | "below";
    }[];
    forecastRevenue: number;
    forecastGrossProfit: number;
    forecastNetProfit: number;
    dailyRevenueRequired: number;
    risk: string | null;
  };
  documents: FinanceDocumentRow[];
  problems: FinanceProblem[];
  exportReports: { id: string; label: string; formats: string[]; description: string }[];
  settings: {
    expenseCategories: FinanceExpenseCategory[];
    taxSettings: FinanceTaxSettings;
    acquiringSettings: FinanceAcquiringSettings;
    fixedExpenses: { id: string; title: string; amount: number; periodicity: string; nextPaymentDate: string; categoryId: string; includeInBreakEven: boolean }[];
    influenceRules: { operation: string; profit: string; cashflow: string; note: string }[];
    accessRights: string[];
  };
  legacy: {
    profitUrl: string;
    invoicesUrl: string;
    cashUrl: string;
    salaryUrl: string;
  };
};

const EXPENSE_CATEGORIES: FinanceExpenseCategory[] = [
  {
    id: "rent",
    name: "Аренда",
    group: "fixed",
    affectsProfit: true,
    affectsCashflow: true,
    costBehavior: "fixed",
    operationScope: "operating",
    pnlLine: "Постоянные расходы",
    cashflowLine: "Аренда",
    keywords: ["аренда", "помещение"],
  },
  {
    id: "utilities",
    name: "Коммунальные",
    group: "fixed",
    affectsProfit: true,
    affectsCashflow: true,
    costBehavior: "fixed",
    operationScope: "operating",
    pnlLine: "Постоянные расходы",
    cashflowLine: "Коммунальные",
    keywords: ["коммун", "электр", "вода", "отопл"],
  },
  {
    id: "services",
    name: "CRM / сервисы",
    group: "fixed",
    affectsProfit: true,
    affectsCashflow: true,
    costBehavior: "fixed",
    operationScope: "operating",
    pnlLine: "Постоянные расходы",
    cashflowLine: "Сервисы",
    keywords: ["crm", "сервис", "подпис", "интернет", "телефон", "связь", "охрана", "бухгалтер"],
  },
  {
    id: "consumables",
    name: "Расходники",
    group: "variable",
    affectsProfit: true,
    affectsCashflow: true,
    costBehavior: "variable",
    operationScope: "operating",
    pnlLine: "Переменные расходы",
    cashflowLine: "Расходники",
    keywords: ["расход", "упаков", "достав", "агрегатор", "комиссия"],
  },
  {
    id: "payroll",
    name: "Зарплата и авансы",
    group: "payroll",
    affectsProfit: false,
    affectsCashflow: true,
    costBehavior: "mixed",
    operationScope: "operating",
    pnlLine: "Зарплата по начислению",
    cashflowLine: "Зарплатные выплаты",
    keywords: ["зарп", "аванс", "прем", "бонус", "компенсац"],
  },
  {
    id: "purchase",
    name: "Закупки на склад",
    group: "purchase",
    affectsProfit: false,
    affectsCashflow: true,
    costBehavior: "variable",
    operationScope: "operating",
    pnlLine: "Не попадает в P&L до продажи",
    cashflowLine: "Закупки",
    keywords: ["закуп", "поставщик", "товар", "масло", "фильтр", "счёт", "счет"],
  },
  {
    id: "tax",
    name: "Налоги и взносы",
    group: "tax",
    affectsProfit: true,
    affectsCashflow: true,
    costBehavior: "fixed",
    operationScope: "non_operating",
    pnlLine: "Налоги",
    cashflowLine: "Налоги",
    keywords: ["налог", "взнос", "патент"],
  },
  {
    id: "bank",
    name: "Банковские комиссии",
    group: "variable",
    affectsProfit: true,
    affectsCashflow: true,
    costBehavior: "variable",
    operationScope: "operating",
    pnlLine: "Переменные расходы",
    cashflowLine: "Банковские комиссии",
    keywords: ["банк", "эквайр", "комисс"],
  },
  {
    id: "other",
    name: "Прочее",
    group: "other",
    affectsProfit: true,
    affectsCashflow: true,
    costBehavior: "mixed",
    operationScope: "operating",
    pnlLine: "Прочие расходы",
    cashflowLine: "Прочие расходы",
    keywords: [],
  },
];

const ACCESS_RIGHTS = [
  "finance.view",
  "finance.pnl.view",
  "finance.cashflow.view",
  "finance.expenses.manage",
  "finance.tax.manage",
  "finance.acquiring.manage",
  "finance.settings.manage",
  "finance.export",
  "finance.full_profit.view",
];

function defaultDateRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return {
    dateFrom: `${year}-${month}-01`,
    dateTo: `${year}-${month}-${day}`,
  };
}

function normalizeDate(value: string | undefined, fallback: string) {
  const raw = value?.trim();
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

function normalizeId(value: string | undefined) {
  const raw = value?.trim();
  return raw || undefined;
}

function cents(value: number | null | undefined) {
  return Math.round(Number(value ?? 0));
}

function rub(centsValue: number | null | undefined) {
  return centsValue == null ? 0 : centsValue / 100;
}

function money(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "Не настроено";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽`;
}

function percent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function dateObject(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function daysInclusive(dateFrom: string, dateTo: string) {
  const from = dateObject(dateFrom).getTime();
  const to = dateObject(dateTo).getTime();
  return Math.max(1, Math.round((to - from) / 86_400_000) + 1);
}

function elapsedDays(dateFrom: string, dateTo: string) {
  const today = new Date();
  const to = dateObject(dateTo);
  const end = today < to ? today : to;
  return Math.max(1, Math.round((end.getTime() - dateObject(dateFrom).getTime()) / 86_400_000) + 1);
}

function addDays(value: string, days: number) {
  const date = dateObject(value);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function safeRatio(value: number, base: number) {
  if (!Number.isFinite(value) || base <= 0) return null;
  return (value / base) * 100;
}

function financeRow(
  row: Omit<FinancePnlRow, "display" | "displayRatio" | "displayChange">,
  revenue: number
): FinancePnlRow {
  return {
    ...row,
    display: money(row.amount),
    displayRatio: percent(row.ratio ?? (row.amount == null ? null : safeRatio(row.amount, revenue))),
    displayChange: row.change == null ? "—" : `${row.change > 0 ? "+" : ""}${percent(row.change)}`,
  };
}

function classifyExpense(source: {
  expenseItemName?: string | null;
  paymentPurpose?: string | null;
  article?: string | null;
  comment?: string | null;
  sourceType?: string | null;
  employeeId?: string | null;
  payrollPeriodId?: string | null;
}) {
  if (source.sourceType === "PAYROLL_PAYMENT" || source.employeeId || source.payrollPeriodId) {
    return EXPENSE_CATEGORIES.find((category) => category.id === "payroll") ?? EXPENSE_CATEGORIES.at(-1)!;
  }
  const text = [
    source.expenseItemName,
    source.paymentPurpose,
    source.article,
    source.comment,
    source.sourceType,
  ].filter(Boolean).join(" ").toLowerCase();
  return EXPENSE_CATEGORIES.find((category) => category.keywords.some((keyword) => text.includes(keyword)))
    ?? EXPENSE_CATEGORIES.find((category) => category.id === "other")
    ?? EXPENSE_CATEGORIES.at(-1)!;
}

function payrollName(login: string) {
  const map: Record<string, string> = {
    vadim: "Вадим Бигожин",
    maksim: "Максим Лобов",
    admin: "Администратор",
  };
  return map[login] ?? login;
}

function parseTaxRate(value: string | null | undefined) {
  const match = value?.match(/(\d+(?:[,.]\d+)?)\s*%/);
  if (!match) return null;
  return Number(match[1].replace(",", "."));
}

function taxBasis(value: string | null | undefined): FinanceCenterResult["taxes"]["basis"] {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("расход") || normalized.includes("минус")) return "profit";
  if (normalized.includes("доход") || normalized.includes("усн")) return "revenue";
  if (normalized.includes("приб")) return "profit";
  if (normalized.includes("патент")) return "fixed";
  return "manual";
}

function sumRows(rows: FinanceExpenseRow[], predicate: (row: FinanceExpenseRow) => boolean) {
  return rows.filter(predicate).reduce((sum, row) => sum + row.amount, 0);
}

function financialDocumentsFromInventory(finance: LocalInventoryFinanceResult): FinanceDocumentRow[] {
  return finance.rows.slice(0, 250).map((row) => ({
    id: row.id,
    date: row.documentDate,
    type: row.type === "sale" ? "Отгрузка" : row.type === "receipt" ? "Приёмка" : "Списание",
    number: row.documentName,
    counterparty: row.counterpartyName ?? "—",
    category: row.productCategory ?? row.costSource,
    amount: row.type === "sale" ? row.revenue : Number(row.cost ?? 0),
    displayAmount: money(row.type === "sale" ? row.revenue : Number(row.cost ?? 0)),
    status: row.status,
    affectsProfit: row.affectsManagementProfit,
    affectsCashflow: row.type === "receipt",
    href: row.documentHref,
  }));
}

export async function getFinanceCenter(params: FinanceCenterParams = {}): Promise<FinanceCenterResult> {
  const defaults = defaultDateRange();
  const dateFrom = normalizeDate(params.dateFrom, defaults.dateFrom);
  const dateTo = normalizeDate(params.dateTo, defaults.dateTo);
  const organizationId = normalizeId(params.organizationId);
  const warehouseId = normalizeId(params.warehouseId);
  const calculationMode: FinanceCalculationMode = params.calculationMode === "payment" ? "payment" : "accrual";
  const periodDays = daysInclusive(dateFrom, dateTo);
  const elapsed = elapsedDays(dateFrom, dateTo);

  const [
    finance,
    payroll,
    expenseOrders,
    supplierInvoices,
    cashShifts,
    organizations,
    warehouses,
  ] = await Promise.all([
    getLocalInventoryFinance({
      dateFrom,
      dateTo,
      organizationId,
      storeId: warehouseId,
      documentType: "all",
      applicableOnly: true,
      includeWriteoffs: true,
    }),
    getCachedPayrollSummary({ dateFrom, dateTo }),
    prisma.cashExpenseOrder.findMany({
      where: {
        expenseDate: { gte: dateFrom, lte: dateTo },
        status: "posted",
        ...(organizationId ? { organizationId } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: {
        organization: true,
        warehouse: true,
        counterparty: true,
        expenseItem: true,
      },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      take: 600,
    }),
    prisma.localSupplierInvoice.findMany({
      where: {
        OR: [
          { invoiceDate: { gte: dateFrom, lte: dateTo } },
          { dueDate: { gte: dateFrom, lte: dateTo } },
          { payments: { some: { paymentDate: { gte: dateFrom, lte: dateTo } } } },
        ],
        document: {
          ...(warehouseId ? { storeId: warehouseId } : {}),
          ...(organizationId ? { store: { organizationId } } : {}),
        },
      },
      include: {
        payments: true,
        document: { include: { store: true } },
      },
      orderBy: [{ dueDate: "asc" }, { invoiceDate: "desc" }],
      take: 300,
    }),
    prisma.cashShift.findMany({
      where: { serviceDate: { gte: dateFrom, lte: dateTo } },
      orderBy: { serviceDate: "asc" },
    }),
    prisma.localOrganization.findMany({
      where: { isActive: true, archivedAt: null },
      select: { id: true, name: true, isDefault: true, taxSystem: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.localStore.findMany({
      where: { archived: false },
      select: { id: true, name: true, organizationId: true },
      orderBy: [{ isMain: "desc" }, { name: "asc" }],
    }),
  ]);

  const selectedOrganization = organizationId
    ? organizations.find((organization) => organization.id === organizationId)
    : organizations.find((organization) => organization.isDefault) ?? organizations[0] ?? null;

  const expenseRows: FinanceExpenseRow[] = expenseOrders.map((order) => {
    const category = classifyExpense(order);
    const amount = rub(order.amountCents);
    return {
      id: order.id,
      date: order.expenseDate,
      number: order.number,
      categoryId: category.id,
      categoryName: category.name,
      group: category.group,
      amount,
      displayAmount: money(amount),
      counterparty: order.counterparty?.name ?? order.counterpartyName ?? "—",
      comment: order.paymentPurpose ?? order.article ?? order.comment ?? "",
      paymentType: order.paymentType,
      affectsProfit: category.affectsProfit,
      affectsCashflow: category.affectsCashflow,
      source: order.sourceType ?? order.source,
      href: `/cash?expense=${encodeURIComponent(order.id)}`,
    };
  });

  const revenue = Number(finance.summary.salesRevenue ?? 0);
  const knownRevenue = Number(finance.summary.knownSalesRevenue ?? revenue);
  const cogs = Number(finance.summary.salesCost ?? 0);
  const grossProfit = Number(finance.summary.grossProfit ?? 0);
  const writeoffLoss = Number(finance.summary.writeoffLoss ?? 0);
  const receiptValue = Number(finance.summary.receiptValue ?? 0);
  const demandsCount = Math.max(0, finance.summary.demandsCount);
  const averageTicket = demandsCount > 0 ? revenue / demandsCount : null;

  const cashIncome = rub(cashShifts.reduce((sum, shift) => sum + cents(shift.cashOrdersTotalCents), 0));
  const cardGross = rub(cashShifts.reduce((sum, shift) => sum + cents(shift.cardOrdersTotalCents), 0));
  const fallbackPaidRevenue = cashShifts.length > 0 ? cashIncome + cardGross : revenue;
  const paidRevenue = Math.min(revenue, fallbackPaidRevenue);
  const unpaidRevenue = Math.max(0, revenue - paidRevenue);

  const acquiringRate = 2;
  const acquiringConfigured = true;
  const acquiringCommission = acquiringConfigured ? Math.round(cardGross * acquiringRate) / 100 : 0;
  const acquiringNet = Math.max(0, cardGross - acquiringCommission);

  const payrollEmployees = Object.entries(payroll.byLogin)
    .map(([login, row]) => ({
      login,
      name: payrollName(login),
      accrued: rub(row.totalCents),
      paid: rub(row.paidOutCents),
      remaining: rub(row.remainingCents),
      shifts: row.shiftsCount,
    }))
    .sort((a, b) => b.accrued - a.accrued);
  const payrollAccrued = payrollEmployees.reduce((sum, row) => sum + row.accrued, 0);
  const payrollPaid = payrollEmployees.reduce((sum, row) => sum + row.paid, 0);
  const payrollRemaining = payrollEmployees.reduce((sum, row) => sum + row.remaining, 0);
  const payrollFixed = rub(Object.values(payroll.byLogin).reduce((sum, row) => sum + row.shiftTotalCents, 0));
  const payrollPiecework = rub(Object.values(payroll.byLogin).reduce((sum, row) => sum + row.pieceworkCents, 0));
  const payrollBonusPenalty = rub(Object.values(payroll.byLogin).reduce((sum, row) => sum + row.bonusPenaltyCents, 0));

  const variableExpenseOrders = sumRows(expenseRows, (row) => row.group === "variable" && row.affectsProfit && row.categoryId !== "bank");
  const fixedExpenseOrders = sumRows(expenseRows, (row) => row.group === "fixed" && row.affectsProfit);
  const otherExpenseOrders = sumRows(expenseRows, (row) => row.group === "other" && row.affectsProfit);
  const taxPaid = sumRows(expenseRows, (row) => row.group === "tax" && row.affectsCashflow);
  const purchaseCashflowFromOrders = sumRows(expenseRows, (row) => row.group === "purchase" && row.affectsCashflow);
  const ordinaryExpenseCashflow = sumRows(expenseRows, (row) => row.affectsCashflow && row.group !== "payroll");

  const supplierPaymentsWithoutCashOrder = supplierInvoices.flatMap((invoice) => invoice.payments)
    .filter((payment) => payment.paymentDate >= dateFrom && payment.paymentDate <= dateTo && !payment.cashExpenseOrderId)
    .reduce((sum, payment) => sum + rub(payment.amountCents), 0);
  const paidToSuppliers = supplierInvoices.reduce((sum, invoice) => sum + rub(invoice.paidAmountCents), 0);
  const unpaidToSuppliers = supplierInvoices.reduce((sum, invoice) => sum + Math.max(0, rub(invoice.sumCents - invoice.paidAmountCents)), 0);
  const purchasesCashflow = purchaseCashflowFromOrders + supplierPaymentsWithoutCashOrder;

  const taxRate = parseTaxRate(selectedOrganization?.taxSystem);
  const taxConfigured = taxRate != null;
  const taxBaseMode = taxBasis(selectedOrganization?.taxSystem);
  const taxBase = taxConfigured
    ? taxBaseMode === "profit"
      ? Math.max(0, grossProfit - variableExpenseOrders - fixedExpenseOrders - payrollAccrued - acquiringCommission)
      : taxBaseMode === "fixed"
        ? null
        : revenue
    : null;
  const calculatedTax = taxConfigured && taxBase != null ? Math.round(taxBase * taxRate) / 100 : null;
  const taxRemaining = calculatedTax == null ? null : Math.max(0, calculatedTax - taxPaid);

  const operatingBeforeFixed = grossProfit - variableExpenseOrders - acquiringCommission - payrollAccrued - writeoffLoss;
  const operatingProfit = operatingBeforeFixed - fixedExpenseOrders;
  const knownNetProfit = operatingProfit - otherExpenseOrders - (calculatedTax ?? 0);
  const revenueForView = calculationMode === "payment" ? paidRevenue : revenue;

  const pnlRows = [
    financeRow({ id: "revenue", label: "Выручка", amount: revenueForView, ratio: null, change: null, level: 0, kind: "income", tab: "documents", description: calculationMode === "payment" ? "Оплаченная выручка по кассе и эквайрингу." : "Проведённые отгрузки за период." }, revenueForView),
    financeRow({ id: "returns", label: "Возвраты", amount: 0, ratio: 0, change: null, level: 1, kind: "expense", tab: "documents", description: "Возвраты будут показаны отдельной строкой после появления таких документов." }, revenueForView),
    financeRow({ id: "net-revenue", label: "Чистая выручка", amount: revenueForView, ratio: 100, change: null, level: 0, kind: "subtotal", tab: "documents", description: "Выручка минус возвраты." }, revenueForView),
    financeRow({ id: "cogs", label: "Себестоимость продаж", amount: -cogs, ratio: safeRatio(cogs, revenueForView), change: null, level: 1, kind: "expense", tab: "purchases", description: "Товары становятся расходом P&L только при продаже, не в момент закупки на склад." }, revenueForView),
    financeRow({ id: "gross-profit", label: "Валовая прибыль", amount: grossProfit, ratio: safeRatio(grossProfit, knownRevenue || revenueForView), change: null, level: 0, kind: "subtotal", tab: "pnl", description: "Выручка с известной себестоимостью минус себестоимость продаж." }, revenueForView),
    financeRow({ id: "variable-expenses", label: "Переменные расходы", amount: -variableExpenseOrders, ratio: safeRatio(variableExpenseOrders, revenueForView), change: null, level: 1, kind: "expense", tab: "expenses", description: "Расходники, доставка и комиссии, привязанные к обороту." }, revenueForView),
    financeRow({ id: "acquiring", label: "Эквайринг", amount: -acquiringCommission, ratio: safeRatio(acquiringCommission, revenueForView), change: null, level: 1, kind: "expense", tab: "acquiring", description: "Комиссия по карточным оплатам. В cashflow показывается сумма к зачислению." }, revenueForView),
    financeRow({ id: "payroll", label: "Зарплата", amount: -payrollAccrued, ratio: safeRatio(payrollAccrued, revenueForView), change: null, level: 1, kind: "expense", tab: "payroll", description: "В P&L учитывается начисленная зарплата. Выплата не списывает прибыль второй раз." }, revenueForView),
    financeRow({ id: "writeoffs", label: "Обычные списания", amount: -writeoffLoss, ratio: safeRatio(writeoffLoss, revenueForView), change: null, level: 1, kind: "expense", tab: "problems", description: "Технические корректировки исключены из управленческой прибыли." }, revenueForView),
    financeRow({ id: "before-fixed", label: "Операционная прибыль до постоянных", amount: operatingBeforeFixed, ratio: safeRatio(operatingBeforeFixed, revenueForView), change: null, level: 0, kind: "subtotal", tab: "pnl", description: "Валовая прибыль после переменных расходов, эквайринга, зарплаты и списаний." }, revenueForView),
    financeRow({ id: "fixed-expenses", label: "Постоянные расходы", amount: -fixedExpenseOrders, ratio: safeRatio(fixedExpenseOrders, revenueForView), change: null, level: 1, kind: "expense", tab: "expenses", description: "Аренда, сервисы, связь и другие регулярные расходы." }, revenueForView),
    financeRow({ id: "operating-profit", label: "Операционная прибыль / EBITDA", amount: operatingProfit, ratio: safeRatio(operatingProfit, revenueForView), change: null, level: 0, kind: "subtotal", tab: "pnl", description: "Прибыль до налогов и прочих расходов." }, revenueForView),
    financeRow({ id: "taxes", label: "Налоги", amount: calculatedTax == null ? null : -calculatedTax, ratio: calculatedTax == null ? null : safeRatio(calculatedTax, revenueForView), change: null, level: 1, kind: calculatedTax == null ? "warning" : "expense", tab: "taxes", description: calculatedTax == null ? "Налоговая ставка не настроена, строка не считается как ноль." : "Налог рассчитан по настройке организации." }, revenueForView),
    financeRow({ id: "other-expenses", label: "Прочие расходы", amount: -otherExpenseOrders, ratio: safeRatio(otherExpenseOrders, revenueForView), change: null, level: 1, kind: "expense", tab: "expenses", description: "Расходы без отдельной управленческой статьи." }, revenueForView),
    financeRow({ id: "net-profit", label: calculatedTax == null ? "Чистая прибыль по известным данным" : "Чистая прибыль", amount: knownNetProfit, ratio: safeRatio(knownNetProfit, revenueForView), change: null, level: 0, kind: "total", tab: "pnl", description: calculatedTax == null ? "Налоги требуют настройки, поэтому это не финальная чистая прибыль." : "Управленческая прибыль после налогов и прочих расходов." }, revenueForView),
  ];

  const beginningBalance = cashShifts.length > 0 ? rub(cashShifts[0].openingCashCents) : 0;
  const incoming = cashIncome + acquiringNet;
  const outgoing = ordinaryExpenseCashflow + payrollPaid + supplierPaymentsWithoutCashOrder;
  const netFlow = incoming - outgoing;
  const endingBalance = beginningBalance + netFlow;
  const cashflowLines: FinanceCashflowLine[] = [
    { id: "begin", label: "Начальный остаток", amount: beginningBalance, display: money(beginningBalance), group: "summary", description: "Остаток кассы на начало периода по первой кассовой смене." },
    { id: "cash", label: "Наличные оплаты", amount: cashIncome, display: money(cashIncome), group: "incoming", description: "Фактические наличные поступления." },
    { id: "card", label: "Эквайринг к зачислению", amount: acquiringNet, display: money(acquiringNet), group: "incoming", description: "Карточные оплаты за вычетом комиссии." },
    { id: "purchases", label: "Закупки и поставщики", amount: -purchasesCashflow, display: money(-purchasesCashflow), group: "outgoing", description: "Денежный отток на закупки. В P&L попадёт как себестоимость только при продаже." },
    { id: "payroll", label: "Зарплатные выплаты", amount: -payrollPaid, display: money(-payrollPaid), group: "outgoing", description: "Фактически выплаченная зарплата." },
    { id: "expenses", label: "Расходные ордера", amount: -(ordinaryExpenseCashflow - purchasesCashflow), display: money(-(ordinaryExpenseCashflow - purchasesCashflow)), group: "outgoing", description: "Расходы, влияющие на движение денег." },
    { id: "net", label: "Чистый денежный поток", amount: netFlow, display: money(netFlow), group: "summary", description: "Поступления минус расходы." },
    { id: "end", label: "Конечный остаток", amount: endingBalance, display: money(endingBalance), group: "summary", description: "Начальный остаток плюс чистый денежный поток." },
  ];

  const expenseTotal = variableExpenseOrders + fixedExpenseOrders + otherExpenseOrders + acquiringCommission + payrollAccrued + writeoffLoss + (calculatedTax ?? 0);
  const byCategoryMap = new Map<string, { id: string; name: string; group: FinanceExpenseCategory["group"]; amount: number }>();
  for (const row of expenseRows) {
    const current = byCategoryMap.get(row.categoryId) ?? { id: row.categoryId, name: row.categoryName, group: row.group, amount: 0 };
    current.amount += row.amount;
    byCategoryMap.set(row.categoryId, current);
  }
  for (const synthetic of [
    { id: "payroll", name: "Зарплата по начислению", group: "payroll" as const, amount: payrollAccrued },
    { id: "acquiring", name: "Эквайринг расчётный", group: "variable" as const, amount: acquiringCommission },
    { id: "writeoffs", name: "Обычные списания", group: "variable" as const, amount: writeoffLoss },
  ]) {
    const current = byCategoryMap.get(synthetic.id) ?? synthetic;
    current.amount += byCategoryMap.has(synthetic.id) ? synthetic.amount : 0;
    byCategoryMap.set(synthetic.id, current);
  }
  const byCategory = [...byCategoryMap.values()]
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .map((row) => ({ ...row, displayAmount: money(row.amount), share: safeRatio(row.amount, Math.max(1, expenseTotal)) ?? 0 }));

  const grossMarginPercent = safeRatio(grossProfit, knownRevenue || revenueForView);
  const variableLoadPercent = safeRatio(variableExpenseOrders + acquiringCommission + writeoffLoss, revenueForView) ?? 0;
  const contributionMarginPercent = grossMarginPercent == null ? null : Math.max(0, grossMarginPercent - variableLoadPercent);
  const fixedForBreakEven = fixedExpenseOrders + payrollFixed;
  const monthlyBreakEven = contributionMarginPercent && contributionMarginPercent > 0
    ? fixedForBreakEven / (contributionMarginPercent / 100)
    : null;
  const dailyBreakEven = monthlyBreakEven == null ? null : monthlyBreakEven / Math.max(1, periodDays);
  const shipmentsPerDay = dailyBreakEven == null || !averageTicket ? null : dailyBreakEven / averageTicket;
  const safetyMargin = monthlyBreakEven == null ? null : revenue - monthlyBreakEven;

  const forecastRevenue = revenue / elapsed * periodDays;
  const forecastGrossProfit = grossProfit / elapsed * periodDays;
  const forecastNetProfit = knownNetProfit / elapsed * periodDays;
  const planRevenue = Math.max(1_500_000, Math.ceil((monthlyBreakEven ?? revenue * 1.1) / 50_000) * 50_000);
  const planGrossProfit = Math.round(planRevenue * ((grossMarginPercent ?? 45) / 100));
  const planNetProfit = Math.max(150_000, Math.round(planRevenue * 0.12));
  const planShipments = Math.max(1, Math.round(planRevenue / Math.max(averageTicket ?? 7_500, 1)));
  const remainingDays = Math.max(1, periodDays - elapsed);
  const dailyRevenueRequired = Math.max(0, (planRevenue - revenue) / remainingDays);

  const taxWarning = taxConfigured ? null : "Налоговая ставка не настроена. Система не считает налоги молча как 0.";
  const problems: FinanceProblem[] = [
    ...finance.issues.map((issue) => ({
      id: issue.id,
      severity: issue.severity,
      title: issue.title,
      description: issue.description,
      amount: issue.amount,
      displayAmount: money(issue.amount),
      href: issue.documentHref ?? (issue.productId ? `/inventory/products?product=${encodeURIComponent(issue.productId)}` : null),
      action: "Исправить источник",
      source: "Себестоимость и склад",
    })),
    ...expenseRows
      .filter((row) => row.categoryId === "other" || !row.categoryName)
      .slice(0, 25)
      .map((row) => ({
        id: `expense-category:${row.id}`,
        severity: "warning" as const,
        title: "Расход без точной категории",
        description: `${row.number}: ${row.comment || row.counterparty}. Проверьте статью P&L и cashflow.`,
        amount: row.amount,
        displayAmount: row.displayAmount,
        href: row.href,
        action: "Назначить категорию",
        source: "Расходные ордера",
      })),
    ...(taxWarning ? [{
      id: "tax-not-configured",
      severity: "danger" as const,
      title: "Налоговая ставка не настроена",
      description: taxWarning,
      amount: null,
      displayAmount: "Не настроено",
      href: null,
      action: "Открыть настройки налогов",
      source: "Налоги",
    }] : []),
    ...(cardGross > 0 && !acquiringConfigured ? [{
      id: "acquiring-not-configured",
      severity: "danger" as const,
      title: "Эквайринг не настроен",
      description: "Есть карточные оплаты, но нет настройки провайдера и комиссии.",
      amount: cardGross,
      displayAmount: money(cardGross),
      href: null,
      action: "Настроить эквайринг",
      source: "Эквайринг",
    }] : []),
  ].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "danger" ? -1 : 1;
    return (b.amount ?? 0) - (a.amount ?? 0);
  });

  const canClose = problems.filter((problem) => problem.severity === "danger").length === 0;
  const documents = [
    ...financialDocumentsFromInventory(finance),
    ...expenseRows.map((row) => ({
      id: `expense:${row.id}`,
      date: row.date,
      type: "Расходный ордер",
      number: row.number,
      counterparty: row.counterparty,
      category: row.categoryName,
      amount: -row.amount,
      displayAmount: money(-row.amount),
      status: row.source,
      affectsProfit: row.affectsProfit,
      affectsCashflow: row.affectsCashflow,
      href: row.href,
    })),
    ...payroll.cashoutHistory.slice(0, 100).map((row) => ({
      id: `payroll:${row.cashoutId}`,
      date: row.date,
      type: "Выплата зарплаты",
      number: row.name,
      counterparty: row.agentName,
      category: row.operationType ?? "SALARY",
      amount: -rub(row.sumCents),
      displayAmount: money(-rub(row.sumCents)),
      status: row.paymentMethod ?? "cash",
      affectsProfit: false,
      affectsCashflow: true,
      href: row.cashOrderId ? `/cash?expense=${encodeURIComponent(row.cashOrderId)}` : "/salary",
    })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 700);

  const metrics: FinanceMetric[] = [
    { id: "revenue", label: calculationMode === "payment" ? "Оплаченная выручка" : "Выручка", value: revenueForView, display: money(revenueForView), sub: calculationMode === "payment" ? `${money(unpaidRevenue)} ещё не оплачено` : `${demandsCount} отгрузок за период`, tone: "neutral", tab: "pnl" },
    { id: "gross", label: "Валовая прибыль", value: grossProfit, display: money(grossProfit), sub: `Маржа ${percent(grossMarginPercent)}`, tone: grossProfit >= 0 ? "success" : "danger", tab: "pnl" },
    { id: "net", label: calculatedTax == null ? "Прибыль по известным данным" : "Чистая прибыль", value: knownNetProfit, display: money(knownNetProfit), sub: calculatedTax == null ? "налоги требуют настройки" : `Рентабельность ${percent(safeRatio(knownNetProfit, revenueForView))}`, tone: knownNetProfit >= 0 ? "success" : "danger", tab: "pnl" },
    { id: "cash", label: "Деньги на руках", value: endingBalance, display: money(endingBalance), sub: `Чистый поток ${money(netFlow)}`, tone: endingBalance >= 0 ? "info" : "danger", tab: "cashflow" },
    { id: "expenses", label: "Расходы", value: expenseTotal, display: money(expenseTotal), sub: `Фикс ${money(fixedExpenseOrders)} · перем ${money(variableExpenseOrders)}`, tone: "warning", tab: "expenses" },
    { id: "break-even", label: "Точка безубыточности", value: monthlyBreakEven, display: money(monthlyBreakEven), sub: dailyBreakEven == null ? "нужны данные по марже" : `${money(dailyBreakEven)} в день`, tone: revenue >= (monthlyBreakEven ?? Infinity) ? "success" : "warning", tab: "breakEven" },
    { id: "forecast", label: "Прогноз месяца", value: forecastRevenue, display: money(forecastRevenue), sub: forecastRevenue >= planRevenue ? "выше плана по текущему темпу" : `нужно ${money(dailyRevenueRequired)} в день`, tone: forecastRevenue >= planRevenue ? "success" : "warning", tab: "planFact" },
    { id: "problems", label: "Проблемы учёта", value: problems.length, display: String(problems.length), sub: `${problems.filter((problem) => problem.severity === "danger").length} критичных`, tone: problems.some((problem) => problem.severity === "danger") ? "danger" : problems.length ? "warning" : "success", tab: "problems" },
  ];

  const managerMetrics = [
    metrics[0],
    { id: "paid", label: "Получено денег", value: paidRevenue, display: money(paidRevenue), sub: `не оплачено ${money(unpaidRevenue)}`, tone: "info" as const, tab: "cashflow" as const },
    { id: "today-expenses", label: "Расходы периода", value: ordinaryExpenseCashflow + payrollPaid, display: money(ordinaryExpenseCashflow + payrollPaid), sub: "по фактическим выплатам", tone: "warning" as const, tab: "expenses" as const },
    { id: "salary-due", label: "Зарплата к выплате", value: payrollRemaining, display: money(payrollRemaining), sub: "начислено минус выплачено", tone: payrollRemaining > 0 ? "warning" as const : "success" as const, tab: "payroll" as const },
    { id: "plan-left", label: "До плана", value: Math.max(0, planRevenue - revenue), display: money(Math.max(0, planRevenue - revenue)), sub: `${money(dailyRevenueRequired)} в день`, tone: revenue >= planRevenue ? "success" as const : "warning" as const, tab: "planFact" as const },
    metrics[7],
  ];

  return {
    period: {
      dateFrom,
      dateTo,
      days: periodDays,
      elapsedDays: elapsed,
      calculatedAt: finance.calculatedAt,
      calculationMode,
      closed: false,
      snapshotStatus: canClose ? "ready_to_close" : "blocked",
      sourceNote: "P&L строится по начислению, cashflow — по фактическому движению денег. Закупки на склад не уменьшают прибыль до продажи.",
    },
    filters: {
      organizations: organizations.map(({ id, name, isDefault }) => ({ id, name, isDefault })),
      warehouses,
    },
    permissions: {
      manager: ["finance.view", "finance.cashflow.view", "finance.expenses.manage"],
      cfo: ACCESS_RIGHTS,
      owner: ACCESS_RIGHTS,
    },
    metrics,
    managerMetrics,
    pnl: {
      rows: pnlRows,
      revenue: revenueForView,
      paidRevenue,
      unpaidRevenue,
      grossProfit,
      operatingProfit,
      knownNetProfit,
      taxConfigured,
    },
    cashflow: {
      beginningBalance,
      incoming,
      outgoing,
      endingBalance,
      netFlow,
      lines: cashflowLines,
    },
    expenses: {
      total: expenseTotal,
      fixed: fixedExpenseOrders,
      variable: variableExpenseOrders + writeoffLoss,
      payrollAccrued,
      payrollPaid,
      taxes: calculatedTax,
      acquiring: acquiringCommission,
      purchasesCashflow,
      categories: EXPENSE_CATEGORIES,
      rows: expenseRows,
      byCategory,
    },
    taxes: {
      configured: taxConfigured,
      organizationName: selectedOrganization?.name ?? "Все организации",
      regime: selectedOrganization?.taxSystem ?? "Не настроено",
      basis: taxBaseMode,
      rate: taxRate,
      base: taxBase,
      calculated: calculatedTax,
      paid: taxPaid,
      remaining: taxRemaining,
      dueDate: addDays(dateTo, 25),
      warning: taxWarning,
    },
    acquiring: {
      configured: acquiringConfigured,
      provider: "Базовая настройка эквайринга",
      percentRate: acquiringRate,
      fixedFee: 0,
      grossCardPayments: cardGross,
      commission: acquiringCommission,
      netToSettle: acquiringNet,
      expectedSettlementDate: cardGross > 0 ? addDays(dateTo, 1) : null,
      status: cardGross > 0 ? "awaiting" : "settled",
      operations: cashShifts
        .filter((shift) => cents(shift.cardOrdersTotalCents) > 0)
        .map((shift) => {
          const amount = rub(shift.cardOrdersTotalCents);
          const commission = Math.round(amount * acquiringRate) / 100;
          return {
            id: shift.id,
            date: shift.serviceDate,
            label: `Карточные оплаты ${shift.serviceDate}`,
            amount,
            commission,
            net: Math.max(0, amount - commission),
            status: "awaiting" as const,
          };
        }),
    },
    payroll: {
      accrued: payrollAccrued,
      paid: payrollPaid,
      remaining: payrollRemaining,
      fixed: payrollFixed,
      piecework: payrollPiecework,
      bonusPenalty: payrollBonusPenalty,
      percentOfRevenue: safeRatio(payrollAccrued, revenueForView),
      employees: payrollEmployees,
      payments: payroll.cashoutHistory,
    },
    purchases: {
      receiptValue,
      paidToSuppliers,
      unpaidToSuppliers,
      inventoryPurchaseCashflow: purchasesCashflow,
      invoices: supplierInvoices.map((invoice) => ({
        id: invoice.id,
        number: invoice.number ?? invoice.document.name,
        supplier: invoice.counterpartyNameSnapshot ?? invoice.document.counterpartyNameSnapshot ?? "Поставщик не указан",
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        sum: rub(invoice.sumCents),
        paid: rub(invoice.paidAmountCents),
        remaining: Math.max(0, rub(invoice.sumCents - invoice.paidAmountCents)),
        status: invoice.status,
        href: `/finance/invoices?invoice=${encodeURIComponent(invoice.id)}`,
      })),
    },
    breakEven: {
      fixedExpenses: fixedForBreakEven,
      contributionMarginPercent,
      monthlyRevenue: monthlyBreakEven,
      dailyRevenue: dailyBreakEven,
      shipmentsPerDay,
      averageTicket,
      safetyMargin,
      progressPercent: monthlyBreakEven == null ? null : safeRatio(revenue, monthlyBreakEven),
      leftToZero: monthlyBreakEven == null ? null : Math.max(0, monthlyBreakEven - revenue),
      formulas: [
        "Точка безубыточности = постоянные расходы / маржа после переменных расходов",
        "Выручка в день = точка безубыточности / дней в периоде",
        "Отгрузок в день = выручка в день / средний чек",
        "Закупка на склад влияет на cashflow сразу, но в P&L становится себестоимостью только при продаже",
      ],
    },
    planFact: {
      rows: [
        { id: "revenue", label: "Выручка", plan: planRevenue, fact: revenue, forecast: forecastRevenue, deviation: revenue - (planRevenue / periodDays * elapsed), status: forecastRevenue >= planRevenue ? "above" : "risk" },
        { id: "gross", label: "Валовая прибыль", plan: planGrossProfit, fact: grossProfit, forecast: forecastGrossProfit, deviation: forecastGrossProfit - planGrossProfit, status: forecastGrossProfit >= planGrossProfit ? "above" : "risk" },
        { id: "net", label: "Чистая прибыль", plan: planNetProfit, fact: knownNetProfit, forecast: forecastNetProfit, deviation: forecastNetProfit - planNetProfit, status: forecastNetProfit >= planNetProfit ? "above" : "below" },
        { id: "shipments", label: "Отгрузки", plan: planShipments, fact: demandsCount, forecast: demandsCount / elapsed * periodDays, deviation: (demandsCount / elapsed * periodDays) - planShipments, status: (demandsCount / elapsed * periodDays) >= planShipments ? "above" : "risk" },
      ],
      forecastRevenue,
      forecastGrossProfit,
      forecastNetProfit,
      dailyRevenueRequired,
      risk: forecastNetProfit < 0 ? "Есть риск не выйти в плюс по текущему темпу и расходам." : null,
    },
    documents,
    problems,
    exportReports: [
      { id: "pnl", label: "P&L за период", formats: ["CSV", "Excel", "PDF", "Печать"], description: "Управленческая прибыль с расшифровками." },
      { id: "cashflow", label: "Cashflow", formats: ["CSV", "Excel"], description: "Поступления, расходы и остатки денег." },
      { id: "expenses", label: "Расходы", formats: ["CSV", "Excel"], description: "Расходные ордера и категории." },
      { id: "taxes", label: "Налоговый расчёт", formats: ["PDF", "Печать"], description: "База, ставка, оплачено и остаток." },
      { id: "payroll", label: "Зарплата", formats: ["CSV", "Excel"], description: "Начислено, выплачено, к выплате." },
    ],
    settings: {
      expenseCategories: EXPENSE_CATEGORIES,
      taxSettings: {
        configured: taxConfigured,
        organizationName: selectedOrganization?.name ?? "Все организации",
        regime: selectedOrganization?.taxSystem ?? "Не настроено",
        basis: taxBaseMode,
        rate: taxRate,
        base: taxBase,
        calculated: calculatedTax,
        paid: taxPaid,
        remaining: taxRemaining,
        dueDate: addDays(dateTo, 25),
        warning: taxWarning,
      },
      acquiringSettings: {
        configured: acquiringConfigured,
        provider: "Базовая настройка эквайринга",
        percentRate: acquiringRate,
        fixedFee: 0,
      },
      fixedExpenses: EXPENSE_CATEGORIES
        .filter((category) => category.group === "fixed")
        .map((category) => ({
          id: category.id,
          title: category.name,
          amount: sumRows(expenseRows, (row) => row.categoryId === category.id),
          periodicity: "ежемесячно",
          nextPaymentDate: addDays(dateTo, 7),
          categoryId: category.id,
          includeInBreakEven: true,
        })),
      influenceRules: [
        { operation: "Закупка товара на склад", profit: "Нет до продажи", cashflow: "Да", note: "Станет себестоимостью при продаже." },
        { operation: "Зарплата начислена", profit: "Да", cashflow: "Нет", note: "Попадает в P&L по начислению." },
        { operation: "Зарплата выплачена", profit: "Нет повторно", cashflow: "Да", note: "Не уменьшает прибыль второй раз." },
        { operation: "Техническая корректировка", profit: "Нет", cashflow: "Нет", note: "Меняет остатки, но не финансовый результат." },
        { operation: "Обычное списание", profit: "Да", cashflow: "Нет", note: "Уменьшает управленческую прибыль." },
      ],
      accessRights: ACCESS_RIGHTS,
    },
    legacy: {
      profitUrl: "/finance/profit",
      invoicesUrl: "/finance/invoices",
      cashUrl: "/cash",
      salaryUrl: "/salary",
    },
  };
}

export function financeSlice(report: string, data: FinanceCenterResult) {
  const normalized = report.trim().toLowerCase();
  if (normalized === "overview") return data;
  if (normalized === "pnl") return { period: data.period, pnl: data.pnl, documents: data.documents };
  if (normalized === "cashflow") return { period: data.period, cashflow: data.cashflow };
  if (normalized === "expenses") return { period: data.period, expenses: data.expenses };
  if (normalized === "expense-categories") return { categories: data.expenses.categories };
  if (normalized === "taxes") return { period: data.period, taxes: data.taxes };
  if (normalized === "acquiring") return { period: data.period, acquiring: data.acquiring };
  if (normalized === "fixed-expenses") return { fixedExpenses: data.settings.fixedExpenses };
  if (normalized === "break-even") return { period: data.period, breakEven: data.breakEven };
  if (normalized === "plan-fact") return { period: data.period, planFact: data.planFact };
  if (normalized === "problems") return { period: data.period, problems: data.problems };
  if (normalized === "documents") return { period: data.period, documents: data.documents };
  if (normalized === "export") return { period: data.period, reports: data.exportReports };
  return null;
}
