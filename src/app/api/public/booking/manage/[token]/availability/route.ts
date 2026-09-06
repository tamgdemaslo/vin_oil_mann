import { NextRequest } from "next/server";
import { getBookingAvailability } from "@/lib/booking/availability";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { getBookingByManagementToken } from "@/lib/booking/service";
import { assertLocalDate } from "@/lib/booking/timezone";
import {
  checkPublicRateLimit,
  getPublicBookingReadLimitPerHour,
  publicJson,
  publicOptions,
  rateLimitHeaders,
  rejectDisallowedPublicOrigin,
} from "@/lib/public-api";

type Context = { params: Promise<{ token: string }> };

function addLocalDays(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}

export async function POST(request: NextRequest, context: Context) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;
  const rate = checkPublicRateLimit(request, "booking-manage-availability", getPublicBookingReadLimitPerHour());
  if (!rate.ok) return publicJson(request, { error: "Слишком много запросов", code: "booking_rate_limited" }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const { token } = await context.params;
    const booking = await getBookingByManagementToken(token);
    const body = await request.json().catch(() => null) as { localDate?: unknown; searchNearest?: unknown } | null;
    const localDate = assertLocalDate(typeof body?.localDate === "string" ? body.localDate : "");
    const availabilityInput = {
      branchId: booking.branchId,
      serviceIds: booking.serviceItems.map((item) => item.serviceId).filter((id): id is string => Boolean(id)),
      onlineOnly: true,
      respectLeadTime: false,
      excludeBookingId: booking.id,
    };
    if (body?.searchNearest === true) {
      const days = [];
      for (let offset = 1; offset <= 10 && days.length < 3; offset += 1) {
        const candidateDate = addLocalDays(localDate, offset);
        const candidate = await getBookingAvailability({ ...availabilityInput, localDate: candidateDate });
        if (candidate.slots.length) days.push({ localDate: candidateDate, slots: candidate.slots.slice(0, 4) });
      }
      return publicJson(request, { days, searchedDays: 10 }, { headers: rateLimitHeaders(rate) });
    }
    const result = await getBookingAvailability({ ...availabilityInput, localDate });
    return publicJson(request, result, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return publicJson(request, failure.body, { status: failure.status, headers: rateLimitHeaders(rate) });
  }
}
