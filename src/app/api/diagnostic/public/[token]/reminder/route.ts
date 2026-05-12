import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "token не указан" }, { status: 400 });

  let body: { clientWantsReminder?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело" }, { status: 400 });
  }

  const wants = Boolean(body.clientWantsReminder);

  await prisma.diagnostic.updateMany({
    where: { clientReportToken: token },
    data: { clientWantsReminder: wants },
  });

  return NextResponse.json({ ok: true, clientWantsReminder: wants });
}
