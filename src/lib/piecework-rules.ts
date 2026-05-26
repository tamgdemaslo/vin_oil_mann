import { prisma } from "@/lib/db";

export type PieceworkRole = "master" | "admin";
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
  isDefault: boolean;
};

type DefaultTargetDefinition = {
  targetType: PieceworkTargetType;
  targetId: string;
  targetName: string;
  matchers?: string[];
  rules: Partial<
    Record<
      PieceworkRole,
      {
        mode: PieceworkMode;
        fixedCents: number | null;
        percentBasisPoints: number | null;
      }
    >
  >;
};

export function isAllowedPieceworkRule(targetType: PieceworkTargetType, role: PieceworkRole) {
  return (targetType === "service" && role === "master") || (targetType === "product_group" && role === "admin");
}

const DEFAULT_TARGETS: DefaultTargetDefinition[] = [
  {
    targetType: "service",
    targetId: "e2c897e4-b557-11ee-0a80-14f00017e2ef",
    targetName: "Замена воздушного фильтра",
    rules: {
      master: { mode: "fixed", fixedCents: 100 * 100, percentBasisPoints: null },
    },
  },
  {
    targetType: "service",
    targetId: "13d998a2-b919-11ee-0a80-174700387000",
    targetName: "Замена масла в заднем редукторе",
    rules: {
      master: { mode: "fixed", fixedCents: 300 * 100, percentBasisPoints: null },
    },
  },
  {
    targetType: "service",
    targetId: "c96965d6-b9e9-11ee-0a80-013000121bc2",
    targetName: "Замена масла в механической коробке передач",
    rules: {
      master: { mode: "fixed", fixedCents: 0, percentBasisPoints: null },
    },
  },
  {
    targetType: "service",
    targetId: "fd118c96-b918-11ee-0a80-119c0038d4a5",
    targetName: "Замена масла в переднем редукторе",
    rules: {
      master: { mode: "fixed", fixedCents: 300 * 100, percentBasisPoints: null },
    },
  },
  {
    targetType: "service",
    targetId: "7e1d8874-edb2-11ee-0a80-0e6b000d4701",
    targetName: "Замена масла в раздаточной коробке",
    rules: {
      master: { mode: "fixed", fixedCents: 300 * 100, percentBasisPoints: null },
    },
  },
  {
    targetType: "service",
    targetId: "4c073551-806f-11ee-0a80-13c60033ea8d",
    targetName: "Замена моторного масла в двигателе и масляного фильтра",
    rules: {
      master: { mode: "fixed", fixedCents: 300 * 100, percentBasisPoints: null },
    },
  },
  {
    targetType: "service",
    targetId: "9b4863b7-9512-11ee-0a80-111f002e8397",
    targetName: "Замена салонного фильтра",
    rules: {
      master: { mode: "fixed", fixedCents: 100 * 100, percentBasisPoints: null },
    },
  },
  {
    targetType: "service",
    targetId: "b939bdc7-dacd-11ee-0a80-170f0052b4dc",
    targetName: "Замена топливного фильтра",
    rules: {
      master: { mode: "fixed", fixedCents: 0, percentBasisPoints: null },
    },
  },
  {
    targetType: "service",
    targetId: "e16fccb8-29b7-11f0-0a80-189a00554631",
    targetName: "Замена тормозной жидкости, аппаратная",
    rules: {
      master: { mode: "fixed", fixedCents: 600 * 100, percentBasisPoints: null },
    },
  },
  {
    targetType: "service",
    targetId: "303f657b-5bda-11ee-0a80-08870001583c",
    targetName: "Замена трансмиссионного масла, полная/аппаратная",
    rules: {
      master: { mode: "fixed", fixedCents: 1500 * 100, percentBasisPoints: null },
    },
  },
  {
    targetType: "service",
    targetId: "3cfce8ef-4a29-11ee-0a80-09c6001ed7ad",
    targetName: "Замена трансмиссионного масла, частичная",
    rules: {
      master: { mode: "fixed", fixedCents: 900 * 100, percentBasisPoints: null },
    },
  },
  {
    targetType: "service",
    targetId: "56c63f56-315d-11ef-0a80-1414002bc041",
    targetName: "Работа по выставлению уровня масла в АКПП",
    rules: {
      master: { mode: "fixed", fixedCents: 0, percentBasisPoints: null },
    },
  },
  {
    targetType: "product_group",
    targetId: "autochemicals",
    targetName: "Автохимия",
    matchers: ["автохимия"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "antifreeze",
    targetName: "Антифриз",
    matchers: ["антифриз"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "air-filters",
    targetName: "Воздушные фильтры",
    matchers: ["воздушные фильтры"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "hydraulic-fluids",
    targetName: "Гидравлические жидкости",
    matchers: ["гидравлические жидкости"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "motor-oil-cans",
    targetName: "Масло в канистрах моторное",
    matchers: ["масло в канистрах моторное"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "transmission-oil-cans",
    targetName: "Масло в канистрах трансмиссионное",
    matchers: ["масло в канистрах трансмиссионное"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "motor-oil-barrels",
    targetName: "Масло моторное в бочках на розлив",
    matchers: ["масло моторное в бочках на розлив", "масло моторное в бочках"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "transmission-oil-barrels",
    targetName: "Масло трансмиссионное в бочках на розлив",
    matchers: ["масло трансмиссионное в бочках на розлив", "масло трансмиссионное в бочках"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "oil-filters",
    targetName: "Масляные фильтры",
    matchers: ["масляные фильтры"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "transmission-oil-filters",
    targetName: "Масляные фильтры АКПП",
    matchers: ["масляные фильтры акпп"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "cabin-filters",
    targetName: "Салонные фильтры",
    matchers: ["салонные фильтры"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "online-store-goods",
    targetName: "Товары интернет-магазинов",
    matchers: ["товары интернет-магазинов", "товары интернет магазинов"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "fuel-filters",
    targetName: "Топливные фильтры",
    matchers: ["топливные фильтры"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "brake-fluid",
    targetName: "Тормозная жидкость",
    matchers: ["тормозная жидкость"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
  {
    targetType: "product_group",
    targetId: "seals-and-gaskets",
    targetName: "Уплотнительные кольца и прокладки",
    matchers: ["уплотнительные кольца и прокладки"],
    rules: {
      admin: { mode: "percent", fixedCents: null, percentBasisPoints: 20 * 100 },
    },
  },
];

function toKey(targetType: PieceworkTargetType, targetId: string, role: PieceworkRole) {
  return `${targetType}:${targetId}:${role}`;
}

export function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function defaultRulesToList(): PieceworkRuleView[] {
  return DEFAULT_TARGETS.flatMap((target) =>
    (Object.entries(target.rules) as Array<
      [PieceworkRole, { mode: PieceworkMode; fixedCents: number | null; percentBasisPoints: number | null }]
    >).map(([role, rule]) => ({
      targetType: target.targetType,
      targetId: target.targetId,
      targetName: target.targetName,
      role,
      mode: rule.mode,
      fixedCents: rule.fixedCents,
      percentBasisPoints: rule.percentBasisPoints,
      isDefault: true,
    }))
  );
}

export function isPieceworkRole(role: string): role is PieceworkRole {
  return role === "master" || role === "admin";
}

export function extractMoyskladEntityId(href?: string): string | null {
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

export function resolveProductGroupTargetId(pathName?: string): string | null {
  if (!pathName) return null;
  const normalizedPath = normalizeText(pathName);
  for (const target of DEFAULT_TARGETS) {
    if (target.targetType !== "product_group") continue;
    if ((target.matchers ?? []).some((matcher) => normalizedPath.includes(normalizeText(matcher)))) {
      return target.targetId;
    }
  }
  return null;
}

export async function listPieceworkRules(): Promise<PieceworkRuleView[]> {
  const rows = await prisma.pieceworkRule.findMany({
    orderBy: [{ targetType: "asc" }, { targetName: "asc" }, { role: "asc" }],
  });

  const merged = new Map<string, PieceworkRuleView>();
  for (const rule of defaultRulesToList()) {
    merged.set(toKey(rule.targetType, rule.targetId, rule.role), rule);
  }

  for (const row of rows) {
    const role = row.role as PieceworkRole;
    const targetType = row.targetType as PieceworkTargetType;
    if (!isAllowedPieceworkRule(targetType, role)) continue;
    merged.set(toKey(targetType, row.targetId, role), {
      targetType,
      targetId: row.targetId,
      targetName: row.targetName,
      role,
      mode: row.mode as PieceworkMode,
      fixedCents: row.fixedCents,
      percentBasisPoints: row.percentBasisPoints,
      isDefault: false,
    });
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (a.targetType !== b.targetType) return a.targetType.localeCompare(b.targetType);
    if (a.targetName !== b.targetName) return a.targetName.localeCompare(b.targetName, "ru");
    return a.role.localeCompare(b.role, "ru");
  });
}

export async function getPieceworkRuleMap(): Promise<Map<string, PieceworkRuleView>> {
  const rules = await listPieceworkRules();
  return new Map(rules.map((rule) => [toKey(rule.targetType, rule.targetId, rule.role), rule]));
}

export function resolveServicePieceworkRule(params: {
  ruleMap: Map<string, PieceworkRuleView>;
  serviceId: string;
  serviceName: string;
  role: PieceworkRole;
}): PieceworkRuleView | undefined {
  const { ruleMap, serviceId, serviceName, role } = params;
  const exact = ruleMap.get(toKey("service", serviceId, role));
  if (exact) return exact;

  const normalizedServiceName = normalizeText(serviceName);
  for (const rule of ruleMap.values()) {
    if (rule.targetType !== "service" || rule.role !== role) continue;
    if (normalizeText(rule.targetName) === normalizedServiceName) return rule;
  }
  return undefined;
}

export function getPieceworkRuleKey(
  targetType: PieceworkTargetType,
  targetId: string,
  role: PieceworkRole
) {
  return toKey(targetType, targetId, role);
}
