import type { NextRequest } from "next/server";

export function buildDiagnosticReportUrl(request: NextRequest, token: string): string {
  const envOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  const vercel = process.env.VERCEL_URL?.trim();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const fromHeaders = host ? `${proto}://${host}` : "";
  const base =
    envOrigin ||
    (vercel ? (vercel.startsWith("http") ? vercel : `https://${vercel}`) : "") ||
    fromHeaders;

  return base ? `${base.replace(/\/$/, "")}/report/${token}` : `/report/${token}`;
}
