import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const ACTIVE_BRANCH_COOKIE = "eco_active_branch";
const ALLOWED_ALL_MODE_WRITES = new Set([
  "POST /api/session/active-branch",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/auth/change-password",
  "POST /api/branches",
]);

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

function isRscPrefetch(request: NextRequest) {
  return (
    request.method === "GET" &&
    request.headers.get("rsc") === "1" &&
    request.headers.has("next-router-prefetch")
  );
}

const DYNAMIC_PARAM_TYPES = new Set([
  "c",
  "ci(..)(..)",
  "ci(.)",
  "ci(..)",
  "ci(...)",
  "oc",
  "d",
  "di(..)(..)",
  "di(.)",
  "di(..)",
  "di(...)",
]);

function isRouterSegment(value: unknown) {
  if (typeof value === "string") return true;
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    typeof value[0] === "string" &&
    typeof value[1] === "string" &&
    typeof value[2] === "string" &&
    DYNAMIC_PARAM_TYPES.has(value[2]) &&
    (value[3] === null ||
      (Array.isArray(value[3]) && value[3].every((item) => typeof item === "string")))
  );
}

function isFlightRouterState(value: unknown, depth = 0): boolean {
  if (!Array.isArray(value) || value.length < 2 || value.length > 5 || depth > 2_000) {
    return false;
  }
  if (!isRouterSegment(value[0])) return false;

  const parallelRoutes = value[1];
  if (!parallelRoutes || typeof parallelRoutes !== "object" || Array.isArray(parallelRoutes)) {
    return false;
  }
  if (
    !Object.values(parallelRoutes).every((route) => isFlightRouterState(route, depth + 1))
  ) {
    return false;
  }

  const url = value[2];
  if (
    url !== undefined &&
    url !== null &&
    (!Array.isArray(url) ||
      url.length !== 2 ||
      url.some((part) => typeof part !== "string"))
  ) {
    return false;
  }

  const refresh = value[3];
  if (
    refresh !== undefined &&
    refresh !== null &&
    refresh !== "refetch" &&
    refresh !== "inside-shared-layout" &&
    refresh !== "metadata-only"
  ) {
    return false;
  }

  return value[4] === undefined || typeof value[4] === "number";
}

function isInvalidRscRouterState(request: NextRequest) {
  if (request.method !== "GET" || request.headers.get("rsc") !== "1") return false;

  const routerState = request.headers.get("next-router-state-tree");
  if (!routerState) return false;
  if (routerState.length > 40_000) return true;

  try {
    const parsed = JSON.parse(decodeURIComponent(routerState));
    return !isFlightRouterState(parsed);
  } catch {
    return true;
  }
}

export function proxy(request: NextRequest) {
  const blockedRscRequest = isRscPrefetch(request)
    ? "prefetch"
    : isInvalidRscRouterState(request)
      ? "invalid-router-state"
      : null;

  if (blockedRscRequest) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Eco-RSC-Blocked": blockedRscRequest,
      },
    });
  }
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
