import { prisma } from "@/lib/db";
import { getBranchContext } from "@/lib/branch-context";

export type PieceworkRole = "master" | "admin";
/**
 * A master is paid for an exact service card; an administrator is paid for an
 * exact product group. Both identifiers are stable catalog IDs, never names.
 */
export type PieceworkTargetType = "service" | "product_group";
export type PieceworkMode = "fixed" | "percent";

export type PieceworkRuleView = {
  targetType: PieceworkTargetType;
  targetId: string;
  targetName: string;
  role: PieceworkRole;
  mode: PieceworkMode;
  fixedCents: number | null;
  percentBasisPoints: number | null;
  isConfigured: boolean;
  isDefault: false;
};

export type PieceworkTargetOption = {
  id: string;
  name: string;
  targetType: PieceworkTargetType;
  role: PieceworkRole;
};

export type PieceworkTargets = {
  services: PieceworkTargetOption[];
  productGroups: PieceworkTargetOption[];
};

function toKey(targetType: PieceworkTargetType, targetId: string, role: PieceworkRole) {
  return `${targetType}:${targetId}:${role}`;
}

export function isAllowedPieceworkRule(targetType: PieceworkTargetType, role: PieceworkRole) {
  return (targetType === "service" && role === "master") || (targetType === "product_group" && role === "admin");
}

export function isPieceworkRole(role: string): role is PieceworkRole {
  return role === "master" || role === "admin";
}

export function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ");
}

export function extractLocalEntityId(href?: string): string | null {
  if (!href) return null;
  const cleanHref = href.split(/[?#]/)[0] ?? href;
  const parts = cleanHref.split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

export function calculatePieceworkAmountCents(
  rule: Pick<PieceworkRuleView, "mode" | "fixedCents" | "percentBasisPoints">,
  percentBaseCents: number,
  quantity: number
): number {
  if (rule.mode === "percent") {
    return Math.round((percentBaseCents * (rule.percentBasisPoints ?? 0)) / 10_000);
  }
  return (rule.fixedCents ?? 0) * quantity;
}

async function resolveBranchId(branchId?: string) {
  const scopedBranchId = branchId ?? (await getBranchContext({ requireActive: true }))?.branchId;
  if (!scopedBranchId) throw new Error("Для сдельных правил нужен активный филиал");
  return scopedBranchId;
}

/**
 * Lists only rules that the owner explicitly added. We deliberately do not
 * create rows from all services or all groups: an untouched catalog must not
 * look like a payroll configuration.
 */
export async function listPieceworkRules(branchId?: string): Promise<PieceworkRuleView[]> {
  const scopedBranchId = await resolveBranchId(branchId);
  const savedRules = await prisma.pieceworkRule.findMany({
    where: {
      branchId: scopedBranchId,
      OR: [
        { targetType: "service", role: "master" },
        { targetType: "product_group", role: "admin" },
      ],
    },
    orderBy: [{ targetType: "asc" }, { targetName: "asc" }],
  });

  const [services, productGroups] = await Promise.all([
    prisma.localProduct.findMany({
      where: {
        branchId: scopedBranchId,
        archived: false,
        entityType: "service",
        id: { in: savedRules.filter((rule) => rule.targetType === "service").map((rule) => rule.targetId) },
      },
      select: { id: true, name: true },
    }),
    prisma.localCatalogGroup.findMany({
      where: {
        branchId: scopedBranchId,
        archived: false,
        kind: "product",
        id: { in: savedRules.filter((rule) => rule.targetType === "product_group").map((rule) => rule.targetId) },
      },
      select: { id: true, name: true },
    }),
  ]);
  const serviceNames = new Map(services.map((service) => [service.id, service.name]));
  const productGroupNames = new Map(productGroups.map((group) => [group.id, group.name]));

  return savedRules.flatMap((rule) => {
    const targetType = rule.targetType as PieceworkTargetType;
    const role = rule.role as PieceworkRole;
    if (!isAllowedPieceworkRule(targetType, role)) return [];
    const targetName = targetType === "service"
      ? serviceNames.get(rule.targetId)
      : productGroupNames.get(rule.targetId);
    if (!targetName) return [];
    return [{
      targetType,
      targetId: rule.targetId,
      targetName,
      role,
      mode: rule.mode === "fixed" ? "fixed" : "percent",
      fixedCents: rule.fixedCents,
      percentBasisPoints: rule.percentBasisPoints,
      isConfigured: true,
      isDefault: false,
    }];
  });
}

/** Sources for the explicit "Add" control in the payroll screen. */
export async function listPieceworkTargets(branchId?: string): Promise<PieceworkTargets> {
  const scopedBranchId = await resolveBranchId(branchId);
  const [services, productGroups] = await Promise.all([
    prisma.localProduct.findMany({
      where: { branchId: scopedBranchId, archived: false, entityType: "service" },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.localCatalogGroup.findMany({
      where: { branchId: scopedBranchId, archived: false, kind: "product" },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  ]);

  return {
    services: services.map((service) => ({ ...service, targetType: "service" as const, role: "master" as const })),
    productGroups: productGroups.map((group) => ({ ...group, targetType: "product_group" as const, role: "admin" as const })),
  };
}

/** Only configured ID-bound rules can take part in a payroll calculation. */
export async function getPieceworkRuleMap(branchId?: string): Promise<Map<string, PieceworkRuleView>> {
  const rules = await listPieceworkRules(branchId);
  return new Map(rules.map((rule) => [toKey(rule.targetType, rule.targetId, rule.role), rule]));
}

export function resolvePieceworkRule(params: {
  ruleMap: Map<string, PieceworkRuleView>;
  targetId?: string | null;
  targetType: PieceworkTargetType;
  role: PieceworkRole;
}): PieceworkRuleView | undefined {
  const { ruleMap, targetId, targetType, role } = params;
  if (!targetId || !isAllowedPieceworkRule(targetType, role)) return undefined;
  return ruleMap.get(toKey(targetType, targetId, role));
}

export function getPieceworkRuleKey(
  targetType: PieceworkTargetType,
  targetId: string,
  role: PieceworkRole
) {
  return toKey(targetType, targetId, role);
}
