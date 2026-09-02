import { prisma } from "@/lib/db";
import { getBranchContext } from "@/lib/branch-context";

export type PieceworkRole = "master" | "admin";
export type PieceworkTargetType = "service_group" | "product_group";
export type PieceworkMode = "fixed" | "percent";

export type PieceworkRuleView = {
  targetType: PieceworkTargetType;
  /** Stable LocalCatalogGroup.id. Never a display name or a legacy slug. */
  targetId: string;
  /** Canonical current name, shown only to the operator. */
  targetName: string;
  role: PieceworkRole;
  mode: PieceworkMode;
  fixedCents: number | null;
  percentBasisPoints: number | null;
  isConfigured: boolean;
  isDefault: false;
};

function toKey(targetType: PieceworkTargetType, targetId: string, role: PieceworkRole) {
  return `${targetType}:${targetId}:${role}`;
}

export function isAllowedPieceworkRule(targetType: PieceworkTargetType, role: PieceworkRole) {
  return (targetType === "service_group" && role === "master") || (targetType === "product_group" && role === "admin");
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

/**
 * Lists actual catalog groups in the active branch. Missing entries are
 * intentionally returned to the UI so a new group cannot silently receive a
 * guessed rate.
 */
export async function listPieceworkRules(branchId?: string): Promise<PieceworkRuleView[]> {
  const scopedBranchId = branchId ?? (await getBranchContext({ requireActive: true }))?.branchId;
  if (!scopedBranchId) throw new Error("Для сдельных правил нужен активный филиал");

  const [groups, savedRules] = await Promise.all([
    prisma.localCatalogGroup.findMany({
      where: { branchId: scopedBranchId, archived: false, kind: { in: ["product", "service"] } },
      select: { id: true, kind: true, name: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
    prisma.pieceworkRule.findMany({
      where: { branchId: scopedBranchId },
      orderBy: [{ targetType: "asc" }, { targetName: "asc" }, { role: "asc" }],
    }),
  ]);

  const savedByKey = new Map(
    savedRules
      .filter((rule) => {
        const targetType = rule.targetType as PieceworkTargetType;
        const role = rule.role as PieceworkRole;
        return isAllowedPieceworkRule(targetType, role);
      })
      .map((rule) => [toKey(rule.targetType as PieceworkTargetType, rule.targetId, rule.role as PieceworkRole), rule])
  );

  return groups.map((group) => {
    const targetType: PieceworkTargetType = group.kind === "service" ? "service_group" : "product_group";
    const role: PieceworkRole = group.kind === "service" ? "master" : "admin";
    const saved = savedByKey.get(toKey(targetType, group.id, role));
    return {
      targetType,
      targetId: group.id,
      targetName: group.name,
      role,
      mode: saved ? (saved.mode === "fixed" ? "fixed" : "percent") : group.kind === "service" ? "fixed" : "percent",
      fixedCents: saved?.fixedCents ?? null,
      percentBasisPoints: saved?.percentBasisPoints ?? null,
      isConfigured: Boolean(saved),
      isDefault: false,
    };
  });
}

/** Only configured ID-bound rules can take part in a payroll calculation. */
export async function getPieceworkRuleMap(branchId?: string): Promise<Map<string, PieceworkRuleView>> {
  const rules = await listPieceworkRules(branchId);
  return new Map(
    rules
      .filter((rule) => rule.isConfigured)
      .map((rule) => [toKey(rule.targetType, rule.targetId, rule.role), rule])
  );
}

export function resolveGroupPieceworkRule(params: {
  ruleMap: Map<string, PieceworkRuleView>;
  groupId?: string | null;
  targetType: PieceworkTargetType;
  role: PieceworkRole;
}): PieceworkRuleView | undefined {
  const { ruleMap, groupId, targetType, role } = params;
  if (!groupId || !isAllowedPieceworkRule(targetType, role)) return undefined;
  return ruleMap.get(toKey(targetType, groupId, role));
}

export function getPieceworkRuleKey(
  targetType: PieceworkTargetType,
  targetId: string,
  role: PieceworkRole
) {
  return toKey(targetType, targetId, role);
}
