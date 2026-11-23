import { z } from "zod";
import { runWithBranchApiTargetContext } from "@/lib/branch-api";
import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import { loyaltyProgram, LoyaltyError } from "@/lib/loyalty/accounts";
import { loyaltyApi, loyaltyBody } from "@/lib/loyalty/http";

const rate = z.number().int().min(0).max(10_000);
const rulesSchema = z.object({
  enabled: z.boolean(),
  centsPerPoint: z.number().int().min(1).max(100_000),
  productRate: rate,
  serviceRate: rate,
  spendRate: rate,
  compensationLimit: z.number().int().min(0).max(1_000_000),
  groupRates: z.record(z.string(), rate),
}).strict();

async function catalog(context: BranchContext) {
  const branchIds = context.branches.filter((branch) => branch.status === "active").map((branch) => branch.id);
  return Promise.all(branchIds.map((branchId) => runWithBranchApiTargetContext(context, branchId, async () => {
    const groups = await prisma.localCatalogGroup.findMany({
      where: { branchId, kind: "product", archived: false },
      select: { id: true, name: true }, orderBy: { name: "asc" },
    });
    return { branchId, name: context.branches.find((branch) => branch.id === branchId)?.displayName, groups };
  })));
}

export function GET() {
  return loyaltyApi("owner", async (context) => {
    const [rules, groups] = await Promise.all([loyaltyProgram(prisma, context.businessGroupId), catalog(context)]);
    return { rules: rulesSchema.strip().parse(rules), groups };
  }, { allowAll: true, requireActive: false });
}

export function PUT(request: Request) {
  return loyaltyApi("owner", async (context) => {
    const rules = await loyaltyBody(request, rulesSchema);
    const valid = new Set((await catalog(context)).flatMap((branch) => branch.groups.map((group) => group.id)));
    if (Object.keys(rules.groupRates).some((group) => !valid.has(group))) throw new LoyaltyError("Одна из групп больше недоступна. Обновите настройки");
    await prisma.loyaltyProgram.upsert({
      where: { businessGroupId: context.businessGroupId },
      update: rules,
      create: { businessGroupId: context.businessGroupId, ...rules },
    });
    return { ok: true };
  }, { allowAll: true, requireActive: false });
}
