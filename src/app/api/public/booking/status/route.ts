import { NextRequest } from "next/server";
import { publicManagedBookingDto } from "@/lib/booking/dto";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { buildBookingManagementUrl } from "@/lib/booking/management-url";
import { getPublicBookingByIdempotency } from "@/lib/booking/service";
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
  const rate = checkPublicRateLimit(request, "booking-create-status", Math.min(getPublicBookingReadLimitPerHour(), 80));
  if (!rate.ok) {
    return publicJson(request, { error: "Слишком много запросов", code: "booking_rate_limited" }, { status: 429, headers: rateLimitHeaders(rate) });
  }
  try {
    const body = await request.json().catch(() => null) as { branchId?: unknown; idempotencyKey?: unknown } | null;
    const result = await getPublicBookingByIdempotency(
      typeof body?.branchId === "string" ? body.branchId : "",
      typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "",
    );
    return publicJson(request, {
      ok: true,
      booking: publicManagedBookingDto(result.booking),
      managementUrl: buildBookingManagementUrl(request, result.managementToken),
      notification: { state: "NOT_CONFIRMED" },
      reused: true,
    }, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return publicJson(request, failure.body, { status: failure.status, headers: rateLimitHeaders(rate) });
  }
}
