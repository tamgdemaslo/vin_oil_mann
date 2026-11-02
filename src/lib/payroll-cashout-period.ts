export type PayrollCashoutPeriod = { periodFrom: string; periodTo: string };

const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];
const MONTH_FORMS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const MONTH_PATTERN = [...MONTHS, ...MONTH_FORMS].join("|");
const NAMED_MONTH = new RegExp(
  `(?:\\(\\s*|(?:зарплата|аванс)\\s+за\\s+)(${MONTH_PATTERN})(?:\\s+(\\d{4})(?:\\s*г\\.?)?)?\\s*(?=\\)|$|[,;.])`,
  "i",
);

function validDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validPeriod(periodFrom?: string | null, periodTo?: string | null) {
  return validDate(periodFrom) && validDate(periodTo) && periodFrom <= periodTo;
}

/** Cash dates stay unchanged; only payroll attribution uses this period. */
export function resolvePayrollCashoutPeriod(input: {
  expenseDate: string;
  payrollPeriodFrom?: string | null;
  payrollPeriodTo?: string | null;
  paymentPurpose?: string | null;
  expenseItemName?: string | null;
}): PayrollCashoutPeriod {
  if (validPeriod(input.payrollPeriodFrom, input.payrollPeriodTo)) {
    return { periodFrom: input.payrollPeriodFrom!, periodTo: input.payrollPeriodTo! };
  }

  // Older RKO records keep their payroll period only in the payment purpose.
  for (const text of [input.paymentPurpose, input.expenseItemName]) {
    if (!text) continue;
    const range = text.match(/период\s+(\d{4}-\d{2}-\d{2})\s*[-–—]\s*(\d{4}-\d{2}-\d{2})/i);
    if (range && validPeriod(range[1], range[2])) {
      return { periodFrom: range[1], periodTo: range[2] };
    }

    const namedMonth = text.match(NAMED_MONTH);
    if (!namedMonth || !validDate(input.expenseDate)) continue;
    const monthName = namedMonth[1].toLowerCase();
    const month = Math.max(MONTHS.indexOf(monthName), MONTH_FORMS.indexOf(monthName)) + 1;
    const cashYear = Number(input.expenseDate.slice(0, 4));
    const cashMonth = Number(input.expenseDate.slice(5, 7));
    // A salary month without a year refers to its latest occurrence by cash date.
    const year = namedMonth[2] ? Number(namedMonth[2]) : cashYear - (month > cashMonth ? 1 : 0);
    const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { periodFrom: `${prefix}-01`, periodTo: `${prefix}-${lastDay}` };
  }

  // Undated legacy advances continue to count on the actual payment day.
  return { periodFrom: input.expenseDate, periodTo: input.expenseDate };
}

export function payrollCashoutPeriodOverlaps(period: PayrollCashoutPeriod, dateFrom: string, dateTo: string) {
  return period.periodTo >= dateFrom && period.periodFrom <= dateTo;
}
