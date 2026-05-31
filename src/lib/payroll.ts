import { prisma } from "@/lib/db";
import { getShiftRateCents } from "@/lib/shifts";
import { canonicalizeLogin, getLoginVariants, getUsersFromEnv } from "@/lib/auth";
import {
  calculatePieceworkAmountCents,
  extractMoyskladEntityId,
  getPieceworkRuleKey,
  getPieceworkRuleMap,
  isPieceworkRole,
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

const PAYROLL_CASHOUT_AGENT_TO_LOGIN: Record<string, string> = {
  [normalizePersonName("Бигожин Вадим Андреевич")]: "vadim",
  [normalizePersonName("Лобов Максим")]: "maksim",
};

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
    where: { documentDate: { gte: dateFrom, lte: dateTo } },
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

/** Кто фактически был на смене по дням (shiftDate -> login[]) */
async function getShiftsByDate(dateFrom: string, dateTo: string): Promise<Map<string, { login: string; role: string }[]>> {
  const shifts = await prisma.shift.findMany({
    where: { shiftDate: { gte: dateFrom, lte: dateTo } },
    orderBy: { shiftDate: "asc" },
  });
  const users = await getUsersFromEnv();
  const roleByLogin = new Map(users.map((u) => [normalizeLogin(u.login), u.role]));
  const canonicalLoginByLower = new Map(users.map((u) => [normalizeLogin(u.login), u.login]));
  const byDate = new Map<string, { login: string; role: string }[]>();
  for (const s of shifts) {
    const normalized = normalizeLogin(s.userLogin);
    const canonicalLogin = canonicalLoginByLower.get(normalized) ?? s.userLogin;
    const role = roleByLogin.get(normalized) ?? "master";
    const list = byDate.get(s.shiftDate) ?? [];
    if (!list.some((x) => normalizeLogin(x.login) === normalized)) {
      list.push({ login: canonicalLogin, role });
      byDate.set(s.shiftDate, list);
    }
  }
  return byDate;
}

function mergeStaffingByDate(params: {
  actualByDate: Map<string, { login: string; role: string }[]>;
  scheduledDays: { userLogin: string; date: string }[];
  roleByLogin: Map<string, string>;
}) {
  const { actualByDate, scheduledDays, roleByLogin } = params;
  const byDate = new Map(actualByDate);

  for (const day of scheduledDays) {
    const actualForDate = actualByDate.get(day.date) ?? [];
    if (actualForDate.length > 0) continue;

    const normalized = normalizeLogin(day.userLogin);
    const role = roleByLogin.get(normalized) ?? "master";
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
  /** Начисление по этой машине для каждого сотрудника, который был на смене в этот день */
  earningsByLogin: Record<string, number>;
  /** Детальная расшифровка сдельной части по каждому сотруднику для этой машины */
  pieceworkBreakdownByLogin: Record<
    string,
    { category: "work" | "product"; label: string; quantity: number; amountCents: number }[]
  >;
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
  const [actualShiftsByDate, bonusPenalties, scheduledDays, users, pieceworkRuleMap] = await Promise.all([
    getShiftsByDate(dateFrom, dateTo),
    prisma.bonusPenalty.findMany({
      where: {
        date: { gte: dateFrom, lte: dateTo },
        ...targetLoginWhere,
      },
    }),
    prisma.scheduledWorkingDay.findMany({
      where: {
        date: { gte: dateFrom, lte: dateTo },
        ...targetLoginWhere,
      },
    }),
    getUsersFromEnv(),
    getPieceworkRuleMap(),
  ]);

  const demandsWithPositions = await fetchDemandsWithPositions(dateFrom, dateTo);
  const cashouts = await fetchPayrollCashouts(dateFrom, dateTo);

  const canonicalLoginByLower = new Map(users.map((u) => [normalizeLogin(u.login), u.login]));
  const roleByLogin = new Map(users.map((u) => [normalizeLogin(u.login), u.role]));
  const activeLogins = new Set(users.map((u) => normalizeLogin(u.login)));
  const staffingByDate = mergeStaffingByDate({
    actualByDate: actualShiftsByDate,
    scheduledDays: scheduledDays.map((day) => ({
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

    function addPieceworkEntry(
      login: string,
      entry: { category: "work" | "product"; label: string; quantity: number; amountCents: number }
    ) {
      if (!pieceworkBreakdownByLogin[login]) pieceworkBreakdownByLogin[login] = [];
      pieceworkBreakdownByLogin[login].push(entry);
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
        for (const { login, role } of onShift) {
          if (!serviceId || !isPieceworkRole(role)) continue;
          const rule = resolveServicePieceworkRule({
            ruleMap: pieceworkRuleMap,
            serviceId,
            serviceName: name,
            role,
          });
          if (!rule) continue;
          const amountCents = calculatePieceworkAmountCents(rule, saleCents, qty);
          if (amountCents <= 0) continue;
          earningsByLogin[login] = (earningsByLogin[login] ?? 0) + amountCents;
          addPieceworkEntry(login, {
            category: "work",
            label: name,
            quantity: qty,
            amountCents,
          });
        }
      } else {
        products.push({
          name,
          pathName: pathName || undefined,
          quantity: qty,
          priceCents: saleCents,
        });

        const productGroupTargetId = resolveProductGroupTargetId(pathName);
        if (!productGroupTargetId) continue;

        for (const { login, role } of onShift) {
          if (!isPieceworkRole(role)) continue;
          const rule = pieceworkRuleMap.get(
            getPieceworkRuleKey("product_group", productGroupTargetId, role)
          );
          if (!rule) continue;
          const profitCents = Math.max(0, saleCents - buyPriceCents);
          const amountCents = calculatePieceworkAmountCents(rule, profitCents, qty);
          if (amountCents <= 0) continue;
          earningsByLogin[login] = (earningsByLogin[login] ?? 0) + amountCents;
          addPieceworkEntry(login, {
            category: "product",
            label: name,
            quantity: qty,
            amountCents,
          });
        }
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
    });
  }

  // Собираем смены за период и ставки (фактические смены)
  const shifts = await prisma.shift.findMany({
    where: { shiftDate: { gte: dateFrom, lte: dateTo }, ...targetLoginWhere },
  });

  const actualShiftDatesByLogin = new Map<string, Set<string>>();
  for (const s of shifts) {
    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(s.userLogin)) ?? s.userLogin;
    if (normalizedTargetLogin && normalizeLogin(canonicalLogin) !== normalizedTargetLogin) continue;
    if (!actualShiftDatesByLogin.has(canonicalLogin)) {
      actualShiftDatesByLogin.set(canonicalLogin, new Set());
    }
    actualShiftDatesByLogin.get(canonicalLogin)!.add(s.shiftDate);
  }

  for (const s of shifts) {
    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(s.userLogin)) ?? s.userLogin;
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
    const rate = await getShiftRateCents(canonicalLogin, s.shiftDate);
    if (rate != null) {
      byLogin[canonicalLogin].shiftTotalCents += rate;
      byLogin[canonicalLogin].shiftsCount += 1;
    }
  }

  // Назначенные рабочие дни без фактической смены: начисляем ставку за день (график)
  for (const swd of scheduledDays) {
    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(swd.userLogin)) ?? swd.userLogin;
    if (normalizedTargetLogin && normalizeLogin(canonicalLogin) !== normalizedTargetLogin) continue;
    const hasActual = actualShiftDatesByLogin.get(canonicalLogin)?.has(swd.date);
    if (hasActual) continue; // уже учтено по фактической смене
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
    const canonicalLogin = canonicalLoginByLower.get(normalizeLogin(bp.userLogin)) ?? bp.userLogin;
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

  for (const cashout of cashouts) {
    const agentName = cashout.agent?.name ?? "";
    const mappedLogin = PAYROLL_CASHOUT_AGENT_TO_LOGIN[normalizePersonName(agentName)];
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
      .filter((vehicle) => Object.keys(vehicle.earningsByLogin).length > 0);
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
