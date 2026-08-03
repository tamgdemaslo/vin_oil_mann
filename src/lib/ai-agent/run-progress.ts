import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { sanitizeForModel } from "./security";
import type { AIAgentSettings } from "./types";

export const AGENT_RUN_STAGES = [
  "understanding_request",
  "loading_context",
  "resolving_vehicle",
  "technical_research",
  "local_catalog_search",
  "supplier_search",
  "calculating_quote",
  "waiting_for_human",
  "sending_answer",
  "completed",
] as const;

export type AgentRunStage = (typeof AGENT_RUN_STAGES)[number];

export const AGENT_RUN_STAGE_LABELS: Record<AgentRunStage, string> = {
  understanding_request: "Разбираем запрос клиента",
  loading_context: "Загружаем клиента, автомобиль и историю",
  resolving_vehicle: "Определяем автомобиль и модификацию",
  technical_research: "Проверяем технические требования",
  local_catalog_search: "Ищем товары в каталоге и остатках",
  supplier_search: "Проверяем варианты под заказ",
  calculating_quote: "Собираем расчёт стоимости",
  waiting_for_human: "Расчёт ждёт проверки сотрудника",
  sending_answer: "Готовим ответ клиенту",
  completed: "Расчёт завершён",
};

const TOOL_STAGE: Record<string, AgentRunStage> = {
  get_client_profile: "loading_context",
  resolve_vehicle_by_vin: "resolving_vehicle",
  resolve_vehicle_by_parameters: "resolving_vehicle",
  save_vehicle: "resolving_vehicle",
  trusted_vehicle_web_search: "resolving_vehicle",
  trusted_technical_web_search: "technical_research",
  get_engine_oil_requirements: "technical_research",
  get_transmission_requirements: "technical_research",
  find_required_parts: "technical_research",
  search_local_catalog: "local_catalog_search",
  search_compatible_oil: "local_catalog_search",
  rossko_search: "supplier_search",
  calculate_service_quote: "calculating_quote",
  request_quote_approval: "waiting_for_human",
  select_quote_option: "waiting_for_human",
  create_client_case: "waiting_for_human",
  get_available_slots: "sending_answer",
  hold_appointment_slot: "sending_answer",
  create_appointment: "sending_answer",
  handoff_to_human: "waiting_for_human",
};

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function completedStages(value: unknown): AgentRunStage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is AgentRunStage => typeof item === "string" && AGENT_RUN_STAGES.includes(item as AgentRunStage));
}

function asStage(value: string | null | undefined): AgentRunStage | null {
  return value && AGENT_RUN_STAGES.includes(value as AgentRunStage) ? value as AgentRunStage : null;
}

export function stageForTool(toolName: string): AgentRunStage {
  return TOOL_STAGE[toolName] ?? "understanding_request";
}

export function safeRunEventPayload(value: unknown) {
  return sanitizeForModel(value);
}

type ProgressInput = {
  organizationId: string;
  runId: string;
  stage?: AgentRunStage;
  status?: "queued" | "running" | "waiting_for_client" | "waiting_for_human" | "completed" | "failed" | "research_failed" | "timed_out" | "cancelled" | "handed_off";
  eventType: string;
  toolName?: string;
  toolStatus?: string;
  durationMs?: number;
  payload?: unknown;
  errorCode?: string;
  publicLabel?: string;
  internalLabel?: string;
  humanApprovalReason?: string | null;
};

/**
 * Stores semantic, staff-visible execution progress. It is deliberately
 * separate from model reasoning and only keeps tool/stage metadata.
 */
export async function updateAgentRunProgress(input: ProgressInput) {
  const current = await prisma.aIAgentRun.findFirst({
    where: { id: input.runId, organizationId: input.organizationId },
    select: { currentStage: true, completedStagesJson: true },
  });
  if (!current) return;
  const now = new Date();
  const nextStage = input.stage ?? asStage(current.currentStage) ?? "understanding_request";
  const previousStage = asStage(current.currentStage);
  const done = completedStages(current.completedStagesJson);
  if (previousStage && previousStage !== nextStage && !done.includes(previousStage)) done.push(previousStage);
  const terminal = input.status === "completed" || input.status === "failed" || input.status === "research_failed" || input.status === "timed_out" || input.status === "cancelled" || input.status === "handed_off";
  if (terminal && previousStage && !done.includes(previousStage)) done.push(previousStage);

  await prisma.$transaction([
    prisma.aIAgentRun.update({
      where: { id: input.runId },
      data: {
        ...(input.status ? { status: input.status } : {}),
        currentStage: nextStage,
        stageLabel: input.publicLabel ?? AGENT_RUN_STAGE_LABELS[nextStage],
        ...(previousStage !== nextStage ? { stageStartedAt: now } : {}),
        heartbeatAt: now,
        ...(input.toolName ? { lastToolName: input.toolName } : {}),
        ...(input.toolStatus ? { lastToolStatus: input.toolStatus } : {}),
        ...(input.humanApprovalReason !== undefined ? { humanApprovalReason: input.humanApprovalReason } : {}),
        completedStagesJson: json(done),
      },
    }),
    prisma.aIAgentRunEvent.create({
      data: {
        runId: input.runId,
        eventType: input.eventType,
        stage: nextStage,
        publicLabel: input.publicLabel ?? AGENT_RUN_STAGE_LABELS[nextStage],
        internalLabel: input.internalLabel,
        toolName: input.toolName,
        toolStatus: input.toolStatus,
        durationMs: input.durationMs,
        sanitizedPayload: input.payload === undefined ? undefined : json(safeRunEventPayload(input.payload)),
        errorCode: input.errorCode,
      },
    }),
  ]);
}

export async function touchAgentRunHeartbeat(organizationId: string, runId: string, toolName?: string) {
  await prisma.aIAgentRun.updateMany({
    where: { id: runId, organizationId, status: { in: ["queued", "running"] } },
    data: { heartbeatAt: new Date(), ...(toolName ? { lastToolName: toolName } : {}) },
  });
}

export function startAgentRunHeartbeat(organizationId: string, runId: string, intervalMs = 8_000) {
  const timer = setInterval(() => {
    void touchAgentRunHeartbeat(organizationId, runId);
  }, intervalMs);
  return () => clearInterval(timer);
}

export function runTimeoutState(settings: AIAgentSettings, startedAt: Date, heartbeatAt: Date | null, now = Date.now()) {
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt.getTime()) / 1000));
  const heartbeatSeconds = Math.max(0, Math.floor((now - (heartbeatAt ?? startedAt).getTime()) / 1000));
  return {
    elapsedSeconds,
    heartbeatSeconds,
    softExceeded: elapsedSeconds >= settings.timeoutRules.softRunSeconds,
    hardExceeded: elapsedSeconds >= settings.timeoutRules.hardRunSeconds,
    stale: heartbeatSeconds >= settings.timeoutRules.staleHeartbeatSeconds,
  };
}
