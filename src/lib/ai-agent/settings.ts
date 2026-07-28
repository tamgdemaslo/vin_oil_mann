import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { AI_SERVICE_TYPES, type AIAgentMode, type AIAgentSettings, type AIAgentTimeoutRules, type AICalculationRules, type AIHandoffRules, type AIRosskoMarkupRule } from "./types";

export const DEFAULT_CALCULATION_RULES: AICalculationRules = {
  serviceOilWorkCents: 0,
  clientOilWorkCents: 149_000,
  clientFilterSurchargeCents: 0,
  protectionRemovalCents: 0,
  protectionInstallCents: 0,
  complexFilterSurchargeCents: 0,
  cartridgeSurchargeCents: 0,
  excessVolumeThresholdLiters: 6,
  excessVolumeSurchargeCents: 0,
  washerCents: 0,
  drainPlugCents: 0,
  environmentalFeeCents: 0,
  minimumOrderCents: 0,
  serviceDurationMinutes: 45,
  freeWorkWithServiceOil: true,
  literRoundingStep: 1,
  totalRoundingCents: 100,
  maxAutomaticDiscountCents: 0,
  quoteValidityHours: 24,
};

export const DEFAULT_HANDOFF_RULES: AIHandoffRules = {
  lowConfidenceThreshold: 0.72,
  highAmountCents: 100_000_00,
  complaints: true,
  ambiguousVehicle: true,
  conflictingTechnicalData: true,
  customerRequestsHuman: true,
};

export const DEFAULT_ROSSKO_MARKUP_RULES: AIRosskoMarkupRule[] = [
  { fromCents: 0, toCents: 100_000, marginPercent: 100 },
  { fromCents: 100_000, toCents: 300_000, marginPercent: 70 },
  { fromCents: 300_000, toCents: null, marginPercent: 50 },
];

export const DEFAULT_TIMEOUT_RULES: AIAgentTimeoutRules = {
  softRunSeconds: 180,
  hardRunSeconds: 900,
  staleHeartbeatSeconds: 60,
  clientProfileSeconds: 15,
  vehicleResolutionSeconds: 120,
  technicalSearchSeconds: 240,
  catalogSearchSeconds: 30,
  rosskoSearchSeconds: 120,
  quoteCalculationSeconds: 30,
};

function jsonRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: Prisma.JsonValue | null | undefined, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function money(value: unknown, fallback: number) {
  return Math.round(boundedNumber(value, fallback, 0, 100_000_000));
}

function normalizeMode(value: string, enabled = true): AIAgentMode {
  if (!enabled || value === "off") return "off";
  if (value === "observe" || value === "suggestions") return "suggestions";
  if (value === "confirm" || value === "auto_quote_approval") return "auto_quote_approval";
  if (value === "auto_booking_approval") return "auto_booking_approval";
  return "autonomous";
}

function calculationRules(value: Prisma.JsonValue): AICalculationRules {
  const row = jsonRecord(value);
  return {
    serviceOilWorkCents: money(row.serviceOilWorkCents, DEFAULT_CALCULATION_RULES.serviceOilWorkCents),
    clientOilWorkCents: money(row.clientOilWorkCents, DEFAULT_CALCULATION_RULES.clientOilWorkCents),
    clientFilterSurchargeCents: money(row.clientFilterSurchargeCents, DEFAULT_CALCULATION_RULES.clientFilterSurchargeCents),
    protectionRemovalCents: money(row.protectionRemovalCents, DEFAULT_CALCULATION_RULES.protectionRemovalCents),
    protectionInstallCents: money(row.protectionInstallCents, DEFAULT_CALCULATION_RULES.protectionInstallCents),
    complexFilterSurchargeCents: money(row.complexFilterSurchargeCents, DEFAULT_CALCULATION_RULES.complexFilterSurchargeCents),
    cartridgeSurchargeCents: money(row.cartridgeSurchargeCents, DEFAULT_CALCULATION_RULES.cartridgeSurchargeCents),
    excessVolumeThresholdLiters: boundedNumber(row.excessVolumeThresholdLiters, DEFAULT_CALCULATION_RULES.excessVolumeThresholdLiters, 0, 30),
    excessVolumeSurchargeCents: money(row.excessVolumeSurchargeCents, DEFAULT_CALCULATION_RULES.excessVolumeSurchargeCents),
    washerCents: money(row.washerCents, DEFAULT_CALCULATION_RULES.washerCents),
    drainPlugCents: money(row.drainPlugCents, DEFAULT_CALCULATION_RULES.drainPlugCents),
    environmentalFeeCents: money(row.environmentalFeeCents, DEFAULT_CALCULATION_RULES.environmentalFeeCents),
    minimumOrderCents: money(row.minimumOrderCents, DEFAULT_CALCULATION_RULES.minimumOrderCents),
    serviceDurationMinutes: Math.round(boundedNumber(row.serviceDurationMinutes, DEFAULT_CALCULATION_RULES.serviceDurationMinutes, 10, 480)),
    freeWorkWithServiceOil: row.freeWorkWithServiceOil !== false,
    literRoundingStep: boundedNumber(row.literRoundingStep, DEFAULT_CALCULATION_RULES.literRoundingStep, 0.1, 10),
    totalRoundingCents: Math.round(boundedNumber(row.totalRoundingCents, DEFAULT_CALCULATION_RULES.totalRoundingCents, 1, 100_000)),
    maxAutomaticDiscountCents: money(row.maxAutomaticDiscountCents, DEFAULT_CALCULATION_RULES.maxAutomaticDiscountCents),
    quoteValidityHours: Math.round(boundedNumber(row.quoteValidityHours, DEFAULT_CALCULATION_RULES.quoteValidityHours, 1, 168)),
  };
}

function handoffRules(value: Prisma.JsonValue): AIHandoffRules {
  const row = jsonRecord(value);
  return {
    lowConfidenceThreshold: boundedNumber(row.lowConfidenceThreshold, DEFAULT_HANDOFF_RULES.lowConfidenceThreshold, 0, 1),
    highAmountCents: money(row.highAmountCents, DEFAULT_HANDOFF_RULES.highAmountCents),
    complaints: row.complaints !== false,
    ambiguousVehicle: row.ambiguousVehicle !== false,
    conflictingTechnicalData: row.conflictingTechnicalData !== false,
    customerRequestsHuman: row.customerRequestsHuman !== false,
  };
}

function timeoutRules(value: Prisma.JsonValue): AIAgentTimeoutRules {
  const row = jsonRecord(value);
  const softRunSeconds = Math.round(boundedNumber(row.softRunSeconds, DEFAULT_TIMEOUT_RULES.softRunSeconds, 60, 900));
  return {
    softRunSeconds,
    hardRunSeconds: Math.round(boundedNumber(row.hardRunSeconds, DEFAULT_TIMEOUT_RULES.hardRunSeconds, Math.max(softRunSeconds + 60, 180), 1_800)),
    staleHeartbeatSeconds: Math.round(boundedNumber(row.staleHeartbeatSeconds, DEFAULT_TIMEOUT_RULES.staleHeartbeatSeconds, 45, 120)),
    clientProfileSeconds: Math.round(boundedNumber(row.clientProfileSeconds, DEFAULT_TIMEOUT_RULES.clientProfileSeconds, 5, 60)),
    vehicleResolutionSeconds: Math.round(boundedNumber(row.vehicleResolutionSeconds, DEFAULT_TIMEOUT_RULES.vehicleResolutionSeconds, 30, 180)),
    technicalSearchSeconds: Math.round(boundedNumber(row.technicalSearchSeconds, DEFAULT_TIMEOUT_RULES.technicalSearchSeconds, 60, 300)),
    catalogSearchSeconds: Math.round(boundedNumber(row.catalogSearchSeconds, DEFAULT_TIMEOUT_RULES.catalogSearchSeconds, 10, 90)),
    rosskoSearchSeconds: Math.round(boundedNumber(row.rosskoSearchSeconds, DEFAULT_TIMEOUT_RULES.rosskoSearchSeconds, 30, 180)),
    quoteCalculationSeconds: Math.round(boundedNumber(row.quoteCalculationSeconds, DEFAULT_TIMEOUT_RULES.quoteCalculationSeconds, 10, 90)),
  };
}

function rosskoMarkupRules(value: Prisma.JsonValue): AIRosskoMarkupRule[] {
  if (!Array.isArray(value)) return DEFAULT_ROSSKO_MARKUP_RULES;
  const parsed = value
    .map((item) => jsonRecord(item as Prisma.JsonValue))
    .map((item) => ({
      fromCents: money(item.fromCents, 0),
      toCents: item.toCents == null ? null : money(item.toCents, 0),
      marginPercent: boundedNumber(item.marginPercent, 0, 0, 300),
      category: typeof item.category === "string" && item.category.trim() ? item.category.trim().slice(0, 100) : null,
    }))
    .filter((item) => item.marginPercent > 0 && (item.toCents == null || item.toCents > item.fromCents));
  return parsed.length ? parsed.sort((a, b) => a.fromCents - b.fromCents) : DEFAULT_ROSSKO_MARKUP_RULES;
}

export function normalizeAgentSettings(row: Awaited<ReturnType<typeof prisma.aIAgentSetting.upsert>>): AIAgentSettings {
  const { channelsJson, allowedServicesJson, allowedStoreIdsJson, businessHoursJson, trustedDomainsJson, calculationRulesJson, timeoutRulesJson, rosskoMarkupRulesJson, handoffRulesJson, ...plain } = row;
  return {
    ...plain,
    mode: normalizeMode(row.mode, row.enabled),
    channels: stringArray(channelsJson, ["telegram"]),
    allowedServices: stringArray(allowedServicesJson, [...AI_SERVICE_TYPES]),
    allowedStoreIds: stringArray(allowedStoreIdsJson),
    businessHours: jsonRecord(businessHoursJson),
    trustedDomains: stringArray(trustedDomainsJson),
    calculationRules: calculationRules(calculationRulesJson),
    timeoutRules: timeoutRules(timeoutRulesJson),
    rosskoMarkupRules: rosskoMarkupRules(rosskoMarkupRulesJson),
    handoffRules: handoffRules(handoffRulesJson),
  };
}

export async function getAgentSettings(organizationId: string) {
  const row = await prisma.aIAgentSetting.upsert({
    where: { branchId_organizationId: { branchId: getScopedBranchId(), organizationId } },
    update: {},
    create: { organizationId },
  });
  return normalizeAgentSettings(row);
}

export function settingsToPublicJson(settings: AIAgentSettings) {
  return {
    id: settings.id,
    organizationId: settings.organizationId,
    enabled: settings.enabled,
    mode: settings.mode,
    agentName: settings.agentName,
    model: settings.model,
    promptVersion: settings.promptVersion,
    tone: settings.tone,
    greeting: settings.greeting,
    language: settings.language,
    channels: settings.channels,
    allowedServices: settings.allowedServices,
    allowedStoreIds: settings.allowedStoreIds,
    businessHours: settings.businessHours,
    trustedDomains: settings.trustedDomains,
    calculationRules: settings.calculationRules,
    timeoutRules: settings.timeoutRules,
    rosskoMarkupRules: settings.rosskoMarkupRules,
    responseDelaySeconds: settings.responseDelaySeconds,
    maxTurns: settings.maxTurns,
    maxMessagesWithoutHandoff: settings.maxMessagesWithoutHandoff,
    autoBookingEnabled: settings.autoBookingEnabled,
    bookingApprovalRequired: settings.bookingApprovalRequired,
    slotHoldMinutes: settings.slotHoldMinutes,
    minBookingLeadMinutes: settings.minBookingLeadMinutes,
    maxBookingHorizonDays: settings.maxBookingHorizonDays,
    slotSuggestionCount: settings.slotSuggestionCount,
    rosskoSearchEnabled: settings.rosskoSearchEnabled,
    rosskoOrderApprovalRequired: settings.rosskoOrderApprovalRequired,
    internetSearchEnabled: settings.internetSearchEnabled,
    handoffRules: settings.handoffRules,
    updatedAt: settings.updatedAt.toISOString(),
  };
}
