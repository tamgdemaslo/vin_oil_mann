import { NextRequest } from "next/server";
import { publicManagedBookingDto } from "@/lib/booking/dto";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { notifyBookingRescheduled } from "@/lib/booking/notifications";
import { getBookingByManagementToken, rescheduleBooking } from "@/lib/booking/service";
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
  const rate = checkPublicRateLimit(request, "booking-manage-reschedule", getPublicBookingWriteLimitPerHour());
  if (!rate.ok) return publicJson(request, { error: "Слишком много попыток" }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const { token } = await context.params;
    const current = await getBookingByManagementToken(token);
    const body = await request.json().catch(() => null) as { startsAt?: unknown; masterMembershipId?: unknown } | null;
    const booking = await rescheduleBooking(current.id, {
      startsAt: typeof body?.startsAt === "string" ? body.startsAt : "",
      masterMembershipId: typeof body?.masterMembershipId === "string" ? body.masterMembershipId : null,
    }, { kind: "MANAGE_LINK", respectLeadTime: false });
    const managementUrl = new URL(`/booking/manage/${encodeURIComponent(token)}`, request.nextUrl.origin).toString();
    await notifyBookingRescheduled(booking, managementUrl).catch((error) => console.warn("[booking/notification-rescheduled]", error));
    return publicJson(request, { ok: true, booking: publicManagedBookingDto(booking) }, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return publicJson(request, failure.body, { status: failure.status, headers: rateLimitHeaders(rate) });
  }
}
