import { NextRequest, NextResponse } from "next/server";
import { canonicalizeLogin, getSession, getUsersFromEnv } from "@/lib/auth";
import { getCachedPayrollSummary, type PayrollSummary, type VehicleRecord } from "@/lib/payroll";
import { getPayrollPeriodEmployeeByRange } from "@/lib/payroll-periods";
import {
  getMotivationSettings,
  listActivePayrollGoals,
  listEmployeeRecognition,
  type PayrollGoalMetric,
  type PayrollGoalRecord,
} from "@/lib/payroll-motivation";
import { toLocalDateString } from "@/lib/time";

type PeriodSummary = {
  dateFrom: string;
  dateTo: string;
  totalCents: number;
  pieceworkCents: number;
  fixedCents: number;
  adjustmentsCents: number;
  paidCents: number;
  payableCents: number;
  workDays: number;
  shipments: number;
};

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toLocalDateString(date);
}

function startOfWeek(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  const day = (date.getDay() + 6) % 7;
  return addDays(dateKey, -day);
}

function monthBounds(dateKey: string) {
  const [year, month] = dateKey.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  return {
    dateFrom: toLocalDateString(first),
    dateTo: toLocalDateString(last),
  };
}

function normalizeLogin(value: string) {
  return canonicalizeLogin(value).trim().toLowerCase();
}

function findPayrollRow(summary: PayrollSummary, login: string) {
  const normalized = normalizeLogin(login);
  return (
    Object.entries(summary.byLogin).find(([entryLogin]) => normalizeLogin(entryLogin) === normalized)?.[1] ?? {
      shiftTotalCents: 0,
      pieceworkCents: 0,
      bonusPenaltyCents: 0,
      paidOutCents: 0,
      remainingCents: 0,
      totalCents: 0,
      shiftsCount: 0,
    }
  );
}

function employeeBreakdown(vehicle: VehicleRecord, login: string) {
  const normalized = normalizeLogin(login);
  return (
    Object.entries(vehicle.pieceworkBreakdownByLogin).find(([entryLogin]) => normalizeLogin(entryLogin) === normalized)
      ?.[1] ?? []
  );
}

function employeeEarnings(vehicle: VehicleRecord, login: string) {
  const normalized = normalizeLogin(login);
  return (
    Object.entries(vehicle.earningsByLogin).find(([entryLogin]) => normalizeLogin(entryLogin) === normalized)?.[1] ?? 0
  );
}

function buildPeriodSummary(summary: PayrollSummary, login: string): PeriodSummary {
  const row = findPayrollRow(summary, login);
  return {
    dateFrom: summary.dateFrom,
    dateTo: summary.dateTo,
    totalCents: row.totalCents,
    pieceworkCents: row.pieceworkCents,
    fixedCents: row.shiftTotalCents,
    adjustmentsCents: row.bonusPenaltyCents,
    paidCents: row.paidOutCents,
    payableCents: row.remainingCents,
    workDays: row.shiftsCount,
    shipments: summary.vehicleHistory.filter((vehicle) => employeeEarnings(vehicle, login) > 0).length,
  };
}

function buildShipmentCard(vehicle: VehicleRecord, login: string, status: "CONFIRMED" | "PRELIMINARY") {
  const items = employeeBreakdown(vehicle, login);
  const earningsCents = employeeEarnings(vehicle, login);
  const serviceCount = items.filter((item) => item.category === "work").length;
  const productCount = items.filter((item) => item.category === "product").length;
  const roleInCalculation = serviceCount > 0 ? "master" : productCount > 0 ? "admin" : "employee";

  return {
    id: vehicle.demandId,
    name: vehicle.demandName,
    date: vehicle.date,
    clientName: vehicle.agentName,
    vehicleLabel: "Автомобиль не указан",
    roleInCalculation,
    positionsCount: items.length,
    servicesCount: serviceCount,
    productsCount: productCount,
    earningsCents,
    status,
    shipmentUrl: `/shipment/${encodeURIComponent(vehicle.demandId)}`,
    items: items.map((item) => ({
      category: item.category,
      label: item.label,
      quantity: item.quantity,
      amountCents: item.amountCents,
      ruleLabel: item.ruleLabel,
      basisLabel: item.basisLabel,
      status: status === "CONFIRMED" ? status : item.status ?? status,
    })),
  };
}

function buildOpportunities(month: PayrollSummary, login: string) {
  const ownVehicles = month.vehicleHistory.filter((vehicle) => employeeEarnings(vehicle, login) > 0);
  const missingRuleCount = month.vehicleHistory.reduce(
    (sum, vehicle) => sum + vehicle.unallocatedPiecework.filter((item) => item.reason === "missing_rule").length,
    0
  );

  const opportunities = [];
  if (missingRuleCount > 0) {
    opportunities.push({
      title: "Проверить позиции без правила",
      text: `${missingRuleCount} позиций пока не вошли в начисления из-за отсутствующего правила.`,
      href: "/salary?tab=piecework-rules",
    });
  }
  if (ownVehicles.length === 0) {
    opportunities.push({
      title: "Нет начислений за выбранный период",
      text: "Когда появятся проведённые отгрузки вашей рабочей команды, они отобразятся здесь.",
      href: "/salary?tab=workdays",
    });
  }
  return opportunities;
}

function metricTitle(metric: PayrollGoalMetric) {
  if (metric === "ACCRUAL_AMOUNT") return "Цель по заработку";
  if (metric === "VEHICLES") return "Обслуженные автомобили";
  if (metric === "SERVICES") return "Услуги";
  if (metric === "PRODUCTS") return "Товарные позиции";
  if (metric === "SHIPMENTS") return "Отгрузки";
  if (metric === "QUALITY") return "Качество";
  if (metric === "DIAGNOSTICS") return "Диагностики";
  return "Согласованные рекомендации";
}

function goalCurrentValue(goal: PayrollGoalRecord, summary: PayrollSummary, login: string) {
  const ownVehicles = summary.vehicleHistory.filter((vehicle) => employeeEarnings(vehicle, login) > 0);
  if (goal.metric === "ACCRUAL_AMOUNT") return findPayrollRow(summary, login).totalCents;
  if (goal.metric === "SHIPMENTS" || goal.metric === "VEHICLES") return ownVehicles.length;
  if (goal.metric === "SERVICES") {
    return ownVehicles.reduce((sum, vehicle) => sum + employeeBreakdown(vehicle, login).filter((item) => item.category === "work").length, 0);
  }
  if (goal.metric === "PRODUCTS") {
    return ownVehicles.reduce((sum, vehicle) => sum + employeeBreakdown(vehicle, login).filter((item) => item.category === "product").length, 0);
  }
  return 0;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const previewUser = searchParams.get("previewUser");
  const login = session.user.role === "owner" && previewUser ? canonicalizeLogin(previewUser) : session.user.login;
  const today = toLocalDateString(new Date());
  const weekFrom = startOfWeek(today);
  const weekTo = addDays(weekFrom, 6);
  const month = monthBounds(today);

  const [users, todaySummary, weekSummary, monthSummary, settings, closedMonthEmployee] = await Promise.all([
    getUsersFromEnv(),
    getCachedPayrollSummary({ dateFrom: today, dateTo: today, targetLogin: login }),
    getCachedPayrollSummary({ dateFrom: weekFrom, dateTo: weekTo, targetLogin: login }),
    getCachedPayrollSummary({ dateFrom: month.dateFrom, dateTo: month.dateTo, targetLogin: login }),
    getMotivationSettings({ employeeLogin: login }),
    getPayrollPeriodEmployeeByRange({
      dateFrom: month.dateFrom,
      dateTo: month.dateTo,
      employeeLogin: login,
    }),
  ]);

  const employee = users.find((user) => normalizeLogin(user.login) === normalizeLogin(login)) ?? {
    login,
    name: login,
    role: session.user.role,
  };
  const monthRow = findPayrollRow(monthSummary, login);
  const todayShipments = todaySummary.vehicleHistory.filter((vehicle) => employeeEarnings(vehicle, login) > 0);
  const monthShipments = monthSummary.vehicleHistory
    .filter((vehicle) => employeeEarnings(vehicle, login) > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
  const accrualStatus = closedMonthEmployee ? "CONFIRMED" : "PRELIMINARY";
  const latestAccruals = monthShipments.slice(0, 10).map((vehicle) => buildShipmentCard(vehicle, login, accrualStatus));
  const currentShift = buildPeriodSummary(todaySummary, login);
  const monthWorkingDays = Math.max(1, monthRow.shiftsCount);
  const dailyAverageCents = Math.round(monthRow.totalCents / monthWorkingDays);
  const remainingAssignedDays = Math.max(0, 22 - monthRow.shiftsCount);
  const forecastLowCents = monthRow.totalCents + Math.round(dailyAverageCents * remainingAssignedDays * 0.85);
  const forecastHighCents = monthRow.totalCents + Math.round(dailyAverageCents * remainingAssignedDays * 1.15);
  const [goals, recognition] = await Promise.all([
    settings?.showGoals === false
      ? Promise.resolve([])
      : listActivePayrollGoals({
          employeeLogin: login,
          role: employee.role,
          dateKey: today,
        }),
    settings?.showRecognition === false
      ? Promise.resolve([])
      : listEmployeeRecognition({
          employeeLogin: login,
          limit: 10,
        }),
  ]);
  const userNameByLogin = new Map(users.map((user) => [user.login.toLowerCase(), user.name]));

  return NextResponse.json({
    employee: {
      login: employee.login,
      name: employee.name,
      role: employee.role,
      preview: session.user.role === "owner" && previewUser ? true : false,
    },
    status: closedMonthEmployee ? "CONFIRMED" : "PRELIMINARY",
    period: month,
    lastUpdatedAt: new Date().toISOString(),
    summary: buildPeriodSummary(monthSummary, login),
    today: buildPeriodSummary(todaySummary, login),
    shift: currentShift,
    week: buildPeriodSummary(weekSummary, login),
    month: buildPeriodSummary(monthSummary, login),
    paid: monthRow.paidOutCents,
    payable: monthRow.remainingCents,
    confirmed: {
      amountCents: closedMonthEmployee?.totalCents ?? 0,
      note: closedMonthEmployee
        ? "Период закрыт владельцем, сумма сохранена в payroll snapshot."
        : "Период ещё не закрыт владельцем.",
    },
    preliminary: {
      amountCents: closedMonthEmployee ? 0 : monthRow.totalCents,
      note: closedMonthEmployee
        ? "Предварительных начислений по закрытому периоду нет."
        : "Проведённые отгрузки и правила учтены, но период ещё может быть пересчитан.",
    },
    goals: goals.map((goal) => ({
      id: goal.id,
      title: metricTitle(goal.metric),
      currentValue: goalCurrentValue(goal, monthSummary, login),
      targetValue: goal.targetValue,
      baselineValue: goal.baselineValue,
      stretchValue: goal.stretchValue,
      unit: goal.metric === "ACCRUAL_AMOUNT" ? "money" : "count",
      status: goal.status,
    })),
    forecast: {
      available: settings?.showForecast !== false && monthRow.totalCents > 0,
      lowCents: forecastLowCents,
      highCents: forecastHighCents,
      note: "Это прогноз, а не гарантированная сумма.",
    },
    latestAccruals,
    recentShipments: latestAccruals,
    teamProgress: {
      label: todayShipments.length > 0 ? "Рабочая команда сегодня" : "Команда смены не определена",
      shipments: todayShipments.length,
      services: todayShipments.reduce((sum, vehicle) => sum + vehicle.works.length, 0),
      products: todayShipments.reduce((sum, vehicle) => sum + vehicle.products.length, 0),
      ownEarningsCents: currentShift.totalCents,
      goalLabel: "Цель смены пока не назначена",
    },
    quality: {
      items: [
        { label: "Возвраты и рекламации", value: "Данных пока нет", tone: "neutral" },
        { label: "Документы", value: "Ошибки не зафиксированы", tone: "success" },
      ],
    },
    achievements: [],
    recognition: recognition.map((item) => ({
      id: item.id,
      title: item.title,
      message: item.message,
      authorName: userNameByLogin.get(item.authorLogin.toLowerCase()) ?? item.authorLogin,
      createdAt: item.createdAt,
    })),
    opportunities: buildOpportunities(monthSummary, login),
  });
}
