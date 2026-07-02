import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logChange } from "@/lib/change-log";
import { getMotivationSettings, upsertMotivationSettings } from "@/lib/payroll-motivation";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const employeeLogin = searchParams.get("employee") ?? (session.user.role === "owner" ? null : session.user.login);
  if (session.user.role !== "owner" && employeeLogin && employeeLogin !== session.user.login) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  const settings = await getMotivationSettings({ employeeLogin });
  return NextResponse.json({ settings });
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const body = await request.json();
  const employeeLogin = typeof body.employeeLogin === "string" && body.employeeLogin ? body.employeeLogin : null;
  await upsertMotivationSettings({
    employeeLogin,
    showForecast: Boolean(body.showForecast ?? true),
    showGoals: Boolean(body.showGoals ?? true),
    showAchievements: Boolean(body.showAchievements ?? true),
    showTeamProgress: Boolean(body.showTeamProgress ?? true),
    showQuality: Boolean(body.showQuality ?? true),
    showRecognition: Boolean(body.showRecognition ?? true),
    notificationsJson: typeof body.notificationsJson === "object" && body.notificationsJson ? body.notificationsJson : {},
  });

  await logChange({
    entityType: "employee_motivation_settings",
    entityId: employeeLogin ?? "default",
    action: "update",
    newValue: body,
    performedByLogin: session.user.login,
  });

  return NextResponse.json({ ok: true });
}
