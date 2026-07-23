import type { Prisma } from "@prisma/client";
import type { AIServiceType } from "./types";

export type AgentPendingToolAction = "none" | "get_available_slots" | "technical_research" | "calculate_quote";
export type AgentPendingQuestion = "none" | "slots" | "slot_selection" | "quote" | "budget" | "mileage_and_history" | "vehicle" | "vin" | "drive" | "mileage" | "transmission_history" | "transmission_complaints";
export type AgentVinAvailability = "unknown" | "available" | "unavailable_now" | "refused" | "invalid" | "confirmed";

export type AgentSlotSuggestion = {
  id: string;
  date: string;
  time: string;
  address: string;
  durationMinutes: number;
};

export type ConversationAgentState = {
  version: 1;
  /** Monotonic optimistic version of the current dialogue workflow. */
  stateRevision: number;
  /** The only run permitted to persist workflow transitions for this turn. */
  activeRunId: string | null;
  lastAppliedMessageId: string | null;
  currentIntent: string | null;
  activeServiceRequests: AIServiceType[];
  pendingQuestion: AgentPendingQuestion;
  pendingQuestionType: Exclude<AgentPendingQuestion, "none"> | null;
  pendingQuestionMessageId: string | null;
  pendingQuestionAskedAt: string | null;
  pendingQuestionAnsweredAt: string | null;
  vinAvailability: AgentVinAvailability;
  vehicleConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  engineConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  engineOilSpecificationConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  engineOilVolumeConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  oilFilterConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  transmissionTypeConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  transmissionFluidConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  transmissionVolumeConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  transferCaseConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  rearDifferentialConfidence: "HIGH" | "MEDIUM" | "LOW" | null;
  pendingToolAction: AgentPendingToolAction;
  vehicleId: string | null;
  vehicleData: Record<string, unknown>;
  requestedDate: string | null;
  selectedSlot: string | null;
  quoteId: string | null;
  awaitingTechnicalResearch: boolean;
  awaitingHumanApproval: boolean;
  complexFluidRequest: boolean;
  missingRequirements: string[];
  mileage: string | null;
  mileageApproximate: boolean;
  transmissionHistory: string | null;
  transmissionComplaints: string | null;
  confirmedItems: string[];
  unresolvedItems: string[];
  lastClientMessageId: string | null;
  lastAgentMessageId: string | null;
  slotSuggestions: AgentSlotSuggestion[];
  updatedAt: string;
};

const STATE_KEY = "conversationAgentState";

const DEFAULT_STATE: ConversationAgentState = {
  version: 1,
  stateRevision: 0,
  activeRunId: null,
  lastAppliedMessageId: null,
  currentIntent: null,
  activeServiceRequests: [],
  pendingQuestion: "none",
  pendingQuestionType: null,
  pendingQuestionMessageId: null,
  pendingQuestionAskedAt: null,
  pendingQuestionAnsweredAt: null,
  vinAvailability: "unknown",
  vehicleConfidence: null,
  engineConfidence: null,
  engineOilSpecificationConfidence: null,
  engineOilVolumeConfidence: null,
  oilFilterConfidence: null,
  transmissionTypeConfidence: null,
  transmissionFluidConfidence: null,
  transmissionVolumeConfidence: null,
  transferCaseConfidence: null,
  rearDifferentialConfidence: null,
  pendingToolAction: "none",
  vehicleId: null,
  vehicleData: {},
  requestedDate: null,
  selectedSlot: null,
  quoteId: null,
  awaitingTechnicalResearch: false,
  awaitingHumanApproval: false,
  complexFluidRequest: false,
  missingRequirements: [],
  mileage: null,
  mileageApproximate: false,
  transmissionHistory: null,
  transmissionComplaints: null,
  confirmedItems: [],
  unresolvedItems: [],
  lastClientMessageId: null,
  lastAgentMessageId: null,
  slotSuggestions: [],
  updatedAt: "",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isServiceType(value: unknown): value is AIServiceType {
  return [
    "engine_oil_change", "oil_filter", "air_filter", "cabin_filter", "fuel_filter",
    "automatic_transmission_partial", "automatic_transmission_machine", "cvt_service", "dsg_service",
    "manual_transmission_oil_change", "front_differential_oil_change", "rear_differential_oil_change",
    "transfer_case_oil_change", "haldex_service", "brake_fluid_change", "filters_sale",
  ].includes(String(value));
}

function normalizedServices(value: unknown): AIServiceType[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isServiceType))];
}

function normalizedSlots(value: unknown): AgentSlotSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    const id = stringValue(row.id);
    const date = stringValue(row.date);
    const time = stringValue(row.time);
    if (!id || !date || !time) return [];
    return [{
      id,
      date,
      time,
      address: stringValue(row.address) || "Дачная, 6В",
      durationMinutes: Math.max(10, Number(row.durationMinutes) || 45),
    }];
  }).slice(0, 5);
}

function normalizedStrings(value: unknown, max = 20) {
  return Array.isArray(value) ? [...new Set(value.map(stringValue).filter((item): item is string => Boolean(item)))].slice(0, max) : [];
}

function pendingQuestion(value: unknown): AgentPendingQuestion {
  return ["slots", "slot_selection", "quote", "budget", "mileage_and_history", "vehicle", "vin", "drive", "mileage", "transmission_history", "transmission_complaints"].includes(String(value))
    ? String(value) as AgentPendingQuestion
    : "none";
}

function pendingQuestionType(value: unknown, fallback: unknown): Exclude<AgentPendingQuestion, "none"> | null {
  const current = pendingQuestion(value);
  if (current !== "none") return current;
  const previous = pendingQuestion(fallback);
  return previous === "none" ? null : previous;
}

function vinAvailability(value: unknown): AgentVinAvailability {
  return ["unknown", "available", "unavailable_now", "refused", "invalid", "confirmed"].includes(String(value))
    ? String(value) as AgentVinAvailability
    : "unknown";
}

function confidence(value: unknown): "HIGH" | "MEDIUM" | "LOW" | null {
  return ["HIGH", "MEDIUM", "LOW"].includes(String(value)) ? String(value) as "HIGH" | "MEDIUM" | "LOW" : null;
}

function vehicleDataFromMessage(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const make = text.match(/\b(toyota|lexus|ford|volkswagen|vw|bmw|mercedes(?:-benz)?|mazda|honda|hyundai|kia|nissan|mitsubishi|subaru|audi|skoda|renault|lada)\b/i)?.[1];
  if (make) result.make = make.replace(/^vw$/i, "Volkswagen").replace(/^\w/, (letter) => letter.toUpperCase());
  const modelPatterns: Array<[RegExp, string]> = [
    [/\bhighlander\b/i, "Highlander"], [/\bmondeo\b/i, "Mondeo"], [/\b(camry|rav4|land\s*cruiser|prado)\b/i, (text.match(/\b(camry|rav4|land\s*cruiser|prado)\b/i)?.[1] ?? "").replace(/\b\w/g, (letter) => letter.toUpperCase())],
    [/\b(passat|tiguan|polo|octavia|superb|santa\s*fe|sorento|sportage|cx-5|cx-7|qashqai|x-trail)\b/i, (text.match(/\b(passat|tiguan|polo|octavia|superb|santa\s*fe|sorento|sportage|cx-5|cx-7|qashqai|x-trail)\b/i)?.[1] ?? "").replace(/\b\w/g, (letter) => letter.toUpperCase())],
  ];
  for (const [pattern, model] of modelPatterns) if (pattern.test(text) && model) { result.model = model; break; }
  const year = text.match(/\b(19[6-9]\d|20\d{2})\s*(?:г(?:од[а]?|\.)?)?\b/i)?.[1];
  if (year) result.year = Number(year);
  const engine = text.match(/\b([1-8](?:[.,]\d)?)\s*(?:л(?:\.|итр(?:а|ов)?)?)\b/i)?.[1];
  if (engine) result.engine = engine.replace(",", ".");
  if (/(полный|полнопривод|awd|4wd|4x4)/i.test(text)) result.drive = "AWD";
  else if (/(передний|переднепривод|fwd)/i.test(text)) result.drive = "FWD";
  else if (/(задний|заднепривод|rwd)/i.test(text)) result.drive = "RWD";
  if (/(акпп|автомат)/i.test(text)) result.transmission = "automatic";
  return result;
}

export function getConversationAgentState(value: Prisma.JsonValue | Record<string, unknown> | null | undefined): ConversationAgentState {
  const root = record(value);
  const raw = record(root[STATE_KEY]);
  return {
    ...DEFAULT_STATE,
    stateRevision: Math.max(0, Math.floor(Number(raw.stateRevision) || 0)),
    activeRunId: stringValue(raw.activeRunId),
    lastAppliedMessageId: stringValue(raw.lastAppliedMessageId),
    currentIntent: stringValue(raw.currentIntent),
    activeServiceRequests: normalizedServices(raw.activeServiceRequests),
    pendingQuestion: pendingQuestion(raw.pendingQuestion),
    pendingQuestionType: pendingQuestionType(raw.pendingQuestionType, raw.pendingQuestion),
    pendingQuestionMessageId: stringValue(raw.pendingQuestionMessageId),
    pendingQuestionAskedAt: stringValue(raw.pendingQuestionAskedAt),
    pendingQuestionAnsweredAt: stringValue(raw.pendingQuestionAnsweredAt),
    vinAvailability: vinAvailability(raw.vinAvailability),
    vehicleConfidence: confidence(raw.vehicleConfidence),
    engineConfidence: confidence(raw.engineConfidence),
    engineOilSpecificationConfidence: confidence(raw.engineOilSpecificationConfidence),
    engineOilVolumeConfidence: confidence(raw.engineOilVolumeConfidence),
    oilFilterConfidence: confidence(raw.oilFilterConfidence),
    transmissionTypeConfidence: confidence(raw.transmissionTypeConfidence),
    transmissionFluidConfidence: confidence(raw.transmissionFluidConfidence),
    transmissionVolumeConfidence: confidence(raw.transmissionVolumeConfidence),
    transferCaseConfidence: confidence(raw.transferCaseConfidence),
    rearDifferentialConfidence: confidence(raw.rearDifferentialConfidence),
    pendingToolAction: ["get_available_slots", "technical_research", "calculate_quote"].includes(String(raw.pendingToolAction))
      ? String(raw.pendingToolAction) as AgentPendingToolAction
      : "none",
    vehicleId: stringValue(raw.vehicleId),
    vehicleData: record(raw.vehicleData),
    requestedDate: stringValue(raw.requestedDate),
    selectedSlot: stringValue(raw.selectedSlot),
    quoteId: stringValue(raw.quoteId),
    awaitingTechnicalResearch: raw.awaitingTechnicalResearch === true,
    awaitingHumanApproval: raw.awaitingHumanApproval === true,
    complexFluidRequest: raw.complexFluidRequest === true,
    missingRequirements: normalizedStrings(raw.missingRequirements, 12),
    mileage: stringValue(raw.mileage),
    mileageApproximate: raw.mileageApproximate === true,
    transmissionHistory: stringValue(raw.transmissionHistory),
    transmissionComplaints: stringValue(raw.transmissionComplaints),
    confirmedItems: normalizedStrings(raw.confirmedItems, 60),
    unresolvedItems: normalizedStrings(raw.unresolvedItems, 30),
    lastClientMessageId: stringValue(raw.lastClientMessageId),
    lastAgentMessageId: stringValue(raw.lastAgentMessageId),
    slotSuggestions: normalizedSlots(raw.slotSuggestions),
    updatedAt: stringValue(raw.updatedAt) || "",
  };
}

export function withConversationAgentState<T extends Record<string, unknown>>(data: T, state: ConversationAgentState): T & { conversationAgentState: ConversationAgentState } {
  return { ...data, [STATE_KEY]: state };
}

function isoDay(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromMessage(text: string, now: Date) {
  const normalized = text.toLowerCase();
  if (normalized.includes("сегодня")) return isoDay(now);
  if (normalized.includes("завтра")) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return isoDay(tomorrow);
  }
  const explicit = text.match(/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/);
  if (explicit) return `${explicit[1]}-${explicit[2].padStart(2, "0")}-${explicit[3].padStart(2, "0")}`;
  return null;
}

function hasTransmissionOilIntent(text: string) {
  return /(акпп|автомат\S*|коробас\S*|короб\S*|трансмис\S*|вариатор\S*|dsg|дсг|мкпп|редуктор\S*|раздат\S*|халдекс|haldex)/i.test(text)
    && /(масл\S*|жиж\S*|обслуж\S*|частич\S*|аппарат\S*|полную|полная|полн\S*\s+замен|махнуть)/i.test(text);
}

function transmissionServiceFor(text: string): AIServiceType {
  if (/вариатор|cvt/i.test(text)) return "cvt_service";
  if (/dsg|дсг/i.test(text)) return "dsg_service";
  if (/халдекс|haldex/i.test(text)) return "haldex_service";
  if (/передн\S*\s+редукт/i.test(text)) return "front_differential_oil_change";
  if (/задн\S*\s+редукт/i.test(text)) return "rear_differential_oil_change";
  if (/раздат/i.test(text)) return "transfer_case_oil_change";
  if (/мкпп|механик/i.test(text)) return "manual_transmission_oil_change";
  if (/аппарат|полную|полная|полн\S*\s+замен/i.test(text)) return "automatic_transmission_machine";
  return "automatic_transmission_partial";
}

function hasEngineOilIntent(text: string) {
  return /(мотор|двигател|движок|моторк)/i.test(text)
    || /(масл\S*\s+(помен|замен|смен|нужн|хочу|сдела|махн)\S*|(помен|замен)\S*\s+масл\S*)/i.test(text);
}

function dedupeServices(current: AIServiceType[], additions: AIServiceType[]) {
  const next = [...current];
  for (const service of additions) {
    if (service === "automatic_transmission_machine") {
      const partial = next.indexOf("automatic_transmission_partial");
      if (partial >= 0) next.splice(partial, 1);
    }
    if (service === "automatic_transmission_partial" && next.includes("automatic_transmission_machine")) continue;
    if (!next.includes(service)) next.push(service);
  }
  return next;
}

export function updateConversationAgentState(input: {
  current: ConversationAgentState;
  message: string;
  messageId?: string | null;
  intent: string;
  vehicleId?: string | null;
  vehicleData?: Record<string, unknown>;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const text = input.message.trim();
  const requestedDate = dateFromMessage(text, now);
  const additions: AIServiceType[] = [];
  if (hasEngineOilIntent(text)) additions.push("engine_oil_change");
  if (/акпп|автомат\S*|коробас\S*|короб\S*|трансмис\S*/i.test(text) && /(масл\S*|жиж\S*|обслуж\S*|частич\S*|аппарат\S*|полн\S*\s+замен|махнуть)/i.test(text)) additions.push(transmissionServiceFor(text));
  if (/раздат/i.test(text)) additions.push("transfer_case_oil_change");
  if (/передн\S*\s+редукт/i.test(text)) additions.push("front_differential_oil_change");
  if (/задн\S*\s+редукт/i.test(text) || /редуктор/i.test(text) && !/передн\S*\s+редукт/i.test(text)) additions.push("rear_differential_oil_change");
  if (/воздушн\S*\s+фильтр/i.test(text)) additions.push("air_filter");
  if (/салонн\S*\s+фильтр/i.test(text)) additions.push("cabin_filter");
  if (/топливн\S*\s+фильтр/i.test(text)) additions.push("fuel_filter");
  const activeServiceRequests = dedupeServices(input.current.activeServiceRequests, additions);
  const addedTransmission = additions.some((service) => service !== "engine_oil_change" && !["air_filter", "cabin_filter", "fuel_filter"].includes(service));
  const complexFluidRequest = ["engine_oil_change", "automatic_transmission_partial", "automatic_transmission_machine", "transfer_case_oil_change", "front_differential_oil_change", "rear_differential_oil_change"].filter((service) => activeServiceRequests.includes(service as AIServiceType)).length >= 3;
  const complexWorkflowStarted = complexFluidRequest && !input.current.complexFluidRequest;
  const asksWhen = /^(когда|а когда|во сколько|какое время)\??$/i.test(text) || /(когда|свободн\S*\s+время|на сегодня|на завтра|запис)/i.test(text);
  const asksPrice = /^(сколько|а сколько)\??$/i.test(text) || /(сколько|цен[аы]|стоим)/i.test(text);
  const asksBudget = /подешевл|дешевле|бюджетн/i.test(text);
  const parsedVehicleData = vehicleDataFromMessage(text);
  const next: ConversationAgentState = {
    ...input.current,
    currentIntent: input.intent,
    activeServiceRequests,
    requestedDate: requestedDate ?? input.current.requestedDate,
    vehicleId: input.vehicleId ?? input.current.vehicleId,
    vehicleData: { ...input.current.vehicleData, ...(input.vehicleData ?? {}), ...parsedVehicleData },
    lastClientMessageId: input.messageId ?? input.current.lastClientMessageId,
    complexFluidRequest: input.current.complexFluidRequest || complexFluidRequest,
    updatedAt: now.toISOString(),
  };

  // Start the clarification workflow only once. Previously every short reply
  // (including a VIN) reset the conversation back to the VIN question.
  if (complexWorkflowStarted) {
    next.awaitingTechnicalResearch = false;
    next.awaitingHumanApproval = false;
    next.pendingToolAction = "none";
    next.pendingQuestion = "vin";
    next.pendingQuestionType = "vin";
    next.pendingQuestionAskedAt = now.toISOString();
    next.pendingQuestionAnsweredAt = null;
    next.slotSuggestions = [];
  } else if (addedTransmission) {
    next.awaitingTechnicalResearch = true;
    next.awaitingHumanApproval = false;
    next.pendingToolAction = "technical_research";
    next.pendingQuestion = "mileage_and_history";
    next.slotSuggestions = [];
  } else if (asksWhen || (requestedDate && activeServiceRequests.length > 0)) {
    next.pendingQuestion = "slots";
    next.pendingToolAction = "get_available_slots";
  } else if (asksBudget) {
    next.pendingQuestion = "budget";
    next.pendingToolAction = "none";
  } else if (asksPrice) {
    next.pendingQuestion = "quote";
    next.pendingToolAction = "calculate_quote";
  }

  return { state: next, addedServices: additions, addedTransmission, asksWhen, asksPrice, asksBudget };
}

export function estimateConversationDurationMinutes(state: ConversationAgentState, baseMinutes: number) {
  const durationByService: Partial<Record<AIServiceType, number>> = {
    engine_oil_change: baseMinutes,
    automatic_transmission_partial: Math.max(75, baseMinutes * 2),
    automatic_transmission_machine: Math.max(120, baseMinutes * 3),
    cvt_service: Math.max(90, baseMinutes * 2),
    dsg_service: Math.max(90, baseMinutes * 2),
    manual_transmission_oil_change: Math.max(60, baseMinutes),
    front_differential_oil_change: Math.max(45, baseMinutes),
    rear_differential_oil_change: Math.max(45, baseMinutes),
    transfer_case_oil_change: Math.max(45, baseMinutes),
    haldex_service: Math.max(75, baseMinutes * 2),
    brake_fluid_change: Math.max(60, baseMinutes),
    air_filter: 10,
    cabin_filter: 15,
    fuel_filter: 45,
    oil_filter: 0,
    filters_sale: 0,
  };
  const total = state.activeServiceRequests.reduce((sum, service) => sum + (durationByService[service] ?? baseMinutes), 0);
  return Math.max(baseMinutes, total || baseMinutes);
}

export function contextInstruction(state: ConversationAgentState, input: { preloadedSlots?: AgentSlotSuggestion[]; addedServices?: AIServiceType[] }) {
  const services = state.activeServiceRequests.length ? state.activeServiceRequests.join(", ") : "нет";
  const lines = [
    "Контекст текущего диалога обязателен к использованию.",
    `Активные услуги клиента: ${services}. Добавленная услуга не отменяет предыдущие.`,
    `Ожидаемый вопрос: ${state.pendingQuestion}; следующее действие: ${state.pendingToolAction}.`,
  ];
  if (state.requestedDate) lines.push(`Клиент просил время не раньше ${state.requestedDate}.`);
  if (input.addedServices?.length) lines.push("Клиент добавил услугу. Не трактуй фразу о масле в коробке как замену или ремонт коробки целиком.");
  if (state.pendingToolAction === "technical_research") {
    lines.push("Это уже подтверждённый этап технической проверки. Сначала получи профиль и автомобиль, затем по отдельности вызови trusted_technical_web_search и get_engine_oil_requirements для двигателя; trusted_technical_web_search и get_transmission_requirements для АКПП, раздатки и каждого запрошенного редуктора. После этого вызови find_required_parts, search_local_catalog, а ROSSKO — только для отсутствующих позиций; затем calculate_service_quote и request_quote_approval. Нельзя завершать запуск, объявлять расчёт готовым или вызывать handoff_to_human до фактических попыток этих шагов, кроме жалобы, явной неисправности, тюнинга или прямой просьбы человека.");
  }
  if (["unavailable_now", "refused"].includes(state.vinAvailability)) {
    lines.push("VIN клиент сейчас не может предоставить. Для этого расчёта VIN больше не запрашивай и не возвращайся к этому вопросу. Сначала обязательно вызови resolve_vehicle_by_parameters по уже собранным марке, модели, году, двигателю, коробке и приводу. Если модификация неоднозначна, спроси только один различающий параметр; при средней уверенности подготовь предварительный расчёт с явной пометкой. VIN понадобится позднее только перед заказом деталей или окончательной записью.");
  }
  if (state.complexFluidRequest && state.pendingQuestion !== "none") {
    lines.push("Это комплексное обслуживание агрегатов. До технического поиска задай только следующий недостающий вопрос из workflow: VIN, затем привод при отсутствии VIN, пробег, история обслуживания АКПП, жалобы на АКПП. Не передавай весь запрос сотруднику и не объявляй расчёт завершён.");
  }
  if (state.pendingToolAction === "get_available_slots") {
    lines.push("Перед любым утверждением о занятости или времени обязательно вызови get_available_slots. Если сегодня нет окна, сразу назови до трёх ближайших реальных вариантов, не задавая промежуточный вопрос.");
  }
  if (input.preloadedSlots?.length) {
    const slots = input.preloadedSlots.map((slot) => `${slot.date} ${slot.time}`).join(", ");
    lines.push(`Свежие реальные окна уже получены: ${slots}. Ответь ими конкретно; не говори, что мест нет и не обещай дополнительную проверку.`);
  }
  if (state.activeServiceRequests.length > 1) {
    lines.push("Нужен единый расчёт и один визит по всем активным услугам. После добавления услуги не используй старые окна: проверь календарь заново с общей длительностью.");
  }
  return lines.join("\n");
}

export function normalizeClientFacingText(text: string) {
  return text
    .replace(/([.!?])(?=[А-ЯЁA-Z])/g, "$1 ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function hasContradictoryWorkflowStatus(text: string) {
  const researching = /(проверяю|проверим|это займ[её]т несколько минут)/i.test(text);
  const handedOff = /(передал|передала|передали)[^.\n]{0,80}(мастер|сотрудник|специалист)/i.test(text);
  return researching && handedOff;
}
