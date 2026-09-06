import { NextRequest } from "next/server";
import { getBookingAvailability } from "@/lib/booking/availability";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { assertLocalDate } from "@/lib/booking/timezone";
import {
  checkPublicRateLimit,
  getPublicBookingReadLimitPerHour,
  publicJson,
  publicOptions,
  rateLimitHeaders,
  rejectDisallowedPublicOrigin,
} from "@/lib/public-api";

const MAX_SEARCH_DAYS = 10;
const MAX_RESULT_DAYS = 3;

function addLocalDays(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}

export async function POST(request: NextRequest) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;
  const rate = checkPublicRateLimit(request, "booking-nearest-availability", Math.min(getPublicBookingReadLimitPerHour(), 50));
  if (!rate.ok) {
    return publicJson(request, { error: "Слишком много запросов", code: "booking_rate_limited" }, { status: 429, headers: rateLimitHeaders(rate) });
  }
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const branchId = typeof body?.branchId === "string" ? body.branchId : "";
    const fromDate = assertLocalDate(typeof body?.fromDate === "string" ? body.fromDate : "");
    const serviceIds = Array.isArray(body?.serviceIds) ? body.serviceIds.map(String) : [];
    const days = [];
    for (let offset = 1; offset <= MAX_SEARCH_DAYS && days.length < MAX_RESULT_DAYS; offset += 1) {
      const localDate = addLocalDays(fromDate, offset);
      const availability = await getBookingAvailability({
        branchId,
        localDate,
        serviceIds,
        onlineOnly: true,
        respectLeadTime: true,
      });
      if (availability.slots.length) {
        days.push({
          localDate,
          durationMinutes: availability.durationMinutes,
          slots: availability.slots.slice(0, 4),
        });
      }
    }
    return publicJson(request, { days, searchedDays: MAX_SEARCH_DAYS }, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return publicJson(request, failure.body, { status: failure.status, headers: rateLimitHeaders(rate) });
  }
}
