import { NextRequest } from "next/server";
import { publicManagedBookingDto } from "@/lib/booking/dto";
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

export async function GET(request: NextRequest, context: Context) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;
  const rate = checkPublicRateLimit(request, "booking-manage-read", Math.min(getPublicBookingReadLimitPerHour(), 80));
  if (!rate.ok) return publicJson(request, { error: "Слишком много запросов" }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const { token } = await context.params;
    const booking = await getBookingByManagementToken(token);
    return publicJson(request, { booking: publicManagedBookingDto(booking) }, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return publicJson(request, failure.body, { status: failure.status, headers: rateLimitHeaders(rate) });
  }
}
