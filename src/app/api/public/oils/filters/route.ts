import { NextRequest } from "next/server";
import { getPublicOilFilters } from "@/lib/public-oil";
import { publicJson, publicOptions, rejectDisallowedPublicOrigin } from "@/lib/public-api";

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}
export async function GET(request: NextRequest) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;
  try {
    return publicJson(request, await getPublicOilFilters(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[public/oils/filters]", error);
    return publicJson(request, { error: "Фильтры каталога временно недоступны" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
