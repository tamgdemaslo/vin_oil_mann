import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { aiAgentApiError, requireAIAgentAccess } from "@/lib/ai-agent/access";
import { getAgentSettings, settingsToPublicJson } from "@/lib/ai-agent/settings";

const moneyRule = z.number().int().min(0).max(100_000_000);
const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["off", "suggestions", "auto_quote_approval", "auto_booking_approval", "autonomous"]).optional(),
  agentName: z.string().trim().min(2).max(80).optional(),
  model: z.string().trim().max(80).nullable().optional(),
  tone: z.string().trim().max(50).optional(),
  greeting: z.string().trim().max(800).nullable().optional(),
  language: z.string().trim().min(2).max(10).optional(),
  channels: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  allowedServices: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  allowedStoreIds: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  businessHours: z.record(z.string(), z.unknown()).optional(),
  trustedDomains: z.array(z.string().trim().min(3).max(160)).max(50).optional(),
  responseDelaySeconds: z.number().int().min(0).max(300).optional(),
  maxTurns: z.number().int().min(3).max(30).optional(),
  maxMessagesWithoutHandoff: z.number().int().min(1).max(50).optional(),
  autoBookingEnabled: z.boolean().optional(),
  bookingApprovalRequired: z.boolean().optional(),
  slotHoldMinutes: z.number().int().min(5).max(15).optional(),
  minBookingLeadMinutes: z.number().int().min(0).max(10_080).optional(),
  maxBookingHorizonDays: z.number().int().min(1).max(180).optional(),
  slotSuggestionCount: z.number().int().min(1).max(5).optional(),
  rosskoSearchEnabled: z.boolean().optional(),
  rosskoOrderApprovalRequired: z.boolean().optional(),
  rosskoMarkupRules: z.array(z.object({
    fromCents: moneyRule,
    toCents: moneyRule.nullable(),
    marginPercent: z.number().min(0).max(300),
    category: z.string().trim().min(1).max(100).nullable().optional(),
  })).min(1).max(20).optional(),
  internetSearchEnabled: z.boolean().optional(),
  timeoutRules: z.object({
    softRunSeconds: z.number().int().min(60).max(900),
    hardRunSeconds: z.number().int().min(180).max(1_800),
    staleHeartbeatSeconds: z.number().int().min(45).max(120),
    clientProfileSeconds: z.number().int().min(5).max(60),
    vehicleResolutionSeconds: z.number().int().min(30).max(180),
    technicalSearchSeconds: z.number().int().min(60).max(300),
    catalogSearchSeconds: z.number().int().min(10).max(90),
    rosskoSearchSeconds: z.number().int().min(30).max(180),
    quoteCalculationSeconds: z.number().int().min(10).max(90),
  }).refine((value) => value.hardRunSeconds > value.softRunSeconds, { message: "Жёсткий таймаут должен быть больше мягкого" }).optional(),
  calculationRules: z.object({
    serviceOilWorkCents: moneyRule,
    clientOilWorkCents: moneyRule,
    clientFilterSurchargeCents: moneyRule,
    protectionRemovalCents: moneyRule,
    protectionInstallCents: moneyRule,
    complexFilterSurchargeCents: moneyRule,
    cartridgeSurchargeCents: moneyRule,
    excessVolumeThresholdLiters: z.number().min(0).max(30),
    excessVolumeSurchargeCents: moneyRule,
    washerCents: moneyRule,
    drainPlugCents: moneyRule,
    environmentalFeeCents: moneyRule,
    minimumOrderCents: moneyRule,
    serviceDurationMinutes: z.number().int().min(10).max(480),
    freeWorkWithServiceOil: z.boolean(),
    literRoundingStep: z.number().min(0.1).max(10),
    totalRoundingCents: z.number().int().min(1).max(100_000),
    maxAutomaticDiscountCents: moneyRule,
    quoteValidityHours: z.number().int().min(1).max(168),
  }).optional(),
  handoffRules: z.object({
    lowConfidenceThreshold: z.number().min(0).max(1),
    highAmountCents: moneyRule,
    complaints: z.boolean(),
    ambiguousVehicle: z.boolean(),
    conflictingTechnicalData: z.boolean(),
    customerRequestsHuman: z.boolean(),
  }).optional(),
});

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

export async function GET() {
  const access = await requireAIAgentAccess({ manage: true });
  if ("response" in access) return access.response;
  try {
    const settings = await getAgentSettings(access.organizationId);
    return NextResponse.json({ settings: settingsToPublicJson(settings), environment: { openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()), yclientsConfigured: Boolean(process.env.YCLIENTS_PARTNER_TOKEN?.trim() && process.env.YCLIENTS_AI_SERVICE_ID?.trim() && process.env.YCLIENTS_AI_STAFF_ID?.trim()), rosskoConfigured: Boolean(process.env.ROSSKO_KEY1?.trim() && process.env.ROSSKO_KEY2?.trim()) } });
  } catch (error) {
    return aiAgentApiError(error);
  }
}

export async function PUT(request: Request) {
  const access = await requireAIAgentAccess({ manage: true });
  if ("response" in access) return access.response;
  try {
    const parsed = settingsSchema.parse(await request.json());
    if (parsed.mode === "autonomous" && parsed.bookingApprovalRequired === false && parsed.autoBookingEnabled !== true) {
      return NextResponse.json({ error: "Сначала включите автоматическую запись" }, { status: 422 });
    }
    const { channels, allowedServices, allowedStoreIds, businessHours, trustedDomains, calculationRules, timeoutRules, rosskoMarkupRules, handoffRules, ...plain } = parsed;
    const jsonFields = {
      ...(channels ? { channelsJson: json(channels) } : {}),
      ...(allowedServices ? { allowedServicesJson: json(allowedServices) } : {}),
      ...(allowedStoreIds ? { allowedStoreIdsJson: json(allowedStoreIds) } : {}),
      ...(businessHours ? { businessHoursJson: json(businessHours) } : {}),
      ...(trustedDomains ? { trustedDomainsJson: json(trustedDomains) } : {}),
      ...(calculationRules ? { calculationRulesJson: json(calculationRules) } : {}),
      ...(timeoutRules ? { timeoutRulesJson: json(timeoutRules) } : {}),
      ...(rosskoMarkupRules ? { rosskoMarkupRulesJson: json(rosskoMarkupRules) } : {}),
      ...(handoffRules ? { handoffRulesJson: json(handoffRules) } : {}),
    };
    const data = {
      ...plain,
      ...jsonFields,
      updatedById: access.actorId,
    };
    await prisma.aIAgentSetting.upsert({
      where: { organizationId: access.organizationId },
      update: data,
      create: { organizationId: access.organizationId, createdById: access.actorId, ...plain, ...jsonFields, updatedById: access.actorId },
    });
    return NextResponse.json({ settings: settingsToPublicJson(await getAgentSettings(access.organizationId)) });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Проверьте значения настроек", details: error.issues }, { status: 422 });
    return aiAgentApiError(error);
  }
}
