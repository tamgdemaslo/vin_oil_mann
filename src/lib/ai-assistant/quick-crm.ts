import type { Prisma } from "@prisma/client";
import type { AIAssistantAccess } from "./access";
import { bookingViewIsSelfOnly, canViewBookings } from "@/lib/booking/access";
import { addLocalDays, formatLocalDate, zonedLocalToUtc } from "@/lib/booking/timezone";
import { utcInstantToJournalLocal } from "@/lib/booking/journal-time";
import { journalId } from "@/lib/booking/journal-id";
import { BOOKING_STATUS } from "@/lib/booking/constants";
import { clientCaseStatusLabel, isClientCaseStatus } from "@/lib/client-case-shared";
import { prisma } from "@/lib/db";
import type { QuickSourceLink } from "@/lib/quick-assistant";

const LIMIT = 12;

export async function loadQuickCrmFacts(access: AIAssistantAccess, input: {
  customer: string;
  phone: string | null;
  caseRef: string;
  status: unknown;
  filter: unknown;
  timezone: string;
}) {
  const { customer, phone, caseRef, filter, status, timezone } = input;
  const now = new Date();
  const day = formatLocalDate(now, timezone);
  const openOnly = filter === "open" || filter === "today" || filter === "overdue";
  const where: Prisma.CrmDealWhereInput = { branchId: access.branchId, AND: [
    ...(caseRef ? [{ id: caseRef }] : []),
    ...(phone ? [{ phoneNormalized: phone }] : customer ? [{ customerName: { contains: customer, mode: "insensitive" as const } }] : []),
    ...(isClientCaseStatus(status) ? [{ caseStatus: status }] : []),
    ...(openOnly ? [{ status: "open", caseStatus: { notIn: ["closed", "cancelled", "duplicate"] } }] : []),
  ] };
  if (filter === "today" || filter === "overdue") {
    const range = filter === "today"
      ? { gte: zonedLocalToUtc(day, "00:00", timezone), lt: zonedLocalToUtc(addLocalDays(day, 1), "00:00", timezone) }
      : { lt: now };
    where.OR = [{ nextActionAt: range }, { nextActionAt: null, nextContactAt: range }];
  }

  const bookingsVisible = canViewBookings(access.context) && !bookingViewIsSelfOnly(access.context);
  const bookingsWhere: Prisma.BookingWhereInput | null = bookingsVisible && (phone || customer) ? {
    branchId: access.branchId,
    status: { not: BOOKING_STATUS.CANCELLED },
    startsAt: { gte: now },
    ...(phone ? { normalizedPhone: phone } : { customerName: { contains: customer, mode: "insensitive" } }),
  } : null;
  const [cases, matchingCases, bookings] = await Promise.all([
    prisma.crmDeal.findMany({
      where,
      select: {
        id: true, title: true, customerName: true, status: true, caseStatus: true, nextAction: true,
        nextActionAt: true, nextContactAt: true, updatedAt: true, responsibleLogin: true, shipmentId: true,
        stage: { select: { name: true } },
      },
      orderBy: filter === "today" || filter === "overdue"
        ? [{ nextActionAt: "asc" }, { nextContactAt: "asc" }, { id: "asc" }]
        : [{ updatedAt: "desc" }, { id: "asc" }],
      take: LIMIT,
    }),
    prisma.crmDeal.count({ where }),
    bookingsWhere ? prisma.booking.findMany({
      where: bookingsWhere,
      select: { id: true, customerName: true, startsAt: true, confirmationState: true },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 6,
    }) : null,
  ]);
  const shipmentIds = [...new Set(cases.flatMap(row => row.shipmentId ? [row.shipmentId] : []))];
  const shipments = shipmentIds.length ? await prisma.localDemand.findMany({
    where: { branchId: access.branchId, id: { in: shipmentIds } },
    select: { id: true, name: true, applicable: true, documentDate: true },
  }) : [];
  const shipmentsById = new Map(shipments.map(row => [row.id, {
    number: row.name, date: row.documentDate, status: row.applicable ? "Проведена" : "Черновик",
  }]));
  const localTime = (date: Date | null) => date ? utcInstantToJournalLocal(date, timezone) : null;
  const facts = {
    timezone, day, matchingCases, caseListTruncated: matchingCases > cases.length,
    cases: cases.map(row => ({
      customer: row.customerName?.slice(0, 160),
      title: row.title.slice(0, 160),
      state: row.status,
      stage: clientCaseStatusLabel(row.caseStatus, row.stage?.name),
      nextAction: row.nextAction?.slice(0, 180),
      deadline: localTime(row.nextActionAt ?? row.nextContactAt),
      updated: localTime(row.updatedAt),
      responsible: row.responsibleLogin,
      linkedShipment: row.shipmentId ? shipmentsById.get(row.shipmentId) : undefined,
    })),
    upcomingBookings: bookings?.slice(0, 5).map(row => ({
      customer: row.customerName.slice(0, 160),
      date: localTime(row.startsAt),
      confirmation: row.confirmationState,
    })) ?? null,
    bookingListTruncated: (bookings?.length ?? 0) > 5,
  };
  const sources: QuickSourceLink[] = cases.map(row => ({
    label: [row.customerName, row.title].filter(Boolean).join(" · ").slice(0, 160),
    href: `/crm?dealId=${encodeURIComponent(row.id)}`,
  }));
  for (const row of bookings?.slice(0, 5) ?? []) {
    sources.push({ label: `Запись · ${row.customerName} · ${localTime(row.startsAt)?.replace("T", " ")}`,
      href: `/records?recordId=${journalId(row.id)}` });
  }
  for (const row of shipments) {
    sources.push({ label: `Отгрузка № ${row.name} · ${row.documentDate}`,
      href: `/shipment/${encodeURIComponent(row.id)}/edit` });
  }
  return { facts, sources };
}
