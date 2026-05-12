import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithShift } from "@/lib/api-session-shift";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const row = await prisma.diagnostic.update({
    where: { id },
    data: { clientReportSentAt: new Date() },
    select: { clientReportToken: true },
  });

  const envOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  const vercel = process.env.VERCEL_URL?.trim();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const fromHeaders = host ? `${proto}://${host}` : "";
  const base =
    envOrigin ||
    (vercel ? (vercel.startsWith("http") ? vercel : `https://${vercel}`) : "") ||
    fromHeaders;
  const reportUrl = base ? `${base.replace(/\/$/, "")}/report/${row.clientReportToken}` : `/report/${row.clientReportToken}`;

  return NextResponse.json({ reportUrl, token: row.clientReportToken });
}
