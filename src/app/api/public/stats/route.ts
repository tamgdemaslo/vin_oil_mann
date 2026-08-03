import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  publicJson,
  publicOptions,
  rejectDisallowedPublicOrigin,
} from "@/lib/public-api";

const FALLBACK_REPLACEMENTS_COUNT = 4217;

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin) {
    const originError = rejectDisallowedPublicOrigin(request);
    if (originError) return originError;
  }

  try {
    const replacementsCount = await prisma.moySkladDemandSync.count({
      where: { applicable: true },
    });

    return publicJson(
      request,
      {
        replacementsCount: Math.max(replacementsCount, FALLBACK_REPLACEMENTS_COUNT),
        source: "moysklad_demand_sync",
        updatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("[public/stats]", error);
    return publicJson(
      request,
      {
        replacementsCount: FALLBACK_REPLACEMENTS_COUNT,
        source: "fallback",
        updatedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
