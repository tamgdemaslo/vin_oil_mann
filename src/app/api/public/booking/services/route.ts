import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { CATALOG_BOOKING_SERVICE_PREFIX } from "@/lib/booking/catalog-services";
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
  const productIds = services
    .map((service) => service.id.startsWith(CATALOG_BOOKING_SERVICE_PREFIX)
      ? service.id.slice(CATALOG_BOOKING_SERVICE_PREFIX.length)
      : null)
    .filter((id): id is string => Boolean(id));
  const products = productIds.length ? await prisma.localProduct.findMany({
    where: { branchId, id: { in: productIds }, entityType: "service", archived: false },
    select: {
      id: true,
      salePriceCents: true,
      minPriceCents: true,
      currencyName: true,
      minPriceCurrencyName: true,
      priceNeedsSetup: true,
      pricingMode: true,
    },
  }) : [];
  const productsById = new Map(products.map((product) => [product.id, product]));
  return publicJson(request, {
    services: services.map((service) => {
      const productId = service.id.startsWith(CATALOG_BOOKING_SERVICE_PREFIX)
        ? service.id.slice(CATALOG_BOOKING_SERVICE_PREFIX.length)
        : null;
      const product = productId ? productsById.get(productId) : null;
      const pricing = !product || product.priceNeedsSetup
        ? null
        : product.pricingMode === "assistant_rule"
          ? { kind: "vehicle_calculation" as const }
          : product.minPriceCents && product.minPriceCents > 0
            ? { kind: "from" as const, amountCents: product.minPriceCents, currency: product.minPriceCurrencyName || product.currencyName || "RUB" }
            : product.salePriceCents > 0
              ? { kind: "fixed" as const, amountCents: product.salePriceCents, currency: product.currencyName || "RUB" }
              : null;
      return {
        ...service,
        pricing,
        requiredFields: Array.isArray(service.requiredFieldsJson)
        ? service.requiredFieldsJson.filter((field): field is string => typeof field === "string")
        : [],
        requiredFieldsJson: undefined,
      };
    }),
  }, { headers: rateLimitHeaders(rate) });
}
