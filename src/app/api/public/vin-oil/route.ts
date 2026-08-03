import { NextRequest } from "next/server";
import {
  getPublicVinOilRecommendation,
  normalizePublicVin,
} from "@/lib/public-oil";
import {
  checkPublicRateLimit,
  getPublicVinLimitPerHour,
  publicJson,
  publicOptions,
  rateLimitHeaders,
  rejectDisallowedPublicOrigin,
} from "@/lib/public-api";

type VinOilBody = {
  vin?: unknown;
  vehicleOverrides?: {
    displacementL?: unknown;
    enginePowerPS?: unknown;
  };
};

function parseVehicleOverrides(input: VinOilBody["vehicleOverrides"]) {
  if (!input || typeof input !== "object") return undefined;
  const displacementL = typeof input.displacementL === "string" ? input.displacementL.trim().slice(0, 20) : "";
  const rawPower = input.enginePowerPS;
  const enginePowerPS =
    typeof rawPower === "number"
      ? rawPower
      : typeof rawPower === "string"
        ? Number.parseFloat(rawPower.replace(",", "."))
        : undefined;
  return {
    ...(displacementL ? { displacementL } : {}),
    ...(typeof enginePowerPS === "number" && Number.isFinite(enginePowerPS) && enginePowerPS > 0
      ? { enginePowerPS }
      : {}),
  };
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}

export async function POST(request: NextRequest) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;

  const rate = checkPublicRateLimit(request, "vin-oil", getPublicVinLimitPerHour());
  if (!rate.ok) {
    return publicJson(
      request,
      { error: "Слишком много VIN-запросов. Попробуйте позже." },
      { status: 429, headers: rateLimitHeaders(rate) }
    );
  }

  try {
    const body = (await request.json().catch(() => null)) as VinOilBody | null;
    if (!body || typeof body !== "object") {
      return publicJson(request, { error: "Неверное тело запроса" }, { status: 400, headers: rateLimitHeaders(rate) });
    }

    const vin = normalizePublicVin(body.vin);
    if (vin.length < 8) {
      return publicJson(
        request,
        { error: "Укажите корректный VIN (минимум 8 символов)" },
        { status: 400, headers: rateLimitHeaders(rate) }
      );
    }

    const result = await getPublicVinOilRecommendation({
      vin,
      vehicleOverrides: parseVehicleOverrides(body.vehicleOverrides),
    });
    return publicJson(request, result, { headers: rateLimitHeaders(rate) });
  } catch (error) {
    console.error("[public/vin-oil]", error);
    return publicJson(
      request,
      { error: "Не удалось выполнить подбор масла" },
      { status: 500, headers: rateLimitHeaders(rate) }
    );
  }
}
