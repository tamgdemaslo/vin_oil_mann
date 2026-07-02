import { listAppointmentRowsForDate } from "@/lib/appointment-source";
import {
  appointmentClientName,
  appointmentDateTime,
  appointmentPhone,
  appointmentServiceTitle,
  appointmentStatusLabel,
  appointmentTimeLabel,
  appointmentVehicleLabel,
  reconcileAppointmentShipments,
  stringValue,
  type AppointmentLike,
  type AppointmentShipmentStatus,
} from "@/lib/appointment-shipment-reconcile";
import { toServiceDateInput } from "@/lib/date-time";
import { prisma } from "@/lib/db";

export function normalizeAppointmentDate(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return toServiceDateInput(new Date());
}

export async function loadAppointmentShipmentReconciliation(date: string) {
  const [appointments, shipments] = await Promise.all([
    listAppointmentRowsForDate(date),
    prisma.localDemand.findMany({
      where: { documentDate: date },
      include: { positions: true, counterparty: true },
      orderBy: [{ momentAt: "desc" }],
      take: 200,
    }),
  ]);
  const statuses = reconcileAppointmentShipments(appointments, shipments);
  return { date, appointments, shipments, statuses };
}

export function appointmentApiRow(appointment: AppointmentLike, status: AppointmentShipmentStatus | null) {
  return {
    id: stringValue(appointment.id),
    source: stringValue(appointment.source) || null,
    datetime: appointmentDateTime(appointment)?.toISOString() ?? null,
    time: appointmentTimeLabel(appointment),
    client: appointmentClientName(appointment),
    phone: appointmentPhone(appointment),
    vehicle: appointmentVehicleLabel(appointment),
    service: appointmentServiceTitle(appointment),
    appointmentStatus: appointmentStatusLabel(appointment),
    shipmentStatus: status?.label ?? "Отгрузка не найдена",
    shipmentStatusKind: status?.kind ?? "shipment_not_found",
    shipmentId: status?.matchedShipment?.shipmentId ?? null,
    matchedShipment: status?.matchedShipment ?? null,
    candidates: status?.candidates ?? [],
    hasShipment: status?.hasShipment ?? false,
    countsAsWithoutShipment: status?.countsAsWithoutShipment ?? true,
    requiresManualLink: status?.requiresManualLink ?? false,
    actions: {
      openAppointment: `/records?recordId=${encodeURIComponent(stringValue(appointment.id))}`,
      openShipment: status?.matchedShipment?.shipmentHref ?? null,
      linkShipment: `/api/appointments/${encodeURIComponent(stringValue(appointment.id))}/link-shipment`,
      createShipment: `/shipment/new?recordId=${encodeURIComponent(stringValue(appointment.id))}`,
    },
  };
}

