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

type ReconcileRequest = {
  date?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  commit?: boolean;
};

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateRange(from: string, to: string): string[] {
  const result: string[] = [];
  let cursor = from;
  for (let guard = 0; guard < 31 && cursor <= to; guard += 1) {
    result.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return result;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: ReconcileRequest;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const singleDate = normalizeAppointmentDate(body.date ?? null);
  const from = body.dateFrom ? normalizeAppointmentDate(body.dateFrom) : singleDate;
  const to = body.dateTo ? normalizeAppointmentDate(body.dateTo) : from;
  const dates = dateRange(from <= to ? from : to, from <= to ? to : from);
  const commit = body.commit === true;
  const days = [];

  for (const date of dates) {
    const { appointments, statuses } = await loadAppointmentShipmentReconciliation(date);
    const appointmentById = new Map(appointments.map((appointment) => [stringValue(appointment.id), appointment]));
    const matched = statuses.filter(
      (status) =>
        status.hasShipment &&
        status.matchedShipment &&
        status.linkSource &&
        status.linkSource !== "created_from_appointment" &&
        status.linkSource !== "manual" &&
        status.confidence === "high"
    );
    const linked = [];
    if (commit) {
      for (const status of matched) {
        const appointment = appointmentById.get(status.appointmentId);
        const linkSource = status.linkSource;
        const confidence = status.confidence;
        if (
          !appointment ||
          !status.matchedShipment ||
          !linkSource ||
          linkSource === "created_from_appointment" ||
          linkSource === "manual" ||
          !confidence
        ) {
          continue;
        }
        const vehicleLabel = appointmentVehicleLabel(appointment);
        const linkBody: LinkDemandToAppointmentBody = {
          appointmentId: status.appointmentId,
          recordDateTime: appointmentDateTime(appointment)?.toISOString() ?? null,
          recordSource: stringValue(appointment.source) || null,
          sourceLabel: "Автосверка записей",
          clientName: appointmentClientName(appointment),
          clientPhone: appointmentPhone(appointment),
          vehicle: vehicleLabel ? { model: vehicleLabel } : null,
          linkSource,
          confidence,
          comment: "Автоматическая связь при сверке записей и отгрузок",
        };
        const result = await linkLocalDemandToAppointment(status.matchedShipment.shipmentId, linkBody, session.user);
        if (result.ok) linked.push(result);
      }
    }
    days.push({
      date,
      totalAppointments: appointments.length,
      withoutShipment: statuses.filter((status) => status.countsAsWithoutShipment).length,
      requiresManualLink: statuses.filter((status) => status.requiresManualLink).length,
      matchedHighConfidence: matched.length,
      linked: linked.length,
      dryRun: !commit,
    });
  }

  return NextResponse.json({
    commit,
    days,
    summary: days.reduce(
      (acc, day) => {
        acc.totalAppointments += day.totalAppointments;
        acc.withoutShipment += day.withoutShipment;
        acc.requiresManualLink += day.requiresManualLink;
        acc.matchedHighConfidence += day.matchedHighConfidence;
        acc.linked += day.linked;
        return acc;
      },
      { totalAppointments: 0, withoutShipment: 0, requiresManualLink: 0, matchedHighConfidence: 0, linked: 0 }
    ),
  });
}
