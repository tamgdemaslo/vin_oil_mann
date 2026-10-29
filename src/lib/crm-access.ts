import type { UserRole } from "@/lib/auth";

export function canAccessCrm(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

/** Operational client requests are also part of the reception master's work. */
export function canAccessClientCases(role: UserRole): boolean {
  return canAccessCrm(role) || role === "master";
}
