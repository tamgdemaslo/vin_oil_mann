import { canonicalizeLogin } from "@/lib/auth";
import { getCachedPayrollSummary, type PayrollSummary, type VehicleRecord } from "@/lib/payroll";
import { getPayrollPeriodEmployeeByRange } from "@/lib/payroll-periods";

export type PersonalPayrollPeriod = "today" | "week" | "month" | "custom";

type PersonalPayrollQuery = {
  period: PersonalPayrollPeriod;
  dateFrom?: string | null;
  dateTo?: string | null;
};

type PayrollRow = PayrollSummary["byLogin"][string];

const EMPTY_PAYROLL_ROW: PayrollRow = {
  shiftTotalCents: 0,
  pieceworkCents: 0,
  bonusPenaltyCents: 0,
  paidOutCents: 0,
  remainingCents: 0,
  totalCents: 0,
  shiftsCount: 0,
};

function normalizeLogin(value: string) {
  return canonicalizeLogin(value).trim().toLowerCase();
}

function dateKeyInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function addDays(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function firstDayOfMonth(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`;
}

function firstDayOfWeek(dateKey: string) {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return addDays(dateKey, -mondayOffset);
}

export function resolvePersonalPayrollRange(query: PersonalPayrollQuery, timeZone: string) {
  const today = dateKeyInTimeZone(new Date(), timeZone);
  if (query.period === "today") return { dateFrom: today, dateTo: today };
  if (query.period === "week") return { dateFrom: firstDayOfWeek(today), dateTo: today };
  if (query.period === "month") return { dateFrom: firstDayOfMonth(today), dateTo: today };

  const dateFrom = query.dateFrom?.trim() ?? "";
  const dateTo = query.dateTo?.trim() ?? "";
  if (!parseDateKey(dateFrom) || !parseDateKey(dateTo)) {
    throw new Error("Для произвольного периода укажите корректные даты");
  }
  if (dateFrom > dateTo) throw new Error("Дата начала не может быть позже даты окончания");
  if (dateFrom < addDays(today, -366) || dateTo > today) {
    throw new Error("Произвольный период доступен в пределах последних 12 месяцев");
  }
  return { dateFrom, dateTo };
}

function payrollRow(summary: PayrollSummary, login: string) {
  const target = normalizeLogin(login);
  return Object.entries(summary.byLogin).find(([entryLogin]) => normalizeLogin(entryLogin) === target)?.[1] ?? EMPTY_PAYROLL_ROW;
}

function employeeEarnings(vehicle: VehicleRecord, login: string) {
  const target = normalizeLogin(login);
  return Object.entries(vehicle.earningsByLogin).find(([entryLogin]) => normalizeLogin(entryLogin) === target)?.[1] ?? 0;
}

function employeeComponents(vehicle: VehicleRecord, login: string) {
  const target = normalizeLogin(login);
  return Object.entries(vehicle.pieceworkBreakdownByLogin).find(([entryLogin]) => normalizeLogin(entryLogin) === target)?.[1] ?? [];
}

function shipmentItem(vehicle: VehicleRecord, login: string, status: "CONFIRMED" | "PRELIMINARY") {
  const components = employeeComponents(vehicle, login);
  return {
    id: vehicle.demandId,
    shipmentNumber: vehicle.demandName,
    date: vehicle.date,
    moment: vehicle.moment,
    clientName: vehicle.agentName || null,
    // The payroll engine does not reliably expose the car title. Returning
    // null is safer than reconstructing it from untrusted shipment metadata.
    vehicleLabel: null,
    earnedCents: employeeEarnings(vehicle, login),
    status,
    components: components.map((item) => ({
      label: item.label,
      category: item.category,
      quantity: item.quantity,
      amountCents: item.amountCents,
      ruleLabel: item.ruleLabel,
      basisLabel: item.basisLabel,
    })),
  };
}

/**
 * Builds the employee-only home widget from the canonical payroll engine.
 * Call under the verified branch request context; employee identity is passed
 * by the authenticated API route, never taken from a query parameter.
 */
export async function calculateEmployeePayrollSummary(params: {
  employeeLogin: string;
  timeZone: string;
  query: PersonalPayrollQuery;
}) {
  const period = resolvePersonalPayrollRange(params.query, params.timeZone);
  const today = dateKeyInTimeZone(new Date(), params.timeZone);
  const month = { dateFrom: firstDayOfMonth(today), dateTo: today };

  const [selectedSummary, monthSummary, todaySummary, closedPeriodEmployee] = await Promise.all([
    getCachedPayrollSummary({ ...period, targetLogin: params.employeeLogin }),
    getCachedPayrollSummary({ ...month, targetLogin: params.employeeLogin }),
    getCachedPayrollSummary({ dateFrom: today, dateTo: today, targetLogin: params.employeeLogin }),
    getPayrollPeriodEmployeeByRange({
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      employeeLogin: params.employeeLogin,
    }),
  ]);

  const row = payrollRow(selectedSummary, params.employeeLogin);
  const monthRow = payrollRow(monthSummary, params.employeeLogin);
  const todayRow = payrollRow(todaySummary, params.employeeLogin);
  const status = closedPeriodEmployee ? "CONFIRMED" : "PRELIMINARY";
  const earningVehicles = selectedSummary.vehicleHistory
    .filter((vehicle) => employeeEarnings(vehicle, params.employeeLogin) > 0)
    .sort((left, right) => right.moment.localeCompare(left.moment));
  const items = earningVehicles
    .slice(0, 20)
    .map((vehicle) => shipmentItem(vehicle, params.employeeLogin, status));
  const todayShipmentCount = todaySummary.vehicleHistory.filter(
    (vehicle) => employeeEarnings(vehicle, params.employeeLogin) > 0
  ).length;

  return {
    period: {
      from: period.dateFrom,
      to: period.dateTo,
      timezone: params.timeZone,
      kind: params.query.period,
    },
    lastUpdatedAt: new Date().toISOString(),
    status,
    summary: {
      earnedCents: row.totalCents,
      paidCents: row.paidOutCents,
      toPayCents: row.remainingCents,
      shipmentEarningsCents: row.pieceworkCents,
      shiftEarningsCents: row.shiftTotalCents,
      adjustmentsCents: row.bonusPenaltyCents,
      shipmentCount: earningVehicles.length,
      averageShipmentEarningsCents: earningVehicles.length ? Math.round(row.pieceworkCents / earningVehicles.length) : null,
    },
    today: {
      earnedCents: todayRow.totalCents,
      shipmentCount: todayShipmentCount,
      shipmentEarningsCents: todayRow.pieceworkCents,
      shiftEarningsCents: todayRow.shiftTotalCents,
    },
    month: {
      earnedCents: monthRow.totalCents,
      paidCents: monthRow.paidOutCents,
      toPayCents: monthRow.remainingCents,
    },
    items,
  };
}
