import { NextRequest, NextResponse } from "next/server";

const PUBLIC_METHODS = "GET,POST,OPTIONS";
const PUBLIC_HEADERS = "Content-Type, X-Requested-With";
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

type RateBucket = {
  count: number;
  resetAt: number;
};

type PublicRateLimitStore = {
  buckets: Map<string, RateBucket>;
};

const rateStore = ((globalThis as typeof globalThis & {
  __ecoPublicApiRateLimit?: PublicRateLimitStore;
}).__ecoPublicApiRateLimit ??= { buckets: new Map() });

function splitEnvList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getPublicAllowedOrigins(): string[] {
  const configured = splitEnvList(process.env.PUBLIC_CLIENT_ORIGINS);
  if (configured.length > 0) return configured;
  if (process.env.NODE_ENV === "production") return [];
  return [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
}

function getRequestOriginCandidates(request: NextRequest): string[] {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ??
    request.nextUrl.protocol.replace(/:$/, "") ??
    "https";
  return [
    request.nextUrl.origin,
    host ? `${proto}://${host}` : null,
  ].filter((value): value is string => !!value);
}

export function isPublicOriginAllowed(origin: string | null, request?: NextRequest): boolean {
  if (!origin) return true;
  if (request && getRequestOriginCandidates(request).includes(origin)) return true;
  return getPublicAllowedOrigins().includes(origin);
}

function publicCorsHeaders(request: NextRequest): Headers {
  const origin = request.headers.get("origin");
  const headers = new Headers();
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", PUBLIC_METHODS);
  headers.set("Access-Control-Allow-Headers", PUBLIC_HEADERS);
  headers.set("Access-Control-Max-Age", "86400");
  if (origin && isPublicOriginAllowed(origin, request)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

export function publicOptions(request: NextRequest): NextResponse {
  const headers = publicCorsHeaders(request);
  if (!isPublicOriginAllowed(request.headers.get("origin"), request)) {
    return new NextResponse(null, { status: 403, headers });
  }
  return new NextResponse(null, { status: 204, headers });
}

export function rejectDisallowedPublicOrigin(request: NextRequest): NextResponse | null {
  if (isPublicOriginAllowed(request.headers.get("origin"), request)) return null;
  return publicJson(request, { error: "Origin is not allowed" }, { status: 403 });
}

export function publicJson(
  request: NextRequest,
  body: unknown,
  init?: ResponseInit
): NextResponse {
  const headers = publicCorsHeaders(request);
  const existing = new Headers(init?.headers);
  existing.forEach((value, key) => headers.set(key, value));
  return NextResponse.json(body, { ...init, headers });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getPublicVinLimitPerHour(): number {
  return parsePositiveInt(process.env.PUBLIC_API_VIN_LIMIT_PER_HOUR, 20);
}

export function getPublicLeadLimitPerHour(): number {
  return parsePositiveInt(process.env.PUBLIC_API_LEAD_LIMIT_PER_HOUR, 5);
}

export function getPublicBookingReadLimitPerHour(): number {
  return parsePositiveInt(process.env.PUBLIC_BOOKING_READ_LIMIT_PER_HOUR, 180);
}

export function getPublicBookingWriteLimitPerHour(): number {
  return parsePositiveInt(process.env.PUBLIC_BOOKING_WRITE_LIMIT_PER_HOUR, 12);
}

export function getRequestIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwarded ||
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

export function checkPublicRateLimit(
  request: NextRequest,
  routeKey: string,
  limitPerHour: number
): { ok: boolean; remaining: number; resetAt: number } {
  if (limitPerHour <= 0) {
    return { ok: true, remaining: Number.POSITIVE_INFINITY, resetAt: Date.now() + RATE_LIMIT_WINDOW_MS };
  }

  const now = Date.now();
  const key = `${routeKey}:${getRequestIp(request)}`;
  const current = rateStore.buckets.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateStore.buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: Math.max(0, limitPerHour - 1), resetAt };
  }

  if (current.count >= limitPerHour) {
    return { ok: false, remaining: 0, resetAt: current.resetAt };
  }

  current.count += 1;
  return { ok: true, remaining: Math.max(0, limitPerHour - current.count), resetAt: current.resetAt };
}

export function rateLimitHeaders(result: { remaining: number; resetAt: number }): HeadersInit {
  return {
    "X-RateLimit-Remaining": String(Math.max(0, Math.floor(result.remaining))),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

export function hasLeadHoneypot(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  return ["website", "companyWebsite", "_hp", "_gotcha"].some((key) => {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}
