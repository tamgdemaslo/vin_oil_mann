import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import {
  checkPublicRateLimit,
  getPublicBookingReadLimitPerHour,
  publicJson,
  publicOptions,
  rateLimitHeaders,
  rejectDisallowedPublicOrigin,
} from "@/lib/public-api";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function legacyVehicle(value: unknown) {
  const vehicle = record(record(value).vehicle);
  const display = String(vehicle.model ?? "").trim();
  const words = display.split(/\s+/u).filter(Boolean);
  const make = String(vehicle.make ?? words[0] ?? "").trim();
  const model = String(vehicle.modelName ?? words.slice(1).join(" ") ?? "").trim() || (words.length === 1 ? words[0] : "");
  if (!make || !model) return null;
  const parsedYear = Number.parseInt(String(vehicle.year ?? ""), 10);
  return {
    id: "legacy:vehicle",
    make,
    model,
    generation: null,
    year: Number.isInteger(parsedYear) ? parsedYear : null,
    plate: String(vehicle.plate ?? "").trim().toUpperCase() || null,
    vin: String(vehicle.vin ?? "").trim().toUpperCase() || null,
  };
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}

export async function POST(request: NextRequest) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;
  const rate = checkPublicRateLimit(request, "booking-customer-lookup", Math.min(getPublicBookingReadLimitPerHour(), 40));
  if (!rate.ok) return publicJson(request, { error: "Слишком много попыток" }, { status: 429, headers: rateLimitHeaders(rate) });
  const body = await request.json().catch(() => null) as { branchId?: unknown; phone?: unknown } | null;
  const branchId = typeof body?.branchId === "string" ? body.branchId.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone : "";
  const normalizedPhone = normalizePhoneKey(phone);
  if (!branchId || !normalizedPhone) {
    return publicJson(request, { error: "Укажите филиал и корректный телефон" }, { status: 400, headers: rateLimitHeaders(rate) });
  }
  const enabled = await prisma.branchBookingSettings.findFirst({
    where: { branchId, publicBookingEnabled: true, branch: { status: "active" } },
    select: { branchId: true },
  });
  if (!enabled) return publicJson(request, { error: "Онлайн-запись недоступна" }, { status: 404, headers: rateLimitHeaders(rate) });
  const matches = await prisma.localCounterparty.findMany({
    where: { branchId, normalizedPhone, archived: false },
    select: {
      raw: true,
      vehicles: {
        where: { status: "ACTIVE" },
        select: { id: true, make: true, model: true, generation: true, year: true, plate: true, vin: true },
        orderBy: { updatedAt: "desc" },
      },
    },
    take: 2,
  });
  if (matches.length !== 1) {
    return publicJson(request, { match: matches.length ? "ambiguous" : "none" }, { headers: rateLimitHeaders(rate) });
  }
  return publicJson(request, {
    match: "found",
    vehicles: matches[0].vehicles.length
      ? matches[0].vehicles
      : [legacyVehicle(matches[0].raw)].filter(Boolean),
  }, { headers: rateLimitHeaders(rate) });
}
