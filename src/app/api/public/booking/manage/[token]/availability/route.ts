import { NextRequest } from "next/server";
import { getBookingAvailability } from "@/lib/booking/availability";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { getBookingByManagementToken } from "@/lib/booking/service";
import {
  checkPublicRateLimit,
  getPublicBookingReadLimitPerHour,
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
  const rate = checkPublicRateLimit(request, "booking-manage-availability", getPublicBookingReadLimitPerHour());
  if (!rate.ok) return publicJson(request, { error: "Слишком много запросов" }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const { token } = await context.params;
    const booking = await getBookingByManagementToken(token);
    const body = await request.json().catch(() => null) as { localDate?: unknown } | null;
    const result = await getBookingAvailability({
      branchId: booking.branchId,
      localDate: typeof body?.localDate === "string" ? body.localDate : "",
      serviceIds: booking.serviceItems.map((item) => item.serviceId).filter((id): id is string => Boolean(id)),
      onlineOnly: true,
      respectLeadTime: false,
      excludeBookingId: booking.id,
    });
    return publicJson(request, result, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return publicJson(request, failure.body, { status: failure.status, headers: rateLimitHeaders(rate) });
  }
}
