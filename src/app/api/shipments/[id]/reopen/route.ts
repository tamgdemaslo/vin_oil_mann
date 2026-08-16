import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { type ReopenDemandBody, reopenLocalDemand } from "@/lib/local-demand-write";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: ReopenDemandBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  return runWithBranchApiContext(branchAccess.context, async () => {
    const result = await reopenLocalDemand(
      id,
      body,
      session.user,
      branchAccess.context.branchId!,
      branchAccess.context.organizationId!
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.notFound ? 404 : result.conflict ? 409 : 400 }
      );
    }
    return NextResponse.json(result);
  });
}
