import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";

export type CustomerAnalyticsResolvedSettings = {
  inactiveDaysThreshold: number;
  regularVisitThreshold: number;
  vipThresholdCents: number | null;
  vipMetric: "revenue" | "profit";
  vipWindow: "all" | "selected_period";
};

function parseIntEnv(name: string, fallback: number): number {
  const v = process.env[name]?.trim();
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseOptionalCents(name: string): number | null {
  const v = process.env[name]?.trim();
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function getCustomerAnalyticsSettings(): Promise<CustomerAnalyticsResolvedSettings> {
  const branchId = getScopedBranchId();
  const envDefaults: CustomerAnalyticsResolvedSettings = {
    inactiveDaysThreshold: parseIntEnv("CUSTOMER_ANALYTICS_INACTIVE_DAYS", 90),
    regularVisitThreshold: parseIntEnv("CUSTOMER_ANALYTICS_REGULAR_VISITS", 3),
    vipThresholdCents: parseOptionalCents("CUSTOMER_ANALYTICS_VIP_THRESHOLD_CENTS"),
    vipMetric: process.env.CUSTOMER_ANALYTICS_VIP_METRIC === "profit" ? "profit" : "revenue",
    vipWindow: process.env.CUSTOMER_ANALYTICS_VIP_WINDOW === "selected_period" ? "selected_period" : "all",
  };

  try {
    await prisma.customerAnalyticsSettings.upsert({
      where: { branchId_id: { branchId, id: "default" } },
      create: {
        branchId,
        id: "default",
        inactiveDaysThreshold: envDefaults.inactiveDaysThreshold,
        regularVisitThreshold: envDefaults.regularVisitThreshold,
        vipThresholdCents: envDefaults.vipThresholdCents,
        vipMetric: envDefaults.vipMetric,
        vipWindow: envDefaults.vipWindow,
      },
      update: {},
    });
    const row = await prisma.customerAnalyticsSettings.findUnique({ where: { branchId_id: { branchId, id: "default" } } });
    if (!row) return envDefaults;
    return {
      inactiveDaysThreshold: row.inactiveDaysThreshold,
      regularVisitThreshold: row.regularVisitThreshold,
      vipThresholdCents: row.vipThresholdCents,
      vipMetric: row.vipMetric === "profit" ? "profit" : "revenue",
      vipWindow: row.vipWindow === "selected_period" ? "selected_period" : "all",
    };
  } catch {
    return envDefaults;
  }
}
