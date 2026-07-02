import type { User } from "@/lib/auth";

export const DEFAULT_MESSENGER_ORGANIZATION_ID = "default";

export function getMessengerOrganizationId() {
  return process.env.MESSENGER_DEFAULT_ORG_ID?.trim() || DEFAULT_MESSENGER_ORGANIZATION_ID;
}

export function getMessengerOrganizationIdForUser(user?: Pick<User, "login" | "role"> | null) {
  void user;
  return getMessengerOrganizationId();
}
