import { createHash } from "node:crypto";
import type { AIAssistantLaborPricingRule } from "@prisma/client";

export type PricingScope = {
  id: string; name: string; organizationId: string; businessGroupId: string; slug: string;
  rules: AIAssistantLaborPricingRule[];
};
export type PricingRepairPlan = {
  id: string; kind: "restore" | "copy"; sourceBranchId: string; sourceBranchName: string;
  targetBranchName: string; sourceNeedsRepair: boolean; initialSettings: boolean;
  token: string; locationId: string; rules: AIAssistantLaborPricingRule[];
};

const current = (rule: AIAssistantLaborPricingRule, now: Date) => rule.active && rule.effectiveFrom <= now && (!rule.effectiveTo || rule.effectiveTo >= now);
const overlaps = (left: AIAssistantLaborPricingRule, right: AIAssistantLaborPricingRule) =>
  left.serviceFamily === right.serviceFamily && left.procedureType === right.procedureType
  && (!left.transmissionConfiguration || !right.transmissionConfiguration || left.transmissionConfiguration === right.transmissionConfiguration)
  && (!left.materialsOwner || !right.materialsOwner || left.materialsOwner === right.materialsOwner)
  && (!left.vehicleId || !right.vehicleId || left.vehicleId === right.vehicleId)
  && (!left.aggregateCode || !right.aggregateCode || left.aggregateCode === right.aggregateCode);

/** Legacy rows are diagnostic candidates only. The calculator still requires exact organization scope. */
export function pricingRepairPlans(target: PricingScope, sources: PricingScope[], now = new Date()): PricingRepairPlan[] {
  const scoped = (scope: PricingScope) => scope.rules.filter(rule => rule.branchId === scope.id && [scope.organizationId, "default"].includes(rule.organizationId) && current(rule, now));
  const targetRows = scoped(target);
  const protectedRows = target.rules.filter(rule => rule.branchId === target.id && [target.organizationId, "default"].includes(rule.organizationId) && rule.active && (!rule.effectiveTo || rule.effectiveTo >= now));
  const visible = targetRows.filter(rule => rule.organizationId === target.organizationId);
  const legacy = targetRows.filter(rule => rule.organizationId === "default" && target.organizationId !== "default");
  const locations = [...new Set(visible.map(rule => rule.locationId))];
  const targetLocation = locations.includes(target.slug) || !locations.length ? target.slug : locations.length === 1 ? locations[0] : null;
  const plans: PricingRepairPlan[] = [];
  function add(kind: "restore" | "copy", source: PricingScope, candidates: AIAssistantLaborPricingRule[], locationId: string, sourceNeedsRepair: boolean) {
    // Conflicts need an explicit editor decision, never first-row-wins or an overwrite.
    const rules = candidates.filter(rule => !candidates.some(other => other.id !== rule.id && overlaps(rule, other)))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!rules.length) return;
    const id = `${kind}:${source.id}`;
    const snapshot = [id, target.id, target.organizationId, target.slug, source.organizationId, source.businessGroupId, locationId,
      protectedRows.sort((a, b) => a.id.localeCompare(b.id)), rules];
    plans.push({ id, kind, sourceBranchId: source.id, sourceBranchName: source.name, targetBranchName: target.name,
      sourceNeedsRepair, initialSettings: rules.some(rule => rule.createdById === "system"), locationId, rules,
      token: createHash("sha256").update(JSON.stringify(snapshot)).digest("hex") });
  }
  add("restore", target, legacy.filter(rule => !visible.some(existing => overlaps(rule, existing))), "", true);
  if (!targetLocation) return plans;
  for (const source of sources) {
    if (source.id === target.id || !target.businessGroupId || source.businessGroupId !== target.businessGroupId) continue;
    const sourceRows = scoped(source);
    const valid = sourceRows.filter(rule => rule.organizationId === source.organizationId);
    const orphaned = sourceRows.filter(rule => rule.organizationId === "default" && source.organizationId !== "default"
      && !valid.some(existing => overlaps(rule, existing)));
    const candidates = [...valid, ...orphaned].filter(rule => rule.serviceFamily === "transmission_fluid"
      && !rule.vehicleId && !rule.aggregateCode && ["partial", "machine"].includes(rule.procedureType)
      && ["service", "customer"].includes(rule.materialsOwner ?? "")
      && ["no_pan", "pan_and_filter", "two_coarse_filters"].includes(rule.transmissionConfiguration ?? "")
      && !protectedRows.some(existing => overlaps(rule, existing)));
    add("copy", source, candidates, targetLocation, candidates.some(rule => rule.organizationId !== source.organizationId));
  }
  return plans;
}

export function selectPricingRepair(plans: PricingRepairPlan[], input: { planId: string; token: string; ruleIds: string[] }) {
  const plan = plans.find(candidate => candidate.id === input.planId && candidate.token === input.token);
  if (!plan) throw new Error("PRICING_PREVIEW_CHANGED");
  const ids = [...new Set(input.ruleIds)];
  if (!ids.length || ids.some(id => !plan.rules.some(rule => rule.id === id))) throw new Error("PRICING_SELECTION_INVALID");
  return { ...plan, rules: plan.rules.filter(rule => ids.includes(rule.id)) };
}
