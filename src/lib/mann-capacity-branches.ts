import { parseConditionalFluidCapacities, type ConditionalFluidCapacity } from "./fluid-capacity-conditions";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export type MannCapacityBranch = ConditionalFluidCapacity & { applicabilityJson: unknown };

// Reparse the preserved source. Stored numeric values must never override it.
export function readMannCapacityBranches(technical: unknown, applicability: unknown, systemCode: string): MannCapacityBranch[] | null {
  const data = record(technical), scope = record(applicability);
  if (typeof data.fillVolumeText !== "string" || !Array.isArray(data.capacityBranches) || !data.capacityBranches.length) return null;
  const engineCodes = Array.isArray(scope.engineCodes) ? scope.engineCodes.filter((v): v is string => typeof v === "string") : [];
  const parsed = parseConditionalFluidCapacities(data.fillVolumeText, systemCode, engineCodes);
  if (parsed.status !== "structured") return null;
  const seen = new Set<string>(), branches: MannCapacityBranch[] = [];
  for (const raw of data.capacityBranches) {
    const stored = record(raw), condition = record(stored.condition), validation = record(stored.validation);
    const branch = parsed.branches.find(b => b.condition.kind === condition.kind && b.condition.value === condition.value && b.sourceSegment === stored.sourceSegment);
    const branchScope = record(stored.applicabilityJson);
    if (!branch || seen.has(`${condition.kind}:${condition.value}`)
      || !("window" in branchScope) || !("matchedEngineScope" in branchScope)
      || validation.independentlyValidated !== true
      || !Array.isArray(validation.hardConflicts) || validation.hardConflicts.length
      || !Array.isArray(validation.reviewBlockers) || validation.reviewBlockers.length) return null;
    seen.add(`${condition.kind}:${condition.value}`);
    branches.push({ ...branch, applicabilityJson: stored.applicabilityJson });
  }
  return branches;
}
