import { NextRequest } from "next/server";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { getBookingByManagementToken } from "@/lib/booking/service";
import { createClientTelegramLinkToken } from "@/lib/messenger/messenger-linking";
import { runWithRequestTenant } from "@/lib/request-tenant-store";
import {
  checkPublicRateLimit,
  getPublicBookingWriteLimitPerHour,
  publicJson,
  publicOptions,
  rateLimitHeaders,
  rejectDisallowedPublicOrigin,
} from "@/lib/public-api";

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;
  const rate = checkPublicRateLimit(request, "booking-telegram-link", Math.min(getPublicBookingWriteLimitPerHour(), 20));
  if (!rate.ok) {
    return publicJson(request, { error: "Слишком много попыток. Попробуйте позже." }, { status: 429, headers: rateLimitHeaders(rate) });
  }
  try {
    const { token } = await params;
    const booking = await getBookingByManagementToken(token);
    if (!booking.clientId) {
      return publicJson(request, { error: "Клиент для этой записи не найден" }, { status: 404, headers: rateLimitHeaders(rate) });
    }
    const linked = await runWithRequestTenant({
      mode: "branch",
      branchId: booking.branchId,
      organizationId: booking.branch.legacyOrganizationId ?? booking.branchId,
      allowedBranchIds: [booking.branchId],
      businessGroupId: booking.branch.businessGroupId,
      userId: null,
      permissions: [],
    }, () => createClientTelegramLinkToken({ clientId: booking.clientId!, ttlMinutes: 60 }));
    if (!linked.linkUrl) {
      return publicJson(request, { error: "Telegram для этого филиала пока не настроен", code: "telegram_not_configured" }, { status: 404, headers: rateLimitHeaders(rate) });
    }
    return publicJson(request, { linkUrl: linked.linkUrl, expiresAt: linked.expiresAt }, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return publicJson(request, failure.body, { status: failure.status, headers: rateLimitHeaders(rate) });
  }
}
