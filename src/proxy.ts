import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const ACTIVE_BRANCH_COOKIE = "eco_active_branch";
const ALLOWED_ALL_MODE_WRITES = new Set([
  "/api/session/active-branch",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/change-password",
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

export function proxy(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return NextResponse.next();
  if (ALLOWED_ALL_MODE_WRITES.has(request.nextUrl.pathname)) return NextResponse.next();
  const branchId = activeBranch(request.cookies.get(ACTIVE_BRANCH_COOKIE)?.value);
  if (branchId === "all") {
    return NextResponse.json(
      { error: "В режиме «Все филиалы» операции изменения запрещены. Выберите конкретный филиал.", code: "concrete_branch_required" },
      { status: 409 }
    );
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
