import crypto from "node:crypto";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { getSession, type User as AuthUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const ACTIVE_BRANCH_COOKIE = "eco_active_branch";
const ACTIVE_BRANCH_MAX_AGE = 60 * 60 * 24 * 180;
const ALL_BRANCHES = "all";
const GROUP_ROLES = new Set(["group_owner", "group_admin", "group_analyst"]);
const GROUP_MANAGE_ROLES = new Set(["group_owner", "group_admin"]);

type BranchCookiePayload = {
  branchId: string;
  login: string;
  exp: number;
};

export type BranchSummary = {
  id: string;
  businessGroupId: string;
  name: string;
  shortName: string;
  slug: string;
  status: string;
  address: string | null;
  timezone: string;
  phone: string | null;
  email: string | null;
  legacyOrganizationId: string | null;
};

export type BranchContext = {
  user: AuthUser;
  userId: string;
  businessGroupId: string;
  groupRole: string | null;
  branchRole: string | null;
  isGroupOwner: boolean;
  canManageBranches: boolean;
  mode: "branch" | "all";
  branchId: string | null;
  organizationId: string | null;
  branch: BranchSummary | null;
  branches: BranchSummary[];
};

export class BranchAccessError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 403, code = "branch_access_denied") {
    super(message);
    this.name = "BranchAccessError";
    this.status = status;
    this.code = code;
  }
}

function normalizeLogin(value: string) {
  return value.trim().toLowerCase();
}

function branchSecret() {
  return process.env.SESSION_SECRET ?? "eco-platform-secret-change-in-production";
}

function sign(value: string) {
  return crypto.createHmac("sha256", branchSecret()).update(value, "utf8").digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encodeCookie(payload: BranchCookiePayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

function decodeCookie(value: string | undefined, login: string): BranchCookiePayload | null {
  if (!value) return null;
  const [encoded, signature, extra] = value.split(".");
  if (!encoded || !signature || extra || !safeEqual(sign(encoded), signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as BranchCookiePayload;
    if (
      !payload?.branchId ||
      normalizeLogin(payload.login) !== normalizeLogin(login) ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function activeBranchCookieOptions() {
  return {
    name: ACTIVE_BRANCH_COOKIE,
    maxAge: ACTIVE_BRANCH_MAX_AGE,
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
  };
}

function branchCookieToken(branchId: string, login: string) {
  return encodeCookie({
    branchId,
    login,
    exp: Math.floor(Date.now() / 1000) + ACTIVE_BRANCH_MAX_AGE,
  });
}

function branchSummary(branch: {
  id: string;
  businessGroupId: string;
  name: string;
  shortName: string;
  slug: string;
  status: string;
  address: string | null;
  timezone: string;
  phone: string | null;
  email: string | null;
  legacyOrganizationId: string | null;
}): BranchSummary {
  return { ...branch };
}

async function auditAccess(input: {
  userId?: string | null;
  businessGroupId?: string | null;
  branchId?: string | null;
  action: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  try {
    await prisma.branchAuditLog.create({
      data: {
        userId: input.userId ?? null,
        businessGroupId: input.businessGroupId ?? null,
        branchId: input.branchId ?? null,
        action: input.action,
        entityType: "branch",
        entityId: input.entityId ?? input.branchId ?? null,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    console.error("branch audit failed", error);
  }
}

async function ensureIdentity(authUser: AuthUser) {
  const login = normalizeLogin(authUser.login);
  const user = await prisma.user.findFirst({
    where: { login, status: "active" },
  });
  if (!user) throw new BranchAccessError("Аккаунт не привязан к филиальной архитектуре", 403, "branch_identity_missing");
  const [groupMembership, branchMembership] = await Promise.all([
    prisma.businessGroupMembership.findFirst({
      where: { userId: user.id, status: "active", businessGroup: { status: "active" } },
      include: { businessGroup: true },
    }),
    prisma.branchMembership.findFirst({
      where: { userId: user.id, status: "active", branch: { businessGroup: { status: "active" } } },
      include: { branch: { include: { businessGroup: true } } },
      orderBy: [{ isDefaultBranch: "desc" }, { joinedAt: "asc" }],
    }),
  ]);
  const group = groupMembership?.businessGroup ?? branchMembership?.branch.businessGroup;
  if (!group) throw new BranchAccessError("У аккаунта нет активного доступа к бизнес-группе", 403, "business_group_access_missing");
  return { user, group };
}

async function resolveAccess(authUser: AuthUser) {
  const { user, group } = await ensureIdentity(authUser);
  const [groupMembership, branchMemberships] = await Promise.all([
    prisma.businessGroupMembership.findUnique({
      where: { businessGroupId_userId: { businessGroupId: group.id, userId: user.id } },
    }),
    prisma.branchMembership.findMany({
      where: { userId: user.id, status: "active", branch: { businessGroupId: group.id } },
      include: { branch: true },
      orderBy: [{ isDefaultBranch: "desc" }, { joinedAt: "asc" }],
    }),
  ]);

  const activeGroupRole = groupMembership?.status === "active" && GROUP_ROLES.has(groupMembership.role)
    ? groupMembership.role
    : null;
  const branches = activeGroupRole
    ? await prisma.branch.findMany({ where: { businessGroupId: group.id }, orderBy: [{ status: "asc" }, { name: "asc" }] })
    : branchMemberships.map((membership) => membership.branch);

  return { user, group, groupRole: activeGroupRole, branchMemberships, branches };
}

export async function getBranchContext(options: { allowAll?: boolean; requireActive?: boolean } = {}): Promise<BranchContext | null> {
  const session = await getSession();
  if (!session) return null;

  const access = await resolveAccess(session.user);
  const store = await cookies();
  const cookie = decodeCookie(store.get(ACTIVE_BRANCH_COOKIE)?.value, session.user.login);
  const allowedIds = new Set(access.branches.map((branch) => branch.id));
  const canUseAll = Boolean(access.groupRole && options.allowAll !== false);
  const requested = cookie?.branchId;

  if (requested === ALL_BRANCHES && canUseAll) {
    return {
      user: session.user,
      userId: access.user.id,
      businessGroupId: access.group.id,
      groupRole: access.groupRole,
      branchRole: null,
      isGroupOwner: access.groupRole === "group_owner",
      canManageBranches: Boolean(access.groupRole && GROUP_MANAGE_ROLES.has(access.groupRole)),
      mode: "all",
      branchId: null,
      organizationId: null,
      branch: null,
      branches: access.branches.map(branchSummary),
    };
  }

  let selectedId = requested && allowedIds.has(requested) ? requested : null;
  if (!selectedId && access.user.lastActiveBranchId && allowedIds.has(access.user.lastActiveBranchId)) {
    selectedId = access.user.lastActiveBranchId;
  }
  selectedId ??= access.branchMemberships.find((membership) => membership.isDefaultBranch)?.branchId ?? access.branches[0]?.id ?? null;

  if (requested && requested !== ALL_BRANCHES && !allowedIds.has(requested)) {
    await auditAccess({
      userId: access.user.id,
      businessGroupId: access.group.id,
      branchId: requested,
      action: "branch_access_denied",
      metadata: { source: "signed_cookie", login: session.user.login },
    });
  }

  if (!selectedId) {
    throw new BranchAccessError("Пользователю не назначен доступ ни к одному филиалу", 403, "branch_membership_required");
  }

  const branch = access.branches.find((candidate) => candidate.id === selectedId) ?? null;
  if (!branch) throw new BranchAccessError("Филиал недоступен", 403);
  if (options.requireActive !== false && branch.status !== "active") {
    throw new BranchAccessError("Филиал работает в режиме только для чтения", 423, "branch_read_only");
  }
  const branchMembership = access.branchMemberships.find((membership) => membership.branchId === branch.id) ?? null;

  return {
    user: session.user,
    userId: access.user.id,
    businessGroupId: access.group.id,
    groupRole: access.groupRole,
    branchRole: branchMembership?.roleId ?? (access.groupRole ? "branch_owner" : null),
    isGroupOwner: access.groupRole === "group_owner",
    canManageBranches: Boolean(access.groupRole && GROUP_MANAGE_ROLES.has(access.groupRole)),
    mode: "branch",
    branchId: branch.id,
    organizationId: branch.legacyOrganizationId ?? branch.id,
    branch: branchSummary(branch),
    branches: access.branches.map(branchSummary),
  };
}

export async function requireBranchContext(options: { allowAll?: boolean; requireActive?: boolean } = {}) {
  const context = await getBranchContext(options);
  if (!context) throw new BranchAccessError("Необходима авторизация", 401, "authentication_required");
  if (!options.allowAll && context.mode === "all") {
    throw new BranchAccessError("Для операции выберите конкретный филиал", 409, "concrete_branch_required");
  }
  return context;
}

export async function selectActiveBranch(candidate: string, authUser: AuthUser) {
  const branchId = candidate.trim();
  if (!branchId) throw new BranchAccessError("Филиал не указан", 400, "branch_required");
  const access = await resolveAccess(authUser);

  if (branchId === ALL_BRANCHES) {
    if (!access.groupRole) {
      await auditAccess({
        userId: access.user.id,
        businessGroupId: access.group.id,
        action: "all_branches_access_denied",
        metadata: { login: authUser.login },
      });
      throw new BranchAccessError("Режим «Все филиалы» доступен только владельцу", 403);
    }
    return { token: branchCookieToken(ALL_BRANCHES, authUser.login), branchId: ALL_BRANCHES, branch: null };
  }

  const branch = access.branches.find((item) => item.id === branchId);
  if (!branch) {
    await auditAccess({
      userId: access.user.id,
      businessGroupId: access.group.id,
      branchId,
      action: "branch_switch_denied",
      metadata: { login: authUser.login },
    });
    throw new BranchAccessError("Филиал недоступен", 403);
  }

  await prisma.user.update({ where: { id: access.user.id }, data: { lastActiveBranchId: branch.id } });
  await auditAccess({
    userId: access.user.id,
    businessGroupId: access.group.id,
    branchId: branch.id,
    action: "branch_switched",
  });
  return { token: branchCookieToken(branch.id, authUser.login), branchId: branch.id, branch: branchSummary(branch) };
}

export function branchErrorResponse(error: unknown) {
  if (error instanceof BranchAccessError) {
    return { error: error.message, code: error.code, status: error.status };
  }
  console.error(error);
  return { error: "Не удалось определить контекст филиала", code: "branch_context_failed", status: 500 };
}
