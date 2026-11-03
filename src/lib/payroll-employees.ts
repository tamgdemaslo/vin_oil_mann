import { prisma } from "@/lib/db";
import { canonicalizeLogin } from "@/lib/auth";
import { readEmployeePaySettings } from "@/lib/employee-pay-settings";
import { loadPayrollServiceIdentities, normalizeEmployeeServiceRules } from "@/lib/payroll-service-identity";

export async function listPayrollEmployees(branchId: string) {
  const memberships = await prisma.branchMembership.findMany({
    where: { branchId },
    include: { user: { select: { login: true, name: true, authRole: true } } },
    orderBy: { createdAt: "asc" },
  });
  const services = await loadPayrollServiceIdentities(branchId);
  // Disabled access does not erase the employment or historical payroll record.
  return memberships.map((member) => ({
    membershipId: member.id,
    login: canonicalizeLogin(member.user.login),
    name: member.user.name,
    role: (member.user.authRole === "owner" ? "owner" : member.user.authRole === "admin" ? "admin" : "master") as "owner" | "admin" | "master",
    branchRole: member.roleId,
    accessStatus: member.status,
    employmentStart: member.employmentStart?.toISOString().slice(0, 10) ?? null,
    settings: normalizeEmployeeServiceRules(readEmployeePaySettings(member.paySettingsJson), services),
  }));
}
