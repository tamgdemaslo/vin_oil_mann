import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { User as AuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { bindRequestTenantStore as bind, type RequestTenant } from "@/lib/request-tenant-store";

export { getRequestTenant, type RequestTenant } from "@/lib/request-tenant-store";

const ACTIVE_BRANCH_COOKIE = "eco_active_branch";
const ALL_BRANCHES = "all";

type BranchCookiePayload = { branchId: string; login: string; exp: number };
function normalize(value: string) {
  return value.trim().toLowerCase();
}

function secret() {
  return process.env.SESSION_SECRET ?? "eco-platform-secret-change-in-production";
}

function signature(value: string) {
  return crypto.createHmac("sha256", secret()).update(value, "utf8").digest("base64url");
}

function decode(value: string | undefined, login: string): BranchCookiePayload | null {
  if (!value) return null;
  const [encoded, supplied, extra] = value.split(".");
  if (!encoded || !supplied || extra) return null;
  const expected = signature(encoded);
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as BranchCookiePayload;
    if (!payload.branchId || normalize(payload.login) !== normalize(login) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Binds the legacy organization tenant to the verified active branch.
 * Failure is fail-closed after branch tables exist; pre-migration databases keep
 * the historical single-organization behavior until the migration is applied.
 */
export async function bindRequestTenant(authUser: AuthUser) {
  const denied: RequestTenant = { mode: "denied", branchId: null, organizationId: null, allowedBranchIds: [], businessGroupId: null, userId: null, permissions: [] };
  // Clear a possibly inherited AsyncLocalStorage value before control-plane
  // lookups. If any lookup fails, the request must stay denied instead of
  // reusing a tenant left in the surrounding async context.
  bind(denied);
  try {
    const store = await cookies();
    const requested = decode(store.get(ACTIVE_BRANCH_COOKIE)?.value, authUser.login)?.branchId ?? null;
    const user = await prisma.user.findUnique({ where: { login: normalize(authUser.login) } });
    if (!user) {
      bind({ ...denied, branchId: requested });
      return;
    }

    const [groupMemberships, branchMemberships] = await Promise.all([
      prisma.businessGroupMembership.findMany({ where: { userId: user.id, status: "active" } }),
      prisma.branchMembership.findMany({
        where: { userId: user.id, status: "active" },
        include: { branch: true },
        orderBy: [{ isDefaultBranch: "desc" }, { joinedAt: "asc" }],
      }),
    ]);
    const groupIds = new Set(groupMemberships.map((membership) => membership.businessGroupId));

    if (requested === ALL_BRANCHES) {
      const allowedBranchIds = groupIds.size
        ? (await prisma.branch.findMany({ where: { businessGroupId: { in: [...groupIds] } }, select: { id: true } })).map((branch) => branch.id)
        : [];
      bind(allowedBranchIds.length
        ? { mode: "all", branchId: null, organizationId: null, allowedBranchIds, businessGroupId: [...groupIds][0] ?? null, userId: user.id, permissions: groupMemberships.map((membership) => membership.role) }
        : denied);
      return;
    }

    let branch = requested
      ? branchMemberships.find((membership) => membership.branchId === requested)?.branch ??
        (await prisma.branch.findFirst({ where: { id: requested, businessGroupId: { in: [...groupIds] } } }))
      : null;
    if (!branch && user.lastActiveBranchId) {
      branch = branchMemberships.find((membership) => membership.branchId === user.lastActiveBranchId)?.branch ??
        (await prisma.branch.findFirst({ where: { id: user.lastActiveBranchId, businessGroupId: { in: [...groupIds] } } }));
    }
    branch ??= branchMemberships[0]?.branch ??
      (groupIds.size ? await prisma.branch.findFirst({ where: { businessGroupId: { in: [...groupIds] } }, orderBy: { createdAt: "asc" } }) : null);

    if (!branch || branch.status !== "active") {
      bind({ ...denied, branchId: requested });
      return;
    }
    bind({ mode: "branch", branchId: branch.id, organizationId: branch.legacyOrganizationId ?? branch.id, allowedBranchIds: [branch.id], businessGroupId: branch.businessGroupId, userId: user.id, permissions: branchMemberships.filter((membership) => membership.branchId === branch.id).map((membership) => membership.roleId) });
  } catch (error) {
    console.error("Failed to bind verified branch context", error);
    bind(denied);
  }
}
