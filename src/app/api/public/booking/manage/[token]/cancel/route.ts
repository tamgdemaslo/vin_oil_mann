import { NextRequest } from "next/server";
import { publicManagedBookingDto } from "@/lib/booking/dto";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { notifyBookingCancelled } from "@/lib/booking/notifications";
import { cancelBooking, getBookingByManagementToken } from "@/lib/booking/service";
import {
  checkPublicRateLimit,
  getPublicBookingWriteLimitPerHour,
  publicJson,
  publicOptions,
  rateLimitHeaders,
  rejectDisallowedPublicOrigin,
} from "@/lib/public-api";

type Context = { params: Promise<{ token: string }> };

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}

export async function POST(request: NextRequest, context: Context) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;
  const rate = checkPublicRateLimit(request, "booking-manage-cancel", getPublicBookingWriteLimitPerHour());
  if (!rate.ok) return publicJson(request, { error: "Слишком много попыток" }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const { token } = await context.params;
    const current = await getBookingByManagementToken(token);
    const body = await request.json().catch(() => null) as { reason?: unknown } | null;
    const booking = await cancelBooking(current.id, typeof body?.reason === "string" ? body.reason : null, { kind: "MANAGE_LINK" });
    const managementUrl = new URL(`/booking/manage/${encodeURIComponent(token)}`, request.nextUrl.origin).toString();
    await notifyBookingCancelled(booking, managementUrl).catch((error) => console.warn("[booking/notification-cancelled]", error));
    return publicJson(request, { ok: true, booking: publicManagedBookingDto(booking) }, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return publicJson(request, failure.body, { status: failure.status, headers: rateLimitHeaders(rate) });
  }
}
