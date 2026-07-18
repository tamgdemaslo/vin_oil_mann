import type { AIAgentSetting } from "@prisma/client";

export type AIAgentMode = "observe" | "confirm" | "autonomous";

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

export type AIAgentSettings = Omit<
  AIAgentSetting,
  | "channelsJson"
  | "allowedServicesJson"
  | "allowedStoreIdsJson"
  | "businessHoursJson"
  | "trustedDomainsJson"
  | "calculationRulesJson"
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
};
