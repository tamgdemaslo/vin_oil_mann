import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
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

export async function GET(request: NextRequest) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;
  const rate = checkPublicRateLimit(request, "booking-services", getPublicBookingReadLimitPerHour());
  if (!rate.ok) return publicJson(request, { error: "Слишком много запросов" }, { status: 429, headers: rateLimitHeaders(rate) });
  const branchId = request.nextUrl.searchParams.get("branchId")?.trim();
  if (!branchId) return publicJson(request, { error: "Филиал не указан" }, { status: 400, headers: rateLimitHeaders(rate) });
  const enabled = await prisma.branchBookingSettings.findFirst({
    where: { branchId, publicBookingEnabled: true, branch: { status: "active" } },
    select: { branchId: true },
  });
  if (!enabled) return publicJson(request, { error: "Онлайн-запись недоступна" }, { status: 404, headers: rateLimitHeaders(rate) });
  const services = await prisma.bookingService.findMany({
    where: { branchId, status: "ACTIVE", onlineBookingEnabled: true },
    select: {
      id: true,
      name: true,
      description: true,
      durationMinutes: true,
      requiresVin: true,
      requiresConfirmation: true,
      requiredFieldsJson: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return publicJson(request, {
    services: services.map((service) => ({
      ...service,
      requiredFields: Array.isArray(service.requiredFieldsJson)
        ? service.requiredFieldsJson.filter((field): field is string => typeof field === "string")
        : [],
      requiredFieldsJson: undefined,
    })),
  }, { headers: rateLimitHeaders(rate) });
}
