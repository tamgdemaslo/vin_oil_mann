import { prisma } from "@/lib/db";
import { listPayrollEmployees } from "@/lib/payroll-employees";
import { employedOn, selectPieceworkRecipients } from "@/lib/employee-pay-settings";
import { getShiftRateCents } from "@/lib/shift-rates";
import { canonicalizeLogin, getLoginVariants } from "@/lib/auth";
import { listPayrollAdjustments, listPayrollPayments } from "@/lib/payroll-settlements";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { calculateLineFinancials } from "@/lib/inventory-costing";
import { payrollCashoutPeriodOverlaps, resolvePayrollCashoutPeriod } from "@/lib/payroll-cashout-period";
import {
  calculatePieceworkAmountCents,
  extractLocalEntityId,
  getPieceworkRuleMap,
  resolvePieceworkRule,
} from "@/lib/piecework-rules";

const payrollCache = new Map<
  string,
  { promise?: Promise<PayrollSummary> }
>();

export function invalidatePayrollCache() {
  payrollCache.clear();
}

function normalizeLogin(login: string): string {
  return canonicalizeLogin(login).trim().toLowerCase();
}

function normalizePersonName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

const PAYROLL_CASHOUT_AGENT_ALIASES: { login: string; names: string[] }[] = [
  {
    login: "vadim",
    names: [
      "Бигожин Вадим",
      "Бигожин Вадим Андреевич",
      "Вадим Бигожин",
      "Вадим Андреевич Бигожин",
    ],
  },
  {
    login: "maksim",
    names: [
      "Лобов Максим",
      "Максим Лобов",
    ],
  },
];

const PAYROLL_CASHOUT_AGENT_TO_LOGIN = new Map(
  PAYROLL_CASHOUT_AGENT_ALIASES.flatMap((item) =>
    item.names.map((name) => [normalizePersonName(name), item.login] as const)
  )
);

type PositionRow = {
  positionId?: string;
  assortment: {
    meta: { href: string; type: string };
    name?: string;
    pathName?: string;
    /** Immutable group snapshot from the shipment position. */
    groupId?: string;
    buyPrice?: { value?: number };
    salePrices?: { value?: number }[];
  };
  quantity: number;
  price: number;
  discount: number;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value != null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Imported shipment rows may not have productId in the relational column, but
 * still retain the local product href/id inside `raw`. That id is a valid
 * legacy recovery key; a display name is deliberately never used for payroll.
 */
function positionProductReferenceIds(position: { productId: string | null; raw: unknown }) {
  const ids = new Set<string>();
  const addId = (value: unknown) => {
    const text = textValue(value);
    if (!text) return;
    if (text.includes("://")) {
      const id = extractLocalEntityId(text);
      if (id) ids.add(id);
      return;
    }
    ids.add(text);
  };

  addId(position.productId);
  const raw = recordValue(position.raw);
  const assortment = recordValue(raw?.assortment);
  const product = recordValue(raw?.product);
  const meta = recordValue(assortment?.meta);
  for (const value of [
    raw?.productId,
    raw?.assortmentId,
    raw?.assortmentReference,
    raw?.href,
    assortment?.id,
    assortment?.productId,
    product?.id,
    meta?.href,
  ]) {
    addId(value);
  }
  return [...ids];
}

type DemandRow = {
  id: string;
  name: string;
  moment: string;
  sum: number;
  agent?: { name?: string };
};

type CashoutRow = {
  id: string;
  name: string;
  moment: string;
  sum: number;
  applicable: boolean;
  periodFrom: string;
  periodTo: string;
  employeeLogin?: string | null;
  paymentPurpose?: string;
  description?: string;
  agent?: { name?: string };
  expenseItem?: { name?: string };
};

type StaffingMember = { login: string; role: "master" | "admin" };
type PieceworkBreakdownEntry = {
  positionId?: string;
  targetId?: string;
  targetType?: "service" | "product_group";
  category: "work" | "product";
  label: string;
  quantity: number;
  amountCents: number;
  ruleLabel: string;
  basisLabel: string;
  status: "PRELIMINARY";
};

function formatRuleAmountLabel(rule: {
  mode: "fixed" | "percent";
  fixedCents: number | null;
  percentBasisPoints: number | null;
}) {
  if (rule.mode === "fixed") {
    return `Фиксированно ${Math.round((rule.fixedCents ?? 0) / 100).toLocaleString("ru-RU")} ₽`;
  }

  const percent = (rule.percentBasisPoints ?? 0) / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2)}%`;
}

function isSalaryCashout(row: CashoutRow) {
  const expenseItemName = normalizePersonName(row.expenseItem?.name ?? "");
  const paymentPurpose = normalizePersonName(row.paymentPurpose ?? "");
  return (
    expenseItemName.includes("зарплата") ||
    expenseItemName.includes("аванс") ||
    paymentPurpose.includes("зарплата") ||
    paymentPurpose.includes("аванс")
  );
}

function resolvePayrollCashoutLogin(agentName: string) {
  const normalized = normalizePersonName(agentName);
  if (normalized.length < 3) return undefined;
  const exact = PAYROLL_CASHOUT_AGENT_TO_LOGIN.get(normalized);
  if (exact) return exact;

  return PAYROLL_CASHOUT_AGENT_ALIASES.find((item) =>
    item.names.some((name) => {
      const alias = normalizePersonName(name);
      return normalized.includes(alias) || alias.includes(normalized);
    })
  )?.login;
}

/** Получить отгрузки за период и позиции с расширенным assortment */
async function fetchDemandsWithPositions(
  dateFrom: string,
  dateTo: string
): Promise<{ demand: DemandRow; positions: PositionRow[] }[]> {
  return fetchLocalDemandsWithPositions(dateFrom, dateTo);
}

async function fetchPayrollCashouts(dateFrom: string, dateTo: string): Promise<CashoutRow[]> {
  return fetchLocalPayrollCashouts(dateFrom, dateTo);
}

async function fetchLocalDemandsWithPositions(
  dateFrom: string,
  dateTo: string
): Promise<{ demand: DemandRow; positions: PositionRow[] }[]> {
  const branchId = getScopedBranchId();
  const demands = await prisma.localDemand.findMany({
    where: {
      branchId,
      documentDate: { gte: dateFrom, lte: dateTo },
      applicable: true,
    },
    include: {
      counterparty: true,
      positions: { include: { product: true, groupSnapshot: true }, orderBy: { id: "asc" } },
    },
    orderBy: { momentAt: "asc" },
  });

  // Old imported positions can lose their relational product link. Their raw
  // local product id/href remains a safe recovery key. Names are not used: two
  // identical captions must never cause payroll to select a group by text.
  const unresolvedPositions = demands.flatMap((demand) => demand.positions)
    .filter((position) =>
      position.assortmentType !== "nonstock_product" &&
      !position.groupIdSnapshot &&
      !position.product?.groupId
    );
  const unresolvedProductIds = [...new Set(
    unresolvedPositions.flatMap((position) => positionProductReferenceIds(position))
  )];
  const fallbackProducts = unresolvedProductIds.length
    ? await prisma.localProduct.findMany({
        where: {
          branchId,
          archived: false,
          id: { in: unresolvedProductIds },
        },
        select: {
          id: true,
          entityType: true,
          groupPath: true,
          groupId: true,
          buyPriceCents: true,
        },
      })
    : [];
  const fallbackProductsById = new Map(fallbackProducts.map((product) => [product.id, product]));
  return demands.map((demand) => ({
    demand: {
      id: demand.id,
      name: demand.name,
      moment: demand.momentAt.toISOString(),
      sum: demand.sumCents,
      agent: { name: demand.counterparty?.name ?? demand.agentNameSnapshot ?? "" },
    },
    positions: demand.positions.map((position) => {
      const raw = recordValue(position.raw);
      const oneOffProduct = recordValue(raw?.oneOffProduct);
      const oneOffGroupLabel = textValue(oneOffProduct?.groupLabel);
      const linkedProduct = position.product;
      const candidates = [
        ...positionProductReferenceIds(position)
          .map((id) => fallbackProductsById.get(id))
          .filter((candidate): candidate is (typeof fallbackProducts)[number] => Boolean(candidate)),
      ].filter((candidate, index, all) => all.findIndex((other) => other.id === candidate.id) === index);
      const candidateGroupIds = new Set(candidates.map((candidate) => candidate.groupId).filter((groupId): groupId is string => Boolean(groupId)));
      // Prefer an immutable shipment snapshot. For old rows only, recover a
      // group from one unambiguous saved product id — never from a name.
      const product = position.assortmentType === "nonstock_product"
        ? undefined
        : linkedProduct?.groupId
        ? linkedProduct
        : candidateGroupIds.size === 1
        ? candidates[0]
          : linkedProduct ?? (position.assortmentType === "service" && candidates.length === 1 ? candidates[0] : undefined);
      const assortmentType = position.assortmentType ?? product?.entityType ?? "";
      const assortmentId = product?.id ?? position.productId ?? position.id;
      const groupId = position.groupIdSnapshot ?? product?.groupId ?? undefined;
      return {
        positionId: position.id,
        assortment: {
          meta: {
            href: `local://${assortmentType || "product"}/${assortmentId}`,
            type: assortmentType,
          },
          name: position.name,
          pathName: position.groupSnapshot?.name ?? product?.groupPath ?? oneOffGroupLabel ?? undefined,
          groupId,
          buyPrice: {
            value: assortmentType === "service" ? 0 : position.buyPriceCentsPerUnit ?? undefined,
          },
        },
        quantity: position.quantity.toNumber(),
        price: position.priceCentsPerUnit,
        discount: position.discount.toNumber(),
      };
    }),
  }));
}

async function fetchLocalPayrollCashouts(dateFrom: string, dateTo: string): Promise<CashoutRow[]> {
  const branchId = getScopedBranchId();
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        number: string;
        expenseDate: string;
        amountCents: number;
        status: string;
        paymentPurpose: string | null;
        article: string | null;
        comment: string | null;
        counterpartyName: string;
        counterpartyRelationName: string | null;
        expenseItemName: string;
        expenseItemRelationName: string | null;
        employeeId: string | null;
        payrollPeriodFrom: string | null;
        payrollPeriodTo: string | null;
      }>
    >`
      SELECT
        ceo.id,
        ceo.number,
        ceo.expense_date AS "expenseDate",
        ceo.amount_cents AS "amountCents",
        ceo.status,
        ceo.payment_purpose AS "paymentPurpose",
        ceo.article,
        ceo.comment,
        ceo.counterparty_name AS "counterpartyName",
        cp.name AS "counterpartyRelationName",
        ceo.expense_item_name AS "expenseItemName",
        item.name AS "expenseItemRelationName",
        ceo.employee_id AS "employeeId",
        ceo.payroll_period_from AS "payrollPeriodFrom",
        ceo.payroll_period_to AS "payrollPeriodTo"
      FROM cash_expense_orders ceo
      LEFT JOIN local_counterparties cp ON cp.id = ceo.counterparty_id
      LEFT JOIN cash_expense_items item ON item.id = ceo.expense_item_id
      WHERE ceo.branch_id = ${branchId}
        AND (cp.id IS NULL OR cp.branch_id = ${branchId})
        AND (item.id IS NULL OR item.branch_id = ${branchId})
        AND ceo.status = 'posted'
        AND (ceo.source_type IS NULL OR ceo.source_type <> 'PAYROLL_PAYMENT')
        AND LOWER(CONCAT_WS(' ',
          COALESCE(item.name, ceo.expense_item_name),
          COALESCE(ceo.payment_purpose, ceo.article, ceo.comment)
        )) LIKE ANY (ARRAY['%зарплата%', '%аванс%'])
      ORDER BY ceo.expense_date ASC
    `;

    // Read payroll RKO regardless of cash date: August salary can be paid in September.
    return rows.map((row) => ({
      id: row.id,
      name: row.number,
      moment: `${row.expenseDate} 00:00:00`,
      sum: row.amountCents,
      applicable: row.status === "posted",
      ...resolvePayrollCashoutPeriod({
        expenseDate: row.expenseDate,
        payrollPeriodFrom: row.payrollPeriodFrom,
        payrollPeriodTo: row.payrollPeriodTo,
        paymentPurpose: row.paymentPurpose ?? row.article ?? row.comment,
        expenseItemName: row.expenseItemRelationName ?? row.expenseItemName,
      }),
      employeeLogin: row.employeeId,
      paymentPurpose: row.paymentPurpose ?? row.article ?? row.comment ?? "",
      description: row.comment ?? "",
      agent: { name: row.counterpartyRelationName ?? row.counterpartyName ?? "" },
      expenseItem: { name: row.expenseItemRelationName ?? row.expenseItemName ?? "" },
    })).filter((row) => payrollCashoutPeriodOverlaps(row, dateFrom, dateTo));
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("source_type") && !message.includes("undefined_column")) throw error;
  }

  const rows = await prisma.cashExpenseOrder.findMany({
    where: {
      branchId,
      status: "posted",
    },
    select: {
      id: true,
      number: true,
      expenseDate: true,
      amountCents: true,
      status: true,
      paymentPurpose: true,
      article: true,
      comment: true,
      counterpartyName: true,
      expenseItemName: true,
      counterparty: { select: { name: true } },
      expenseItem: { select: { name: true } },
    },
    orderBy: { expenseDate: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.number,
    moment: `${row.expenseDate} 00:00:00`,
    sum: row.amountCents,
    applicable: row.status === "posted",
    ...resolvePayrollCashoutPeriod({
      expenseDate: row.expenseDate,
      paymentPurpose: row.paymentPurpose ?? row.article ?? row.comment,
      expenseItemName: row.expenseItem?.name ?? row.expenseItemName,
    }),
    paymentPurpose: row.paymentPurpose ?? row.article ?? row.comment ?? "",
    description: row.comment ?? "",
    agent: { name: row.counterparty?.name ?? row.counterpartyName ?? "" },
    expenseItem: { name: row.expenseItem?.name ?? row.expenseItemName ?? "" },
  })).filter((row) => payrollCashoutPeriodOverlaps(row, dateFrom, dateTo));
}

function mergeStaffingByDate(params: {
  scheduledDays: { userLogin: string; date: string }[];
  roleByLogin: Map<string, string>;
}) {
  const { scheduledDays, roleByLogin } = params;
  const byDate = new Map<string, StaffingMember[]>();

  for (const day of scheduledDays) {
    const normalized = normalizeLogin(day.userLogin);
    const userRole = roleByLogin.get(normalized);
    const role: "master" | "admin" = userRole === "admin" ? "admin" : "master";
    if (!userRole) continue;
    const list = byDate.get(day.date) ?? [];
    if (!list.some((x) => normalizeLogin(x.login) === normalized)) {
      list.push({ login: day.userLogin, role });
      byDate.set(day.date, list);
    }
  }

  return byDate;
}

/** Дата документа в формате YYYY-MM-DD */
function momentToDate(moment: string): string {
  return moment.slice(0, 10);
}

export type VehicleRecord = {
  demandId: string;
  demandName: string;
  date: string;
  moment: string;
  agentName: string;
  sumCents: number;
  works: { name: string; quantity: number; priceCents: number }[];
  products: { name: string; pathName?: string; quantity: number; priceCents: number }[];
  /** Начисление по этой отгрузке для сотрудников рабочей команды дня */
  earningsByLogin: Record<string, number>;
  /** Детальная расшифровка сдельной части по каждому сотруднику для этой отгрузки */
  pieceworkBreakdownByLogin: Record<string, PieceworkBreakdownEntry[]>;
  /** Позиции, которые не начислены автоматически из-за отсутствующей роли, конфликта или правила */
  unallocatedPiecework: {
    category: "work" | "product";
    label: string;
    quantity: number;
    baseCents: number;
    reason:
      | "missing_master"
      | "multiple_masters"
      | "missing_admin"
      | "multiple_admins"
      | "missing_rule"
      | "missing_cost";
    logins?: string[];
    groupPath?: string;
    ruleTargetId?: string;
    diagnostic?: string;
  }[];
};

export type PayrollSummary = {
  salesPlanBonusIds?: string[];
  dateFrom: string;
  dateTo: string;
  byLogin: Record<
    string,
    {
      shiftTotalCents: number;
      pieceworkCents: number;
      bonusPenaltyCents: number;
      /** Kept separate so a bonus never hides an existing penalty in the UI. */
      bonusCents?: number;
      penaltyCents?: number;
      paidOutCents: number;
      remainingCents: number;
      totalCents: number;
      shiftsCount: number;
    }
  >;
  vehicleHistory: VehicleRecord[];
  cashoutHistory: {
    cashoutId: string;
    name: string;
    date: string;
    agentName: string;
    sumCents: number;
    paymentPurpose: string;
    description: string;
    login: string;
    sourceType?: "cash_expense_order" | "payroll_payment";
    paymentMethod?: string;
    operationType?: string;
    cashOrderId?: string | null;
    paymentId?: string;
    periodFrom?: string;
    periodTo?: string;
    cashDate?: string;
    cashOrderShiftStatus?: string | null;
  }[];
};

/** Расчёт на лету: зарплата и история машин за период */
export async function computePayroll(params: {
  /** Internal recursion guard: the base calculation must not award bonuses. */
  skipSalesPlanBonuses?: boolean;
  dateFrom: string;
  dateTo: string;
  /** для владельца — по всем, для мастера/админа — только свой логин */
  targetLogin?: string;
}): Promise<PayrollSummary> {
  const { dateFrom, dateTo, targetLogin } = params;
  const branchId = getScopedBranchId();
  if (!params.skipSalesPlanBonuses) {
    const { syncSalesPlanBonuses } = await import("@/lib/sales-plan-bonus");
    await syncSalesPlanBonuses(params);
  }
  const normalizedTargetLogin = targetLogin ? normalizeLogin(targetLogin) : undefined;
  const targetLoginVariants = targetLogin ? getLoginVariants(targetLogin) : undefined;
  const targetLoginWhere = targetLoginVariants ? { userLogin: { in: targetLoginVariants } } : {};
  const [
    bonusPenalties,
    payrollAdjustments,
    payrollPayments,
    scheduledShiftsForRates,
    scheduledShiftsForStaffing,
    users,
    pieceworkRuleMap,
  ] = await Promise.all([
    prisma.bonusPenalty.findMany({
      where: {
        date: { gte: dateFrom, lte: dateTo },
        ...targetLoginWhere,
      },
    }),
    listPayrollAdjustments({
      unlimited: true,
      dateFrom,
      dateTo,
      employeeLogin: targetLogin,
    }),
    listPayrollPayments({
      dateFrom,
      dateTo,
      employeeLogin: targetLogin,
    }),
    prisma.scheduledWorkingDay.findMany({
      where: {
        date: { gte: dateFrom, lte: dateTo },
        ...targetLoginWhere,
      },
    }),
    prisma.scheduledWorkingDay.findMany({
      where: {
        date: { gte: dateFrom, lte: dateTo },
      },
    }),
    listPayrollEmployees(branchId!),
    // The rules and shipments must be read from the same active branch. Reading
    // rules via the request branch also avoids a stale cookie context selecting
    // a rule set from another branch.
    getPieceworkRuleMap(branchId),
  ]);

  const demandsWithPositions = await fetchDemandsWithPositions(dateFrom, dateTo);
  const cashouts = await fetchPayrollCashouts(dateFrom, dateTo);

  const employeeByLogin = new Map(users.map((user) => [normalizeLogin(user.login), user]));
  const canonicalLoginByLower = new Map(users.map((u) => [normalizeLogin(u.login), u.login]));
  const roleByLogin = new Map(users.map((u) => [normalizeLogin(u.login), u.role]));
  const nameByLogin = new Map(users.map((u) => [normalizeLogin(u.login), u.name]));
  const activeLogins = new Set(
    users.map((u) => normalizeLogin(u.login))
  );
  const staffingByDate = mergeStaffingByDate({
    scheduledDays: scheduledShiftsForStaffing.filter((shift) => {
      const employee = employeeByLogin.get(normalizeLogin(shift.userLogin));
      return employee && employedOn(employee.settings, shift.date, employee.employmentStart);
    }).map((shift) => ({
      ...shift,
      userLogin: canonicalLoginByLower.get(normalizeLogin(shift.userLogin)) ?? shift.userLogin,
    })),
    roleByLogin,
  });

  const byLogin: PayrollSummary["byLogin"] = {};
  const vehicleHistory: VehicleRecord[] = [];
  const cashoutHistory: PayrollSummary["cashoutHistory"] = [];

  for (const { demand, positions } of demandsWithPositions) {
    const demandDate = momentToDate(demand.moment);
    const onShift = staffingByDate.get(demandDate) ?? [];
    if (normalizedTargetLogin && !onShift.some((x) => normalizeLogin(x.login) === normalizedTargetLogin)) continue;

    const works: VehicleRecord["works"] = [];
    const products: VehicleRecord["products"] = [];
    const earningsByLogin: Record<string, number> = {};
    const pieceworkBreakdownByLogin: VehicleRecord["pieceworkBreakdownByLogin"] = {};
    const unallocatedPiecework: VehicleRecord["unallocatedPiecework"] = [];

    function addPieceworkEntry(
      login: string,
      entry: PieceworkBreakdownEntry
    ) {
      if (!pieceworkBreakdownByLogin[login]) pieceworkBreakdownByLogin[login] = [];
      pieceworkBreakdownByLogin[login].push(entry);
    }

    function addUnallocatedPiecework(entry: VehicleRecord["unallocatedPiecework"][number]) {
      unallocatedPiecework.push(entry);
    }

    for (const p of positions) {
      const name = p.assortment?.name ?? "";
      const pathName = p.assortment?.pathName ?? "";
      const groupId = p.assortment?.groupId ?? null;
      const qty = p.quantity ?? 1;
      const priceCents = Math.round(p.price ?? 0); // цена за единицу в копейках
      const unitBuyPriceCents = p.assortment?.buyPrice?.value;
      const type = p.assortment?.meta?.type ?? "";
      const lineFinancials = calculateLineFinancials({
        quantity: qty,
        salePriceCents: priceCents,
        discountPercent: p.discount ?? 0,
        assortmentType: type,
        snapshotCents: unitBuyPriceCents,
      });
      const saleCents = lineFinancials.revenueCents;
      const buyPriceCents = lineFinancials.costCents;

      const isService = type === "service";
      const targetType = isService ? "service" : "product_group";
      const targetId = isService ? extractLocalEntityId(p.assortment?.meta?.href) : groupId;
      const category = isService ? "work" : "product";
      const baseCents = isService ? saleCents : Math.max(0, lineFinancials.profitCents ?? 0);
      if (isService) works.push({ name, quantity: qty, priceCents: saleCents });
      else products.push({ name, pathName: pathName || undefined, quantity: qty, priceCents: saleCents });

      const { recipients, conflicts } = selectPieceworkRecipients({
        staff: onShift,
        settingsFor: (login) => employeeByLogin.get(normalizeLogin(login))?.settings ?? {},
        targetType,
        targetId,
        roleRule: (role) => resolvePieceworkRule({ ruleMap: pieceworkRuleMap, targetId, targetType, role }),
      });
      for (const conflict of conflicts) {
        addUnallocatedPiecework({ category, label: name, quantity: qty, baseCents,
          reason: conflict.role === "master" ? "multiple_masters" : "multiple_admins", logins: conflict.logins,
          diagnostic: "На смене несколько сотрудников с общим правилом роли. Назначьте индивидуальные правила." });
      }
      if (!recipients.length && !conflicts.length && !(onShift.length > 0 && onShift.every((member) => employeeByLogin.get(normalizeLogin(member.login))?.settings.individualPiecework))) {
        addUnallocatedPiecework({ category, label: name, quantity: qty, baseCents,
          reason: onShift.length ? "missing_rule" : isService ? "missing_master" : "missing_admin",
          ruleTargetId: targetId ?? undefined, groupPath: pathName || undefined,
          diagnostic: onShift.length ? "У сотрудников смены нет правила для этой позиции. Добавьте индивидуальное правило." : "На дату отгрузки нет назначенных сотрудников." });
      }
      for (const { login: recipientLogin, rule } of recipients) {
        if (!isService && rule.mode === "percent" && buyPriceCents == null) {
          addUnallocatedPiecework({ category, label: name, quantity: qty, baseCents: 0, reason: "missing_cost", logins: [recipientLogin],
            diagnostic: "Для процента от прибыли нужен подтверждённый снимок себестоимости позиции." });
          continue;
        }
        const amountCents = calculatePieceworkAmountCents(rule, baseCents, qty);
        if (amountCents <= 0) continue;
        earningsByLogin[recipientLogin] = (earningsByLogin[recipientLogin] ?? 0) + amountCents;
        addPieceworkEntry(recipientLogin, {
          positionId: p.positionId, targetId: targetId ?? undefined, targetType, category, label: name, quantity: qty, amountCents,
          ruleLabel: formatRuleAmountLabel(rule),
          basisLabel: rule.mode === "percent" ? isService ? "от суммы услуги" : "от прибыли товара" : isService ? "за услугу" : "за единицу",
          status: "PRELIMINARY",
        });
      }
    }

    const sumCents = demand.sum ?? 0;
    vehicleHistory.push({
      demandId: demand.id,
      demandName: demand.name,
      date: demandDate,
      moment: demand.moment,
      agentName: demand.agent?.name ?? "",
      sumCents,
      works,
      products,
      earningsByLogin,
      pieceworkBreakdownByLogin,
      unallocatedPiecework,
    });
  }

  // Назначенная смена — единственный источник фиксированной части зарплаты.
  for (const scheduledShift of scheduledShiftsForRates) {
    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(scheduledShift.userLogin)) ?? scheduledShift.userLogin;
    if (normalizedTargetLogin && normalizeLogin(canonicalLogin) !== normalizedTargetLogin) continue;
    const roleValue = roleByLogin.get(normalizeLogin(canonicalLogin));
    if (!roleValue) continue;
    const employee = employeeByLogin.get(normalizeLogin(canonicalLogin));
    if (!employee || !employedOn(employee.settings, scheduledShift.date, employee.employmentStart)) continue;
    if (!byLogin[canonicalLogin]) {
      byLogin[canonicalLogin] = {
        shiftTotalCents: 0,
        pieceworkCents: 0,
        bonusPenaltyCents: 0,
        paidOutCents: 0,
        remainingCents: 0,
        totalCents: 0,
        shiftsCount: 0,
      };
    }
    const rate = await getShiftRateCents(canonicalLogin, scheduledShift.date);
    if (rate != null) {
      byLogin[canonicalLogin].shiftTotalCents += rate;
      byLogin[canonicalLogin].shiftsCount += 1;
    }
  }

  for (const v of vehicleHistory) {
    for (const [login, cents] of Object.entries(v.earningsByLogin)) {
      const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(login)) ?? login;
      if (normalizedTargetLogin && normalizeLogin(canonicalLogin) !== normalizedTargetLogin) continue;
      if (!byLogin[canonicalLogin]) {
        byLogin[canonicalLogin] = {
          shiftTotalCents: 0,
          pieceworkCents: 0,
          bonusPenaltyCents: 0,
          paidOutCents: 0,
          remainingCents: 0,
          totalCents: 0,
          shiftsCount: 0,
        };
      }
      byLogin[canonicalLogin].pieceworkCents += cents;
    }
  }

  for (const bp of bonusPenalties) {
    if (bp.type === "penalty_late") continue;

    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(bp.userLogin)) ?? bp.userLogin;
    const roleValue = roleByLogin.get(normalizeLogin(canonicalLogin));
    if (!roleValue) continue;
    if (!byLogin[canonicalLogin]) {
      byLogin[canonicalLogin] = {
        shiftTotalCents: 0,
        pieceworkCents: 0,
        bonusPenaltyCents: 0,
        paidOutCents: 0,
        remainingCents: 0,
        totalCents: 0,
        shiftsCount: 0,
      };
    }
    byLogin[canonicalLogin].bonusPenaltyCents += bp.amountCents;
    if (bp.amountCents >= 0) {
      byLogin[canonicalLogin].bonusCents = (byLogin[canonicalLogin].bonusCents ?? 0) + bp.amountCents;
    } else {
      byLogin[canonicalLogin].penaltyCents = (byLogin[canonicalLogin].penaltyCents ?? 0) + bp.amountCents;
    }
  }

  for (const adjustment of payrollAdjustments) {
    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(adjustment.employeeId)) ?? adjustment.employeeId;
    const roleValue = roleByLogin.get(normalizeLogin(canonicalLogin));
    if (!roleValue) continue;
    if (normalizedTargetLogin && normalizeLogin(canonicalLogin) !== normalizedTargetLogin) continue;
    if (!byLogin[canonicalLogin]) {
      byLogin[canonicalLogin] = {
        shiftTotalCents: 0,
        pieceworkCents: 0,
        bonusPenaltyCents: 0,
        paidOutCents: 0,
        remainingCents: 0,
        totalCents: 0,
        shiftsCount: 0,
      };
    }
    byLogin[canonicalLogin].bonusPenaltyCents += adjustment.amountCents;
    if (adjustment.amountCents >= 0) {
      byLogin[canonicalLogin].bonusCents = (byLogin[canonicalLogin].bonusCents ?? 0) + adjustment.amountCents;
    } else {
      byLogin[canonicalLogin].penaltyCents = (byLogin[canonicalLogin].penaltyCents ?? 0) + adjustment.amountCents;
    }
  }

  for (const payment of payrollPayments) {
    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(payment.employeeId)) ?? payment.employeeId;
    if (normalizedTargetLogin && normalizeLogin(canonicalLogin) !== normalizedTargetLogin) continue;
    const roleValue = roleByLogin.get(normalizeLogin(canonicalLogin));
    if (!roleValue) continue;

    if (!byLogin[canonicalLogin]) {
      byLogin[canonicalLogin] = {
        shiftTotalCents: 0,
        pieceworkCents: 0,
        bonusPenaltyCents: 0,
        paidOutCents: 0,
        remainingCents: 0,
        totalCents: 0,
        shiftsCount: 0,
      };
    }

    byLogin[canonicalLogin].paidOutCents += payment.amountCents;
    cashoutHistory.push({
      cashoutId: payment.cashOrderId ?? payment.id,
      name: payment.cashOrderNumber ? `РКО ${payment.cashOrderNumber}` : `Выплата ${payment.id.slice(0, 8)}`,
      date: payment.cashOrderExpenseDate ?? payment.operationDate,
      agentName: nameByLogin.get(normalizeLogin(canonicalLogin)) ?? canonicalLogin,
      sumCents: payment.amountCents,
      paymentPurpose:
        payment.operationType === "ADVANCE"
          ? "Аванс из раздела Зарплата"
          : payment.operationType === "COMPENSATION"
            ? "Компенсация из раздела Зарплата"
            : "Выплата зарплаты из раздела Зарплата",
      description: payment.comment ?? "",
      login: canonicalLogin,
      sourceType: "payroll_payment",
      paymentMethod: payment.paymentMethod,
      operationType: payment.operationType,
      cashOrderId: payment.cashOrderId,
      paymentId: payment.id,
      periodFrom: payment.periodFrom,
      periodTo: payment.periodTo,
      cashDate: payment.cashOrderExpenseDate ?? payment.operationDate,
      cashOrderShiftStatus: payment.cashOrderShiftStatus,
    });
  }

  for (const cashout of cashouts) {
    const agentName = cashout.agent?.name ?? "";
    const mappedLogin = cashout.employeeLogin || resolvePayrollCashoutLogin(agentName);
    if (!mappedLogin || !isSalaryCashout(cashout)) continue;

    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(mappedLogin)) ?? mappedLogin;
    if (normalizedTargetLogin && normalizeLogin(canonicalLogin) !== normalizedTargetLogin) continue;

    if (!byLogin[canonicalLogin]) {
      byLogin[canonicalLogin] = {
        shiftTotalCents: 0,
        pieceworkCents: 0,
        bonusPenaltyCents: 0,
        paidOutCents: 0,
        remainingCents: 0,
        totalCents: 0,
        shiftsCount: 0,
      };
    }

    byLogin[canonicalLogin].paidOutCents += cashout.sum ?? 0;
    cashoutHistory.push({
      cashoutId: cashout.id,
      name: cashout.name,
      date: momentToDate(cashout.moment),
      agentName,
      sumCents: cashout.sum ?? 0,
      paymentPurpose: cashout.paymentPurpose ?? "",
      description: cashout.description ?? "",
      login: canonicalLogin,
      sourceType: "cash_expense_order",
      paymentMethod: "CASH",
      operationType: normalizePersonName(`${cashout.paymentPurpose ?? ""} ${cashout.expenseItem?.name ?? ""}`).includes("аванс")
        ? "ADVANCE"
        : "SALARY",
      cashOrderId: cashout.id,
      periodFrom: cashout.periodFrom,
      periodTo: cashout.periodTo,
      cashDate: momentToDate(cashout.moment),
    });
  }

  for (const login of Object.keys(byLogin)) {
    const row = byLogin[login];
    row.totalCents = row.shiftTotalCents + row.pieceworkCents + row.bonusPenaltyCents;
    row.remainingCents = row.totalCents - row.paidOutCents;
  }

  const filteredHistory = normalizedTargetLogin
    ? vehicleHistory.filter((v) =>
        Object.keys(v.earningsByLogin).some((login) => normalizeLogin(login) === normalizedTargetLogin)
      )
    : vehicleHistory;
  const filteredCashoutHistory = normalizedTargetLogin
    ? cashoutHistory.filter((item) => normalizeLogin(item.login) === normalizedTargetLogin)
    : cashoutHistory;

  if (!normalizedTargetLogin) {
    const activeByLogin = Object.fromEntries(
      Object.entries(byLogin).filter(([login]) => activeLogins.has(normalizeLogin(login)))
    );

    const activeHistory = filteredHistory
      .map((vehicle) => {
        const earningsByLogin = Object.fromEntries(
          Object.entries(vehicle.earningsByLogin).filter(([login]) => activeLogins.has(normalizeLogin(login)))
        );
        const pieceworkBreakdownByLogin = Object.fromEntries(
          Object.entries(vehicle.pieceworkBreakdownByLogin).filter(([login]) =>
            activeLogins.has(normalizeLogin(login))
          )
        );
        return { ...vehicle, earningsByLogin, pieceworkBreakdownByLogin };
      })
      .filter((vehicle) => Object.keys(vehicle.earningsByLogin).length > 0 || vehicle.unallocatedPiecework.length > 0);
    const activeCashoutHistory = filteredCashoutHistory.filter((item) =>
      activeLogins.has(normalizeLogin(item.login))
    );

    return {
      dateFrom,
      dateTo,
      salesPlanBonusIds: payrollAdjustments.filter((row) => row.sourceType === "SALES_PLAN_BONUS").map((row) => row.id).sort(),
      byLogin: activeByLogin,
      vehicleHistory: activeHistory,
      cashoutHistory: activeCashoutHistory,
    };
  }

  return {
    dateFrom,
    dateTo,
    salesPlanBonusIds: payrollAdjustments.filter((row) => row.sourceType === "SALES_PLAN_BONUS").map((row) => row.id).sort(),
    byLogin,
    vehicleHistory: filteredHistory,
    cashoutHistory: filteredCashoutHistory,
  };
}

export async function getCachedPayrollSummary(params: {
  dateFrom: string;
  dateTo: string;
  targetLogin?: string;
}): Promise<PayrollSummary> {
  const key = JSON.stringify({
    branchId: getScopedBranchId(),
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    targetLogin: params.targetLogin ?? "",
  });
  const existing = payrollCache.get(key);

  if (existing?.promise) {
    return existing.promise;
  }

  const promise = computePayroll(params)
    .then((summary) => {
      payrollCache.delete(key);
      return summary;
    })
    .catch((error) => {
      payrollCache.delete(key);
      throw error;
    });

  payrollCache.set(key, {
    promise,
  });

  return promise;
}
