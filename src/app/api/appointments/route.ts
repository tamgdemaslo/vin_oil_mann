import { NextRequest, NextResponse } from "next/server";
import {
  ClientApiError,
  createClientAppointment,
  listClientAppointments,
} from "@/lib/client-site-api";
import { handleAppointmentCreated } from "@/lib/client-notifications/client-notifications";

export async function GET() {
  const items = listClientAppointments();
  return NextResponse.json({ items, total: items.length });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const appointment = createClientAppointment(body ?? {});
    const slotMatch = appointment.slotId.match(/^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})$/);
    await handleAppointmentCreated({
      source: "client",
      appointmentId: appointment.id,
      appointmentAt: slotMatch ? `${slotMatch[1]} ${slotMatch[2]}:${slotMatch[3]}` : null,
      appointmentDate: appointment.slot.date,
      appointmentTime: appointment.slot.time,
      clientName: appointment.name,
      clientPhone: appointment.phone,
      vin: appointment.vin,
      car: appointment.vin ? `VIN ${appointment.vin}` : null,
      serviceList: appointment.oilId,
      payload: { publicAppointment: appointment },
    }).catch((error) => {
      console.warn("[client-notifications/appointment]", error);
    });
    return NextResponse.json(appointment, { status: 201 });
  } catch (error) {
    if (error instanceof ClientApiError) {
      return NextResponse.json({ error: { message: error.message } }, { status: error.status });
    }
    return NextResponse.json({ error: { message: "Не получилось создать запись." } }, { status: 500 });
  }
}
