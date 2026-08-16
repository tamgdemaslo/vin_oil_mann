import { NextRequest } from "next/server";
import { getBookingAvailability } from "@/lib/booking/availability";
import { bookingErrorPayload } from "@/lib/booking/errors";
import {
  checkPublicRateLimit,
  getPublicBookingReadLimitPerHour,
  publicJson,
  publicOptions,
  rateLimitHeaders,
  rejectDisallowedPublicOrigin,
} from "@/lib/public-api";

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}

export async function POST(request: NextRequest) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;
  const rate = checkPublicRateLimit(request, "booking-availability", getPublicBookingReadLimitPerHour());
  if (!rate.ok) return publicJson(request, { error: "Слишком много запросов" }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const result = await getBookingAvailability({
      branchId: typeof body?.branchId === "string" ? body.branchId : "",
      localDate: typeof body?.localDate === "string" ? body.localDate : "",
      serviceIds: Array.isArray(body?.serviceIds) ? body.serviceIds.map(String) : [],
      masterMembershipId: typeof body?.masterMembershipId === "string" ? body.masterMembershipId : null,
      onlineOnly: true,
      respectLeadTime: true,
    });
    return publicJson(request, result, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return publicJson(request, failure.body, { status: failure.status, headers: rateLimitHeaders(rate) });
  }
}
