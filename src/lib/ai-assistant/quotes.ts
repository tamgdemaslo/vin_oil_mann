import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type JsonRecord = Record<string, unknown>;

export type QuotePreviewResult = {
  lines?: Array<{ name?: unknown; quantity?: unknown; totalCents?: unknown; type?: unknown; article?: unknown }>;
  totalCents?: unknown;
  validUntil?: unknown;
  note?: unknown;
  maximum?: {
    lines?: Array<{ name?: unknown; quantity?: unknown; totalCents?: unknown; type?: unknown; article?: unknown }>;
    totalCents?: unknown;
    validUntil?: unknown;
  } | null;
  appliedRule?: Record<string, unknown> | null;
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function clean(value: unknown, max = 400) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function integer(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function stringList(value: unknown, maxItems = 12, maxLength = 360) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => clean(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function lineSnapshot(lines: QuotePreviewResult["lines"]) {
  return (Array.isArray(lines) ? lines : []).map((line) => ({
    name: clean(line?.name, 220) || "Позиция",
    quantity: Number(line?.quantity) || 1,
    type: clean(line?.type, 60) || null,
    article: clean(line?.article, 120) || null,
    totalCents: integer(line?.totalCents),
  }));
}

function date(value: unknown) {
  const candidate = clean(value, 100);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function saveAssistantQuoteSnapshot(input: {
  organizationId: string;
  threadId: string;
  runId: string;
  createdById: string;
  argumentsValue: unknown;
  preview: QuotePreviewResult;
}) {
  const args = object(input.argumentsValue);
  const totalCents = integer(input.preview.totalCents);
  if (totalCents <= 0) throw new Error("Предварительный расчёт не содержит корректной итоговой суммы");
  const maximumCents = integer(input.preview.maximum?.totalCents);
  const maximumTotalCents = maximumCents > totalCents ? maximumCents : null;
  const vehicleDisplayName = clean(args.vehicleDisplayName, 180);
  const serviceName = clean(args.serviceName, 180);
  const customerSafeWarnings = stringList(args.customerSafeWarnings, 6);
  const defaultCustomerWarning = maximumTotalCents
    ? "Итог зависит от необходимого объёма жидкости и комплекта."
    : "Перед началом работ окончательно сверим комплект и необходимый объём.";
  const validUntil = date(input.preview.validUntil) ?? date(input.preview.maximum?.validUntil);
  const status = vehicleDisplayName && serviceName ? "draft" : "needs_clarification";
  const includedItems = lineSnapshot(input.preview.lines);
  const optionalItems = stringList(args.optionalItems, 12);
  const assumptions = stringList(args.assumptions, 12);
  const internalWarnings = stringList(args.internalWarnings, 12);
  const appliedRule = object(input.preview.appliedRule);
  const appliedRuleId = clean(appliedRule.id, 160) || null;

  return prisma.$transaction(async (tx) => {
    await tx.aIAssistantQuote.updateMany({
      where: { organizationId: input.organizationId, threadId: input.threadId, isSelected: true },
      data: { isSelected: false },
    });
    return tx.aIAssistantQuote.create({
      data: {
        organizationId: input.organizationId,
        threadId: input.threadId,
        runId: input.runId,
        createdById: input.createdById,
        status,
        vehicleId: clean(args.vehicleId, 160) || null,
        vehicleDisplayName: vehicleDisplayName || null,
        vehicleSnapshotJson: json(object(args.vehicleSnapshot)),
        serviceName: serviceName || null,
        selectedScenario: clean(args.selectedScenario, 180) || null,
        appliedRuleId,
        appliedRuleSnapshotJson: json(appliedRule),
        includedItemsJson: json(includedItems),
        optionalItemsJson: json(optionalItems),
        baseTotalCents: totalCents,
        maximumTotalCents,
        priceRangeJson: json({ baseTotalCents: totalCents, maximumTotalCents, maximumItems: lineSnapshot(input.preview.maximum?.lines), maximumPriceSentence: clean(args.maximumPriceSentence, 360) || null }),
        assumptionsJson: json(assumptions),
        internalWarningsJson: json(internalWarnings),
        customerSafeWarningsJson: json(customerSafeWarnings.length ? customerSafeWarnings : [defaultCustomerWarning]),
        validUntil,
        isSelected: true,
      },
    });
  });
}

export async function getSelectedAssistantQuote(input: { organizationId: string; threadId: string; quoteId?: string | null }) {
  const where = {
    organizationId: input.organizationId,
    threadId: input.threadId,
    ...(input.quoteId ? { id: input.quoteId } : { isSelected: true }),
  };
  return prisma.aIAssistantQuote.findFirst({ where, orderBy: { createdAt: "desc" } });
}

export function quoteStrings(value: unknown, maxItems = 12) {
  return stringList(value, maxItems);
}

export function quoteItems(value: unknown) {
  return lineSnapshot(Array.isArray(value) ? value : []);
}
