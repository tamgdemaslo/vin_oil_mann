/** Employment labels come from the branch membership, independently of access rights. */
export function employeeRoleLabel(branchRole?: string | null, accountRole?: string) {
  const labels: Record<string, string> = {
    branch_owner: "Владелец филиала", administrator: "Администратор", master: "Мастер-приёмщик",
    mechanic: "Механик", accountant: "Бухгалтер", viewer: "Наблюдатель",
  };
  if (branchRole) return labels[branchRole] ?? branchRole;
  return accountRole === "owner" ? "Владелец" : accountRole === "admin" ? "Администратор" : "Мастер";
}
