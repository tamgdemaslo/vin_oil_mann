import type { NextRequest } from "next/server";

function httpOrigin(value: string | null | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function bookingAppOrigin(request: NextRequest) {
  const configured = httpOrigin(process.env.APP_ORIGIN) ?? httpOrigin(process.env.NEXT_PUBLIC_APP_ORIGIN);
  if (configured) return configured;

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const forwarded = forwardedHost ? httpOrigin(`${forwardedProto}://${forwardedHost}`) : null;
  return forwarded ?? request.nextUrl.origin;
}

export function buildBookingManagementUrl(request: NextRequest, token: string) {
  return new URL(`/booking/manage/${encodeURIComponent(token)}`, bookingAppOrigin(request)).toString();
}
