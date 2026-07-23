import type { AIAgentSetting } from "@prisma/client";

/**
 * Mode names describe the business decision, not a messenger implementation.
 * Legacy database values observe/confirm are normalized on read.
 */
export type AIAgentMode =
  | "off"
  | "suggestions"
  | "auto_quote_approval"
  | "auto_booking_approval"
  | "autonomous";

export const AI_SERVICE_TYPES = [
  "engine_oil_change",
  "oil_filter",
  "air_filter",
  "cabin_filter",
  "fuel_filter",
  "automatic_transmission_partial",
  "automatic_transmission_machine",
  "cvt_service",
  "dsg_service",
  "manual_transmission_oil_change",
  "front_differential_oil_change",
  "rear_differential_oil_change",
  "transfer_case_oil_change",
  "haldex_service",
  "brake_fluid_change",
  "filters_sale",
] as const;

export type AIServiceType = (typeof AI_SERVICE_TYPES)[number];

export const TRANSMISSION_SERVICE_TYPES = new Set<AIServiceType>([
  "automatic_transmission_partial",
  "automatic_transmission_machine",
  "cvt_service",
  "dsg_service",
  "manual_transmission_oil_change",
  "front_differential_oil_change",
  "rear_differential_oil_change",
  "transfer_case_oil_change",
  "haldex_service",
]);

export type AICalculationRules = {
  serviceOilWorkCents: number;
  clientOilWorkCents: number;
  clientFilterSurchargeCents: number;
  protectionRemovalCents: number;
  protectionInstallCents: number;
  complexFilterSurchargeCents: number;
  cartridgeSurchargeCents: number;
  excessVolumeThresholdLiters: number;
  excessVolumeSurchargeCents: number;
  washerCents: number;
  drainPlugCents: number;
  environmentalFeeCents: number;
  minimumOrderCents: number;
  serviceDurationMinutes: number;
  freeWorkWithServiceOil: boolean;
  literRoundingStep: number;
  totalRoundingCents: number;
  maxAutomaticDiscountCents: number;
  quoteValidityHours: number;
};

export type AIHandoffRules = {
  lowConfidenceThreshold: number;
  highAmountCents: number;
  complaints: boolean;
  ambiguousVehicle: boolean;
  conflictingTechnicalData: boolean;
  customerRequestsHuman: boolean;
};

export type AIAgentTimeoutRules = {
  softRunSeconds: number;
  hardRunSeconds: number;
  staleHeartbeatSeconds: number;
  clientProfileSeconds: number;
  vehicleResolutionSeconds: number;
  technicalSearchSeconds: number;
  catalogSearchSeconds: number;
  rosskoSearchSeconds: number;
  quoteCalculationSeconds: number;
};

export type AIRosskoMarkupRule = {
  fromCents: number;
  toCents: number | null;
  marginPercent: number;
  category?: string | null;
};

export type AIAgentSettings = Omit<
  AIAgentSetting,
  | "channelsJson"
  | "allowedServicesJson"
  | "allowedStoreIdsJson"
  | "businessHoursJson"
  | "trustedDomainsJson"
  | "calculationRulesJson"
  | "timeoutRulesJson"
  | "rosskoMarkupRulesJson"
  | "handoffRulesJson"
  | "mode"
> & {
  mode: AIAgentMode;
  channels: string[];
  allowedServices: string[];
  allowedStoreIds: string[];
  businessHours: Record<string, unknown>;
  trustedDomains: string[];
  calculationRules: AICalculationRules;
  timeoutRules: AIAgentTimeoutRules;
  rosskoMarkupRules: AIRosskoMarkupRule[];
  handoffRules: AIHandoffRules;
};

export type AIAgentRunContext = {
  organizationId: string;
  conversationId: string;
  sessionId: string;
  runId: string;
  actorId: string;
  mode: AIAgentMode;
  settings: AIAgentSettings;
};

export type AIAgentConversationStatus = {
  enabled: boolean;
  configured: boolean;
  hasApiKey: boolean;
  mode: AIAgentMode;
  agentName: string;
  state: "off" | "idle" | "running" | "waiting_client" | "needs_approval" | "handoff" | "human" | "error";
  intent: string | null;
  confidence: number | null;
  draft: string | null;
  pendingApprovals: Array<{ id: string; toolName: string; arguments?: unknown }>;
  latestQuote: unknown | null;
  latestHandoff: unknown | null;
  recentToolCalls: unknown[];
  lastError: string | null;
  updatedAt: string | null;
  conversationState: {
    pendingQuestion: string | null;
    vinAvailability: string;
    vehicleConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
    mileage: string | null;
    mileageApproximate: boolean;
    unresolvedItems: string[];
  };
  currentRun: {
    id: string;
    status: "queued" | "running" | "waiting_for_client" | "waiting_for_human" | "completed" | "failed" | "research_failed" | "timed_out" | "cancelled" | "handed_off";
    stage: string | null;
    stageLabel: string | null;
    startedAt: string;
    heartbeatAt: string | null;
    elapsedSeconds: number;
    heartbeatSeconds: number;
    softExceeded: boolean;
    stale: boolean;
    requiresHumanApproval: boolean;
    humanApprovalReason: string | null;
    lastToolName: string | null;
    lastToolStatus: string | null;
    completedStages: string[];
    errorCode: string | null;
    errorMessage: string | null;
    retryCount: number;
    events: Array<{ id: string; eventType: string; stage: string | null; publicLabel: string | null; toolName: string | null; toolStatus: string | null; durationMs: number | null; createdAt: string }>;
  } | null;
};
