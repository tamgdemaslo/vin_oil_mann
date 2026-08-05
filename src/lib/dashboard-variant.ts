import type { UserRole } from "@/lib/auth";
import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";

export type DashboardVariant = "OWNER_MANAGEMENT" | "MANAGER" | "EMPLOYEE";

export type DashboardAccess = {
  variant: DashboardVariant;
  canViewFinance: boolean;
  canViewClientOperations: boolean;
  canManageCash: boolean;
  canViewManagementTasks: boolean;
};

type DashboardAccessInput = {
  userRole: UserRole;
  groupRole?: string | null;
  branchRole?: string | null;
  permissions?: Iterable<string>;
};

const MANAGEMENT_PERMISSIONS = new Set([
  "dashboard.management",
  "stock.view_alerts",
  "supplier_invoices.view",
  "client_cases.view_all",
  "messages.manage",
  "finances.view",
]);

const MANAGEMENT_BRANCH_ROLES = new Set([
  "administrator",
  "admin",
  "branch_admin",
  "manager",
  "accountant",
]);

function normalized(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * Converts the membership JSON accepted by the branch API to an explicit set.
 * Both { "permission": true } and ["permission"] are supported.
 */
export function dashboardPermissionsFromJson(value: unknown): Set<string> {
  if (Array.isArray(value)) return new Set(value.map(String).map((item) => item.trim()).filter(Boolean));
  if (value && typeof value === "object") {
    return new Set(
      Object.entries(value)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([permission]) => permission.trim())
        .filter(Boolean)
    );
  }
  return new Set();
}

/**
 * A single permission boundary for the home page. Role fallbacks preserve the
 * existing owner/admin experience while membership permissions take precedence
 * for branch-aware deployments.
 */
export function resolveDashboardVariant(input: DashboardAccessInput): DashboardAccess {
  const permissions = new Set(Array.from(input.permissions ?? [], (permission) => permission.trim()));
  const groupRole = normalized(input.groupRole);
  const branchRole = normalized(input.branchRole);
  const isOwner =
    input.userRole === "owner" ||
    groupRole === "group_owner" ||
    branchRole === "branch_owner" ||
    branchRole === "owner";
  const hasManagementPermission = Array.from(MANAGEMENT_PERMISSIONS).some((permission) => permissions.has(permission));
  const isLegacyManager = input.userRole === "admin" || MANAGEMENT_BRANCH_ROLES.has(branchRole) || groupRole === "group_admin";

  if (isOwner) {
    return {
      variant: "OWNER_MANAGEMENT",
      canViewFinance: true,
      canViewClientOperations: true,
      canManageCash: true,
      canViewManagementTasks: true,
    };
  }

  if (hasManagementPermission || isLegacyManager) {
    return {
      variant: "MANAGER",
      canViewFinance: permissions.has("finances.view"),
      canViewClientOperations:
        permissions.has("dashboard.management") ||
        permissions.has("client_cases.view_all") ||
        permissions.has("messages.manage") ||
        isLegacyManager,
      canManageCash: permissions.has("finances.view") || permissions.has("dashboard.management") || isLegacyManager,
      canViewManagementTasks: true,
    };
  }

  return {
    variant: "EMPLOYEE",
    canViewFinance: false,
    canViewClientOperations: false,
    canManageCash: false,
    canViewManagementTasks: false,
  };
}

/** Resolve dashboard access from the verified active branch membership. */
export async function resolveDashboardAccessForBranch(context: BranchContext): Promise<DashboardAccess> {
  const membership = context.branchId
    ? await prisma.branchMembership.findUnique({
        where: { branchId_userId: { branchId: context.branchId, userId: context.userId } },
        select: { roleId: true, permissionsJson: true },
      })
    : null;

  return resolveDashboardVariant({
    userRole: context.user.role,
    groupRole: context.groupRole,
    branchRole: membership?.roleId ?? context.branchRole,
    permissions: dashboardPermissionsFromJson(membership?.permissionsJson),
  });
}
