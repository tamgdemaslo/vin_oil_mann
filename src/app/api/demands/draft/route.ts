import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { createEmptyLocalDemandDraft } from "@/lib/local-demand-write";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  return runWithBranchApiContext(branchAccess.context, async () => {
    try {
      const created = await createEmptyLocalDemandDraft({
        ecoUserName: session.user.name || session.user.login,
        actor: session.user,
        branchId: branchAccess.context.branchId!,
        organizationId: branchAccess.context.organizationId!,
      });
      if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
      return NextResponse.json(created);
    } catch (error) {
      console.error("[api/demands/draft] create failed", error);
      return NextResponse.json(
        { error: error instanceof Error && error.message.trim() ? error.message : "Не удалось создать черновик отгрузки" },
        { status: 400 },
      );
    }
  });
}
