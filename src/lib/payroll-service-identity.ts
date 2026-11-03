import { prisma } from "@/lib/db";
import type { EmployeePaySettings } from "@/lib/employee-pay-settings";

type ServiceIdentity = { id: string; name: string; archived: boolean; raw?: unknown };
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Saved import identifiers only. Display names never establish identity. */
export function serviceIdentityIds(service: ServiceIdentity): string[] {
  const raw = record(service.raw);
  const meta = record(raw.meta);
  const ids = new Set([service.id]);
  for (const value of [raw.id, raw.sourceProductId]) {
    if (typeof value === "string" && value.trim()) ids.add(value.trim());
  }
  for (const value of [meta.href, meta.uuidHref]) {
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value);
      const id = url.searchParams.get("id") ?? (url.hash.includes("?") ? new URLSearchParams(url.hash.split("?")[1]).get("id") : null);
      if (id) ids.add(id);
      else if (url.pathname.includes("/entity/service/")) ids.add(url.pathname.split("/").filter(Boolean).at(-1)!);
    } catch { /* Invalid imported metadata cannot identify a service. */ }
  }
  return [...ids];
}

export function findServiceIdentity(services: ServiceIdentity[], id: string) {
  const direct = services.find(service => service.id === id);
  if (direct) return direct;
  const matches = services.filter(service => serviceIdentityIds(service).includes(id));
  return matches.length === 1 ? matches[0] : undefined;
}

export async function loadPayrollServiceIdentities(branchId: string) {
  return prisma.localProduct.findMany({ where: { branchId, entityType: "service" }, select: { id: true, name: true, archived: true, raw: true } });
}

export function normalizeEmployeeServiceRules(settings: EmployeePaySettings, services: ServiceIdentity[]): EmployeePaySettings {
  if (!settings.pieceworkRules?.length) return settings;
  const explicit = new Set(settings.pieceworkRules.filter(rule => rule.targetType === "service").map(rule => rule.targetId));
  return { ...settings, pieceworkRules: settings.pieceworkRules.flatMap(rule => {
    if (rule.targetType !== "service") return [rule];
    const service = findServiceIdentity(services, rule.targetId);
    if (service && service.id !== rule.targetId && explicit.has(service.id)) return [];
    return [service ? { ...rule, targetId: service.id, targetName: service.name } : rule];
  }) };
}
