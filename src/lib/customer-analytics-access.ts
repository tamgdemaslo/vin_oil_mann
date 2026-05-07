import type { UserRole } from "@/lib/auth";

export function canAccessCustomerAnalytics(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}
