/** Stored in the existing branch membership: no schema migration is needed. */
export type EmployeeRule = {
  targetType: "service" | "product_group" | "all_services" | "all_products";
  targetId: string;
  targetName: string;
  mode: "fixed" | "percent";
  fixedCents: number | null;
  percentBasisPoints: number | null;
};
export type EmployeePaySettings = {
  employmentEnd?: string;
  individualPiecework?: boolean;
  pieceworkRules?: EmployeeRule[];
  [key: string]: unknown;
};
export function readEmployeePaySettings(value: unknown): EmployeePaySettings {
  return value && typeof value === "object" && !Array.isArray(value) ? value as EmployeePaySettings : {};
}
export function employedOn(settings: EmployeePaySettings, date: string, start?: string | null) {
  return (!start || date >= start) && (!settings.employmentEnd || date <= settings.employmentEnd);
}
export function resolveEmployeeRule(settings: EmployeePaySettings, targetType: "service" | "product_group", targetId: string | null) {
  const rules = settings.pieceworkRules ?? [];
  return rules.find((rule) => rule.targetType === targetType && rule.targetId === targetId)
    ?? rules.find((rule) => rule.targetType === (targetType === "service" ? "all_services" : "all_products"));
}

export function selectPieceworkRecipients<T extends { mode: "fixed" | "percent"; fixedCents: number | null; percentBasisPoints: number | null }>(params: {
  staff: { login: string; role: "master" | "admin" }[];
  settingsFor: (login: string) => EmployeePaySettings;
  targetType: "service" | "product_group";
  targetId: string | null;
  roleRule: (role: "master" | "admin") => T | undefined;
}) {
  const recipients: { login: string; rule: T | EmployeeRule }[] = [];
  const conflicts: { role: "master" | "admin"; logins: string[] }[] = [];
  for (const member of params.staff) {
    const settings = params.settingsFor(member.login);
    if (!settings.individualPiecework) continue;
    const rule = resolveEmployeeRule(settings, params.targetType, params.targetId);
    if (rule) recipients.push({ login: member.login, rule });
  }
  for (const role of ["master", "admin"] as const) {
    const rule = params.roleRule(role);
    if (!rule) continue;
    const candidates = params.staff.filter((member) => member.role === role && !params.settingsFor(member.login).individualPiecework);
    if (candidates.length === 1) recipients.push({ login: candidates[0].login, rule });
    if (candidates.length > 1) conflicts.push({ role, logins: candidates.map((member) => member.login) });
  }
  return { recipients, conflicts };
}
