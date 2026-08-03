import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  appointmentApiRow,
  loadAppointmentShipmentReconciliation,
  normalizeAppointmentDate,
} from "@/lib/appointment-shipment-service";
import { stringValue } from "@/lib/appointment-shipment-reconcile";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  const appointmentId = decodeURIComponent(id ?? "");
  if (!appointmentId) return NextResponse.json({ error: "id записи не указан" }, { status: 400 });

  const date = normalizeAppointmentDate(request.nextUrl.searchParams.get("date"));
  const { appointments, statuses } = await loadAppointmentShipmentReconciliation(date);
  const appointment = appointments.find((item) => stringValue(item.id) === appointmentId);
  const status = statuses.find((item) => item.appointmentId === appointmentId) ?? null;
  if (!appointment) return NextResponse.json({ error: "Запись не найдена за выбранную дату", date }, { status: 404 });

  return NextResponse.json({
    date,
    appointment: appointmentApiRow(appointment, status),
    candidates: status?.candidates ?? [],
  });
}

