import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { branchErrorResponse, requireBranchContext } from "@/lib/branch-context";

/** The first release is deliberately employee-only. */
export async function requireAIAssistantAccess() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) } as const;
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return { response: NextResponse.json({ error: "ИИ-помощник доступен владельцу и администраторам" }, { status: 403 }) } as const;
  }
  try {
    const branch = await requireBranchContext({ allowAll: false, requireActive: true });
    return {
      session,
      branchId: branch.branchId!,
      branchName: branch.branch?.shortName ?? "Филиал",
      organizationId: branch.organizationId!,
      actorId: session.user.login,
    } as const;
  } catch (error) {
    const result = branchErrorResponse(error);
    return { response: NextResponse.json({ error: result.error, code: result.code }, { status: result.status }) } as const;
  }
}

export function aiAssistantApiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = /авторизац/i.test(message) ? 401 : /доступ|прав/i.test(message) ? 403 : /не найден/i.test(message) ? 404 : /отмен/i.test(message) ? 409 : 500;
  return NextResponse.json({ error: message }, { status });
}
