import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { updateLocalDemand } from "@/lib/local-demand-write";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  return runWithBranchApiContext(branchAccess.context, async () => {
    const result = await updateLocalDemand(
      id,
      { applicable: true },
      session.user,
      branchAccess.context.branchId!,
      branchAccess.context.organizationId!
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
    return NextResponse.json(result);
  });
}
