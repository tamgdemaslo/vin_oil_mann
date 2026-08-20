import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageOrganizations, canViewOrganizations } from "@/lib/organizations";
import { canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import { getBranchContext } from "@/lib/branch-context";
import { resolveNavigationForUser } from "@/lib/navigation-policy.mjs";

const SESSION_RESPONSE_CACHE_MS = 3_000;
const SESSION_RESPONSE_CACHE_LIMIT = 1_000;

async function buildSessionPayload() {
  const session = await getSession();
  if (!session) return { user: null };
  const branchContext = await getBranchContext({ allowAll: true, requireActive: false });
  const [canManageOrganizationsSection, canViewOrganizationsSection, canViewWarehouseAnalyticsSection] = await Promise.all([
    branchContext?.canManageBranches ?? canManageOrganizations(session.user),
    canViewOrganizations(session.user),
    canViewWarehouseAnalytics(session.user),
  ]);
  const navigationPermissions = new Set(branchContext?.permissions ?? []);
  if (canManageOrganizationsSection) navigationPermissions.add("organizations.manage");
  if (canViewOrganizationsSection) navigationPermissions.add("organizations.view");
  if (canViewWarehouseAnalyticsSection) navigationPermissions.add("warehouse.analytics.view");
  const navigation = resolveNavigationForUser({
    user: session.user,
    businessGroupMembership: branchContext?.groupRole ? { role: branchContext.groupRole } : null,
    branchMemberships: branchContext?.branchId
      ? [{ branchId: branchContext.branchId, roleId: branchContext.branchRole, permissions: branchContext.permissions }]
      : [],
    permissions: [...navigationPermissions],
    activeBranchMode: branchContext?.mode ?? "branch",
    activeBranchId: branchContext?.branchId ?? null,
  });
  return {
    user: session.user,
    navigation,
    branchContext: branchContext
      ? {
          mode: branchContext.mode,
          activeBranchId: branchContext.branchId ?? "all",
          activeBranch: branchContext.branch,
          branches: branchContext.branches,
          groupRole: branchContext.groupRole,
          branchRole: branchContext.branchRole,
          permissions: branchContext.permissions,
          canManageBranches: branchContext.canManageBranches,
        }
      : null,
    permissions: {
      canManageOrganizations: canManageOrganizationsSection,
      canViewOrganizations: canViewOrganizationsSection,
      canViewWarehouseAnalytics: canViewWarehouseAnalyticsSection,
    },
  };
}

type SessionResponsePayload = Awaited<ReturnType<typeof buildSessionPayload>>;
type SessionResponseCacheEntry = {
  expiresAt: number;
  promise: Promise<SessionResponsePayload>;
};

const sessionResponseCache = ((globalThis as typeof globalThis & {
  __ecoSessionResponseCache?: Map<string, SessionResponseCacheEntry>;
}).__ecoSessionResponseCache ??= new Map<string, SessionResponseCacheEntry>());

function sessionResponseCacheKey(request: NextRequest) {
  const sessionCookie = request.cookies.get("eco_session")?.value;
  if (!sessionCookie) return null;
  const branchCookie = request.cookies.get("eco_active_branch")?.value ?? "";
  return crypto
    .createHash("sha256")
    .update(`${sessionCookie}\0${branchCookie}`, "utf8")
    .digest("hex")
    .slice(0, 24);
}

function cachedSessionPayload(request: NextRequest) {
  const key = sessionResponseCacheKey(request);
  if (!key) return buildSessionPayload();
  const now = Date.now();
  const cached = sessionResponseCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  if (cached) sessionResponseCache.delete(key);

  if (sessionResponseCache.size >= SESSION_RESPONSE_CACHE_LIMIT) {
    for (const [cacheKey, entry] of sessionResponseCache) {
      if (entry.expiresAt <= now) sessionResponseCache.delete(cacheKey);
    }
    while (sessionResponseCache.size >= SESSION_RESPONSE_CACHE_LIMIT) {
      const oldestKey = sessionResponseCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      sessionResponseCache.delete(oldestKey);
    }
  }

  const promise = buildSessionPayload().catch((error) => {
    sessionResponseCache.delete(key);
    throw error;
  });
  sessionResponseCache.set(key, { expiresAt: now + SESSION_RESPONSE_CACHE_MS, promise });
  return promise;
}

export async function GET(request: NextRequest) {
  const payload = await cachedSessionPayload(request);
  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
