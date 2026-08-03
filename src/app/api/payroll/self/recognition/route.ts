import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listEmployeeRecognition } from "@/lib/payroll-motivation";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });

  const recognition = await listEmployeeRecognition({
    employeeLogin: session.user.login,
    limit: 30,
  });

  return NextResponse.json({ recognition });
}
