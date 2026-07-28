import { getRequestTenant } from "@/lib/request-tenant-store";

export type BranchSqlMode = "SINGLE_BRANCH" | "BUSINESS_GROUP_READ_ONLY" | "MIGRATION" | "SYSTEM_GLOBAL";

export type BranchSqlContext = {
  businessGroupId: string | null;
  branchId: string | null;
  allowedBranchIds: readonly string[];
  mode: BranchSqlMode;
  userId: string | null;
  permissions: readonly string[];
};

export class AllBranchesMutationForbiddenError extends Error {
  constructor() {
    super("Изменения в режиме «Все филиалы» запрещены");
    this.name = "AllBranchesMutationForbiddenError";
  }
}

/**
 * Returns only the server-verified request scope. Callers cannot promote a
 * single-branch request into a group read or a system/migration context.
 */
export function getBranchSqlContext(): BranchSqlContext {
  const tenant = getRequestTenant();
  if (!tenant || tenant.mode === "denied") throw new Error("Branch SQL context is required");
  if (tenant.mode === "all") {
    return {
      businessGroupId: tenant.businessGroupId ?? null,
      branchId: null,
      allowedBranchIds: tenant.allowedBranchIds,
      mode: "BUSINESS_GROUP_READ_ONLY",
      userId: tenant.userId ?? null,
      permissions: tenant.permissions ?? [],
    };
  }
  if (!tenant.branchId) throw new Error("Concrete branch is required for SQL");
  return {
    businessGroupId: tenant.businessGroupId ?? null,
    branchId: tenant.branchId,
    allowedBranchIds: [tenant.branchId],
    mode: "SINGLE_BRANCH",
    userId: tenant.userId ?? null,
    permissions: tenant.permissions ?? [],
  };
}

export function requireSingleBranchSqlContext() {
  const context = getBranchSqlContext();
  if (context.mode === "BUSINESS_GROUP_READ_ONLY") throw new AllBranchesMutationForbiddenError();
  if (context.mode !== "SINGLE_BRANCH" || !context.branchId) throw new Error("Concrete branch is required for SQL mutation");
  return context as BranchSqlContext & { mode: "SINGLE_BRANCH"; branchId: string };
}
