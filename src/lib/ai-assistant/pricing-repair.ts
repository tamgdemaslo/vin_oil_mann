import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AIAssistantAccessError, branchAccess, runWithAIAssistantBranchContext, type AIAssistantAccess } from "./access";
import { pricingRepairPlans, selectPricingRepair, type PricingScope } from "./pricing-repair-plan";

async function scope(db: Prisma.TransactionClient, access: AIAssistantAccess): Promise<PricingScope> {
  return runWithAIAssistantBranchContext(access, async () => {
    const branch = await db.branch.findFirst({ where: { id: access.branchId, status: "active" }, select: { id: true, slug: true, legacyOrganizationId: true, businessGroupId: true } });
    if (!branch || (branch.legacyOrganizationId ?? branch.id) !== access.organizationId || branch.businessGroupId !== access.tenant.businessGroupId) {
      throw new AIAssistantAccessError("Привязка филиала изменилась. Обновите страницу.", 409);
    }
    const rules = await db.aIAssistantLaborPricingRule.findMany({
      where: { branchId: branch.id, organizationId: { in: [...new Set([access.organizationId, "default"])] } },
      orderBy: { id: "asc" },
      take: 1001,
    });
    if (rules.length > 1000) throw new AIAssistantAccessError("Для этого филиала используйте редактор тарифов.", 409);
    return { id: branch.id, name: access.branchName, slug: branch.slug, organizationId: access.organizationId, businessGroupId: branch.businessGroupId, rules };
  });
}

async function snapshot(db: Prisma.TransactionClient, access: AIAssistantAccess) {
  const target = await scope(db, access);
  const sources = await Promise.all(access.branches.filter(branch => branch.id !== target.id && branch.businessGroupId === target.businessGroupId)
    .map(branch => scope(db, branchAccess(access, branch.id))));
  return { target, plans: pricingRepairPlans(target, sources) };
}

export async function pricingRepairPreview(access: AIAssistantAccess) {
  const { target, plans } = await snapshot(prisma, access);
  return {
    branch: { id: target.id, name: target.name },
    visibleCount: target.rules.filter(rule => rule.organizationId === target.organizationId && rule.active && rule.effectiveFrom <= new Date() && (!rule.effectiveTo || rule.effectiveTo >= new Date())).length,
    legacyCount: target.rules.filter(rule => rule.organizationId === "default" && target.organizationId !== "default" && rule.active).length,
    plans: plans.map(plan => ({ ...plan, rules: plan.rules.map(rule => ({
      id: rule.id, name: rule.name, laborPriceCents: rule.laborPriceCents,
      priceFromCents: rule.priceFromCents, priceToCents: rule.priceToCents,
      requiresHumanConfirmation: rule.requiresHumanConfirmation,
      effectiveTo: rule.effectiveTo?.toISOString() ?? null,
    })) })),
  };
}

export async function applyPricingRepair(access: AIAssistantAccess, input: { planId: string; token: string; ruleIds: string[] }) {
  try {
    return await runWithAIAssistantBranchContext(access, () => prisma.$transaction(async tx => {
      const { target, plans } = await snapshot(tx, access);
      const plan = selectPricingRepair(plans, input);
      const changes: { id: string; sourceId: string; laborPriceCents: number }[] = [];
      for (const source of plan.rules) {
        if (plan.kind === "restore") {
          const result = await tx.aIAssistantLaborPricingRule.updateMany({
            where: { id: source.id, branchId: target.id, organizationId: "default", updatedAt: source.updatedAt },
            data: { organizationId: target.organizationId, updatedById: access.actorId },
          });
          if (result.count !== 1) throw new Error("PRICING_PREVIEW_CHANGED");
          changes.push({ id: source.id, sourceId: source.id, laborPriceCents: source.laborPriceCents });
        } else {
          const added = await tx.aIAssistantLaborPricingRule.create({ data: {
            branchId: target.id, organizationId: target.organizationId, locationId: plan.locationId,
            serviceFamily: source.serviceFamily, procedureType: source.procedureType,
            transmissionConfiguration: source.transmissionConfiguration, materialsOwner: source.materialsOwner,
            vehicleId: null, aggregateCode: null, name: source.name, laborPriceCents: source.laborPriceCents,
            priceFromCents: source.priceFromCents, priceToCents: source.priceToCents,
            requiresHumanConfirmation: source.requiresHumanConfirmation, active: true,
            effectiveFrom: source.effectiveFrom, effectiveTo: source.effectiveTo, comment: source.comment,
            createdById: access.actorId, updatedById: access.actorId,
          }, select: { id: true } });
          changes.push({ id: added.id, sourceId: source.id, laborPriceCents: source.laborPriceCents });
        }
      }
      await tx.branchAuditLog.create({ data: {
        branchId: target.id, businessGroupId: target.businessGroupId, userId: access.context.userId,
        action: `ai_assistant.pricing.${plan.kind}`, entityType: "ai_assistant_labor_pricing_rule", entityId: target.id,
        metadata: { sourceBranchId: plan.sourceBranchId, previewToken: plan.token, changes },
      } });
      return { applied: changes.length, branch: { id: target.id, name: target.name } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 }));
  } catch (error) {
    if (error instanceof AIAssistantAccessError) throw error;
    if (error instanceof Error && ["PRICING_PREVIEW_CHANGED", "PRICING_SELECTION_INVALID"].includes(error.message)
      || error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new AIAssistantAccessError("Тарифы изменились. Обновите предложение и проверьте суммы ещё раз.", 409, "pricing_preview_changed");
    }
    throw new AIAssistantAccessError("Не удалось сохранить тарифы. Изменения не применены.", 500, "pricing_repair_failed");
  }
}
