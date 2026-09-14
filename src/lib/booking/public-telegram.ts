import { getClientTelegramStatus } from "@/lib/messenger/messenger-linking";
import { getTelegramStoredSettings } from "@/lib/messenger/messenger-channel-settings";
import { runWithRequestTenant } from "@/lib/request-tenant-store";
import type { BookingWithDetails } from "./service";

export type PublicBookingTelegramState = {
  state: "available" | "connected" | "unavailable" | "error";
};

export async function publicBookingTelegramState(booking: BookingWithDetails): Promise<PublicBookingTelegramState> {
  try {
    return await runWithRequestTenant({
      mode: "branch",
      branchId: booking.branchId,
      organizationId: booking.branch.legacyOrganizationId ?? booking.branchId,
      allowedBranchIds: [booking.branchId],
      businessGroupId: booking.branch.businessGroupId,
      userId: null,
      permissions: [],
    }, async () => {
      const settings = await getTelegramStoredSettings();
      const available = settings.enabled && settings.configured && !settings.dryRun && Boolean(settings.botUsername);
      if (!available || !booking.clientId) return { state: "unavailable" as const };
      const client = await getClientTelegramStatus(booking.clientId);
      if (!client.connected) return { state: "available" as const };
      return { state: client.blockedAt ? "error" as const : "connected" as const };
    });
  } catch (error) {
    console.warn("[booking/telegram-status]", error);
    return { state: "error" };
  }
}
