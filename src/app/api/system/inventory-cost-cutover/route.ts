import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  applyInventoryCostCutover,
  getInventoryCostCutoverPlan,
} from "@/lib/inventory-cost-cutover";
import { invalidateWarehouseReadCaches } from "@/lib/local-inventory-admin";

export const dynamic = "force-dynamic";

async function requireOwner() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (session.user.role !== "owner") {
    return { response: NextResponse.json({ error: "Cutover себестоимости доступен только владельцу" }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const auth = await requireOwner();
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json(await getInventoryCostCutoverPlan(prisma), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireOwner();
  if ("response" in auth) return auth.response;
  try {
    const body = await request.json() as {
      expectedPlanHash?: string;
      confirmation?: string;
      backupReference?: string;
    };
    if (!body.expectedPlanHash || !body.confirmation || !body.backupReference) {
      return NextResponse.json({ error: "Не заполнены обязательные параметры cutover" }, { status: 400 });
    }
    const result = await applyInventoryCostCutover({
      prisma,
      actor: auth.session.user,
      expectedPlanHash: body.expectedPlanHash,
      confirmation: body.confirmation,
      backupReference: body.backupReference,
    });
    invalidateWarehouseReadCaches();
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("План изменился") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
