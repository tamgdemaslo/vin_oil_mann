import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";

type ShipmentRow = {
  id: string;
  name: string;
  documentDate: string;
  momentAt: string;
  sumCents: number;
  applicable: boolean;
  agentName?: string;
};

function dedupe(rows: ShipmentRow[]): ShipmentRow[] {
  const map = new Map<string, ShipmentRow>();
  for (const row of rows) {
    if (!map.has(row.id)) map.set(row.id, row);
  }
  return [...map.values()].sort((a, b) => String(b.momentAt).localeCompare(String(a.momentAt)));
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const phone = request.nextUrl.searchParams.get("phone")?.trim() ?? "";
  const phoneKey = normalizePhoneKey(phone);
  if (!phone || !phoneKey) {
    return NextResponse.json({ error: "Укажите корректный phone" }, { status: 400 });
  }

  const limit = Math.min(10, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "5", 10) || 5));
  const last10 = phoneKey.slice(-10);

  const [localDemands, synced] = await Promise.all([
    prisma.localDemand.findMany({
      where: {
        OR: [
          { counterparty: { normalizedPhone: { contains: phoneKey, mode: "insensitive" } } },
          { counterparty: { normalizedPhone: { contains: last10, mode: "insensitive" } } },
          { counterparty: { phone: { contains: last10, mode: "insensitive" } } },
        ],
      },
      include: { counterparty: true },
      orderBy: { momentAt: "desc" },
      take: limit,
    }),
    prisma.moySkladDemandSync.findMany({
      where: { normalizedPhone: phoneKey },
      orderBy: { momentAt: "desc" },
      take: limit,
    }),
  ]);

  const rows = dedupe([
    ...localDemands.map((row) => ({
      id: row.id,
      name: row.name,
      documentDate: row.documentDate,
      momentAt: row.momentAt.toISOString(),
      sumCents: row.sumCents,
      applicable: row.applicable,
      agentName: row.counterparty?.name ?? row.agentNameSnapshot ?? undefined,
    })),
    ...synced.map((row) => ({
      id: row.id,
      name: row.name,
      documentDate: row.documentDate,
      momentAt: row.momentAt.toISOString(),
      sumCents: row.sumCents,
      applicable: row.applicable,
      agentName: row.agentNameSnapshot ?? undefined,
    })),
  ]).slice(0, limit);

  return NextResponse.json({ phone: phoneKey, rows, source: "local" });
}
