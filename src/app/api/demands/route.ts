import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { type CreateDemandBody } from "@/lib/demand-create-payload";
import { createLocalDemand } from "@/lib/local-demand-write";
import { loadLocalDemandList } from "@/lib/local-inventory-read";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const counterparty = request.nextUrl.searchParams.get("counterparty") ?? "";
  const plate = request.nextUrl.searchParams.get("plate") ?? "";
  const phone = request.nextUrl.searchParams.get("phone") ?? "";
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? "";
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);

  return runWithBranchApiContext(branchAccess.context, async () => NextResponse.json(
    await loadLocalDemandList({ branchId: branchAccess.context.branchId!, search, counterparty, plate, phone, dateFrom, dateTo, limit, offset })
  ));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  let body: CreateDemandBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  if (!body.organization?.meta?.href || !body.store?.meta?.href) {
    return NextResponse.json({ error: "Укажите организацию и склад" }, { status: 400 });
  }

  return runWithBranchApiContext(branchAccess.context, async () => {
    let created;
    try {
      created = await createLocalDemand(body, {
        ecoUserName: session.user.name || session.user.login,
        branchId: branchAccess.context.branchId!,
        organizationId: branchAccess.context.organizationId!,
      });
    } catch (error) {
      console.error("[api/demands] create failed", error);
      return NextResponse.json(
        { error: error instanceof Error && error.message.trim() ? error.message : "Не удалось создать отгрузку" },
        { status: 400 }
      );
    }
    if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });

    return NextResponse.json(created);
  });
}
