import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readableBranchIds, requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { listLocalStoresForAdmin } from "@/lib/local-inventory-admin";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ requireActive: false });
  if (!access.ok) return access.response;
  return runWithBranchApiContext(access.context, async () => {
    const list = await listLocalStoresForAdmin({ branchIds: readableBranchIds(access.context) });
    const branchNames = new Map(access.context.branches.map((branch) => [branch.id, branch.displayName]));
    return NextResponse.json({
      ...list,
      mode: access.context.mode,
      stores: list.stores.map((store) => ({ ...store, branchName: branchNames.get(store.branchId) ?? store.branchId })),
    });
  });
}
