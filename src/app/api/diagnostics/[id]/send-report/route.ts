import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import {
  handleDiagnosticReportSent,
  markDiagnosticReportSent,
} from "@/lib/client-notifications/client-notifications";
import { syncDiagnosticVehicleFromShipment } from "@/lib/diagnostic-vehicle-sync";

function actionError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось отправить отчёт в Telegram";
  if (message.includes("messenger_") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiSessionWithCashShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  try {
    await syncDiagnosticVehicleFromShipment(id, {
      mode: "fillMissingOnly",
      reason: "before-send-report",
      userLogin: gate.session.user.login,
    });
    const result = await handleDiagnosticReportSent({
      source: "map",
      diagnosticId: id,
      request,
      initiatedById: gate.session.user.login,
    });
    if (!result) return NextResponse.json({ error: "Диагностика не найдена" }, { status: 404 });
    if (result.ok) await markDiagnosticReportSent("map", id);
    return NextResponse.json(result, { status: result.ok ? 201 : 409 });
  } catch (error) {
    return actionError(error);
  }
}
