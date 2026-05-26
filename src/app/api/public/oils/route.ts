import { NextRequest } from "next/server";
import { listPublicOils } from "@/lib/public-oil";
import {
  publicJson,
  publicOptions,
  rejectDisallowedPublicOrigin,
} from "@/lib/public-api";

function parseLimit(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(1000, Math.max(1, parsed)) : 30;
}

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}

export async function GET(request: NextRequest) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;

  try {
    const params = request.nextUrl.searchParams;
    const result = await listPublicOils({
      search: params.get("search") ?? undefined,
      brand: params.get("brand") ?? undefined,
      sae: params.get("sae") ?? undefined,
      acea: params.get("acea") ?? undefined,
      api: params.get("api") ?? undefined,
      limit: parseLimit(params.get("limit")),
    });
    return publicJson(request, result);
  } catch (error) {
    console.error("[public/oils]", error);
    return publicJson(request, { error: "Не удалось загрузить каталог масел" }, { status: 500 });
  }
}
