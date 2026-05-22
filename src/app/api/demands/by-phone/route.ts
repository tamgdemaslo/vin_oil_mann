import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { moyskladFetch } from "@/lib/moysklad";
import {
  listRawPhonesFromCounterparty,
  normalizePhoneKey,
  type CounterpartyPhoneSource,
} from "@/lib/phone-normalize";

type DemandAgent = {
  name?: string;
  meta?: { href?: string };
} & NonNullable<CounterpartyPhoneSource>;

type DemandRow = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  sum: number;
  description?: string;
  agent?: DemandAgent;
  attributes?: { name?: string; value?: unknown }[];
};

type CounterpartyRow = DemandAgent;

type ShipmentRow = {
  id: string;
  name: string;
  documentDate: string;
  momentAt: string;
  sumCents: number;
  applicable: boolean;
  agentName?: string;
};

const DEMAND_EXPAND = "agent,agent.contactpersons,attributes";

function phoneKeyVariants(phoneKey: string): string[] {
  const variants = new Set([phoneKey]);
  if (/^7\d{10}$/.test(phoneKey)) variants.add(`8${phoneKey.slice(1)}`);
  if (/^8\d{10}$/.test(phoneKey)) variants.add(`7${phoneKey.slice(1)}`);
  if (phoneKey.length >= 10) variants.add(phoneKey.slice(-10));
  return [...variants];
}

function rawTextMatchesPhone(value: unknown, phoneKey: string): boolean {
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  if (normalizePhoneKey(raw) === phoneKey) return true;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return false;
  return phoneKeyVariants(phoneKey).some((variant) => digits.includes(variant));
}

function sourceMatchesPhone(source: CounterpartyPhoneSource, phoneKey: string): boolean {
  return listRawPhonesFromCounterparty(source).some((raw) => rawTextMatchesPhone(raw, phoneKey));
}

function demandMatchesPhone(row: DemandRow, phoneKey: string): boolean {
  if (sourceMatchesPhone(row.agent, phoneKey)) return true;
  if (row.description && rawTextMatchesPhone(row.description, phoneKey)) return true;
  for (const attr of row.attributes ?? []) {
    const label = (attr.name ?? "").toLowerCase();
    if (/телефон|phone|контакт/i.test(label) && rawTextMatchesPhone(attr.value, phoneKey)) return true;
  }
  return false;
}

function momentToDate(value: string): string {
  return value?.slice(0, 10) || "";
}

function momentToIso(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function fromDemand(row: DemandRow): ShipmentRow {
  return {
    id: row.id,
    name: row.name,
    documentDate: momentToDate(row.moment),
    momentAt: momentToIso(row.moment),
    sumCents: Math.round(row.sum ?? 0),
    applicable: row.applicable,
    agentName: row.agent?.name,
  };
}

function dedupe(rows: ShipmentRow[]): ShipmentRow[] {
  const map = new Map<string, ShipmentRow>();
  for (const row of rows) {
    if (!map.has(row.id)) map.set(row.id, row);
  }
  return [...map.values()].sort((a, b) => String(b.momentAt).localeCompare(String(a.momentAt)));
}

async function loadFromMoySklad(phone: string, phoneKey: string, limit: number): Promise<ShipmentRow[]> {
  const out: ShipmentRow[] = [];
  const terms = [...new Set([phone.trim(), phoneKey, phoneKey.slice(-10)].filter(Boolean))];

  for (const term of terms) {
    const demandRes = await moyskladFetch<{ rows?: DemandRow[] }>(
      `/entity/demand?search=${encodeURIComponent(term)}&limit=80&order=moment,desc&expand=${DEMAND_EXPAND}`,
      { cache: "no-store" }
    );
    if (demandRes.ok) {
      out.push(...(demandRes.data.rows ?? []).filter((row) => demandMatchesPhone(row, phoneKey)).map(fromDemand));
    }

    const counterpartyRes = await moyskladFetch<{ rows?: CounterpartyRow[] }>(
      `/entity/counterparty?search=${encodeURIComponent(term)}&limit=20&expand=contactpersons`,
      { cache: "no-store" }
    );
    if (!counterpartyRes.ok) continue;

    for (const counterparty of counterpartyRes.data.rows ?? []) {
      if (!counterparty.meta?.href) continue;
      if (!sourceMatchesPhone(counterparty, phoneKey)) continue;
      const byAgent = await moyskladFetch<{ rows?: DemandRow[] }>(
        `/entity/demand?filter=${encodeURIComponent(`agent=${counterparty.meta.href}`)}&limit=${limit}&order=moment,desc&expand=${DEMAND_EXPAND}`,
        { cache: "no-store" }
      );
      if (byAgent.ok) out.push(...(byAgent.data.rows ?? []).map(fromDemand));
    }
  }

  return dedupe(out).slice(0, limit);
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

  const synced = await prisma.moySkladDemandSync.findMany({
    where: { normalizedPhone: phoneKey },
    orderBy: { momentAt: "desc" },
    take: limit,
  });

  let rows: ShipmentRow[] = synced.map((row) => ({
    id: row.id,
    name: row.name,
    documentDate: row.documentDate,
    momentAt: row.momentAt.toISOString(),
    sumCents: row.sumCents,
    applicable: row.applicable,
    agentName: row.agentNameSnapshot ?? undefined,
  }));

  try {
    const liveRows = await loadFromMoySklad(phone, phoneKey, limit);
    rows = dedupe([...rows, ...liveRows]).slice(0, limit);
  } catch {
    // If live MoySklad lookup is unavailable, keep the synced rows instead of hiding known shipments.
  }

  return NextResponse.json({ phone: phoneKey, rows });
}
