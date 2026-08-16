import { getBookingAvailability } from "@/lib/booking/availability";
import { BOOKING_SOURCE } from "@/lib/booking/constants";
import { notifyBookingCreated } from "@/lib/booking/notifications";
import { createBooking } from "@/lib/booking/service";
import { addLocalDays, formatLocalDate, zonedLocalToUtc } from "@/lib/booking/timezone";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";

export type AgentBookingSlot = {
  id: string;
  datetime: string;
  date: string;
  time: string;
  staffId: string;
  serviceId: string;
  address: string;
  durationMinutes: number;
  source: "internal";
};

function parseVehicleLabel(label: string | null | undefined) {
  const normalized = label?.trim() ?? "";
  const parts = normalized.split(/\s+/u).filter(Boolean);
  return {
    make: parts[0] || "Автомобиль",
    model: parts.slice(1).join(" ") || "Не указан",
  };
}

async function selectBookingService(branchId: string, durationMinutes: number) {
  const services = await prisma.bookingService.findMany({
    where: {
      branchId,
      status: "ACTIVE",
      onlineBookingEnabled: true,
      masters: {
        some: {
          membership: { status: "active", user: { status: "active" } },
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  if (!services.length) {
    throw new Error("Для филиала не настроена активная услуга и мастер собственной системы записи");
  }
  return services.sort((left, right) =>
    Math.abs(left.durationMinutes - durationMinutes) - Math.abs(right.durationMinutes - durationMinutes) ||
    left.sortOrder - right.sortOrder ||
    left.name.localeCompare(right.name, "ru")
  )[0];
}

export async function getInternalAvailableSlots(input: {
  limit: number;
  minLeadMinutes: number;
  horizonDays: number;
  durationMinutes: number;
  baseServiceDurationMinutes?: number;
  requestedDate?: string | null;
}): Promise<AgentBookingSlot[]> {
  const branchId = getScopedBranchId();
  const [branch, service] = await Promise.all([
    prisma.branch.findFirst({
      where: { id: branchId, status: "active" },
      select: { id: true, address: true, timezone: true, bookingSettings: true },
    }),
    selectBookingService(branchId, input.durationMinutes),
  ]);
  if (!branch) throw new Error("Филиал собственной системы записи не найден");

  const today = formatLocalDate(new Date(), branch.timezone);
  const firstDate = input.requestedDate && input.requestedDate >= today ? input.requestedDate : today;
  const configuredHorizon = Math.max(1, Math.min(branch.bookingSettings?.bookingHorizonDays ?? 60, 365));
  const horizonDays = Math.max(1, Math.min(input.horizonDays, configuredHorizon));
  const lastDate = addLocalDays(today, horizonDays);
  const earliest = Date.now() + Math.max(0, input.minLeadMinutes) * 60_000;
  const slots: AgentBookingSlot[] = [];

  for (let date = firstDate, checked = 0; date <= lastDate && checked <= horizonDays; date = addLocalDays(date, 1), checked += 1) {
    const availability = await getBookingAvailability({
      branchId,
      localDate: date,
      serviceIds: [service.id],
      onlineOnly: false,
      respectLeadTime: true,
      durationOverrideMinutes: input.durationMinutes,
    });
    for (const slot of availability.slots) {
      if (new Date(slot.startsAt).getTime() < earliest) continue;
      const id = `booking:${slot.master.membershipId}:${service.id}:${date}:${slot.localTime}`;
      slots.push({
        id,
        datetime: slot.startsAt,
        date,
        time: slot.localTime,
        staffId: slot.master.membershipId,
        serviceId: service.id,
        address: branch.address ?? "",
        durationMinutes: input.durationMinutes,
        source: "internal",
      });
      if (slots.length >= input.limit) return slots;
    }
  }
  return slots;
}

export function parseInternalSlotId(slotId: string) {
  const match = slotId.match(/^booking:([^:]+):([^:]+):(20\d{2}-\d{2}-\d{2}):(\d{2}:\d{2})$/);
  if (!match) throw new Error("Неизвестный идентификатор окна записи");
  return { staffId: match[1], serviceId: match[2], date: match[3], time: match[4] };
}

export async function createInternalAppointment(input: {
  slotId: string;
  clientName: string;
  clientPhone: string;
  clientId?: string | null;
  durationMinutes: number;
  comment: string;
  vehicle: {
    label?: string | null;
    vin?: string | null;
    plate?: string | null;
    year?: string | number | null;
  };
}) {
  const branchId = getScopedBranchId();
  const slot = parseInternalSlotId(input.slotId);
  const vehicleName = parseVehicleLabel(input.vehicle.label);
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { timezone: true } });
  if (!branch) throw new Error("Филиал собственной системы записи не найден");
  const result = await createBooking({
    branchId,
    serviceIds: [slot.serviceId],
    masterMembershipId: slot.staffId,
    startsAt: zonedLocalToUtc(slot.date, slot.time, branch.timezone),
    customerName: input.clientName,
    phone: input.clientPhone,
    clientId: input.clientId,
    vehicle: {
      ...vehicleName,
      vin: input.vehicle.vin,
      plate: input.vehicle.plate,
      year: input.vehicle.year,
    },
    durationOverrideMinutes: input.durationMinutes,
    comment: input.comment,
    source: BOOKING_SOURCE.AI_AGENT,
  }, {
    kind: "SYSTEM",
    respectLeadTime: true,
  });
  await notifyBookingCreated(result.booking).catch((error) => {
    console.warn("[booking/ai-agent-notification]", error);
  });
  return {
    id: result.booking.id,
    datetime: result.booking.startsAt.toISOString(),
    address: result.booking.branch.address ?? "",
    source: "internal" as const,
  };
}
