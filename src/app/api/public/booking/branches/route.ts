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
  const rate = checkPublicRateLimit(request, "booking-branches", getPublicBookingReadLimitPerHour());
  if (!rate.ok) {
    return publicJson(request, { error: "Слишком много запросов" }, { status: 429, headers: rateLimitHeaders(rate) });
  }
  const branches = await prisma.branch.findMany({
    where: { status: "active", bookingSettings: { publicBookingEnabled: true } },
    select: {
      id: true,
      name: true,
      shortName: true,
      address: true,
      phone: true,
      timezone: true,
      bookingSettings: { select: { publicName: true, publicIntro: true, bookingHorizonDays: true } },
      bookingWorkingHours: {
        select: { weekday: true, isWorking: true, startTime: true, endTime: true },
        orderBy: { weekday: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });
  return publicJson(request, {
    branches: branches.map((branch) => ({
      id: branch.id,
      name: branch.bookingSettings?.publicName || branch.shortName || branch.name,
      address: branch.address,
      phone: branch.phone,
      timezone: branch.timezone,
      intro: branch.bookingSettings?.publicIntro,
      bookingHorizonDays: branch.bookingSettings?.bookingHorizonDays ?? 60,
      workingHours: branch.bookingWorkingHours,
    })),
  }, { headers: rateLimitHeaders(rate) });
}
