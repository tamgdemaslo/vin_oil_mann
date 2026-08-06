import type { BranchContext } from "@/lib/branch-context";

const GROUP_INTEGRATION_MANAGERS = new Set(["group_owner", "group_admin"]);

export function canViewBranchIntegrationSettings(context: BranchContext) {
  return Boolean(
    (context.groupRole && GROUP_INTEGRATION_MANAGERS.has(context.groupRole))
    || context.branchRole === "branch_owner"
    || context.permissions.includes("integrations.manage")
  );
}

export function canManageBranchIntegrationSecrets(context: BranchContext) {
  return context.isGroupOwner && context.groupRole === "group_owner";
}
