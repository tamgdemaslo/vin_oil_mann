import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getLocalInventorySyncStatus,
  startLocalInventorySync,
  waitForLocalInventorySync,
  type LocalInventorySyncOptions,
} from "@/lib/local-inventory-sync";

function canManageLocalInventory(role: string): boolean {
  return role === "owner" || role === "admin";
}

function parseOptionalLimit(value: unknown): number | null | undefined {
  if (value == null || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

async function requireAccess() {
  const session = await getSession();
  if (!session) return { ok: false as const, response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (!canManageLocalInventory(session.user.role)) {
    return { ok: false as const, response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  }
  return { ok: true as const, session };
}

export async function GET() {
  const access = await requireAccess();
  if (!access.ok) return access.response;
  const status = await getLocalInventorySyncStatus();
  return NextResponse.json({ status });
}

export async function POST(request: NextRequest) {
  const access = await requireAccess();
  if (!access.ok) return access.response;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const options: LocalInventorySyncOptions = {
    includeProducts: body.includeProducts !== false,
    includeCounterparties: body.includeCounterparties !== false,
    includeStores: body.includeStores !== false,
    includeStock: body.includeStock !== false,
    includeDemands: body.includeDemands !== false,
    productLimit: parseOptionalLimit(body.productLimit),
    counterpartyLimit: parseOptionalLimit(body.counterpartyLimit),
    demandLimit: parseOptionalLimit(body.demandLimit) ?? 200,
    fullDemands: body.fullDemands === true,
  };

  const wait = body.wait === true;
  const started = await startLocalInventorySync(options);
  if (wait) {
    const status = await waitForLocalInventorySync();
    return NextResponse.json({ started: started.started, status });
  }

  return NextResponse.json(started);
}
