import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const ACTIVE_BRANCH_COOKIE = "eco_active_branch";
const SESSION_COOKIE = "eco_session";
const REQUEST_BURST_LIMITS = {
  api: { windowMs: 10_000, limit: 12, blockMs: 30_000 },
  document: { windowMs: 15_000, limit: 4, blockMs: 30_000 },
} as const;
const REQUEST_BURST_BUCKET_LIMIT = 2_000;
const REQUEST_BURST_BUCKET_TTL_MS = 5 * 60_000;
const REQUEST_BURST_MAX_BLOCK_MS = 10 * 60_000;
const REQUEST_BURST_STRIKE_RESET_MS = 10 * 60_000;
const REQUEST_BURST_EXEMPT_PATHS = new Set([
  "/api/health/live",
  "/api/health/ready",
  "/api/system/version",
  "/api/auth/login",
  "/api/auth/logout",
  // The login screen must stay usable while stale authenticated tabs are being
  // throttled. This read is protected by the auth cache and in-flight dedupe.
  "/api/auth/users",
]);
const ALLOWED_ALL_MODE_WRITES = new Set([
  "POST /api/session/active-branch",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/auth/change-password",
  "POST /api/branches",
]);

type RequestBurstKind = keyof typeof REQUEST_BURST_LIMITS;
type RequestBurstBucket = {
  count: number;
  windowStartedAt: number;
  blockedUntil: number;
  lastSeenAt: number;
  strikes: number;
  routeCounts: Map<string, number>;
};

const requestBurstBuckets = ((globalThis as typeof globalThis & {
  __ecoRequestBurstBuckets?: Map<string, RequestBurstBucket>;
}).__ecoRequestBurstBuckets ??= new Map<string, RequestBurstBucket>());

function requestBurstKind(request: NextRequest): RequestBurstKind | null {
  const pathname = request.nextUrl.pathname;
  if (REQUEST_BURST_EXEMPT_PATHS.has(pathname) || request.method === "OPTIONS") return null;
  if (pathname.startsWith("/api/")) return "api";
  if (request.method !== "GET") return null;
  const destination = request.headers.get("sec-fetch-dest");
  const acceptsHtml = request.headers.get("accept")?.toLowerCase().includes("text/html") ?? false;
  return destination === "document" || acceptsHtml ? "document" : null;
}

function requestClientFingerprint(request: NextRequest, kind: RequestBurstKind) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) return null;
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  return crypto
    .createHash("sha256")
    .update(`${kind}\0${session}\0${address}\0${userAgent}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

function requestUserAgentFamily(request: NextRequest) {
  const userAgent = request.headers.get("user-agent")?.toLowerCase() ?? "";
  if (userAgent.includes("edg/")) return "edge";
  if (userAgent.includes("chrome/") || userAgent.includes("chromium/")) return "chromium";
  if (userAgent.includes("firefox/")) return "firefox";
  if (userAgent.includes("safari/") && !userAgent.includes("chrome/")) return "safari";
  return "other";
}

function requestBranchHash(request: NextRequest) {
  const branchId = activeBranch(request.cookies.get(ACTIVE_BRANCH_COOKIE)?.value);
  if (!branchId) return null;
  return crypto.createHash("sha256").update(branchId, "utf8").digest("hex").slice(0, 12);
}

function cleanupRequestBurstBuckets(now: number) {
  if (requestBurstBuckets.size <= REQUEST_BURST_BUCKET_LIMIT) return;
  for (const [key, bucket] of requestBurstBuckets) {
    if (now - bucket.lastSeenAt > REQUEST_BURST_BUCKET_TTL_MS) requestBurstBuckets.delete(key);
  }
  while (requestBurstBuckets.size > REQUEST_BURST_BUCKET_LIMIT) {
    const oldest = requestBurstBuckets.keys().next().value as string | undefined;
    if (!oldest) break;
    requestBurstBuckets.delete(oldest);
  }
}

function requestBurstResponse(request: NextRequest) {
  const kind = requestBurstKind(request);
  if (!kind) return null;
  const fingerprint = requestClientFingerprint(request, kind);
  if (!fingerprint) return null;

  const now = Date.now();
  cleanupRequestBurstBuckets(now);
  const limits = REQUEST_BURST_LIMITS[kind];
  let bucket = requestBurstBuckets.get(fingerprint);
  if (!bucket || (bucket.blockedUntil <= now && now - bucket.windowStartedAt >= limits.windowMs)) {
    const strikes = bucket && now - bucket.lastSeenAt <= REQUEST_BURST_STRIKE_RESET_MS ? bucket.strikes : 0;
    bucket = {
      count: 0,
      windowStartedAt: now,
      blockedUntil: 0,
      lastSeenAt: now,
      strikes,
      routeCounts: new Map<string, number>(),
    };
    requestBurstBuckets.set(fingerprint, bucket);
  }
  bucket.lastSeenAt = now;
  const routeKey = `${request.method} ${request.nextUrl.pathname}`;
  bucket.routeCounts.set(routeKey, (bucket.routeCounts.get(routeKey) ?? 0) + 1);

  let startedBlock = false;
  let appliedBlockMs = 0;
  if (bucket.blockedUntil <= now) {
    bucket.count += 1;
    if (bucket.count > limits.limit) {
      bucket.strikes += 1;
      appliedBlockMs = Math.min(limits.blockMs * 2 ** (bucket.strikes - 1), REQUEST_BURST_MAX_BLOCK_MS);
      bucket.blockedUntil = now + appliedBlockMs;
      startedBlock = true;
    }
  }
  if (bucket.blockedUntil <= now) return null;

  if (startedBlock) {
    const topRoutes = [...bucket.routeCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([route, count]) => ({ route, count }));
    console.warn("[request-guard] client burst blocked", {
      fingerprint,
      kind,
      count: bucket.count,
      strike: bucket.strikes,
      blockMs: appliedBlockMs,
      method: request.method,
      pathname: request.nextUrl.pathname,
      topRoutes,
      windowMs: now - bucket.windowStartedAt,
      userAgentFamily: requestUserAgentFamily(request),
      branchHash: requestBranchHash(request),
      release: process.env.APP_COMMIT_SHA ?? process.env.NEXT_PUBLIC_APP_COMMIT_SHA ?? "unknown",
    });
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1_000));
  return NextResponse.json(
    { error: "Слишком много одновременных запросов. Повторите через несколько секунд.", code: "client_request_burst" },
    {
      status: 429,
      headers: {
        "Cache-Control": "private, no-store",
        "Retry-After": String(retryAfterSeconds),
        "X-Eco-Request-Blocked": "client-burst",
      },
    }
  );
}

function activeBranch(value: string | undefined) {
  if (!value) return null;
  const [encoded, supplied, extra] = value.split(".");
  if (!encoded || !supplied || extra) return null;
  const secret = process.env.SESSION_SECRET ?? "eco-platform-secret-change-in-production";
  const expected = crypto.createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { branchId?: string; exp?: number };
    if (!payload.branchId || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload.branchId;
  } catch {
    return null;
  }
}

function isRscRequest(request: NextRequest) {
  return (
    request.method === "GET" &&
    (request.headers.get("rsc") === "1" || request.nextUrl.searchParams.has("_rsc"))
  );
}

export function proxy(request: NextRequest) {
  if (isRscRequest(request)) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Eco-RSC-Blocked": "all-rsc",
      },
    });
  }
  const burstResponse = requestBurstResponse(request);
  if (burstResponse) return burstResponse;
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return NextResponse.next();
  if (ALLOWED_ALL_MODE_WRITES.has(`${request.method} ${request.nextUrl.pathname}`)) return NextResponse.next();
  const branchId = activeBranch(request.cookies.get(ACTIVE_BRANCH_COOKIE)?.value);
  if (branchId === "all") {
    return NextResponse.json(
      { error: "В режиме «Все филиалы» операции изменения запрещены. Выберите конкретный филиал.", code: "concrete_branch_required" },
      { status: 409 }
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/:path*",
    "/((?!api/|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
