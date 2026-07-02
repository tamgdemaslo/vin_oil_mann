import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logChange } from "@/lib/change-log";
import { createEmployeeRecognition, listAllRecognition } from "@/lib/payroll-motivation";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const recognition = await listAllRecognition();
  return NextResponse.json({ recognition });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const body = await request.json();
  const employeeLogin = typeof body.employeeLogin === "string" ? body.employeeLogin.trim() : "";
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Похвала от владельца";
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "good_work";
  const visibility = body.visibility === "TEAM" ? "TEAM" : "PRIVATE";

  if (!employeeLogin) return NextResponse.json({ error: "Выберите сотрудника" }, { status: 400 });
  if (!message) return NextResponse.json({ error: "Добавьте короткий комментарий" }, { status: 400 });

  const id = await createEmployeeRecognition({
    employeeLogin,
    authorLogin: session.user.login,
    title,
    message,
    reason,
    visibility,
    sourceType: typeof body.sourceType === "string" ? body.sourceType : null,
    sourceId: typeof body.sourceId === "string" ? body.sourceId : null,
  });

  await logChange({
    entityType: "employee_recognition",
    entityId: id,
    action: "create",
    newValue: { employeeLogin, title, reason, visibility },
    performedByLogin: session.user.login,
  });

  return NextResponse.json({ id }, { status: 201 });
}
