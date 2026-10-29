type AccessContext = { groupRole: string | null; branchRole: string | null; permissions: string[] };
const readers = new Set(["branch_owner", "administrator", "master", "mechanic", "accountant"]);

export function canViewAvito(context: AccessContext) {
  return ["group_owner", "group_admin", "group_analyst"].includes(context.groupRole ?? "")
    || readers.has(context.branchRole ?? "")
    || context.permissions.some((permission) => ["warehouse.view", "warehouse.avito.view", "warehouse.avito.manage", "integrations.manage"].includes(permission));
}

export function canEditAvito(context: AccessContext) {
  return ["group_owner", "group_admin"].includes(context.groupRole ?? "")
    || ["branch_owner", "administrator", "master"].includes(context.branchRole ?? "")
    || context.permissions.some((permission) => ["warehouse.avito.manage", "integrations.manage"].includes(permission));
}
