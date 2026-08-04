import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getConversationContext } from "@/lib/messenger/messenger-context";
import { messengerContextError, requireMessengerContextSession } from "@/lib/messenger/messenger-context-routes";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireMessengerContextSession();
  if (access.response) return access.response;
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;
  const { id } = await params;
  return runWithBranchApiContext(branchAccess.context, async () => {
    try {
      return NextResponse.json({ context: await getConversationContext(id) });
    } catch (error) {
      return messengerContextError(error);
    }
  });
}
