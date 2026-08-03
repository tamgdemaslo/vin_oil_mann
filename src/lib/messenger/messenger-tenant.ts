import type { User } from "@/lib/auth";
import { getRequestTenant } from "@/lib/request-tenant";

export const DEFAULT_MESSENGER_ORGANIZATION_ID = "default";

export function getMessengerOrganizationId() {
  const tenant = getRequestTenant();
  if (tenant?.mode === "branch" && tenant.organizationId) return tenant.organizationId;
  if (tenant) throw new Error("Для работы с мессенджером выберите доступный активный филиал");
  return process.env.MESSENGER_DEFAULT_ORG_ID?.trim() || DEFAULT_MESSENGER_ORGANIZATION_ID;
}

export function getMessengerOrganizationIdForUser(user?: Pick<User, "login" | "role"> | null) {
  void user;
  return getMessengerOrganizationId();
}
