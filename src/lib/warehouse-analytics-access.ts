import { Prisma } from "@prisma/client";
import type { User } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type WarehouseAnalyticsPermission =
  | "warehouse.analytics.view"
  | "warehouse.analytics.export"
  | "warehouse.analytics.apply_recommendations"
  | "warehouse.products.edit_from_analytics"
  | "warehouse.procurement.create_from_analytics"
  | "warehouse.products.archive_from_analytics";

const OWNER_PERMISSIONS: WarehouseAnalyticsPermission[] = [
  "warehouse.analytics.view",
  "warehouse.analytics.export",
  "warehouse.analytics.apply_recommendations",
  "warehouse.products.edit_from_analytics",
  "warehouse.procurement.create_from_analytics",
  "warehouse.products.archive_from_analytics",
];

function normalizeLogin(value: string) {
  return value.trim().toLowerCase();
}

function envList(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((item) => normalizeLogin(item))
    .filter(Boolean);
}

function permissionsFromJson(value: Prisma.JsonValue | null | undefined): Set<string> {
  if (!value) return new Set();
  if (Array.isArray(value)) return new Set(value.map(String));
  if (typeof value === "object") {
    return new Set(
      Object.entries(value)
        .filter(([, enabled]) => Boolean(enabled))
        .map(([permission]) => permission)
    );
  }
  return new Set();
}

export async function getWarehouseAnalyticsPermissionSet(user: User): Promise<Set<string>> {
  if (user.role === "owner") return new Set(OWNER_PERMISSIONS);

  const envViewers = envList("WAREHOUSE_ANALYTICS_VIEWERS");
  const login = normalizeLogin(user.login);
  const permissions = new Set<string>();
  if (envViewers.includes("*") || envViewers.includes(login)) {
    permissions.add("warehouse.analytics.view");
  }

  const rows = await prisma.organizationMember.findMany({
    where: { userId: user.login },
    select: { permissionsJson: true },
  });
  for (const row of rows) {
    for (const permission of permissionsFromJson(row.permissionsJson)) permissions.add(permission);
  }
  return permissions;
}

export async function canViewWarehouseAnalytics(user: User): Promise<boolean> {
  const permissions = await getWarehouseAnalyticsPermissionSet(user);
  return permissions.has("warehouse.analytics.view");
}

export async function canExportWarehouseAnalytics(user: User): Promise<boolean> {
  const permissions = await getWarehouseAnalyticsPermissionSet(user);
  return permissions.has("warehouse.analytics.export") || permissions.has("warehouse.analytics.view");
}
