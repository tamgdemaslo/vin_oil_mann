import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  appointmentApiRow,
  loadAppointmentShipmentReconciliation,
  normalizeAppointmentDate,
} from "@/lib/appointment-shipment-service";
import { stringValue } from "@/lib/appointment-shipment-reconcile";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const date = normalizeAppointmentDate(request.nextUrl.searchParams.get("date"));
  const includeMatched = request.nextUrl.searchParams.get("includeMatched") === "1";
  const { appointments, statuses } = await loadAppointmentShipmentReconciliation(date);
  const statusById = new Map(statuses.map((status) => [status.appointmentId, status]));
  const rows = appointments
    .map((appointment) => appointmentApiRow(appointment, statusById.get(stringValue(appointment.id)) ?? null))
    .filter((row) => row.countsAsWithoutShipment || row.requiresManualLink || (includeMatched && row.hasShipment));

  return NextResponse.json({
    date,
    totalAppointments: appointments.length,
    summary: {
      withoutShipment: statuses.filter((status) => status.countsAsWithoutShipment).length,
      requiresManualLink: statuses.filter((status) => status.requiresManualLink).length,
      matchedByRules: statuses.filter(
        (status) => status.hasShipment && status.linkSource && status.linkSource !== "created_from_appointment" && status.linkSource !== "manual"
      ).length,
      linked: statuses.filter((status) => status.hasShipment).length,
      cancelled: statuses.filter((status) => status.kind === "appointment_cancelled").length,
    },
    rows,
  });
}

