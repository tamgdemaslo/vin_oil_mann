/** Access equivalence only; persisted employee and payroll roles stay unchanged. */
export function branchAuthorizationRole(role) {
  return role === "master" ? "administrator" : role;
}

/**
 * Legacy endpoints receive an administrator access role only for a verified
 * receptionist membership in the selected branch. Other legacy masters (e.g.
 * mechanics) are not promoted. Never copy this effective role into credentials.
 * @template {{ role: "owner" | "admin" | "master", authRole?: "owner" | "admin" | "master" }} T
 * @param {T} user
 * @param {{ mode?: string, branchId?: string | null, allowedBranchIds?: string[], permissions?: string[] } | null} tenant
 */
export function sessionAuthorizationUser(user, tenant) {
  const authRole = user.authRole ?? user.role;
  const receptionist = tenant?.mode === "branch" && Boolean(tenant.branchId)
    && tenant.allowedBranchIds?.includes(tenant.branchId)
    && tenant.permissions?.includes("master");
  return { ...user, authRole, role: authRole === "owner" ? authRole : receptionist ? /** @type {const} */ ("admin") : authRole };
}
