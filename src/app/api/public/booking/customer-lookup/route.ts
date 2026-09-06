import { NextRequest } from "next/server";
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
  const rate = checkPublicRateLimit(request, "booking-customer-lookup", Math.min(getPublicBookingReadLimitPerHour(), 40));
  if (!rate.ok) return publicJson(request, {
    error: "Слишком много попыток",
    code: "booking_rate_limited",
  }, { status: 429, headers: rateLimitHeaders(rate) });

  // A phone number is not proof of access to a customer profile. Until a
  // trusted customer session or explicit verification exists, do not query or
  // reveal whether a customer or vehicle is present.
  return publicJson(request, {
    error: "Сохранённые автомобили доступны только после подтверждения доступа",
    code: "booking_customer_verification_required",
  }, { status: 403, headers: rateLimitHeaders(rate) });
}
