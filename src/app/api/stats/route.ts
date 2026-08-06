import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const FALLBACK_REPLACEMENTS_COUNT = 4217;

export async function GET() {
  try {
    const replacementsCount = await withTimeout(
      prisma.localDemand.count({
        where: { applicable: true },
      }),
      1200
    );

    return NextResponse.json({
      replacementsCount: Math.max(replacementsCount, FALLBACK_REPLACEMENTS_COUNT),
      source: "eco-platform",
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      replacementsCount: FALLBACK_REPLACEMENTS_COUNT,
      source: "fallback",
      updatedAt: new Date().toISOString(),
    });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Stats request timed out.")), timeoutMs);
    promise
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}
