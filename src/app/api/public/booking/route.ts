import { NextRequest } from "next/server";
import { bookingDto } from "@/lib/booking/dto";
import { bookingErrorPayload } from "@/lib/booking/errors";
import { notifyBookingCreated } from "@/lib/booking/notifications";
import { createBooking, type CreateBookingInput } from "@/lib/booking/service";
import {
  checkPublicRateLimit,
  getPublicBookingWriteLimitPerHour,
  hasLeadHoneypot,
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
  const rate = checkPublicRateLimit(request, "booking-create", getPublicBookingWriteLimitPerHour());
  if (!rate.ok) return publicJson(request, { error: "Слишком много попыток записи. Попробуйте позже." }, { status: 429, headers: rateLimitHeaders(rate) });
  try {
    const body = await request.json().catch(() => null) as (CreateBookingInput & Record<string, unknown>) | null;
    if (!body || hasLeadHoneypot(body)) {
      return publicJson(request, body ? { ok: true } : { error: "Неверное тело запроса" }, { status: body ? 202 : 400, headers: rateLimitHeaders(rate) });
    }
    const result = await createBooking({
      branchId: String(body.branchId ?? ""),
      serviceIds: Array.isArray(body.serviceIds) ? body.serviceIds.map(String) : [],
      masterMembershipId: String(body.masterMembershipId ?? ""),
      startsAt: String(body.startsAt ?? ""),
      customerName: String(body.customerName ?? ""),
      phone: String(body.phone ?? ""),
      email: typeof body.email === "string" ? body.email : null,
      // Public callers never select a CRM row directly; the service resolves the
      // exact normalized phone inside the branch and handles ambiguous matches safely.
      clientId: null,
      vehicleId: typeof body.vehicleId === "string" ? body.vehicleId : null,
      vehicle: body.vehicle && typeof body.vehicle === "object" ? body.vehicle : null,
      comment: typeof body.comment === "string" ? body.comment : null,
      source: "PUBLIC",
    }, { kind: "PUBLIC", respectLeadTime: true });
    const managementUrl = new URL(`/booking/manage/${encodeURIComponent(result.managementToken)}`, request.nextUrl.origin).toString();
    await notifyBookingCreated(result.booking, managementUrl).catch((error) => console.warn("[booking/notification-created]", error));
    return publicJson(request, {
      ok: true,
      booking: bookingDto(result.booking),
      managementUrl,
    }, { status: 201, headers: rateLimitHeaders(rate) });
  } catch (error) {
    const failure = bookingErrorPayload(error);
    return publicJson(request, failure.body, { status: failure.status, headers: rateLimitHeaders(rate) });
  }
}
