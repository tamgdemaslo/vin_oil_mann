import { PrismaClient } from "@prisma/client";
import { getRequestTenant, type RequestTenant } from "./request-tenant-store";
import { configurePrismaPool } from "./prisma-pool-config";

const BRANCH_SCOPED_MODELS = new Set([
  "LegacyWorkShift", "ShiftRate", "PieceworkRule", "BonusPenalty", "PayrollAdjustment", "PayrollPayment",
  "ChangeLog", "ScheduledWorkingDay", "PayrollGoal", "PayrollAchievementDefinition",
  "PayrollAchievementAward", "EmployeeRecognition", "PayrollTeamGoal", "EmployeeMotivationSettings",
  "PayrollPeriod", "PayrollPeriodEmployee", "PayrollAccrualLine", "VehicleLookupCache",
  "VehicleMannMapping", "CrmStage", "CrmDeal", "ClientCaseEvent", "ClientCaseNotificationLog",
  "Diagnostic", "DiagnosticPosition", "DiagnosticPhoto", "DiagnosticOffer", "DiagnosticMapSession",
  "DiagnosticMapItem", "DiagnosticMapPhoto", "DiagnosticMapVehiclePhoto",
  "DiagnosticMapRecommendationAction", "LocalStore", "LocalProduct", "LocalStockBalance",
  "LocalCounterparty", "CashShift", "CashWithdrawal", "CashExpenseItem", "CashExpenseOrder",
  "LocalDemand", "ShipmentRevision", "NotificationTemplate", "NotificationRule", "NotificationJob",
  "AIAgentSetting", "AIAgentSession", "AIServiceQuote", "AIAgentTechnicalEvidence",
  "AIAgentQualityFeedback", "AIAgentRun", "AIAgentRunEvent", "AIAgentToolCall", "AIAgentDecision",
  "AIAgentHandoff", "AIAgentSlotHold", "AIAssistantThread", "AIAssistantMessage", "AIAssistantRun",
  "AIAssistantToolCall", "AIAssistantSource", "AIAssistantQuote", "AIAssistantLaborPricingRule",
  "VehicleServiceComplexityRule",
  "MessengerConnection", "MessengerAccount", "TelegramUserSession", "MessengerConversation",
  "MessengerMessage", "MessengerOutbox", "MessengerWebhookEvent", "MessengerTemplate",
  "MessengerLinkToken", "MessengerChannelSetting", "IntegrationCredential",
  "IntegrationOnboardingSession", "BranchIntegrationMigration", "AqsiCashRegister", "AqsiFiscalizationRecord",
  "MessengerAttachment", "MessengerMediaJob",
  "MessengerDeliveryEvent", "MessengerSyncCursor", "CommunicationIdentity",
  "ConversationEntityLink", "IntegrationAuditLog",
  "ProductMannLink", "ProductMarkingAuditLog", "LocalProductPhoto", "InventoryLedgerEntry",
  "InventorySession", "InventoryLine", "InventoryCountEntry", "InventoryAttachment",
  "InventoryMovementLink", "InventoryAssignment", "InventoryLock", "InventorySchedule",
  "InventoryAuditLog", "LocalInventoryDocument", "LocalInventoryDocumentAuditLog",
  "LocalInventoryDocumentPosition", "LocalSupplierInvoice", "LocalSupplierInvoicePayment",
  "CustomerAnalyticsSettings", "VinLookupCache", "WebhookSubscription", "CommunicationConsent",
  "NotificationLog", "ClientNotificationPreference", "OrganizationMember",
  "ProductMannPomanMigrationAudit", "ProductImportJob", "ProductImportRow", "ProductOemBatch", "ProductOemBatchItem", "ClosingDocument",
  "ClosingDocumentNumberSequence", "LocalDemandPosition", "DemandAttributeDefinition",
  "TBankIntegration", "TBankSettlementAccount", "SupplierInvoiceTBankPayment", "TBankWebhookEvent",
  "BranchBookingSettings", "BranchBookingWorkingHour", "BookingService", "BookingMasterService",
  "BookingMasterWorkingHour", "BookingScheduleException", "ClientVehicle", "Booking", "BookingServiceItem",
]);

const WRITE_OPERATIONS = new Set([
  "create", "createMany", "createManyAndReturn", "update", "updateMany", "updateManyAndReturn",
  "upsert", "delete", "deleteMany",
]);

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function assertNoForeignBranch(value: unknown, expected: string) {
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoForeignBranch(item, expected));
    return;
  }
  const row = object(value);
  if (!row) return;
  for (const [key, nested] of Object.entries(row)) {
    if (key === "branchId") {
      if (typeof nested === "string" && nested !== expected) throw new Error("Попытка доступа к данным другого филиала");
      const filter = object(nested);
      if (filter) {
        if (typeof filter.equals === "string" && filter.equals !== expected) throw new Error("Попытка доступа к данным другого филиала");
        if (Array.isArray(filter.in) && filter.in.some((id) => id !== expected)) throw new Error("Попытка доступа к данным другого филиала");
      }
    }
    assertNoForeignBranch(nested, expected);
  }
}

function explicitBranchIds(where: unknown): string[] {
  const row = object(where);
  if (!row) return [];
  const value = row.branchId;
  if (typeof value === "string") return [value];
  const filter = object(value);
  if (typeof filter?.equals === "string") return [filter.equals];
  if (Array.isArray(filter?.in)) return filter.in.filter((id): id is string => typeof id === "string");
  return [];
}

function scopeData(value: unknown, branchId: string): unknown {
  if (Array.isArray(value)) return value.map((item) => scopeData(item, branchId));
  const row = object(value);
  if (!row) return value;
  assertNoForeignBranch(row, branchId);
  return { ...row, branchId };
}

export function applyBranchQueryPolicy(
  model: string | undefined,
  operation: string,
  args: JsonObject,
  tenant: RequestTenant | null = getRequestTenant()
) {
  if (!model || !BRANCH_SCOPED_MODELS.has(model) || !tenant) return args;
  if (tenant.mode === "denied") throw new Error("Нет доступа к филиальным данным");

  const next = { ...args };
  if (tenant.mode === "all") {
    if (WRITE_OPERATIONS.has(operation)) throw new Error("В режиме «Все филиалы» операции изменения запрещены");
    const ids = explicitBranchIds(next.where);
    if (!ids.length || ids.some((id) => !tenant.allowedBranchIds.includes(id))) {
      throw new Error("В режиме «Все филиалы» требуется явный разрешённый branchId");
    }
    return next;
  }

  const branchId = tenant.branchId;
  if (!branchId) throw new Error("Активный филиал не выбран");
  assertNoForeignBranch(next, branchId);
  if (operation === "create" || operation === "createMany" || operation === "createManyAndReturn") {
    next.data = scopeData(next.data, branchId);
  } else if (operation === "upsert") {
    next.where = { ...(object(next.where) ?? {}), branchId };
    next.create = scopeData(next.create, branchId);
    if (next.update) assertNoForeignBranch(next.update, branchId);
  } else {
    next.where = { ...(object(next.where) ?? {}), branchId };
    if (next.data) assertNoForeignBranch(next.data, branchId);
  }
  return next;
}

function createPrismaClient(): PrismaClient {
  const pool = configurePrismaPool(process.env.DATABASE_URL);
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    ...(pool ? { datasources: { db: { url: pool.url } } } : {}),
  });
  if (pool && !globalForPrisma.__prismaPoolConfigurationLogged) {
    globalForPrisma.__prismaPoolConfigurationLogged = true;
    console.info("[database] Prisma pool configured", {
      connectionLimit: pool.connectionLimit,
      poolTimeoutSeconds: pool.poolTimeoutSeconds,
    });
  }
  return base.$extends({
    name: "branch-isolation",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const next = applyBranchQueryPolicy(model, operation, args as JsonObject);
          return query(next as typeof args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
  __prismaPoolConfigurationLogged?: boolean;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Next.js can evaluate server chunks through more than one module graph in the
// same process. Reuse one pool in production as well, otherwise each graph can
// leave its own idle PostgreSQL sessions behind.
globalForPrisma.prisma = prisma;
