import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import {
  invalidateSalesPerformanceAnalytics,
  normalizeManualMappingSource,
} from "@/lib/sales-performance-analytics";
import { canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";

const AGGREGATES = new Set(["AUTOMATIC", "CVT", "DCT_DSG", "MANUAL", "UNKNOWN"]);
const PROCEDURES = new Set(["PARTIAL", "MACHINE", "STANDARD", "UNKNOWN"]);
const CONFIGURATIONS = new Set(["NO_PAN", "PAN_AND_FILTER", "TWO_FILTERS", "OTHER", "UNKNOWN"]);

function optionalEnum(value: unknown, allowed: Set<string>, label: string): string | null {
  if (value == null || value === "") return null;
  const normalized = String(value).trim().toUpperCase();
  if (!allowed.has(normalized)) throw new Error(`Недопустимое значение поля «${label}»`);
  return normalized;
}

export async function PUT(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false });
  if (!access.ok) return access.response;
  const context = access.context;
  if (!(await canViewWarehouseAnalytics(context.user))) {
    return NextResponse.json({ error: "Недостаточно прав для аналитики склада" }, { status: 403 });
  }
  if (!context.branchId || (!context.canManageBranches && context.user.role !== "owner")) {
    return NextResponse.json({ error: "Изменять классификацию может владелец бизнес-группы" }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      sourceType?: unknown;
      sourceId?: unknown;
      metricCode?: unknown;
      kind?: unknown;
      aggregateType?: unknown;
      procedure?: unknown;
      configuration?: unknown;
    };
    const source = normalizeManualMappingSource(body.sourceType, body.sourceId);
    const metricCode = String(body.metricCode ?? "").trim().toUpperCase();
    const expectedType = body.kind === "service" ? "SERVICE_OPERATION" : body.kind === "product" ? "PRODUCT_CATEGORY" : "";
    if (!expectedType) throw new Error("Не указан тип классифицируемой позиции");
    const aggregateType = optionalEnum(body.aggregateType, AGGREGATES, "Тип агрегата");
    const procedure = optionalEnum(body.procedure, PROCEDURES, "Процедура");
    const configuration = optionalEnum(body.configuration, CONFIGURATIONS, "Конфигурация");

    const result = await runWithBranchApiContext(context, async () => {
      const metric = await prisma.salesAnalyticsMetric.findFirst({
        where: { code: metricCode, type: expectedType, active: true },
      });
      if (!metric) throw new Error("Каноническая категория не найдена");
      const existing = await prisma.salesAnalyticsMapping.findUnique({
        where: {
          branchId_sourceType_sourceId: {
            branchId: context.branchId as string,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
          },
        },
      });
      const version = (existing?.version ?? 0) + 1;
      const mapping = await prisma.salesAnalyticsMapping.upsert({
        where: {
          branchId_sourceType_sourceId: {
            branchId: context.branchId as string,
            sourceType: source.sourceType,
            sourceId: source.sourceId,
          },
        },
        create: {
          businessGroupId: context.businessGroupId,
          branchId: context.branchId as string,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          metricCode,
          matchMethod: "MANUAL",
          aggregateType,
          procedure,
          configuration,
          version,
          active: true,
          confirmedById: context.userId,
          confirmedAt: new Date(),
        },
        update: {
          metricCode,
          matchMethod: "MANUAL",
          aggregateType,
          procedure,
          configuration,
          version,
          active: true,
          confirmedById: context.userId,
          confirmedAt: new Date(),
        },
      });
      await prisma.branchAuditLog.create({
        data: {
          businessGroupId: context.businessGroupId,
          branchId: context.branchId,
          userId: context.userId,
          action: existing ? "SALES_ANALYTICS_MAPPING_UPDATED" : "SALES_ANALYTICS_MAPPING_CREATED",
          entityType: "sales_analytics_mapping",
          entityId: mapping.id,
          metadata: {
            source,
            before: existing ? {
              metricCode: existing.metricCode,
              aggregateType: existing.aggregateType,
              procedure: existing.procedure,
              configuration: existing.configuration,
              version: existing.version,
            } : null,
            after: { metricCode, aggregateType, procedure, configuration, version },
          } as Prisma.InputJsonValue,
        },
      });
      return mapping;
    });
    invalidateSalesPerformanceAnalytics();
    return NextResponse.json({ ok: true, mapping: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить классификацию";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
