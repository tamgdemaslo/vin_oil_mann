import type { UserRole } from "@/lib/auth";

export function canAccessCrm(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}
