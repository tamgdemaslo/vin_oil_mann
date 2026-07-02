import { NextRequest, NextResponse } from "next/server";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";
import { sendDiagnosticReportToTelegram } from "@/lib/messenger/messenger-diagnostics";

function actionError(error: unknown) {
  const message = error instanceof Error ? error.message : "Не удалось отправить отчёт в Telegram";
  if (message.includes("messenger_") && message.includes("does not exist")) {
    return NextResponse.json({ error: "Миграция Messenger Gateway ещё не применена к базе данных" }, { status: 500 });
  }
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  try {
    const result = await sendDiagnosticReportToTelegram({
      source: "legacy",
      diagnosticId: id,
      request,
      createdById: gate.session.user.login,
    });
    if (!result) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
    return NextResponse.json(result, { status: result.ok ? 201 : 409 });
  } catch (error) {
    return actionError(error);
  }
}
