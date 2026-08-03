import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  appointmentClientName,
  appointmentDateTime,
  appointmentPhone,
  appointmentVehicleLabel,
  stringValue,
} from "@/lib/appointment-shipment-reconcile";
import {
  loadAppointmentShipmentReconciliation,
  normalizeAppointmentDate,
} from "@/lib/appointment-shipment-service";
import { linkLocalDemandToAppointment, type LinkDemandToAppointmentBody } from "@/lib/local-demand-write";

type LinkShipmentRequest = LinkDemandToAppointmentBody & {
  shipmentId?: string | null;
  date?: string | null;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  const appointmentId = decodeURIComponent(id ?? "");
  if (!appointmentId) return NextResponse.json({ error: "id записи не указан" }, { status: 400 });

  let body: LinkShipmentRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const shipmentId = stringValue(body.shipmentId);
  if (!shipmentId) return NextResponse.json({ error: "Укажите отгрузку для связи" }, { status: 400 });

  const date = normalizeAppointmentDate(body.date ?? request.nextUrl.searchParams.get("date"));
  const { appointments } = await loadAppointmentShipmentReconciliation(date);
  const appointment = appointments.find((item) => stringValue(item.id) === appointmentId);
  const vehicleLabel = appointment ? appointmentVehicleLabel(appointment) : "";
  const linkBody: LinkDemandToAppointmentBody = {
    ...body,
    appointmentId,
    recordDateTime: body.recordDateTime ?? appointmentDateTime(appointment ?? {})?.toISOString() ?? null,
    recordSource: body.recordSource ?? stringValue(appointment?.source) ?? null,
    sourceLabel: body.sourceLabel ?? (appointment ? "Журнал записей" : null),
    clientName: body.clientName ?? (appointment ? appointmentClientName(appointment) : null),
    clientPhone: body.clientPhone ?? (appointment ? appointmentPhone(appointment) : null),
    vehicle: body.vehicle ?? (vehicleLabel ? { model: vehicleLabel } : null),
    linkSource: body.linkSource ?? "manual",
    confidence: body.confidence ?? "high",
  };

  const result = await linkLocalDemandToAppointment(shipmentId, linkBody, session.user);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
  return NextResponse.json(result);
}

