import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { branchErrorResponse, getBranchContext, type BranchContext, type BranchSummary } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import { runWithRequestTenant, type RequestTenant } from "@/lib/request-tenant-store";

export const ASSISTANT_BRANCH_SELECTION_REQUIRED = "BRANCH_SELECTION_REQUIRED";

export class AIAssistantAccessError extends Error {
  constructor(
    message: string,
    public readonly status = 403,
    public readonly code = "assistant_access_denied"
  ) {
    super(message);
    this.name = "AIAssistantAccessError";
  }
}

export type AIAssistantBranch = Pick<BranchSummary, "id" | "name" | "shortName" | "displayName" | "businessGroupId" | "legacyOrganizationId"> & {
  organizationId: string;
};

export type AIAssistantBaseAccess = {
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>;
  actorId: string;
  context: BranchContext;
  branches: AIAssistantBranch[];
};

export type AIAssistantAccess = AIAssistantBaseAccess & {
  branchId: string;
  branchName: string;
  organizationId: string;
  tenant: RequestTenant;
};

type AIAssistantAccessResponse = { response: NextResponse };

function activeAssistantBranches(context: BranchContext): AIAssistantBranch[] {
  return context.branches
    .filter((branch) => branch.status === "active")
    .map((branch) => ({
      ...branch,
      organizationId: branch.legacyOrganizationId ?? branch.id,
    }));
}

function branchAccess(base: AIAssistantBaseAccess, branchId: string): AIAssistantAccess {
  const branch = base.branches.find((candidate) => candidate.id === branchId);
  if (!branch) {
    throw new AIAssistantAccessError(
      "Выберите доступный активный филиал для ИИ-помощника",
      409,
      ASSISTANT_BRANCH_SELECTION_REQUIRED
    );
  }
  return {
    ...base,
    branchId: branch.id,
    branchName: branch.displayName || branch.shortName || branch.name,
    organizationId: branch.organizationId,
    tenant: {
      mode: "branch",
      branchId: branch.id,
      organizationId: branch.organizationId,
      allowedBranchIds: [branch.id],
      businessGroupId: branch.businessGroupId,
      userId: base.context.userId,
      permissions: [base.context.groupRole, base.context.branchRole].filter((role): role is string => Boolean(role)),
    },
  };
}

/** Validates the user once, without trusting a branch id supplied by the client. */
export async function requireAIAssistantBaseAccess(): Promise<AIAssistantBaseAccess | AIAssistantAccessResponse> {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) } as const;
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return { response: NextResponse.json({ error: "ИИ-помощник доступен владельцу и администраторам" }, { status: 403 }) } as const;
  }

  try {
    const context = await getBranchContext({ allowAll: true, requireActive: false });
    if (!context) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) } as const;
    return {
      session,
      actorId: session.user.login,
      context,
      branches: activeAssistantBranches(context),
    };
  } catch (error) {
    const result = branchErrorResponse(error);
    return { response: NextResponse.json({ error: result.error, code: result.code }, { status: result.status }) } as const;
  }
}

export function branchSelectionResponse(access: AIAssistantBaseAccess) {
  return NextResponse.json({
    error: "Выберите филиал для нового диалога ИИ-помощника",
    code: ASSISTANT_BRANCH_SELECTION_REQUIRED,
    branches: access.branches.map((branch) => ({ id: branch.id, name: branch.displayName || branch.shortName || branch.name })),
  }, { status: 409 });
}

/**
 * A branch can only come from the signed header context or an active branch
 * the already verified user may access. The model never supplies this value.
 */
export async function requireAIAssistantAccess(requestedBranchId?: string | null): Promise<AIAssistantAccess | AIAssistantAccessResponse> {
  const base = await requireAIAssistantBaseAccess();
  if ("response" in base) return base;
  const branchId = requestedBranchId?.trim() || (base.context.mode === "branch" ? base.context.branchId : null);
  if (!branchId) return { response: branchSelectionResponse(base) } as const;
  try {
    return branchAccess(base, branchId);
  } catch (error) {
    return { response: aiAssistantApiError(error) } as const;
  }
}

/** The stored thread, not the active browser header, decides its tenant. */
export async function resolveAIAssistantThreadAccess(access: AIAssistantBaseAccess, threadId: string) {
  const thread = await prisma.aIAssistantThread.findFirst({
    where: { id: threadId, branchId: { in: access.branches.map((branch) => branch.id) } },
    select: { id: true, branchId: true },
  });
  if (!thread) throw new AIAssistantAccessError("Диалог помощника не найден или недоступен", 404, "assistant_thread_not_found");
  return branchAccess(access, thread.branchId);
}

export function runWithAIAssistantBranchContext<T>(access: AIAssistantAccess, operation: () => T): T {
  return runWithRequestTenant(access.tenant, operation);
}

export function aiAssistantApiError(error: unknown) {
  if (error instanceof AIAssistantAccessError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = /авторизац/i.test(message) ? 401 : /доступ|прав/i.test(message) ? 403 : /не найден/i.test(message) ? 404 : /отмен/i.test(message) ? 409 : 500;
  return NextResponse.json({ error: message }, { status });
}
