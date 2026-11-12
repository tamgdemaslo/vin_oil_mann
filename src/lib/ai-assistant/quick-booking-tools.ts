import { prisma } from "@/lib/db";
import { canViewBookings, bookingViewIsSelfOnly } from "@/lib/booking/access";
import { getBookingAvailability } from "@/lib/booking/availability";
import { journalId } from "@/lib/booking/journal-id";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import type { AIAssistantAccess } from "./access";

export async function lookupQuickCustomers(access: AIAssistantAccess, input: {
  name: string;
  phone: string;
  customerId: string;
}) {
  const phone = normalizePhoneKey(input.phone);
  if (!input.customerId && !phone && input.name.length < 2) return { error: "Уточните имя, телефон или откройте карточку клиента." };

  const customers = await prisma.localCounterparty.findMany({
    where: {
      branchId: access.branchId,
      archived: false,
      category: { not: "SUPPLIER" },
      ...(input.customerId ? { id: input.customerId } : phone ? { normalizedPhone: phone } : {
        OR: [
          { name: { contains: input.name, mode: "insensitive" } },
          { displayName: { contains: input.name, mode: "insensitive" } },
        ],
      }),
    },
    select: { id: true, name: true, displayName: true, phone: true, normalizedPhone: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 6,
  });

  if (customers.length !== 1) return {
    status: customers.length ? "ambiguous" : "not_found",
    matches: customers.slice(0, 5).map(customer => ({
      id: customer.id,
      name: customer.displayName || customer.name,
      phoneLast4: (customer.normalizedPhone || customer.phone)?.slice(-4) ?? null,
    })),
  };

  const [customer] = customers;
  const vehicles = await prisma.clientVehicle.findMany({
    where: { branchId: access.branchId, counterpartyId: customer.id },
    select: { make: true, model: true, year: true, engineCode: true, vin: true },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  return {
    status: "matched",
    customer: {
      id: customer.id,
      name: customer.displayName || customer.name,
      phone: customer.phone || customer.normalizedPhone,
      vehicles,
    },
  };
}

export async function listQuickBookingServices(access: AIAssistantAccess) {
  if (!canViewBookings(access.context)) return { error: "Журнал записей недоступен." };
  const services = await prisma.bookingService.findMany({
    where: { branchId: access.branchId, status: "ACTIVE", masters: { some: {} } },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 80,
  });
  return services;
}

export async function findQuickBookingSlots(access: AIAssistantAccess, input: {
  date: string;
  after: string;
  serviceIds: string[];
}) {
  if (!canViewBookings(access.context) || bookingViewIsSelfOnly(access.context)) {
    return { error: "Расписание мастеров недоступно." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || (input.after && !/^\d{2}:\d{2}$/.test(input.after)) || !input.serviceIds.length) {
    return { error: "Для поиска окна нужны дата, время в формате ЧЧ:ММ и услуги филиала." };
  }

  const availability = await getBookingAvailability({
    branchId: access.branchId,
    localDate: input.date,
    serviceIds: input.serviceIds,
    onlineOnly: false,
    respectLeadTime: false,
  });
  const slots = availability.slots
    .filter(slot => !input.after || slot.localTime > input.after)
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
    .slice(0, 5)
    .map(slot => ({ time: slot.localTime, master: slot.master.name, masterId: journalId(slot.master.membershipId) }));
  return { date: input.date, durationMinutes: availability.durationMinutes, slots, reason: availability.message };
}
