import { Prisma, type BranchSalesPlan } from "@prisma/client";
import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import { runWithBranchApiContext, runWithBranchApiTargetContext } from "@/lib/branch-api";
import {
  SALES_ANALYTICS_METRICS,
  type SalesAnalyticsMetricType,
  type ServiceAggregateType,
  type ServiceConfiguration,
  type ServiceProcedure,
} from "@/lib/sales-analytics-taxonomy";
import { invalidateSalesPerformanceAnalytics } from "@/lib/sales-performance-analytics";

const AGGREGATES = new Set(["AUTOMATIC", "CVT", "DCT_DSG", "MANUAL", "UNKNOWN"]);
const PROCEDURES = new Set(["PARTIAL", "MACHINE", "STANDARD", "UNKNOWN"]);
const CONFIGURATIONS = new Set(["NO_PAN", "PAN_AND_FILTER", "TWO_FILTERS", "OTHER", "UNKNOWN"]);

export type SalesPlanWriteInput = {
  rowKey: string;
  targetCount: number;
  targetRevenueCents?: number | null;
  targetGrossProfitCents?: number | null;
  targetAttachRateBasisPoints?: number | null;
  expectedRevenuePerUnitCents?: number | null;
  expectedGrossProfitPerUnitCents?: number | null;
  note?: string | null;
};

export type SalesPlanDto = ReturnType<typeof serializeSalesPlan>;

export function normalizeSalesPlanMonth(value: unknown): string {
  const month = String(value ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Месяц плана должен быть в формате ГГГГ-ММ");
  return month;
}

function enumValue<T extends string>(value: string, allowed: Set<string>, label: string): T | null {
  if (!value || value === "-") return null;
  if (!allowed.has(value)) throw new Error(`Некорректное значение «${label}» в ключе плана`);
  return value as T;
}

export function parseSalesPlanRowKey(rowKeyValue: unknown): {
  rowKey: string;
  metricCode: string;
  metricType: SalesAnalyticsMetricType;
  aggregateType: ServiceAggregateType | null;
  procedure: ServiceProcedure | null;
  configuration: ServiceConfiguration | null;
} {
  const rowKey = String(rowKeyValue ?? "").trim();
  const parts = rowKey.split(":");
  if (parts[0] === "product" && parts.length === 2) {
    const metric = SALES_ANALYTICS_METRICS.find((item) => item.code === parts[1] && item.type === "PRODUCT_CATEGORY");
    if (!metric) throw new Error("Товарная категория плана не найдена");
    return {
      rowKey,
      metricCode: metric.code,
      metricType: "PRODUCT_CATEGORY",
      aggregateType: null,
      procedure: null,
      configuration: null,
    };
  }
  if (parts[0] === "service" && parts.length === 5) {
    const metric = SALES_ANALYTICS_METRICS.find((item) => item.code === parts[1] && item.type === "SERVICE_OPERATION");
    if (!metric) throw new Error("Сервисная операция плана не найдена");
    return {
      rowKey,
      metricCode: metric.code,
      metricType: "SERVICE_OPERATION",
      aggregateType: enumValue<ServiceAggregateType>(parts[2], AGGREGATES, "агрегат"),
      procedure: enumValue<ServiceProcedure>(parts[3], PROCEDURES, "процедура"),
      configuration: enumValue<ServiceConfiguration>(parts[4], CONFIGURATIONS, "конфигурация"),
    };
  }
  throw new Error("Некорректный ключ строки плана");
}

function nonNegativeNumber(value: unknown, label: string, required = false): number | null {
  if (value == null || value === "") {
    if (required) throw new Error(`Поле «${label}» обязательно`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Поле «${label}» должно быть неотрицательным числом`);
  return parsed;
}

function optionalCents(value: unknown, label: string): number | null {
  const parsed = nonNegativeNumber(value, label);
  if (parsed == null) return null;
  if (!Number.isInteger(parsed) || parsed > 2_147_483_647) throw new Error(`Поле «${label}» выходит за допустимый диапазон`);
  return parsed;
}

function normalizePlanInput(input: SalesPlanWriteInput) {
  const parsedKey = parseSalesPlanRowKey(input.rowKey);
  const targetCount = nonNegativeNumber(input.targetCount, "План по количеству", true) as number;
  if (targetCount > 99_999_999_999) throw new Error("План по количеству слишком велик");
  const targetAttachRateBasisPoints = optionalCents(input.targetAttachRateBasisPoints, "План прикрепляемости");
  if (targetAttachRateBasisPoints != null && targetAttachRateBasisPoints > 10_000) {
    throw new Error("План прикрепляемости не может превышать 100%");
  }
  const note = input.note == null ? null : String(input.note).trim().slice(0, 2_000) || null;
  return {
    ...parsedKey,
    targetCount,
    targetRevenueCents: optionalCents(input.targetRevenueCents, "План выручки"),
    targetGrossProfitCents: optionalCents(input.targetGrossProfitCents, "План валовой прибыли"),
    targetAttachRateBasisPoints,
    expectedRevenuePerUnitCents: optionalCents(input.expectedRevenuePerUnitCents, "Ожидаемая выручка на единицу"),
    expectedGrossProfitPerUnitCents: optionalCents(input.expectedGrossProfitPerUnitCents, "Ожидаемая прибыль на единицу"),
    note,
  };
}

function serializeSalesPlan(plan: BranchSalesPlan) {
  return {
    id: plan.id,
    businessGroupId: plan.businessGroupId,
    branchId: plan.branchId,
    month: plan.month,
    rowKey: plan.rowKey,
    metricCode: plan.metricCode,
    aggregateType: plan.aggregateType,
    procedure: plan.procedure,
    configuration: plan.configuration,
    targetCount: Number(plan.targetCount),
    targetRevenueCents: plan.targetRevenueCents,
    targetGrossProfitCents: plan.targetGrossProfitCents,
    targetAttachRateBasisPoints: plan.targetAttachRateBasisPoints,
    expectedRevenuePerUnitCents: plan.expectedRevenuePerUnitCents,
    expectedGrossProfitPerUnitCents: plan.expectedGrossProfitPerUnitCents,
    note: plan.note,
    version: plan.version,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}

export function canManageSalesPlans(context: BranchContext) {
  return context.canManageBranches || context.user.role === "owner";
}

export async function listSalesPlans(context: BranchContext, branchIds: string[], monthValue: unknown) {
  const month = normalizeSalesPlanMonth(monthValue);
  if (!branchIds.length) return [];
  const plans = await runWithBranchApiContext(context, () => prisma.branchSalesPlan.findMany({
    where: { businessGroupId: context.businessGroupId, branchId: { in: branchIds }, month },
    orderBy: [{ branchId: "asc" }, { metricCode: "asc" }, { rowKey: "asc" }],
  }));
  return plans.map(serializeSalesPlan);
}

export async function saveSalesPlans(
  context: BranchContext,
  branchId: string,
  monthValue: unknown,
  inputs: SalesPlanWriteInput[],
) {
  if (!canManageSalesPlans(context)) throw new Error("Изменять планы может владелец или управляющий бизнес-группы");
  const month = normalizeSalesPlanMonth(monthValue);
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100) throw new Error("Передайте от 1 до 100 строк плана");
  const rows = inputs.map(normalizePlanInput);
  if (new Set(rows.map((row) => row.rowKey)).size !== rows.length) throw new Error("Строки плана не должны повторяться");

  const result = await runWithBranchApiTargetContext(context, branchId, async () => prisma.$transaction(async (tx) => {
    const metricRows = await tx.salesAnalyticsMetric.findMany({
      where: { code: { in: [...new Set(rows.map((row) => row.metricCode))] }, active: true },
      select: { code: true, type: true },
    });
    const metricTypes = new Map(metricRows.map((metric) => [metric.code, metric.type]));
    const saved: BranchSalesPlan[] = [];
    for (const row of rows) {
      if (metricTypes.get(row.metricCode) !== row.metricType) throw new Error(`Метрика ${row.metricCode} недоступна`);
      const existing = await tx.branchSalesPlan.findUnique({
        where: { branchId_month_rowKey: { branchId, month, rowKey: row.rowKey } },
      });
      const version = (existing?.version ?? 0) + 1;
      const plan = await tx.branchSalesPlan.upsert({
        where: { branchId_month_rowKey: { branchId, month, rowKey: row.rowKey } },
        create: {
          businessGroupId: context.businessGroupId,
          branchId,
          month,
          rowKey: row.rowKey,
          metricCode: row.metricCode,
          aggregateType: row.aggregateType,
          procedure: row.procedure,
          configuration: row.configuration,
          targetCount: new Prisma.Decimal(row.targetCount),
          targetRevenueCents: row.targetRevenueCents,
          targetGrossProfitCents: row.targetGrossProfitCents,
          targetAttachRateBasisPoints: row.targetAttachRateBasisPoints,
          expectedRevenuePerUnitCents: row.expectedRevenuePerUnitCents,
          expectedGrossProfitPerUnitCents: row.expectedGrossProfitPerUnitCents,
          note: row.note,
          version,
          createdById: context.userId,
          updatedById: context.userId,
        },
        update: {
          targetCount: new Prisma.Decimal(row.targetCount),
          targetRevenueCents: row.targetRevenueCents,
          targetGrossProfitCents: row.targetGrossProfitCents,
          targetAttachRateBasisPoints: row.targetAttachRateBasisPoints,
          expectedRevenuePerUnitCents: row.expectedRevenuePerUnitCents,
          expectedGrossProfitPerUnitCents: row.expectedGrossProfitPerUnitCents,
          note: row.note,
          version,
          updatedById: context.userId,
        },
      });
      await tx.branchAuditLog.create({
        data: {
          businessGroupId: context.businessGroupId,
          branchId,
          userId: context.userId,
          action: existing ? "SALES_PLAN_UPDATED" : "SALES_PLAN_CREATED",
          entityType: "branch_sales_plan",
          entityId: plan.id,
          metadata: {
            month,
            rowKey: row.rowKey,
            before: existing ? serializeSalesPlan(existing) : null,
            after: serializeSalesPlan(plan),
          } as Prisma.InputJsonValue,
        },
      });
      saved.push(plan);
    }
    return saved;
  }));
  invalidateSalesPerformanceAnalytics();
  return result.map(serializeSalesPlan);
}

export async function updateSalesPlan(
  context: BranchContext,
  planId: string,
  patch: Partial<SalesPlanWriteInput>,
) {
  const existing = await prisma.branchSalesPlan.findFirst({
    where: { id: planId, businessGroupId: context.businessGroupId },
  });
  if (!existing || !context.branches.some((branch) => branch.id === existing.branchId)) throw new Error("План не найден");
  const [saved] = await saveSalesPlans(context, existing.branchId, existing.month, [{
    rowKey: existing.rowKey,
    targetCount: patch.targetCount ?? Number(existing.targetCount),
    targetRevenueCents: patch.targetRevenueCents === undefined ? existing.targetRevenueCents : patch.targetRevenueCents,
    targetGrossProfitCents: patch.targetGrossProfitCents === undefined ? existing.targetGrossProfitCents : patch.targetGrossProfitCents,
    targetAttachRateBasisPoints: patch.targetAttachRateBasisPoints === undefined ? existing.targetAttachRateBasisPoints : patch.targetAttachRateBasisPoints,
    expectedRevenuePerUnitCents: patch.expectedRevenuePerUnitCents === undefined ? existing.expectedRevenuePerUnitCents : patch.expectedRevenuePerUnitCents,
    expectedGrossProfitPerUnitCents: patch.expectedGrossProfitPerUnitCents === undefined ? existing.expectedGrossProfitPerUnitCents : patch.expectedGrossProfitPerUnitCents,
    note: patch.note === undefined ? existing.note : patch.note,
  }]);
  return saved;
}

export async function copySalesPlans(context: BranchContext, input: {
  sourceBranchId: string;
  sourceMonth: unknown;
  targetBranchId: string;
  targetMonth: unknown;
}) {
  if (!canManageSalesPlans(context)) throw new Error("Копировать планы может владелец или управляющий бизнес-группы");
  const sourceMonth = normalizeSalesPlanMonth(input.sourceMonth);
  const targetMonth = normalizeSalesPlanMonth(input.targetMonth);
  const allowed = new Set(context.branches.map((branch) => branch.id));
  if (!allowed.has(input.sourceBranchId) || !allowed.has(input.targetBranchId)) throw new Error("Нет доступа к выбранному филиалу");
  const source = await runWithBranchApiTargetContext(context, input.sourceBranchId, () => prisma.branchSalesPlan.findMany({
    where: {
      businessGroupId: context.businessGroupId,
      branchId: input.sourceBranchId,
      month: sourceMonth,
    },
    orderBy: { rowKey: "asc" },
  }));
  if (!source.length) throw new Error("В исходном месяце нет планов для копирования");
  const saved = await saveSalesPlans(context, input.targetBranchId, targetMonth, source.map((plan) => ({
    rowKey: plan.rowKey,
    targetCount: Number(plan.targetCount),
    targetRevenueCents: plan.targetRevenueCents,
    targetGrossProfitCents: plan.targetGrossProfitCents,
    targetAttachRateBasisPoints: plan.targetAttachRateBasisPoints,
    expectedRevenuePerUnitCents: plan.expectedRevenuePerUnitCents,
    expectedGrossProfitPerUnitCents: plan.expectedGrossProfitPerUnitCents,
    note: plan.note,
  })));
  await prisma.branchAuditLog.create({
    data: {
      businessGroupId: context.businessGroupId,
      branchId: input.targetBranchId,
      userId: context.userId,
      action: "SALES_PLAN_COPIED",
      entityType: "branch_sales_plan_batch",
      metadata: { sourceBranchId: input.sourceBranchId, sourceMonth, targetBranchId: input.targetBranchId, targetMonth, rows: saved.length },
    },
  });
  return saved;
}

export async function salesPlanHistory(context: BranchContext, branchIds: string[], monthValue: unknown) {
  const month = normalizeSalesPlanMonth(monthValue);
  const rows = await prisma.branchAuditLog.findMany({
    where: {
      businessGroupId: context.businessGroupId,
      branchId: { in: branchIds },
      entityType: { in: ["branch_sales_plan", "branch_sales_plan_batch"] },
      OR: [
        { metadata: { path: ["month"], equals: month } },
        { metadata: { path: ["targetMonth"], equals: month } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
