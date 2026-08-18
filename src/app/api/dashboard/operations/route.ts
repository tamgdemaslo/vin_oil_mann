import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { reconcileAppointmentShipments } from "@/lib/appointment-shipment-reconcile";
import { listAppointmentRowsForDate } from "@/lib/appointment-source";
import { getCurrentShift, listOperationsForShift } from "@/lib/cashbox";
import { clientCaseStatusLabel, normalizeClientCaseStatus } from "@/lib/client-case-shared";
import { SERVICE_TIME_ZONE, formatServiceTime, toServiceDateInput } from "@/lib/date-time";
import { prisma } from "@/lib/db";
import { resolveDashboardAccessForBranch } from "@/lib/dashboard-variant";

export const dynamic = "force-dynamic";

type NotificationUrgency = "urgent" | "today" | "soon" | "info";

type DashboardNotification = {
  id: string;
  urgency: NotificationUrgency;
  title: string;
  description: string;
  deadline?: string | null;
  entityLabel: string;
  entityHref: string;
  actionLabel: string;
};

type AppointmentRow = {
  id: string | number;
  createdAt?: string;
  name?: string;
  phone?: string;
  vin?: string;
  oilId?: string;
  slotId?: string;
  slot?: {
    id?: string;
    day?: string;
    date?: string;
    weekday?: string;
    time?: string;
    available?: boolean;
  };
  comment?: string;
  date?: string;
  datetime?: string;
  staff_id?: string | number;
  seance_length?: number;
  length?: number;
  attendance?: number;
  confirmed?: number;
  services?: Array<{ title?: string }>;
  client?: {
    display_name?: string;
    name?: string;
    phone?: string;
    is_new?: boolean;
  };
  vehicle?: JsonRecord;
  car?: JsonRecord;
  auto?: JsonRecord;
  vehicle_model?: string;
  vehicle_plate?: string;
  vehicle_vin?: string;
  source?: "local" | "yclients";
};

type JsonRecord = Record<string, unknown>;

type MessengerSummary = {
  total: number;
  needsReply: number;
  unread: number;
  oldest: {
    client: string;
    hours: number;
    href: string;
  } | null;
};

const LONG_OPEN_SHIFT_HOURS = 10;

function cents(amount: number) {
  return Math.round(amount);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function nestedValue(source: JsonRecord, keys: string[]): unknown {
  let cursor: unknown = source;
  for (const key of keys) {
    const record = asRecord(cursor);
    cursor = record[key];
  }
  return cursor;
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function arrayValue<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function truthyPaymentValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  const text = stringValue(value).toLowerCase();
  return ["true", "yes", "paid", "оплачено", "оплачен", "оплачена", "проведена"].includes(text);
}

function paymentStatusFromRaw(raw: unknown, applicable: boolean) {
  const record = asRecord(raw);
  const stateName = stringValue(nestedValue(record, ["state", "name"])).toLowerCase();
  const paymentStatus = stringValue(record.paymentStatus ?? record.payment_status ?? record.paidStatus).toLowerCase();
  const paidFlag = truthyPaymentValue(record.paid ?? record.isPaid ?? record.payed ?? record.paymentCompleted);
  if (paidFlag || stateName.includes("оплачен") || paymentStatus.includes("paid") || paymentStatus.includes("оплачен")) {
    return "paid" as const;
  }
  return applicable ? ("unknown" as const) : ("unpaid" as const);
}

function paymentKindFromRaw(raw: unknown) {
  const record = asRecord(raw);
  const candidates = [
    record.paymentType,
    record.payment_type,
    record.paymentMethod,
    record.payment_method,
    nestedValue(record, ["payment", "type"]),
    nestedValue(record, ["payment", "method"]),
  ].map((item) => stringValue(item).toLowerCase());
  if (candidates.some((item) => item.includes("card") || item.includes("эквай") || item.includes("карт"))) return "card";
  if (candidates.some((item) => item.includes("cash") || item.includes("нал"))) return "cash";
  return "unknown";
}

function lineProfitCents(position: {
  quantity: unknown;
  priceCentsPerUnit: number;
  buyPriceCentsPerUnit: number | null;
  discount: unknown;
}) {
  const quantity = Number(position.quantity ?? 0);
  const discount = Number(position.discount ?? 0);
  const sale = position.priceCentsPerUnit * quantity * (1 - discount / 100);
  const cost = (position.buyPriceCentsPerUnit ?? 0) * quantity;
  return cents(sale - cost);
}

function dateTimeForServiceDate(date: string, time = "00:00") {
  return new Date(`${date}T${time}:00`);
}

function appointmentDateTime(appointment: AppointmentRow) {
  const slotId = appointment.slotId || appointment.slot?.id || "";
  const matched = slotId.match(/^(\d{4}-\d{2}-\d{2})-(\d{4})$/);
  const raw = matched
    ? `${matched[1]}T${matched[2].slice(0, 2)}:${matched[2].slice(2)}:00`
    : stringValue(appointment.date ?? appointment.datetime).replace(" ", "T");
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function appointmentServiceDate(appointment: AppointmentRow) {
  const slotId = appointment.slotId || appointment.slot?.id || "";
  const localSlotDate = slotId.match(/^(\d{4}-\d{2}-\d{2})-/)?.[1] ?? "";
  if (localSlotDate) return localSlotDate;
  const date = appointmentDateTime(appointment);
  return date ? toServiceDateInput(date) : "";
}

function appointmentTime(appointment: AppointmentRow) {
  if (appointment.slot?.time) return appointment.slot.time;
  const date = appointmentDateTime(appointment);
  if (!date) return "";
  return formatServiceTime(date.toISOString());
}

function clockMinutes(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function appointmentDurationMinutes(appointment: AppointmentRow) {
  const seconds = Number(appointment.seance_length ?? appointment.length ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return 60;
  return Math.max(30, Math.min(480, Math.round(seconds / 60)));
}

function appointmentEndTime(appointment: AppointmentRow) {
  const startsAt = appointmentDateTime(appointment);
  if (!startsAt) return "";
  const endsAt = new Date(startsAt.getTime() + appointmentDurationMinutes(appointment) * 60_000);
  return formatServiceTime(endsAt.toISOString());
}

function appointmentClientName(appointment: AppointmentRow) {
  return appointment.client?.display_name || appointment.client?.name || appointment.name || "Клиент";
}

function appointmentPhone(appointment: AppointmentRow) {
  return appointment.client?.phone || appointment.phone || "";
}

function parseVehicleFromComment(comment?: string) {
  const vehicleLine = String(comment ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^авто:/i.test(line));
  if (!vehicleLine) return "";
  return vehicleLine.replace(/^авто:/i, "").trim();
}

function appointmentVehicle(appointment: AppointmentRow) {
  const client = asRecord(appointment.client);
  const candidates = [
    asRecord(appointment.vehicle),
    asRecord(appointment.car),
    asRecord(appointment.auto),
    asRecord(client.vehicle),
    asRecord(client.car),
    asRecord(client.auto),
  ];
  const first = candidates.find((item) => Object.keys(item).length > 0) ?? {};
  return [
    stringValue(first.model || first.title || first.name || appointment.vehicle_model),
    stringValue(first.plate || first.number || first.license_plate || appointment.vehicle_plate),
    stringValue(first.vin || first.VIN || appointment.vehicle_vin || appointment.vin),
  ]
    .filter(Boolean)
    .join(" · ") || parseVehicleFromComment(appointment.comment);
}

function appointmentService(appointment: AppointmentRow) {
  const serviceTitles = arrayValue<{ title?: string }>(appointment.services)
    .map((service) => stringValue(service.title))
    .filter(Boolean);
  return serviceTitles.join(", ") || appointment.comment || appointment.oilId || "Запись";
}

function appointmentStatus(appointment: AppointmentRow) {
  const rawStatus = stringValue(asRecord(appointment).status || asRecord(appointment).state).toLowerCase();
  if (/cancel|отмен/.test(rawStatus)) return "отменена";
  if (/done|finish|complete|заверш/.test(rawStatus)) return "завершена";
  if (appointment.attendance === -1) return "не пришёл";
  if (appointment.attendance === 1) return "приехал";
  if (appointment.confirmed === 1) return "подтверждена";
  if (appointment.client?.is_new) return "новая";
  return "ожидает";
}

function appointmentIsConfirmed(appointment: AppointmentRow) {
  return appointment.confirmed === 1 || appointment.attendance === 1;
}

function dueLabel(date: Date | string | null | undefined) {
  if (!date) return null;
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function notificationSortWeight(item: DashboardNotification) {
  const urgencyWeight = { urgent: 0, today: 1, soon: 2, info: 3 } satisfies Record<NotificationUrgency, number>;
  return urgencyWeight[item.urgency];
}

async function getCashState() {
  const shift = await getCurrentShift();
  if (!shift) {
    return {
      shift: null,
      operations: [],
      expensesCents: 0,
      withdrawalsCents: 0,
      expectedBalanceCents: 0,
      openedHours: 0,
    };
  }
  const operations = await listOperationsForShift(shift.id);
  const expenses = operations
    .filter((op) => op.type === "expense" && op.status !== "draft" && op.status !== "cancelled")
    .reduce((sum, op) => sum + op.amount, 0);
  const cashExpenses = operations
    .filter((op) => op.type === "expense" && op.paymentType === "cash" && op.status !== "draft" && op.status !== "cancelled")
    .reduce((sum, op) => sum + op.amount, 0);
  const withdrawals = operations
    .filter((op) => op.type === "withdrawal")
    .reduce((sum, op) => sum + op.amount, 0);
  const openedAt = new Date(shift.openedAt);
  const openedHours = Number.isNaN(openedAt.getTime()) ? 0 : (Date.now() - openedAt.getTime()) / 3_600_000;
  return {
    shift,
    operations,
    expensesCents: cents(expenses * 100),
    withdrawalsCents: cents(withdrawals * 100),
    expectedBalanceCents: cents(((shift.openingCash || 0) - cashExpenses - withdrawals) * 100),
    openedHours,
  };
}

async function getMessengerSummary(organizationId: string): Promise<MessengerSummary> {
  const empty = { total: 0, needsReply: 0, unread: 0, oldest: null };
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        total: number | null;
        needsReply: number | null;
        unread: number | null;
        oldestClient: string | null;
        oldestHours: number | null;
      }>
    >`
      WITH visible AS (
        SELECT title, participant_name, last_message_at, unread_count, status
        FROM messenger_conversations
        WHERE organization_id = ${organizationId}
          AND status <> 'archived'
      ),
      needs_reply AS (
        SELECT *
        FROM visible
        WHERE status = 'needs_reply' OR unread_count > 0
      )
      SELECT
        COALESCE((SELECT COUNT(*)::int FROM visible), 0) AS "total",
        COALESCE((SELECT COUNT(*)::int FROM needs_reply), 0) AS "needsReply",
        COALESCE((SELECT SUM(unread_count)::int FROM visible), 0) AS "unread",
        (
          SELECT COALESCE(NULLIF(participant_name, ''), NULLIF(title, ''), 'Клиент')
          FROM needs_reply
          ORDER BY last_message_at ASC
          LIMIT 1
        ) AS "oldestClient",
        (
          SELECT GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - last_message_at)) / 3600)::int)
          FROM needs_reply
          ORDER BY last_message_at ASC
          LIMIT 1
        ) AS "oldestHours"
    `;
    const row = rows[0];
    if (!row) return empty;
    return {
      total: row.total ?? 0,
      needsReply: row.needsReply ?? 0,
      unread: row.unread ?? 0,
      oldest: row.oldestClient
        ? {
            client: row.oldestClient,
            hours: row.oldestHours ?? 0,
            href: "/messages",
          }
        : null,
    };
  } catch {
    return empty;
  }
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const audience = session.user.role === "owner" || session.user.role === "admin" ? session.user.role : "master";
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const branch = access.context;
  if (!branch.branchId || !branch.organizationId) {
    return NextResponse.json({ error: "Выберите конкретный филиал" }, { status: 409 });
  }
  const branchId = branch.branchId;
  const organizationId = branch.organizationId;
  const dashboardAccess = await resolveDashboardAccessForBranch(branch);

  // The master-receiver uses the operational day center too, while the
  // capability flags below keep finance and client-management data hidden.
  if (dashboardAccess.variant === "EMPLOYEE" && session.user.role !== "master") {
    return NextResponse.json({
      variant: dashboardAccess.variant,
      audience,
      timezone: branch.branch?.timezone ?? SERVICE_TIME_ZONE,
      capabilities: dashboardAccess,
    });
  }
  const { canViewFinance, canViewClientOperations } = dashboardAccess;

  return runWithBranchApiContext(branch, async () => {

  const today = toServiceDateInput(new Date());
  const tomorrow = toServiceDateInput(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const soonLimit = toServiceDateInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const todayStart = dateTimeForServiceDate(today);
  const tomorrowStart = dateTimeForServiceDate(tomorrow);

  const [
    cashState,
    todayDemands,
    activeDemands,
    crmDeals,
    lowStockRows,
    supplierInvoices,
    diagnosticStats,
    latestDocuments,
    messengerSummary,
  ] = await Promise.all([
    getCashState(),
    prisma.localDemand.findMany({
      where: { branchId, documentDate: today },
      include: { positions: true, counterparty: true, diagnosticMapSessions: { select: { id: true }, take: 1 } },
      orderBy: [{ momentAt: "desc" }],
      take: 80,
    }),
    prisma.localDemand.findMany({
      where: {
        branchId,
        OR: [{ documentDate: today }, { applicable: false }],
      },
      include: { positions: true, counterparty: true, diagnosticMapSessions: { select: { id: true }, take: 1 } },
      orderBy: [{ momentAt: "desc" }],
      take: 12,
    }),
    prisma.crmDeal.findMany({
      where: { branchId, status: "open" },
      include: { stage: true },
      orderBy: [{ nextActionAt: "asc" }, { nextContactAt: "asc" }, { updatedAt: "desc" }],
      take: 80,
    }),
    prisma.localStockBalance.findMany({
      where: {
        branchId,
        product: {
          branchId,
          archived: false,
          minimumBalance: { not: null },
        },
      },
      include: { product: true, store: true },
      take: 300,
    }),
    prisma.localSupplierInvoice.findMany({
      where: { status: { in: ["unpaid", "partial"] }, document: { store: { branchId } } },
      include: { document: true },
      orderBy: [{ dueDate: "asc" }, { invoiceDate: "asc" }],
      take: 12,
    }),
    Promise.all([
      prisma.diagnosticMapSession.count({ where: { branchId, status: { in: ["DRAFT", "IN_PROGRESS"] } } }),
      prisma.diagnosticMapSession.count({ where: { branchId, status: { in: ["DRAFT", "IN_PROGRESS"] }, withoutPhotoCount: { gt: 0 } } }),
      prisma.diagnostic.count({ where: { branchId, status: { in: ["DRAFT", "IN_PROGRESS"] } } }),
    ]),
    prisma.localInventoryDocument.findMany({
      where: { isDeleted: false, store: { branchId } },
      orderBy: [{ momentAt: "desc" }],
      take: 5,
    }),
    getMessengerSummary(organizationId),
  ]);

  const notifications: DashboardNotification[] = [];
  const todayShipments = todayDemands.filter((demand) => demand.applicable);
  const revenueCents = todayShipments.reduce((sum, demand) => sum + demand.sumCents, 0);
  const grossProfitCents = todayShipments.reduce(
    (sum, demand) => sum + demand.positions.reduce((lineSum, position) => lineSum + lineProfitCents(position), 0),
    0
  );
  const paidStats = todayShipments.reduce(
    (acc, demand) => {
      const paymentStatus = paymentStatusFromRaw(demand.raw, demand.applicable);
      const kind = paymentKindFromRaw(demand.raw);
      if (paymentStatus === "paid") acc.paidCents += demand.sumCents;
      if (paymentStatus === "unpaid") acc.unpaidCents += demand.sumCents;
      if (kind === "cash") acc.cashCents += demand.sumCents;
      if (kind === "card") acc.cardCents += demand.sumCents;
      return acc;
    },
    { paidCents: 0, unpaidCents: 0, cashCents: 0, cardCents: 0 }
  );
  const applicableToday = todayShipments.length;
  const missingDiagnostic = todayShipments.filter((demand) => demand.diagnosticMapSessions.length === 0).length;
  const missingPrecheck = todayShipments.filter((demand) => {
    const attrs = JSON.stringify(demand.attributes ?? demand.raw ?? {}).toLowerCase();
    return !attrs.includes("предчек") && !attrs.includes("precheck");
  }).length;

  const rawAppointments = await listAppointmentRowsForDate(today) as AppointmentRow[];
  const todayAppointments = rawAppointments
    .filter((item) => appointmentServiceDate(item) === today)
    .sort((a, b) => (appointmentDateTime(a)?.getTime() ?? 0) - (appointmentDateTime(b)?.getTime() ?? 0));
  const now = new Date();
  const nextAppointment = todayAppointments.find((item) => {
    const value = appointmentDateTime(item);
    return value ? value.getTime() >= now.getTime() : false;
  }) ?? null;
  const appointmentShipmentStatuses = reconcileAppointmentShipments(todayAppointments, todayShipments);
  const appointmentShipmentStatusById = new Map(appointmentShipmentStatuses.map((status) => [status.appointmentId, status]));
  const appointmentsWithoutShipment = todayAppointments.filter((item) => {
    const id = stringValue(item.id);
    return Boolean(id && appointmentShipmentStatusById.get(id)?.countsAsWithoutShipment);
  });
  const appointmentsRequiringManualLink = appointmentShipmentStatuses.filter((status) => status.requiresManualLink);
  const appointmentsMatchedByRules = appointmentShipmentStatuses.filter(
    (status) => status.hasShipment && status.linkSource && status.linkSource !== "created_from_appointment" && status.linkSource !== "manual"
  );
  const occupiedIntervals = todayAppointments.flatMap((item) => {
    if (appointmentStatus(item) === "отменена") return [];
    const start = clockMinutes(appointmentTime(item));
    if (start === null) return [];
    return [{ start, end: start + appointmentDurationMinutes(item) }];
  });
  const freeWindows = ["09:00", "10:30", "12:00", "13:30", "16:00", "17:00", "18:30"].filter((time) => {
    const start = clockMinutes(time);
    if (start === null) return false;
    const end = start + 60;
    return !occupiedIntervals.some((interval) => start < interval.end && end > interval.start);
  });

  const crmDueAt = (deal: (typeof crmDeals)[number]) => deal.nextActionAt ?? deal.nextContactAt;
  const crmToday = crmDeals.filter((deal) => {
    const dueAt = crmDueAt(deal);
    return dueAt && dueAt >= todayStart && dueAt < tomorrowStart;
  });
  const crmOverdue = crmDeals.filter((deal) => {
    const dueAt = crmDueAt(deal);
    return dueAt && dueAt < now;
  });
  const oldestOverdueHours = crmOverdue.reduce((max, deal) => {
    const dueAt = crmDueAt(deal);
    if (!dueAt) return max;
    return Math.max(max, Math.floor((now.getTime() - dueAt.getTime()) / 3_600_000));
  }, 0);
  const crmNoResponsible = crmDeals.filter((deal) => !deal.responsibleLogin);
  const crmQuote = crmDeals.filter((deal) => normalizeClientCaseStatus(deal.caseStatus, deal.stage.name) === "calculation_needed");
  const crmSupplies = crmDeals.filter((deal) => normalizeClientCaseStatus(deal.caseStatus, deal.stage.name) === "waiting_parts");
  const crmCallback = crmDeals.filter((deal) => normalizeClientCaseStatus(deal.caseStatus, deal.stage.name) === "check_response");

  for (const deal of crmOverdue.slice(0, 8)) {
    notifications.push({
      id: `crm-overdue-${deal.id}`,
      urgency: "urgent",
      title: `${deal.nextAction || "Связаться с клиентом"} — просрочено`,
      description: [deal.customerName || deal.title, deal.phoneNormalized || "", deal.vehicle || ""].filter(Boolean).join(" · "),
      deadline: dueLabel(crmDueAt(deal)),
      entityLabel: "CRM-дело",
      entityHref: `/crm?dealId=${deal.id}`,
      actionLabel: "Открыть",
    });
  }

  for (const item of appointmentsWithoutShipment.slice(0, 5)) {
    notifications.push({
      id: `appointment-no-shipment-${item.id}`,
      urgency: "today",
      title: `Запись в ${appointmentTime(item) || "—"} без найденной отгрузки`,
      description:
        [appointmentClientName(item), appointmentVehicle(item), appointmentService(item)].filter(Boolean).join(" · ") ||
        "Нужно подготовить отгрузку или связать существующую.",
      deadline: dueLabel(appointmentDateTime(item)),
      entityLabel: "Запись",
      entityHref: "/records",
      actionLabel: "Создать отгрузку",
    });
  }

  for (const status of appointmentsRequiringManualLink.slice(0, 5)) {
    const item = todayAppointments.find((appointment) => stringValue(appointment.id) === status.appointmentId);
    notifications.push({
      id: `appointment-link-shipment-${status.appointmentId}`,
      urgency: "today",
      title: `Запись в ${item ? appointmentTime(item) || "—" : "—"} нужно связать с отгрузкой`,
      description:
        status.candidates.slice(0, 3).map((candidate) => `${candidate.shipmentName} · ${candidate.client}`).join(" · ") ||
        "Найдено несколько возможных отгрузок.",
      deadline: dueLabel(item ? appointmentDateTime(item) : null),
      entityLabel: "Запись",
      entityHref: `/records?recordId=${encodeURIComponent(status.appointmentId)}`,
      actionLabel: "Связать",
    });
  }

  if (!cashState.shift) {
    notifications.push({
      id: "cash-closed",
      urgency: "urgent",
      title: "Касса закрыта",
      description: "Перед продажами откройте кассовую смену и задайте стартовый остаток.",
      deadline: null,
      entityLabel: "Касса",
      entityHref: "/cash#cash-state",
      actionLabel: "Открыть кассу",
    });
  } else if (cashState.openedHours >= LONG_OPEN_SHIFT_HOURS) {
    notifications.push({
      id: "cash-open-long",
      urgency: "today",
      title: `Касса открыта с ${formatServiceTime(cashState.shift.openedAt)}`,
      description: `Смена открыта ${Math.floor(cashState.openedHours)} ч. Проверьте, нужно ли закрыть кассу.`,
      deadline: dueLabel(cashState.shift.openedAt),
      entityLabel: "Касса",
      entityHref: "/cash#cash-state",
      actionLabel: "Закрыть кассу",
    });
  }

  const unpaidToday = todayShipments.filter((demand) => paymentStatusFromRaw(demand.raw, demand.applicable) === "unpaid");
  if (unpaidToday.length > 0) {
    notifications.push({
      id: "unpaid-demands-today",
      urgency: "today",
      title: `${unpaidToday.length} неоплаченных отгрузок за сегодня`,
      description: "Проверьте оплату и статус документов.",
      deadline: null,
      entityLabel: "Отгрузки",
      entityHref: "/shipment?filter=unpaid",
      actionLabel: "Открыть",
    });
  }

  const unpaidInvoices = supplierInvoices.filter((invoice) => invoice.status !== "paid");
  for (const invoice of unpaidInvoices.slice(0, 4)) {
    const due = invoice.dueDate ? dateTimeForServiceDate(invoice.dueDate) : null;
    notifications.push({
      id: `supplier-invoice-${invoice.id}`,
      urgency: invoice.dueDate && invoice.dueDate <= today ? "urgent" : invoice.dueDate && invoice.dueDate <= soonLimit ? "soon" : "info",
      title: `Счёт поставщика на ${Math.round(invoice.sumCents / 100).toLocaleString("ru-RU")} ₽ не оплачен`,
      description: invoice.counterpartyNameSnapshot || invoice.document.counterpartyNameSnapshot || invoice.number || "Счёт поставщика",
      deadline: dueLabel(due),
      entityLabel: "Счёт поставщика",
      entityHref: "/finance/invoices?status=unpaid",
      actionLabel: "Открыть",
    });
  }

  const lowStock = lowStockRows.filter((row) => Number(row.available) < Number(row.product.minimumBalance ?? 0));
  if (lowStock.length > 0) {
    notifications.push({
      id: "low-stock",
      urgency: "today",
      title: `${lowStock.length} товаров ниже минимума`,
      description: lowStock.slice(0, 3).map((row) => row.product.name).join(" · "),
      deadline: null,
      entityLabel: "Склад",
      entityHref: "/inventory/restock?mode=below_min",
      actionLabel: "Открыть",
    });
  }

  const [activeDiagnosticMapCount, diagnosticWithoutPhotoCount, legacyDiagnosticOpenCount] = diagnosticStats;
  if (diagnosticWithoutPhotoCount > 0 || legacyDiagnosticOpenCount > 0) {
    notifications.push({
      id: "diagnostics-open",
      urgency: "info",
      title: "Есть диагностики без полного отчёта",
      description: `${activeDiagnosticMapCount + legacyDiagnosticOpenCount} в работе, ${diagnosticWithoutPhotoCount} с незакрытыми фото-пунктами.`,
      deadline: null,
      entityLabel: "Диагностики",
      entityHref: "/shipment",
      actionLabel: "Открыть",
    });
  }

  for (const deal of crmToday.slice(0, 5)) {
    notifications.push({
      id: `crm-today-${deal.id}`,
      urgency: "today",
      title: deal.nextAction || "Дело клиента на сегодня",
      description: [deal.customerName || deal.title, deal.phoneNormalized || "", deal.vehicle || ""].filter(Boolean).join(" · "),
      deadline: dueLabel(crmDueAt(deal)),
      entityLabel: "CRM-дело",
      entityHref: `/crm?dealId=${deal.id}`,
      actionLabel: "Открыть",
    });
  }

  const sortedNotifications = notifications
    .sort((a, b) => notificationSortWeight(a) - notificationSortWeight(b) || String(a.deadline ?? "").localeCompare(String(b.deadline ?? "")))
    .slice(0, 80);

  const visibleNotifications = audience === "master"
    ? sortedNotifications.filter((item) => item.id.startsWith("appointment-") || item.id === "diagnostics-open")
    : sortedNotifications;
  const alerts = [
    ...(cashState.shift
      ? [{ id: "cash-open", label: "Нужно закрыть кассу", href: "/cash#cash-state", count: cashState.openedHours >= LONG_OPEN_SHIFT_HOURS ? 1 : 0, tone: "warning" }]
      : [{ id: "cash-closed", label: "Касса закрыта", href: "/cash#cash-state", count: 1, tone: "danger" }]),
    { id: "crm-overdue", label: "Есть просроченные дела", href: "/crm?filter=overdue", count: crmOverdue.length, tone: "danger" },
    { id: "appointments-no-shipment", label: "Есть записи без найденной отгрузки", href: "/records?filter=no-shipment", count: appointmentsWithoutShipment.length, tone: "warning" },
    { id: "appointments-link-manual", label: "Есть записи для ручной связи", href: "/records?filter=shipment-link", count: appointmentsRequiringManualLink.length, tone: "warning" },
    { id: "unpaid-docs", label: "Есть неоплаченные документы", href: "/shipment?filter=unpaid", count: unpaidToday.length + unpaidInvoices.length, tone: "warning" },
    { id: "low-stock", label: "Есть товары ниже минимума", href: "/inventory/restock?mode=below_min", count: lowStock.length, tone: "warning" },
    { id: "diagnostics", label: "Есть диагностики без отчёта", href: "/shipment?filter=diagnostics", count: diagnosticWithoutPhotoCount, tone: "info" },
  ];
  const visibleAlerts = audience === "master"
    ? alerts.filter((item) => item.id.startsWith("appointments-") || item.id === "diagnostics")
    : alerts;

    return NextResponse.json({
    today,
    timezone: branch.branch?.timezone ?? SERVICE_TIME_ZONE,
    variant: dashboardAccess.variant,
    audience,
    capabilities: {
      canViewFinance,
      canViewClientOperations,
      canManageCash: dashboardAccess.canManageCash,
    },
    finance: canViewFinance ? {
      revenueCents,
      grossProfitCents,
      averageCheckCents: todayShipments.length ? cents(revenueCents / todayShipments.length) : 0,
      shipmentsCount: todayShipments.length,
      paidCents: paidStats.paidCents,
      unpaidCents: paidStats.unpaidCents,
      cashCents: paidStats.cashCents,
      cardCents: paidStats.cardCents,
      paymentSourceLabel: "по признакам документа",
    } : null,
    cash: {
      status: cashState.shift ? "open" : "closed",
      openedBy: cashState.shift?.openedBy?.name ?? cashState.shift?.openedBy?.login ?? null,
      openedAt: cashState.shift?.openedAt ?? null,
      startBalanceCents: audience === "master" ? null : cents((cashState.shift?.openingCash ?? 0) * 100),
      expectedBalanceCents: audience === "master" ? null : cashState.expectedBalanceCents,
      expensesCents: audience === "master" ? null : cashState.expensesCents,
      withdrawalsCents: audience === "master" ? null : cashState.withdrawalsCents,
      discrepancyCents: audience === "master" ? null : cents((cashState.shift?.discrepancy ?? 0) * 100),
      openedHours: cashState.openedHours,
    },
    appointments: {
      totalToday: todayAppointments.length,
      confirmedToday: todayAppointments.filter(appointmentIsConfirmed).length,
      withoutShipment: appointmentsWithoutShipment.length,
      requiresManualLink: appointmentsRequiringManualLink.length,
      matchedByRules: appointmentsMatchedByRules.length,
      freeWindows,
      next: nextAppointment
        ? {
            id: nextAppointment.id,
            time: appointmentTime(nextAppointment),
            endTime: appointmentEndTime(nextAppointment),
            durationMinutes: appointmentDurationMinutes(nextAppointment),
            client: appointmentClientName(nextAppointment),
            vehicle: appointmentVehicle(nextAppointment),
            service: appointmentService(nextAppointment),
            status: appointmentStatus(nextAppointment),
            shipmentId: appointmentShipmentStatusById.get(stringValue(nextAppointment.id))?.matchedShipment?.shipmentId ?? null,
            hasShipment: appointmentShipmentStatusById.get(stringValue(nextAppointment.id))?.hasShipment ?? false,
            shipmentStatus: appointmentShipmentStatusById.get(stringValue(nextAppointment.id))?.label ?? "Отгрузка не найдена",
          }
        : null,
      rows: todayAppointments.slice(0, 80).map((item) => ({
        id: item.id,
        time: appointmentTime(item),
        endTime: appointmentEndTime(item),
        durationMinutes: appointmentDurationMinutes(item),
        client: appointmentClientName(item),
        phone: appointmentPhone(item),
        vehicle: appointmentVehicle(item),
        service: appointmentService(item),
        status: appointmentStatus(item),
        shipmentId: appointmentShipmentStatusById.get(stringValue(item.id))?.matchedShipment?.shipmentId ?? null,
        hasShipment: appointmentShipmentStatusById.get(stringValue(item.id))?.hasShipment ?? false,
        shipmentStatus: appointmentShipmentStatusById.get(stringValue(item.id))?.label ?? "Отгрузка не найдена",
      })),
      shipmentStatuses: appointmentShipmentStatuses.map((status) => ({
        appointmentId: status.appointmentId,
        kind: status.kind,
        label: status.label,
        hasShipment: status.hasShipment,
        countsAsWithoutShipment: status.countsAsWithoutShipment,
        requiresManualLink: status.requiresManualLink,
        linkSource: status.linkSource,
        confidence: status.confidence,
        matchedShipment: status.matchedShipment,
        candidates: status.candidates.slice(0, 5),
      })),
    },
    crm: canViewClientOperations ? {
      overdue: crmOverdue.length,
      oldestOverdueHours,
      today: crmToday.length,
      quote: crmQuote.length,
      supplies: crmSupplies.length,
      callback: crmCallback.length,
      noResponsible: crmNoResponsible.length,
      rows: [...crmOverdue, ...crmToday, ...crmDeals]
        .filter((deal, index, arr) => arr.findIndex((item) => item.id === deal.id) === index)
        .slice(0, 7)
        .map((deal) => ({
          id: deal.id,
          client: deal.customerName || deal.title,
          phone: deal.phoneNormalized || "",
          title: deal.nextAction || deal.title,
          status: clientCaseStatusLabel(deal.caseStatus, deal.stage.name),
          deadline: dueLabel(crmDueAt(deal)),
          responsible: deal.responsibleLogin || "без ответственного",
        })),
    } : null,
    shipments: {
      today: todayShipments.length,
      drafts: activeDemands.filter((demand) => !demand.applicable).length,
      applicable: applicableToday,
      unpaid: unpaidToday.length,
      withoutDiagnostic: missingDiagnostic,
      withoutPrecheck: missingPrecheck,
      rows: todayShipments.slice(0, 8).map((demand) => ({
        id: demand.id,
        name: demand.name,
        moment: demand.momentAt.toISOString(),
        client: demand.counterparty?.name || demand.agentNameSnapshot || "Клиент не указан",
        store: demand.storeNameSnapshot || demand.organizationName || "",
        creator: stringValue(asRecord(demand.raw).ecoUserName) || "",
        applicable: demand.applicable,
        sumCents: audience === "master" ? null : demand.sumCents,
        paymentStatus: paymentStatusFromRaw(demand.raw, demand.applicable),
        hasDiagnostic: demand.diagnosticMapSessions.length > 0,
      })),
    },
    stock: canViewClientOperations ? {
      belowMin: lowStock.length,
      rows: lowStock.slice(0, 5).map((row) => ({
        id: row.product.id,
        name: row.product.name,
        available: Number(row.available),
        minimum: Number(row.product.minimumBalance ?? 0),
        store: row.store.name,
      })),
    } : null,
    suppliers: canViewClientOperations ? {
      unpaidInvoices: unpaidInvoices.length,
      amountCents: unpaidInvoices.reduce((sum, invoice) => sum + Math.max(0, invoice.sumCents - invoice.paidAmountCents), 0),
      rows: unpaidInvoices.slice(0, 5).map((invoice) => ({
        id: invoice.id,
        number: invoice.number || invoice.document.name,
        supplier: invoice.counterpartyNameSnapshot || invoice.document.counterpartyNameSnapshot || "Поставщик",
        dueDate: invoice.dueDate,
        amountCents: Math.max(0, invoice.sumCents - invoice.paidAmountCents),
        status: invoice.status,
      })),
    } : null,
    diagnostics: {
      active: activeDiagnosticMapCount + legacyDiagnosticOpenCount,
      withoutPhoto: diagnosticWithoutPhotoCount,
    },
    messages: canViewClientOperations ? messengerSummary : null,
    alerts: visibleAlerts,
    notifications: visibleNotifications,
    notificationCounts: visibleNotifications.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.urgency] += 1;
        return acc;
      },
      { total: 0, urgent: 0, today: 0, soon: 0, info: 0 }
    ),
    documents: (audience === "master" ? [] : latestDocuments).map((doc) => ({
      id: doc.id,
      type: doc.type,
      name: doc.name,
      date: doc.documentDate,
      sumCents: doc.sumCents,
      href: doc.type === "receipt" ? `/inventory/receipts?id=${doc.id}` : "/inventory/writeoffs",
    })),
    });
  });
}
