import { prisma } from "@/lib/db";
import { getShiftRateCents } from "@/lib/shifts";
import { canonicalizeLogin, getLoginVariants, getUsersFromEnv } from "@/lib/auth";
import { listPayrollAdjustments, listPayrollPayments } from "@/lib/payroll-settlements";
import {
  calculatePieceworkAmountCents,
  extractMoyskladEntityId,
  getPieceworkRuleKey,
  getPieceworkRuleMap,
  resolveProductGroupTargetId,
  resolveServicePieceworkRule,
} from "@/lib/piecework-rules";

const payrollCache = new Map<
  string,
  { promise?: Promise<PayrollSummary> }
>();

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
  assortment: {
    meta: { href: string; type: string };
    name?: string;
    pathName?: string;
    buyPrice?: { value?: number };
    salePrices?: { value?: number }[];
  };
  quantity: number;
  price: number;
};

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
  paymentPurpose?: string;
  description?: string;
  agent?: { name?: string };
  expenseItem?: { name?: string };
};

type StaffingMember = { login: string; role: string };
type PieceworkBreakdownEntry = {
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
  const demands = await prisma.localDemand.findMany({
    where: {
      documentDate: { gte: dateFrom, lte: dateTo },
      applicable: true,
    },
    include: {
      counterparty: true,
      positions: { include: { product: true }, orderBy: { id: "asc" } },
    },
    orderBy: { momentAt: "asc" },
  });

  return demands.map((demand) => ({
    demand: {
      id: demand.id,
      name: demand.name,
      moment: demand.momentAt.toISOString(),
      sum: demand.sumCents,
      agent: { name: demand.counterparty?.name ?? demand.agentNameSnapshot ?? "" },
    },
    positions: demand.positions.map((position) => {
      const product = position.product;
      const assortmentType = product?.entityType ?? position.assortmentType ?? "";
      const assortmentId = product?.id ?? position.assortmentMoyskladId ?? position.id;
      return {
        assortment: {
          meta: {
            href: product?.moyskladHref ?? `local://${assortmentType || "product"}/${assortmentId}`,
            type: assortmentType,
          },
          name: position.name,
          pathName: product?.groupPath ?? undefined,
          buyPrice: {
            value: position.buyPriceCentsPerUnit ?? product?.buyPriceCents ?? 0,
          },
        },
        quantity: position.quantity.toNumber(),
        price: position.priceCentsPerUnit,
      };
    }),
  }));
}

async function fetchLocalPayrollCashouts(dateFrom: string, dateTo: string): Promise<CashoutRow[]> {
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
        item.name AS "expenseItemRelationName"
      FROM cash_expense_orders ceo
      LEFT JOIN local_counterparties cp ON cp.id = ceo.counterparty_id
      LEFT JOIN cash_expense_items item ON item.id = ceo.expense_item_id
      WHERE ceo.expense_date >= ${dateFrom}
        AND ceo.expense_date <= ${dateTo}
        AND ceo.status = 'posted'
        AND (ceo.source_type IS NULL OR ceo.source_type <> 'PAYROLL_PAYMENT')
      ORDER BY ceo.expense_date ASC
    `;

    return rows.map((row) => ({
      id: row.id,
      name: row.number,
      moment: `${row.expenseDate} 00:00:00`,
      sum: row.amountCents,
      applicable: row.status === "posted",
      paymentPurpose: row.paymentPurpose ?? row.article ?? row.comment ?? "",
      description: row.comment ?? "",
      agent: { name: row.counterpartyRelationName ?? row.counterpartyName ?? "" },
      expenseItem: { name: row.expenseItemRelationName ?? row.expenseItemName ?? "" },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message.includes("source_type") && !message.includes("undefined_column")) throw error;
  }

  const rows = await prisma.cashExpenseOrder.findMany({
    where: {
      expenseDate: { gte: dateFrom, lte: dateTo },
      status: "posted",
    },
    include: {
      counterparty: true,
      expenseItem: true,
    },
    orderBy: { expenseDate: "asc" },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.number,
    moment: `${row.expenseDate} 00:00:00`,
    sum: row.amountCents,
    applicable: row.status === "posted",
    paymentPurpose: row.paymentPurpose ?? row.article ?? row.comment ?? "",
    description: row.comment ?? "",
    agent: { name: row.counterparty?.name ?? row.counterpartyName ?? "" },
    expenseItem: { name: row.expenseItem?.name ?? row.expenseItemName ?? "" },
  }));
}

function mergeStaffingByDate(params: {
  scheduledDays: { userLogin: string; date: string }[];
  roleByLogin: Map<string, string>;
}) {
  const { scheduledDays, roleByLogin } = params;
  const byDate = new Map<string, StaffingMember[]>();

  for (const day of scheduledDays) {
    const normalized = normalizeLogin(day.userLogin);
    const role = roleByLogin.get(normalized) ?? "master";
    if (role !== "master" && role !== "admin") continue;
    const list = byDate.get(day.date) ?? [];
    if (!list.some((x) => normalizeLogin(x.login) === normalized)) {
      list.push({ login: day.userLogin, role });
      byDate.set(day.date, list);
    }
  }

  return byDate;
}

/** Дата из moment МойСклад (YYYY-MM-DD) */
function momentToDate(moment: string): string {
  return moment.slice(0, 10);
}

export type VehicleRecord = {
  demandId: string;
  demandName: string;
  date: string;
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
      | "missing_rule";
    logins?: string[];
  }[];
};

export type PayrollSummary = {
  dateFrom: string;
  dateTo: string;
  byLogin: Record<
    string,
    {
      shiftTotalCents: number;
      pieceworkCents: number;
      bonusPenaltyCents: number;
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
  }[];
};

/** Расчёт на лету: зарплата и история машин за период */
export async function computePayroll(params: {
  dateFrom: string;
  dateTo: string;
  /** для владельца — по всем, для мастера/админа — только свой логин */
  targetLogin?: string;
}): Promise<PayrollSummary> {
  const { dateFrom, dateTo, targetLogin } = params;
  const normalizedTargetLogin = targetLogin ? normalizeLogin(targetLogin) : undefined;
  const targetLoginVariants = targetLogin ? getLoginVariants(targetLogin) : undefined;
  const targetLoginWhere = targetLoginVariants ? { userLogin: { in: targetLoginVariants } } : {};
  const [
    bonusPenalties,
    payrollAdjustments,
    payrollPayments,
    scheduledDaysForRates,
    scheduledDaysForStaffing,
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
    getUsersFromEnv(),
    getPieceworkRuleMap(),
  ]);

  const demandsWithPositions = await fetchDemandsWithPositions(dateFrom, dateTo);
  const cashouts = await fetchPayrollCashouts(dateFrom, dateTo);

  const canonicalLoginByLower = new Map(users.map((u) => [normalizeLogin(u.login), u.login]));
  const roleByLogin = new Map(users.map((u) => [normalizeLogin(u.login), u.role]));
  const nameByLogin = new Map(users.map((u) => [normalizeLogin(u.login), u.name]));
  const activeLogins = new Set(
    users.filter((u) => u.role === "master" || u.role === "admin").map((u) => normalizeLogin(u.login))
  );
  const staffingByDate = mergeStaffingByDate({
    scheduledDays: scheduledDaysForStaffing.map((day) => ({
      ...day,
      userLogin: canonicalLoginByLower.get(normalizeLogin(day.userLogin)) ?? day.userLogin,
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
    const masters = onShift.filter((member) => member.role === "master");
    const admins = onShift.filter((member) => member.role === "admin");
    const master = masters.length === 1 ? masters[0] : null;
    const admin = admins.length === 1 ? admins[0] : null;

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
      const qty = p.quantity ?? 1;
      const priceCents = Math.round(p.price ?? 0); // цена за единицу в копейках
      const saleCents = priceCents * qty;
      const buyPriceCents = Math.round(p.assortment?.buyPrice?.value ?? 0) * qty;
      const type = p.assortment?.meta?.type ?? "";

      if (type === "service") {
        const serviceId = extractMoyskladEntityId(p.assortment?.meta?.href);
        works.push({ name, quantity: qty, priceCents: saleCents });
        if (!master) {
          addUnallocatedPiecework({
            category: "work",
            label: name,
            quantity: qty,
            baseCents: saleCents,
            reason: masters.length > 1 ? "multiple_masters" : "missing_master",
            logins: masters.length > 1 ? masters.map((member) => member.login) : undefined,
          });
          continue;
        }
        if (!serviceId) {
          addUnallocatedPiecework({
            category: "work",
            label: name,
            quantity: qty,
            baseCents: saleCents,
            reason: "missing_rule",
          });
          continue;
        }
        const rule = resolveServicePieceworkRule({
          ruleMap: pieceworkRuleMap,
          serviceId,
          serviceName: name,
          role: "master",
        });
        if (!rule) {
          addUnallocatedPiecework({
            category: "work",
            label: name,
            quantity: qty,
            baseCents: saleCents,
            reason: "missing_rule",
          });
          continue;
        }
        const amountCents = calculatePieceworkAmountCents(rule, saleCents, qty);
        if (amountCents <= 0) continue;
        earningsByLogin[master.login] = (earningsByLogin[master.login] ?? 0) + amountCents;
        addPieceworkEntry(master.login, {
          category: "work",
          label: name,
          quantity: qty,
          amountCents,
          ruleLabel: formatRuleAmountLabel(rule),
          basisLabel: rule.mode === "percent" ? "от суммы услуги" : "за услугу",
          status: "PRELIMINARY",
        });
      } else {
        products.push({
          name,
          pathName: pathName || undefined,
          quantity: qty,
          priceCents: saleCents,
        });

        const productGroupTargetId = resolveProductGroupTargetId(pathName);
        const profitCents = Math.max(0, saleCents - buyPriceCents);
        if (!admin) {
          addUnallocatedPiecework({
            category: "product",
            label: name,
            quantity: qty,
            baseCents: profitCents,
            reason: admins.length > 1 ? "multiple_admins" : "missing_admin",
            logins: admins.length > 1 ? admins.map((member) => member.login) : undefined,
          });
          continue;
        }
        if (!productGroupTargetId) {
          addUnallocatedPiecework({
            category: "product",
            label: name,
            quantity: qty,
            baseCents: profitCents,
            reason: "missing_rule",
          });
          continue;
        }
        const rule = pieceworkRuleMap.get(
          getPieceworkRuleKey("product_group", productGroupTargetId, "admin")
        );
        if (!rule) {
          addUnallocatedPiecework({
            category: "product",
            label: name,
            quantity: qty,
            baseCents: profitCents,
            reason: "missing_rule",
          });
          continue;
        }
        const amountCents = calculatePieceworkAmountCents(rule, profitCents, qty);
        if (amountCents <= 0) continue;
        earningsByLogin[admin.login] = (earningsByLogin[admin.login] ?? 0) + amountCents;
        addPieceworkEntry(admin.login, {
          category: "product",
          label: name,
          quantity: qty,
          amountCents,
          ruleLabel: formatRuleAmountLabel(rule),
          basisLabel: rule.mode === "percent" ? "от расчётной базы группы товара" : "за единицу",
          status: "PRELIMINARY",
        });
      }
    }

    const sumCents = demand.sum ?? 0;
    vehicleHistory.push({
      demandId: demand.id,
      demandName: demand.name,
      date: demandDate,
      agentName: demand.agent?.name ?? "",
      sumCents,
      works,
      products,
      earningsByLogin,
      pieceworkBreakdownByLogin,
      unallocatedPiecework,
    });
  }

  // Назначенные владельцем смены сотрудников: единственный источник фиксированной части зарплаты.
  for (const swd of scheduledDaysForRates) {
    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(swd.userLogin)) ?? swd.userLogin;
    if (normalizedTargetLogin && normalizeLogin(canonicalLogin) !== normalizedTargetLogin) continue;
    const roleValue = roleByLogin.get(normalizeLogin(canonicalLogin));
    if (roleValue !== "master" && roleValue !== "admin") continue;
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
    const rate = await getShiftRateCents(canonicalLogin, swd.date);
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
    if (roleValue !== "master" && roleValue !== "admin") continue;
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
  }

  for (const adjustment of payrollAdjustments) {
    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(adjustment.employeeId)) ?? adjustment.employeeId;
    const roleValue = roleByLogin.get(normalizeLogin(canonicalLogin));
    if (roleValue !== "master" && roleValue !== "admin") continue;
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
  }

  for (const payment of payrollPayments) {
    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(payment.employeeId)) ?? payment.employeeId;
    if (normalizedTargetLogin && normalizeLogin(canonicalLogin) !== normalizedTargetLogin) continue;
    const roleValue = roleByLogin.get(normalizeLogin(canonicalLogin));
    if (roleValue !== "master" && roleValue !== "admin") continue;

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
      date: payment.operationDate,
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
    });
  }

  for (const cashout of cashouts) {
    const agentName = cashout.agent?.name ?? "";
    const mappedLogin = resolvePayrollCashoutLogin(agentName);
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
      operationType: "SALARY",
      cashOrderId: cashout.id,
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
      byLogin: activeByLogin,
      vehicleHistory: activeHistory,
      cashoutHistory: activeCashoutHistory,
    };
  }

  return {
    dateFrom,
    dateTo,
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
