import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { loyaltyPermissions } from "@/lib/loyalty/accounts";
import { updateLocalDemand } from "@/lib/local-demand-write";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: Parameters<typeof updateLocalDemand>[1];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  if ((body.loyalty?.points ?? 0) > 0 && !loyaltyPermissions(access.context).employee) {
    return NextResponse.json({ error: "Недостаточно прав для списания бонусов" }, { status: 403 });
  }
  return runWithBranchApiContext(access.context, async () => {
    const result = await updateLocalDemand(id, body, session.user, access.context.branchId!, access.context.organizationId!);
    if (!result.ok) return NextResponse.json({ error: result.error, quote: result.quote }, {
      status: result.status ?? (result.notFound ? 404 : 400),
    });
    return NextResponse.json(result);
  });
}
