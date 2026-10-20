import type { UserRole } from "@/lib/auth";

export function canAccessCustomerAnalytics(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

// Shared return drafts are available to active branch staff without financial analytics.
export function canAccessCustomerReturnQueue(role: UserRole): boolean {
  return role === "owner" || role === "admin" || role === "master";
}
