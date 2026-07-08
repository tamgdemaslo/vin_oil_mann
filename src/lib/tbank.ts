import crypto from "crypto";
import { Prisma } from "@prisma/client";
import type { SupplierInvoiceTBankPayment, TBankIntegration, TBankSettlementAccount } from "@prisma/client";
import type { User } from "@/lib/auth";
import { toServiceDateInput } from "@/lib/date-time";
import { prisma } from "@/lib/db";
import {
  invalidateWarehouseReadCaches,
  mapSupplierInvoice,
  supplierInvoiceInclude,
  type SupplierInvoiceWithDocument,
} from "@/lib/local-inventory-admin";

const DEFAULT_ORGANIZATION_ID = process.env.TBANK_DEFAULT_ORG_ID?.trim() || "default";
const DEFAULT_TBANK_API_BASE_URL = "https://business.tbank.ru/openapi";
const PAYMENT_PURPOSE_MAX_LENGTH = 210;
const ACTIVE_PAYMENT_STATUSES = new Set([
  "draft_creating",
  "draft_created",
  "waiting_confirmation",
  "confirmed",
  "sent_to_bank",
  "processing",
  "paid",
]);
const FINAL_ERROR_STATUSES = new Set(["payment_error", "bank_rejected", "cancelled"]);
const TBANK_WEBHOOK_IPS = new Set([
  "91.194.226.181",
  "91.194.227.181",
  "91.194.226.182",
  "91.194.227.182",
]);

type TBankSettingsInput = {
  organizationId?: string;
  inn?: string;
  kpp?: string;
  token?: string;
  debitAccountNumber?: string;
  mode?: string;
  directPaymentsEnabled?: boolean;
  maxSinglePayment?: number | string | null;
  dailyPaymentLimit?: number | string | null;
  allowedSupplierInns?: string[] | string | null;
  webhookUrl?: string | null;
  webhookSecret?: string | null;
  sandbox?: boolean;
  productionMode?: boolean;
  apiBaseUrl?: string | null;
};

type TBankDraftInput = {
  fromAccountId?: string | null;
  fromAccountNumber?: string | null;
  paymentPurpose?: string | null;
};

type TBankApiResponse = {
  body: unknown;
  requestId: string;
  httpStatus: number;
};

type DraftContext = {
  integration: TBankIntegration & { accounts: TBankSettlementAccount[] };
  invoice: SupplierInvoiceWithDocument;
  amountCents: number;
  debitAccountNumber: string;
  debitAccountMasked: string;
  recipient: ReturnType<typeof supplierRecipientFromInvoice>;
  paymentPurpose: string;
  warnings: string[];
  activePayment: SupplierInvoiceTBankPayment | null;
};

class TBankApiError extends Error {
  status: number;
  code?: string;
  raw?: unknown;

  constructor(message: string, status: number, raw?: unknown, code?: string) {
    super(message);
    this.status = status;
    this.raw = raw;
    this.code = code;
  }
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function cleanDigits(value: unknown) {
  return cleanText(value).replace(/\D/g, "");
}

function centsFromRub(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(Math.max(0, n) * 100) : null;
}

function rubFromCents(cents: number) {
  return Math.round(cents) / 100;
}

function maskAccount(value: string) {
  const digits = cleanDigits(value);
  if (!digits) return "";
  return `**** ${digits.slice(-4)}`;
}

function hashSecret(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function encryptionKey() {
  const source =
    process.env.TBANK_SECRET_ENCRYPTION_KEY?.trim() ||
    process.env.TBANK_ENCRYPTION_KEY?.trim() ||
    process.env.MESSENGER_CREDENTIAL_ENCRYPTION_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "eco-platform-local-tbank-secret-change-in-production";
  return crypto.createHash("sha256").update(source, "utf8").digest();
}

function encryptText(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptText(value?: string | null) {
  if (!value) return "";
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Не удалось расшифровать секрет T-Bank");
  const [, ivRaw, tagRaw, encryptedRaw] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptJson(value: unknown) {
  return encryptText(JSON.stringify(value ?? null));
}

function tokenPreview(token: string) {
  const clean = token.trim();
  if (!clean) return "";
  if (clean.length <= 8) return "configured";
  return `${clean.slice(0, 4)}...${clean.slice(-4)}`;
}

function organizationId(value?: string | null) {
  return cleanText(value) || DEFAULT_ORGANIZATION_ID;
}

function defaultWebhookUrl() {
  const origin =
    process.env.NEXT_PUBLIC_APP_ORIGIN?.trim() ||
    process.env.APP_ORIGIN?.trim() ||
    "";
  return origin ? `${origin.replace(/\/$/, "")}/api/integrations/tbank/webhook/payment-status` : "";
}

function apiBaseUrl(integration?: Pick<TBankIntegration, "apiBaseUrl"> | null) {
  return (integration?.apiBaseUrl || process.env.TBANK_API_BASE_URL || DEFAULT_TBANK_API_BASE_URL).replace(/\/$/, "");
}

function parseAllowedInns(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(cleanDigits).filter(Boolean);
  const raw = cleanText(value);
  if (!raw) return [];
  return raw.split(/[,\n;]/).map(cleanDigits).filter(Boolean);
}

function paymentStatusLabel(status: string) {
  if (status === "draft_creating") return "Создаём черновик";
  if (status === "draft_created") return "Черновик создан";
  if (status === "waiting_confirmation") return "Ожидает подтверждения";
  if (status === "confirmed") return "Подтверждён";
  if (status === "sent_to_bank") return "Отправлен в банк";
  if (status === "processing") return "В исполнении";
  if (status === "paid") return "Оплачен";
  if (status === "payment_error") return "Ошибка оплаты";
  if (status === "bank_rejected") return "Отклонён банком";
  if (status === "cancelled") return "Отменён";
  return status || "Неизвестный статус";
}

function mapPayment(payment: SupplierInvoiceTBankPayment | null) {
  if (!payment) return null;
  return {
    id: payment.id,
    provider: payment.provider,
    mode: payment.mode,
    status: payment.status,
    label: paymentStatusLabel(payment.status),
    providerStatus: payment.providerStatus ?? "",
    tbankPaymentId: payment.tbankPaymentId ?? "",
    tbankDocumentId: payment.tbankDocumentId ?? "",
    tbankRequestId: payment.tbankRequestId ?? "",
    amount: rubFromCents(payment.amountCents),
    amountCents: payment.amountCents,
    fromAccountNumberMasked: payment.fromAccountNumberMasked ?? "",
    recipientName: payment.recipientName,
    recipientInn: payment.recipientInn,
    recipientKpp: payment.recipientKpp ?? "",
    recipientAccount: payment.recipientAccount,
    recipientBik: payment.recipientBik,
    paymentPurpose: payment.paymentPurpose,
    confirmationUrl: payment.confirmationUrl ?? "",
    createdAt: payment.createdAt.toISOString(),
    paidAt: payment.paidAt?.toISOString() ?? "",
    failedAt: payment.failedAt?.toISOString() ?? "",
    errorMessage: payment.errorMessage ?? "",
  };
}

function mapIntegrationStatus(integration: (TBankIntegration & { accounts: TBankSettlementAccount[] }) | null) {
  return {
    configured: Boolean(integration),
    connected: Boolean(integration?.tokenEncrypted && (integration.debitAccountNumberEncrypted || integration.accounts.some((account) => account.isDefault))),
    organizationId: integration?.organizationId ?? DEFAULT_ORGANIZATION_ID,
    inn: integration?.inn ?? "",
    kpp: integration?.kpp ?? "",
    tokenConfigured: Boolean(integration?.tokenEncrypted),
    tokenPreview: integration?.tokenPreview ?? "",
    debitAccountNumberMasked: integration?.debitAccountNumberMasked ?? "",
    mode: integration?.mode ?? "draft_only",
    directPaymentsEnabled: integration?.directPaymentsEnabled ?? false,
    maxSinglePayment: integration?.maxSinglePaymentCents == null ? "" : String(rubFromCents(integration.maxSinglePaymentCents)),
    dailyPaymentLimit: integration?.dailyPaymentLimitCents == null ? "" : String(rubFromCents(integration.dailyPaymentLimitCents)),
    allowedSupplierInns: parseAllowedInns(integration?.allowedSupplierInnsJson).join(", "),
    webhookUrl: integration?.webhookUrl ?? defaultWebhookUrl(),
    sandbox: integration?.sandbox ?? false,
    productionMode: integration?.productionMode ?? false,
    certificateConfigured: integration?.certificateConfigured ?? false,
    mtlsRequired: integration?.mtlsRequired ?? false,
    lastCheckedAt: integration?.lastCheckedAt?.toISOString() ?? "",
    lastCheckStatus: integration?.lastCheckStatus ?? "",
    lastCheckMessage: integration?.lastCheckMessage ?? "",
    apiBaseUrl: integration?.apiBaseUrl ?? "",
    accounts: (integration?.accounts ?? []).map((account) => ({
      id: account.id,
      accountNumberMasked: account.accountNumberMasked,
      accountName: account.accountName ?? "",
      bankName: account.bankName ?? "",
      currency: account.currency,
      isDefault: account.isDefault,
      isActive: account.isActive,
    })),
  };
}

async function getIntegration(organization = DEFAULT_ORGANIZATION_ID) {
  return prisma.tBankIntegration.findUnique({
    where: { organizationId: organization },
    include: {
      accounts: {
        where: { isActive: true },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      },
    },
  });
}

async function auditTBank(input: {
  organizationId?: string;
  actorId?: string | null;
  action: string;
  status?: string;
  message?: string | null;
  metadata?: unknown;
}, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  try {
    await tx.integrationAuditLog.create({
      data: {
        id: crypto.randomUUID(),
        organizationId: input.organizationId ?? DEFAULT_ORGANIZATION_ID,
        channel: "tbank",
        actorId: input.actorId ?? null,
        action: input.action,
        status: input.status ?? "ok",
        message: input.message ?? null,
        metadataJson: toJson(input.metadata ?? {}),
      },
    });
  } catch {
    // Audit must not break payment state updates.
  }
}

function ensureOwner(user?: User | null) {
  if (user?.role !== "owner") {
    return "Создать платёж в T-Bank и управлять токеном может только владелец.";
  }
  return null;
}

function ensureFinanceStatusAccess(user?: User | null) {
  if (!user || (user.role !== "owner" && user.role !== "admin")) {
    return "Недостаточно прав для просмотра статуса T-Bank.";
  }
  return null;
}

export async function getTBankIntegrationStatus() {
  return mapIntegrationStatus(await getIntegration());
}

export async function saveTBankIntegrationSettings(input: TBankSettingsInput, user: User) {
  const permissionError = ensureOwner(user);
  if (permissionError) return { ok: false as const, error: permissionError, status: 403 };

  const orgId = organizationId(input.organizationId);
  const token = cleanText(input.token);
  const debitAccountNumber = cleanDigits(input.debitAccountNumber);
  const maxSinglePaymentCents = centsFromRub(input.maxSinglePayment);
  const dailyPaymentLimitCents = centsFromRub(input.dailyPaymentLimit);
  const commonData = {
    inn: cleanDigits(input.inn) || null,
    kpp: cleanDigits(input.kpp) || null,
    mode: input.mode === "direct_enabled" ? "direct_enabled" : "draft_only",
    directPaymentsEnabled: input.mode === "direct_enabled" && input.directPaymentsEnabled === true,
    maxSinglePaymentCents,
    dailyPaymentLimitCents,
    allowedSupplierInnsJson: toJson(parseAllowedInns(input.allowedSupplierInns)),
    webhookUrl: cleanText(input.webhookUrl) || defaultWebhookUrl() || null,
    sandbox: input.sandbox === true,
    productionMode: input.productionMode === true,
    apiBaseUrl: cleanText(input.apiBaseUrl) || null,
  };
  const secretData: Pick<Prisma.TBankIntegrationUncheckedCreateInput, "tokenEncrypted" | "tokenPreview" | "webhookSecretEncrypted" | "debitAccountNumberEncrypted" | "debitAccountNumberMasked"> = {};
  if (token) {
    secretData.tokenEncrypted = encryptText(token);
    secretData.tokenPreview = tokenPreview(token);
  }
  if (cleanText(input.webhookSecret)) {
    secretData.webhookSecretEncrypted = encryptText(cleanText(input.webhookSecret));
  }
  if (debitAccountNumber) {
    secretData.debitAccountNumberEncrypted = encryptText(debitAccountNumber);
    secretData.debitAccountNumberMasked = maskAccount(debitAccountNumber);
  }

  const updateData: Prisma.TBankIntegrationUncheckedUpdateInput = {
    ...commonData,
    ...secretData,
    updatedById: user.login,
  };
  const createData: Prisma.TBankIntegrationUncheckedCreateInput = {
    ...commonData,
    ...secretData,
    organizationId: orgId,
    createdById: user.login,
    updatedById: user.login,
  };

  const integration = await prisma.tBankIntegration.upsert({
    where: { organizationId: orgId },
    update: updateData,
    create: createData,
    include: { accounts: true },
  });

  if (debitAccountNumber) {
    const accountHash = hashSecret(debitAccountNumber);
    await prisma.$transaction(async (tx) => {
      await tx.tBankSettlementAccount.updateMany({
        where: { integrationId: integration.id },
        data: { isDefault: false },
      });
      await tx.tBankSettlementAccount.upsert({
        where: {
          integrationId_accountNumberHash: {
            integrationId: integration.id,
            accountNumberHash: accountHash,
          },
        },
        update: {
          accountNumberEncrypted: encryptText(debitAccountNumber),
          accountNumberMasked: maskAccount(debitAccountNumber),
          isDefault: true,
          isActive: true,
          currency: "RUB",
        },
        create: {
          organizationId: orgId,
          integrationId: integration.id,
          accountNumberEncrypted: encryptText(debitAccountNumber),
          accountNumberMasked: maskAccount(debitAccountNumber),
          accountNumberHash: accountHash,
          accountName: "Расчётный счёт",
          currency: "RUB",
          isDefault: true,
          isActive: true,
        },
      });
    });
  }

  await auditTBank({
    organizationId: orgId,
    actorId: user.login,
    action: "settings_saved",
    message: "Настройки T-Bank обновлены.",
    metadata: { tokenUpdated: Boolean(token), debitAccountUpdated: Boolean(debitAccountNumber) },
  });

  return { ok: true as const, integration: await getTBankIntegrationStatus() };
}

async function tokenForIntegration(integration: TBankIntegration) {
  return integration.tokenEncrypted ? decryptText(integration.tokenEncrypted) : "";
}

async function callTBankJson(
  integration: TBankIntegration,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<TBankApiResponse> {
  const requestId = crypto.randomUUID();
  const token = await tokenForIntegration(integration);
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Request-Id": requestId,
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBaseUrl(integration)}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new TBankApiError(tbankPublicError(response.status, body), response.status, body);
  }
  return {
    body,
    requestId,
    httpStatus: response.status,
  };
}

function tbankPublicError(status: number, raw: unknown) {
  if (status === 401) return "T-Bank не принял токен. Проверьте токен T-API и доступы.";
  if (status === 403) return "У токена T-Bank нет доступа к этому действию.";
  if (status === 404) return "Метод T-Bank не найден для выбранного режима интеграции.";
  if (status === 429) return "T-Bank ограничил частоту запросов. Попробуйте позже.";
  if (status >= 500) return "T-Bank временно недоступен. Попробуйте позже.";
  const message = cleanText(asRecord(raw).message) || cleanText(asRecord(raw).error);
  return message || "T-Bank вернул ошибку по платежу.";
}

function recordsFromUnknown(value: unknown, records: Record<string, unknown>[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) recordsFromUnknown(item, records);
    return records;
  }
  const record = asRecord(value);
  if (!Object.keys(record).length) return records;
  const hasStatus = ["status", "state", "documentStatus", "paymentStatus", "statusName"].some((key) => cleanText(record[key]));
  const hasId = ["documentId", "paymentId", "id", "documentNumber"].some((key) => cleanText(record[key]));
  if (hasStatus || hasId) records.push(record);
  for (const value of Object.values(record)) recordsFromUnknown(value, records);
  return records;
}

function textField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = cleanText(record[key]);
    if (value) return value;
  }
  return "";
}

function extractDocumentId(raw: unknown) {
  const records = recordsFromUnknown(raw);
  for (const record of records) {
    const value = textField(record, ["documentId", "documentID", "docId", "id"]);
    if (value) return value;
  }
  return textField(asRecord(raw), ["documentId", "documentID", "docId", "id"]);
}

function extractPaymentId(raw: unknown) {
  const records = recordsFromUnknown(raw);
  for (const record of records) {
    const value = textField(record, ["paymentId", "paymentID", "operationId"]);
    if (value) return value;
  }
  return textField(asRecord(raw), ["paymentId", "paymentID", "operationId"]);
}

function extractConfirmationUrl(raw: unknown) {
  const records = recordsFromUnknown(raw);
  for (const record of records) {
    const value = textField(record, ["confirmationUrl", "confirmUrl", "signUrl", "url", "link"]);
    if (value.startsWith("http")) return value;
  }
  const root = textField(asRecord(raw), ["confirmationUrl", "confirmUrl", "signUrl", "url", "link"]);
  return root.startsWith("http") ? root : "";
}

function extractProviderStatus(raw: unknown, payment: Pick<SupplierInvoiceTBankPayment, "tbankDocumentId" | "tbankPaymentId">) {
  const records = recordsFromUnknown(raw);
  const matching = records.find((record) => {
    const documentId = textField(record, ["documentId", "documentID", "docId", "id"]);
    const paymentId = textField(record, ["paymentId", "paymentID", "operationId"]);
    return Boolean(
      (payment.tbankDocumentId && documentId === payment.tbankDocumentId) ||
      (payment.tbankPaymentId && paymentId === payment.tbankPaymentId)
    );
  }) ?? records.find((record) => textField(record, ["status", "state", "documentStatus", "paymentStatus", "statusName"]));
  if (!matching) return "";
  return textField(matching, ["status", "state", "documentStatus", "paymentStatus", "statusName"]);
}

function mapProviderStatus(providerStatus: string): string {
  const status = providerStatus.trim().toLowerCase();
  if (!status) return "waiting_confirmation";
  if (/исполн|оплач|paid|execut|success|complete|done/.test(status)) return "paid";
  if (/отклон|declin|reject|refus/.test(status)) return "bank_rejected";
  if (/отмен|cancel/.test(status)) return "cancelled";
  if (/ошиб|fail|error/.test(status)) return "payment_error";
  if (/подпис|confirm|signed|approve/.test(status)) return "confirmed";
  if (/принят|отправ|исполн|process|accepted|sent|created/.test(status)) return "processing";
  return "waiting_confirmation";
}

function invoiceStatusFromPaymentStatus(status: string) {
  if (status === "paid") return "paid";
  if (status === "bank_rejected") return "bank_rejected";
  if (status === "cancelled") return "payment_cancelled";
  if (status === "payment_error") return "payment_error";
  if (status === "confirmed") return "tbank_confirmed";
  if (status === "sent_to_bank") return "tbank_sent";
  if (status === "processing") return "tbank_processing";
  return "tbank_waiting_confirmation";
}

function dateRu(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function generatedPaymentPurpose(invoice: SupplierInvoiceWithDocument) {
  const invoiceNumber = invoice.number || invoice.document.name || invoice.id;
  const purposeSource =
    cleanText(invoice.comment) ||
    cleanText(invoice.document.description) ||
    (invoice.document.positions.length > 0 ? "товары" : "поставку");
  const raw = `Оплата по счету № ${invoiceNumber} от ${dateRu(invoice.invoiceDate)} за ${purposeSource}. Без НДС.`;
  if (raw.length <= PAYMENT_PURPOSE_MAX_LENGTH) return { value: raw, truncated: false };
  const room = PAYMENT_PURPOSE_MAX_LENGTH - "Оплата по счету №  от  за . Без НДС.".length - invoiceNumber.length - dateRu(invoice.invoiceDate).length;
  const compactPurpose = purposeSource.slice(0, Math.max(20, room)).trim();
  return {
    value: `Оплата по счету № ${invoiceNumber} от ${dateRu(invoice.invoiceDate)} за ${compactPurpose}. Без НДС.`.slice(0, PAYMENT_PURPOSE_MAX_LENGTH),
    truncated: true,
  };
}

function supplierRecipientFromInvoice(invoice: SupplierInvoiceWithDocument) {
  const counterparty = invoice.document.counterparty;
  const fallbackName = invoice.counterpartyNameSnapshot ?? invoice.document.counterpartyNameSnapshot ?? counterparty?.name ?? "Поставщик";
  return {
    name: cleanText(counterparty?.legalTitle) || cleanText(counterparty?.name) || fallbackName,
    inn: cleanDigits(counterparty?.inn),
    kpp: cleanDigits(counterparty?.kpp) || "0",
    account: cleanDigits(counterparty?.checkingAccount),
    bik: cleanDigits(counterparty?.bik),
    corrAccount: cleanDigits(counterparty?.correspondentAccount),
    bankName: cleanText(counterparty?.bankName),
    companyType: cleanText(counterparty?.companyType),
    archived: counterparty?.archived === true,
  };
}

async function resolveDebitAccount(
  integration: TBankIntegration & { accounts: TBankSettlementAccount[] },
  input: TBankDraftInput
) {
  const direct = cleanDigits(input.fromAccountNumber);
  if (direct) return { number: direct, masked: maskAccount(direct) };
  const selected = input.fromAccountId
    ? integration.accounts.find((account) => account.id === input.fromAccountId)
    : integration.accounts.find((account) => account.isDefault) ?? integration.accounts[0];
  if (selected?.accountNumberEncrypted) {
    const number = decryptText(selected.accountNumberEncrypted);
    return { number, masked: selected.accountNumberMasked || maskAccount(number) };
  }
  if (integration.debitAccountNumberEncrypted) {
    const number = decryptText(integration.debitAccountNumberEncrypted);
    return { number, masked: integration.debitAccountNumberMasked || maskAccount(number) };
  }
  return { number: "", masked: "" };
}

async function buildDraftContext(
  invoiceId: string,
  input: TBankDraftInput,
  user: User,
  options: { requireOwner?: boolean } = {}
): Promise<{ ok: true; context: DraftContext } | { ok: false; status: number; result: TBankPrecheckResult }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const permissionError = options.requireOwner ? ensureOwner(user) : ensureFinanceStatusAccess(user);
  if (permissionError) errors.push(permissionError);

  const [integration, invoice] = await Promise.all([
    getIntegration(),
    prisma.localSupplierInvoice.findUnique({
      where: { id: invoiceId },
      include: supplierInvoiceInclude,
    }),
  ]);
  if (!invoice) {
    return {
      ok: false,
      status: 404,
      result: { ok: false, errors: ["Счёт поставщика не найден"], warnings, payment: null, integration: mapIntegrationStatus(integration), activePayment: null },
    };
  }
  if (!integration) errors.push("Настройте интеграцию T-Bank в кабинете.");
  if (integration && !integration.tokenEncrypted && !integration.sandbox) errors.push("Укажите токен T-API в настройках T-Bank.");
  if (integration?.sandbox && !integration.tokenEncrypted) warnings.push("Sandbox включён. Если выбранный метод требует токен, T-Bank вернёт ошибку проверки.");

  const amountCents = Math.max(0, invoice.sumCents - Math.min(invoice.sumCents, Math.max(0, invoice.paidAmountCents)));
  const recipient = supplierRecipientFromInvoice(invoice);
  const generatedPurpose = generatedPaymentPurpose(invoice);
  const paymentPurpose = cleanText(input.paymentPurpose) || generatedPurpose.value;
  if (generatedPurpose.truncated && !cleanText(input.paymentPurpose)) warnings.push("Назначение платежа сокращено до лимита T-Bank.");
  const activePayment = invoice.tbankPayments.find((payment) => ACTIVE_PAYMENT_STATUSES.has(payment.status)) ?? null;
  const debitAccount = integration ? await resolveDebitAccount(integration, input) : { number: "", masked: "" };

  if (amountCents <= 0) errors.push("Счёт уже оплачен или сумма к оплате равна нулю.");
  if (!recipient.name) errors.push("Не указан поставщик.");
  if (!recipient.inn || (recipient.inn.length !== 10 && recipient.inn.length !== 12)) errors.push("ИНН поставщика должен содержать 10 или 12 цифр.");
  if (!recipient.account || recipient.account.length !== 20) errors.push("Расчётный счёт получателя должен содержать 20 цифр.");
  if (!recipient.bik || recipient.bik.length !== 9) errors.push("БИК банка получателя должен содержать 9 цифр.");
  if (recipient.corrAccount && recipient.corrAccount.length !== 20) warnings.push("Корреспондентский счёт выглядит неполным.");
  if (!paymentPurpose) errors.push("Назначение платежа не может быть пустым.");
  if (paymentPurpose.length > PAYMENT_PURPOSE_MAX_LENGTH) errors.push(`Назначение платежа длиннее ${PAYMENT_PURPOSE_MAX_LENGTH} символов.`);
  if (!debitAccount.number || debitAccount.number.length !== 20) errors.push("Выберите расчётный счёт списания T-Bank.");
  if (invoice.status === "paid" || invoice.paidAmountCents >= invoice.sumCents) errors.push("Счёт уже оплачен.");
  if (activePayment) errors.push("По этому счёту уже создан активный платёж в T-Bank.");
  if (recipient.archived) errors.push("Поставщик заблокирован или находится в архиве.");
  if (recipient.kpp === "0" && recipient.companyType !== "individual") warnings.push("КПП не указан. Для ИП это нормально, для юрлица проверьте счёт.");
  if (!recipient.bankName) warnings.push("Не указано наименование банка получателя.");

  const invoiceOrganizationId = invoice.document.store?.organizationId ?? DEFAULT_ORGANIZATION_ID;
  if (integration && invoiceOrganizationId && invoiceOrganizationId !== integration.organizationId) {
    errors.push("Организация счёта не совпадает с организацией интеграции T-Bank.");
  }
  if (integration?.maxSinglePaymentCents && amountCents > integration.maxSinglePaymentCents) {
    errors.push("Сумма счёта превышает лимит одного платежа T-Bank.");
  }
  const allowedInns = parseAllowedInns(integration?.allowedSupplierInnsJson);
  if (allowedInns.length > 0 && !allowedInns.includes(recipient.inn)) {
    errors.push("Поставщик не входит в список разрешённых для оплаты через T-Bank.");
  }
  if (integration?.dailyPaymentLimitCents) {
    const today = new Date(`${toServiceDateInput(new Date())}T00:00:00.000Z`);
    const alreadyToday = await prisma.supplierInvoiceTBankPayment.aggregate({
      where: {
        organizationId: integration.organizationId,
        createdAt: { gte: today },
        status: { in: [...ACTIVE_PAYMENT_STATUSES] },
      },
      _sum: { amountCents: true },
    });
    if ((alreadyToday._sum.amountCents ?? 0) + amountCents > integration.dailyPaymentLimitCents) {
      errors.push("Сумма платежей за день превышает внутренний лимит T-Bank.");
    }
  }

  const result: TBankPrecheckResult = {
    ok: errors.length === 0,
    errors,
    warnings,
    integration: mapIntegrationStatus(integration),
    activePayment: mapPayment(activePayment),
    payment: {
      supplierInvoiceId: invoice.id,
      amount: rubFromCents(amountCents),
      amountCents,
      supplierName: recipient.name,
      recipientName: recipient.name,
      recipientInn: recipient.inn,
      recipientKpp: recipient.kpp,
      recipientAccount: recipient.account,
      recipientBik: recipient.bik,
      recipientCorrAccount: recipient.corrAccount,
      recipientBankName: recipient.bankName,
      paymentPurpose,
      paymentPurposeMaxLength: PAYMENT_PURPOSE_MAX_LENGTH,
      fromAccountNumberMasked: debitAccount.masked,
      fromAccountId: input.fromAccountId ?? "",
      invoice: mapSupplierInvoice(invoice),
    },
  };
  if (errors.length || !integration) return { ok: false, status: errors.includes("Счёт поставщика не найден") ? 404 : 400, result };
  return {
    ok: true,
    context: {
      integration,
      invoice,
      amountCents,
      debitAccountNumber: debitAccount.number,
      debitAccountMasked: debitAccount.masked,
      recipient,
      paymentPurpose,
      warnings,
      activePayment,
    },
  };
}

export type TBankPrecheckResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  integration: ReturnType<typeof mapIntegrationStatus>;
  activePayment: ReturnType<typeof mapPayment>;
  payment: null | {
    supplierInvoiceId: string;
    amount: number;
    amountCents: number;
    supplierName: string;
    recipientName: string;
    recipientInn: string;
    recipientKpp: string;
    recipientAccount: string;
    recipientBik: string;
    recipientCorrAccount: string;
    recipientBankName: string;
    paymentPurpose: string;
    paymentPurposeMaxLength: number;
    fromAccountNumberMasked: string;
    fromAccountId: string;
    invoice: ReturnType<typeof mapSupplierInvoice>;
  };
};

export async function precheckTBankDraft(invoiceId: string, input: TBankDraftInput, user: User) {
  const context = await buildDraftContext(invoiceId, input, user);
  if (!context.ok) return context.result;
  const { integration, invoice, amountCents, debitAccountMasked, recipient, paymentPurpose, warnings, activePayment } = context.context;
  return {
    ok: true,
    errors: [],
    warnings,
    integration: mapIntegrationStatus(integration),
    activePayment: mapPayment(activePayment),
    payment: {
      supplierInvoiceId: invoice.id,
      amount: rubFromCents(amountCents),
      amountCents,
      supplierName: recipient.name,
      recipientName: recipient.name,
      recipientInn: recipient.inn,
      recipientKpp: recipient.kpp,
      recipientAccount: recipient.account,
      recipientBik: recipient.bik,
      recipientCorrAccount: recipient.corrAccount,
      recipientBankName: recipient.bankName,
      paymentPurpose,
      paymentPurposeMaxLength: PAYMENT_PURPOSE_MAX_LENGTH,
      fromAccountNumberMasked: debitAccountMasked,
      fromAccountId: input.fromAccountId ?? "",
      invoice: mapSupplierInvoice(invoice),
    },
  };
}

function buildTBankDraftPayload(context: DraftContext, attemptNumber: number) {
  const amount = rubFromCents(context.amountCents);
  return {
    documentNumber: String(Math.max(1, Math.min(999999, attemptNumber))),
    date: toServiceDateInput(new Date()),
    amount,
    accountNumber: context.debitAccountNumber,
    recipientName: context.recipient.name,
    inn: context.recipient.inn,
    kpp: context.recipient.kpp,
    bankAcnt: context.recipient.account,
    bankBik: context.recipient.bik,
    corrAccount: context.recipient.corrAccount || undefined,
    paymentPurpose: context.paymentPurpose,
    executionOrder: 5,
    taxPayerStatus: "0",
    kbk: "0",
    oktmo: "0",
    taxEvidence: "0",
    taxPeriod: "0",
    uin: "0",
    taxDocNumber: "0",
    taxDocDate: "0",
  };
}

export async function createTBankDraft(invoiceId: string, input: TBankDraftInput, user: User) {
  const built = await buildDraftContext(invoiceId, input, user, { requireOwner: true });
  if (!built.ok) return { status: built.status, ...built.result };
  const context = built.context;
  const attemptNumber = context.invoice.tbankPayments.length + 1;
  const idempotencyKey = `tgm-supplier-invoice-${context.invoice.id}-${attemptNumber}`;
  const requestPayload = buildTBankDraftPayload(context, attemptNumber);
  const requestId = crypto.randomUUID();

  const localPayment = await prisma.supplierInvoiceTBankPayment.create({
    data: {
      organizationId: context.integration.organizationId,
      supplierInvoiceId: context.invoice.id,
      integrationId: context.integration.id,
      provider: "tbank",
      mode: "draft",
      tbankRequestId: requestId,
      idempotencyKey,
      attemptNumber,
      amountCents: context.amountCents,
      fromAccountNumberMasked: context.debitAccountMasked,
      recipientName: context.recipient.name,
      recipientInn: context.recipient.inn,
      recipientKpp: context.recipient.kpp,
      recipientAccount: context.recipient.account,
      recipientBik: context.recipient.bik,
      recipientCorrAccount: context.recipient.corrAccount || null,
      recipientBankName: context.recipient.bankName || null,
      paymentPurpose: context.paymentPurpose,
      status: "draft_creating",
      createdById: user.login,
      createdByName: user.name,
      requestPayloadEncrypted: encryptJson(requestPayload),
      raw: toJson({ warnings: context.warnings }),
    },
  });
  await auditTBank({
    organizationId: context.integration.organizationId,
    actorId: user.login,
    action: "create_draft_requested",
    message: `${user.name} создал запрос черновика оплаты счёта ${context.invoice.number || context.invoice.id} в T-Bank.`,
    metadata: { supplierInvoiceId: context.invoice.id, paymentId: localPayment.id, amountCents: context.amountCents },
  });

  try {
    const response = await callTBankJson(context.integration, "/api/v1/payment/create", {
      method: "POST",
      body: requestPayload,
    });
    const tbankDocumentId = extractDocumentId(response.body);
    const tbankPaymentId = extractPaymentId(response.body);
    const confirmationUrl = extractConfirmationUrl(response.body);
    const providerStatus = extractProviderStatus(response.body, {
      tbankDocumentId,
      tbankPaymentId,
    }) || "draft_created";
    const nextStatus = mapProviderStatus(providerStatus) === "processing" ? "waiting_confirmation" : mapProviderStatus(providerStatus);

    const updated = await prisma.$transaction(async (tx) => {
      const payment = await tx.supplierInvoiceTBankPayment.update({
        where: { id: localPayment.id },
        data: {
          status: nextStatus === "paid" ? "paid" : "waiting_confirmation",
          providerStatus,
          providerStatusRaw: toJson(response.body),
          tbankRequestId: response.requestId,
          tbankDocumentId: tbankDocumentId || null,
          tbankPaymentId: tbankPaymentId || null,
          confirmationUrl: confirmationUrl || null,
          responsePayloadEncrypted: encryptJson(response.body),
          sentAt: new Date(),
          confirmedAt: nextStatus === "confirmed" ? new Date() : null,
        },
      });
      await tx.localSupplierInvoice.update({
        where: { id: context.invoice.id },
        data: { status: "tbank_waiting_confirmation" },
      });
      await auditTBank({
        organizationId: context.integration.organizationId,
        actorId: user.login,
        action: "create_draft_succeeded",
        message: `${user.name} создал черновик оплаты счёта ${context.invoice.number || context.invoice.id} в T-Bank на ${rubFromCents(context.amountCents).toLocaleString("ru-RU")} руб.`,
        metadata: { supplierInvoiceId: context.invoice.id, paymentId: payment.id, tbankDocumentId, tbankPaymentId },
      }, tx);
      return payment;
    });
    invalidateWarehouseReadCaches();
    return {
      ok: true as const,
      payment: mapPayment(updated),
      action: confirmationUrl
        ? { type: "link", url: confirmationUrl, label: "Открыть в T-Business для подтверждения" }
        : { type: "instruction", label: "Откройте черновик в личном кабинете T-Business" },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "T-Bank не создал черновик платежа.";
    const raw = error instanceof TBankApiError ? error.raw : { message };
    const updated = await prisma.supplierInvoiceTBankPayment.update({
      where: { id: localPayment.id },
      data: {
        status: "payment_error",
        errorCode: error instanceof TBankApiError ? String(error.status) : "UNKNOWN",
        errorMessage: message,
        failedAt: new Date(),
        responsePayloadEncrypted: encryptJson(raw),
      },
    });
    await prisma.localSupplierInvoice.update({
      where: { id: context.invoice.id },
      data: { status: "payment_error" },
    });
    await auditTBank({
      organizationId: context.integration.organizationId,
      actorId: user.login,
      action: "create_draft_failed",
      status: "error",
      message,
      metadata: { supplierInvoiceId: context.invoice.id, paymentId: localPayment.id },
    });
    invalidateWarehouseReadCaches();
    return { ok: false as const, status: 502, errors: [message], warnings: context.warnings, payment: mapPayment(updated) };
  }
}

async function applyTBankStatus(paymentId: string, providerStatus: string, raw: unknown, actor?: User | null) {
  const payment = await prisma.supplierInvoiceTBankPayment.findUnique({
    where: { id: paymentId },
    include: { supplierInvoice: { include: supplierInvoiceInclude } },
  });
  if (!payment) return { ok: false as const, error: "Платёж T-Bank не найден", status: 404 };

  const nextStatus = mapProviderStatus(providerStatus);
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.supplierInvoiceTBankPayment.update({
      where: { id: payment.id },
      data: {
        status: nextStatus,
        providerStatus,
        providerStatusRaw: toJson(raw),
        ...(nextStatus === "confirmed" ? { confirmedAt: payment.confirmedAt ?? now } : {}),
        ...(nextStatus === "paid" ? { paidAt: payment.paidAt ?? now } : {}),
        ...(FINAL_ERROR_STATUSES.has(nextStatus) ? { failedAt: payment.failedAt ?? now } : {}),
        ...(nextStatus === "cancelled" ? { cancelledAt: payment.cancelledAt ?? now } : {}),
      },
    });

    if (nextStatus === "paid") {
      const existing = await tx.localSupplierInvoicePayment.findFirst({
        where: { externalCode: payment.id },
      });
      if (!existing) {
        await tx.localSupplierInvoicePayment.create({
          data: {
            invoiceId: payment.supplierInvoiceId,
            amountCents: payment.amountCents,
            paymentDate: toServiceDateInput(now),
            paymentType: "bank_transfer",
            comment: `T-Bank: ${payment.tbankDocumentId || payment.tbankPaymentId || payment.id}`,
            createdBy: actor?.login ?? payment.createdById,
            createdByName: actor?.name ?? payment.createdByName,
            raw: toJson({ provider: "tbank", providerStatus, paymentId: payment.id, raw }),
            source: "tbank",
            externalCode: payment.id,
          },
        });
      }
      const invoice = await tx.localSupplierInvoice.findUnique({
        where: { id: payment.supplierInvoiceId },
        select: { sumCents: true, paidAmountCents: true },
      });
      const nextPaid = Math.min(invoice?.sumCents ?? payment.amountCents, (invoice?.paidAmountCents ?? 0) + (existing ? 0 : payment.amountCents));
      await tx.localSupplierInvoice.update({
        where: { id: payment.supplierInvoiceId },
        data: { status: "paid", paidAmountCents: nextPaid },
      });
    } else {
      await tx.localSupplierInvoice.update({
        where: { id: payment.supplierInvoiceId },
        data: { status: invoiceStatusFromPaymentStatus(nextStatus) },
      });
    }

    await auditTBank({
      organizationId: payment.organizationId,
      actorId: actor?.login ?? null,
      action: "status_applied",
      message: `Статус платежа T-Bank обновлён: ${providerStatus || nextStatus}.`,
      metadata: { supplierInvoiceId: payment.supplierInvoiceId, paymentId: payment.id, providerStatus, nextStatus },
    }, tx);
    return updatedPayment;
  });
  invalidateWarehouseReadCaches();
  return { ok: true as const, payment: mapPayment(updated) };
}

export async function refreshTBankPaymentStatus(invoiceId: string, paymentId: string, user: User) {
  const accessError = ensureFinanceStatusAccess(user);
  if (accessError) return { ok: false as const, error: accessError, status: 403 };
  const payment = await prisma.supplierInvoiceTBankPayment.findFirst({
    where: { id: paymentId, supplierInvoiceId: invoiceId },
  });
  if (!payment) return { ok: false as const, error: "Платёж T-Bank не найден", status: 404 };
  if (!payment.tbankDocumentId && !payment.tbankPaymentId) {
    return { ok: false as const, error: "T-Bank не вернул идентификатор документа для проверки статуса", status: 400 };
  }
  const integration = await getIntegration(payment.organizationId);
  if (!integration) return { ok: false as const, error: "Настройки T-Bank не найдены", status: 400 };
  const body = payment.tbankDocumentId
    ? { documentIds: [payment.tbankDocumentId] }
    : { paymentIds: [payment.tbankPaymentId] };
  try {
    const response = await callTBankJson(integration, "/api/v1/payment/status", {
      method: "POST",
      body,
    });
    const providerStatus = extractProviderStatus(response.body, payment) || payment.providerStatus || "waiting_confirmation";
    const applied = await applyTBankStatus(payment.id, providerStatus, response.body, user);
    if (applied.ok) {
      await auditTBank({
        organizationId: payment.organizationId,
        actorId: user.login,
        action: "status_refreshed",
        message: `${user.name} обновил статус платежа T-Bank.`,
        metadata: { supplierInvoiceId: invoiceId, paymentId: payment.id, providerStatus },
      });
    }
    return applied;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обновить статус в T-Bank.";
    await auditTBank({
      organizationId: payment.organizationId,
      actorId: user.login,
      action: "status_refresh_failed",
      status: "error",
      message,
      metadata: { supplierInvoiceId: invoiceId, paymentId: payment.id },
    });
    return { ok: false as const, error: message, status: 502 };
  }
}

function accountNumberFromBankRecord(record: Record<string, unknown>) {
  return cleanDigits(record.accountNumber) || cleanDigits(record.account) || cleanDigits(record.number);
}

export async function testTBankIntegration(user: User) {
  const permissionError = ensureOwner(user);
  if (permissionError) return { ok: false as const, error: permissionError, status: 403 };
  const integration = await getIntegration();
  if (!integration) return { ok: false as const, error: "Сначала сохраните настройки T-Bank.", status: 400 };
  if (!integration.tokenEncrypted && !integration.sandbox) return { ok: false as const, error: "Укажите токен T-API.", status: 400 };
  try {
    const response = await callTBankJson(integration, "/api/v4/bank-accounts");
    const records = recordsFromUnknown(response.body);
    const accountRecords = records
      .map((record) => ({ record, accountNumber: accountNumberFromBankRecord(record) }))
      .filter((item) => item.accountNumber.length === 20);
    await prisma.$transaction(async (tx) => {
      for (const [index, item] of accountRecords.entries()) {
        const hash = hashSecret(item.accountNumber);
        await tx.tBankSettlementAccount.upsert({
          where: {
            integrationId_accountNumberHash: {
              integrationId: integration.id,
              accountNumberHash: hash,
            },
          },
          update: {
            accountNumberEncrypted: encryptText(item.accountNumber),
            accountNumberMasked: maskAccount(item.accountNumber),
            accountName: textField(item.record, ["name", "accountName", "title"]) || "Расчётный счёт",
            bankName: textField(item.record, ["bankName", "bank"]),
            currency: textField(item.record, ["currency"]) || "RUB",
            isDefault: index === 0,
            isActive: true,
            providerAccountId: textField(item.record, ["id", "accountId"]),
            raw: toJson(item.record),
          },
          create: {
            organizationId: integration.organizationId,
            integrationId: integration.id,
            accountNumberEncrypted: encryptText(item.accountNumber),
            accountNumberMasked: maskAccount(item.accountNumber),
            accountNumberHash: hash,
            accountName: textField(item.record, ["name", "accountName", "title"]) || "Расчётный счёт",
            bankName: textField(item.record, ["bankName", "bank"]),
            currency: textField(item.record, ["currency"]) || "RUB",
            isDefault: index === 0,
            isActive: true,
            providerAccountId: textField(item.record, ["id", "accountId"]),
            raw: toJson(item.record),
          },
        });
      }
      await tx.tBankIntegration.update({
        where: { id: integration.id },
        data: {
          lastCheckedAt: new Date(),
          lastCheckStatus: "success",
          lastCheckMessage: accountRecords.length > 0
            ? `Подключение проверено. Найдено счетов: ${accountRecords.length}.`
            : "Подключение проверено, но расчётные счета в ответе не найдены.",
        },
      });
    });
    await auditTBank({
      organizationId: integration.organizationId,
      actorId: user.login,
      action: "connection_tested",
      message: "Подключение T-Bank проверено.",
      metadata: { accountsFound: accountRecords.length },
    });
    return { ok: true as const, message: "Подключение T-Bank проверено.", integration: await getTBankIntegrationStatus() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось проверить подключение T-Bank.";
    await prisma.tBankIntegration.update({
      where: { id: integration.id },
      data: { lastCheckedAt: new Date(), lastCheckStatus: "error", lastCheckMessage: message },
    });
    await auditTBank({
      organizationId: integration.organizationId,
      actorId: user.login,
      action: "connection_test_failed",
      status: "error",
      message,
    });
    return { ok: false as const, error: message, status: 502, integration: await getTBankIntegrationStatus() };
  }
}

function webhookEventId(payload: unknown) {
  const record = asRecord(payload);
  return textField(record, ["eventId", "eventID", "id", "messageId"]);
}

function webhookDocumentId(payload: unknown) {
  return extractDocumentId(payload) || textField(asRecord(payload), ["documentId", "documentID", "docId"]);
}

function webhookPaymentId(payload: unknown) {
  return extractPaymentId(payload) || textField(asRecord(payload), ["paymentId", "paymentID"]);
}

function headersToJson(headers: Headers) {
  const rows: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!/authorization|token|cookie/i.test(key)) rows[key] = value;
  });
  return rows;
}

function secureEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function processTBankPaymentWebhook(input: {
  payload: unknown;
  headers: Headers;
  sourceIp?: string | null;
}) {
  const integration = await getIntegration();
  if (!integration) return { ok: true as const, matched: false, message: "T-Bank integration is not configured" };
  if (integration.webhookSecretEncrypted) {
    const expected = decryptText(integration.webhookSecretEncrypted);
    const provided = input.headers.get("x-tbank-webhook-secret") || input.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (!secureEqual(expected, provided)) {
      await auditTBank({ organizationId: integration.organizationId, action: "webhook_rejected", status: "error", message: "Webhook secret mismatch" });
      return { ok: false as const, status: 401, error: "Webhook secret mismatch" };
    }
  }
  const sourceIp = input.sourceIp?.split(",")[0]?.trim() || "";
  if (process.env.TBANK_WEBHOOK_IP_ALLOWLIST === "1" && sourceIp && !TBANK_WEBHOOK_IPS.has(sourceIp)) {
    await auditTBank({ organizationId: integration.organizationId, action: "webhook_rejected", status: "error", message: "Webhook IP is not allowed", metadata: { sourceIp } });
    return { ok: false as const, status: 403, error: "Webhook IP is not allowed" };
  }

  const eventId = webhookEventId(input.payload) || null;
  const tbankDocumentId = webhookDocumentId(input.payload) || null;
  const tbankPaymentId = webhookPaymentId(input.payload) || null;
  const providerStatus = extractProviderStatus(input.payload, { tbankDocumentId, tbankPaymentId }) || textField(asRecord(input.payload), ["status", "state"]);
  const payment = tbankDocumentId || tbankPaymentId
    ? await prisma.supplierInvoiceTBankPayment.findFirst({
        where: {
          OR: [
            ...(tbankDocumentId ? [{ tbankDocumentId }] : []),
            ...(tbankPaymentId ? [{ tbankPaymentId }] : []),
          ],
        },
      })
    : null;

  try {
    await prisma.tBankWebhookEvent.create({
      data: {
        organizationId: integration.organizationId,
        eventId,
        supplierInvoiceTBankPaymentId: payment?.id ?? null,
        tbankDocumentId,
        tbankPaymentId,
        providerStatus,
        payload: toJson(input.payload),
        receivedHeaders: toJson(headersToJson(input.headers)),
        sourceIp: sourceIp || null,
        processedAt: payment ? new Date() : null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: true as const, duplicate: true, matched: Boolean(payment) };
    }
    throw error;
  }

  if (!payment) {
    await auditTBank({
      organizationId: integration.organizationId,
      action: "webhook_unmatched",
      status: "warning",
      message: "T-Bank прислал статус, но платёж не найден.",
      metadata: { eventId, tbankDocumentId, tbankPaymentId, providerStatus },
    });
    return { ok: true as const, matched: false };
  }
  const applied = await applyTBankStatus(payment.id, providerStatus || "waiting_confirmation", input.payload, null);
  return { ...applied, matched: true };
}

export async function listTBankPayments(invoiceId: string, user: User) {
  const accessError = ensureFinanceStatusAccess(user);
  if (accessError) return { ok: false as const, status: 403, error: accessError };
  const payments = await prisma.supplierInvoiceTBankPayment.findMany({
    where: { supplierInvoiceId: invoiceId },
    orderBy: [{ createdAt: "desc" }],
  });
  return { ok: true as const, payments: payments.map(mapPayment) };
}

export async function markSupplierInvoicePaidManually(invoiceId: string, user: User, input: { paymentDate?: string; comment?: string }) {
  const permissionError = ensureOwner(user);
  if (permissionError) return { ok: false as const, status: 403, error: permissionError };
  const invoice = await prisma.localSupplierInvoice.findUnique({
    where: { id: invoiceId },
    include: supplierInvoiceInclude,
  });
  if (!invoice) return { ok: false as const, status: 404, error: "Счёт поставщика не найден" };
  const paidCents = Math.min(invoice.sumCents, Math.max(0, invoice.paidAmountCents));
  const remainingCents = Math.max(0, invoice.sumCents - paidCents);
  if (remainingCents <= 0) return { ok: false as const, status: 400, error: "Счёт уже оплачен" };
  const paymentDate = /^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate ?? "") ? input.paymentDate! : toServiceDateInput(new Date());
  const updated = await prisma.$transaction(async (tx) => {
    await tx.localSupplierInvoicePayment.create({
      data: {
        invoiceId: invoice.id,
        amountCents: remainingCents,
        paymentDate,
        paymentType: "bank_transfer",
        comment: cleanText(input.comment) || "Отмечено оплаченным вручную",
        createdBy: user.login,
        createdByName: user.name,
        raw: toJson({ source: "manual_paid" }),
        source: "manual",
      },
    });
    await auditTBank({
      organizationId: DEFAULT_ORGANIZATION_ID,
      actorId: user.login,
      action: "mark_paid_manually",
      message: `${user.name} отметил счёт ${invoice.number || invoice.id} оплаченным вручную.`,
      metadata: { supplierInvoiceId: invoice.id, amountCents: remainingCents },
    }, tx);
    return tx.localSupplierInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "paid_manually",
        paidAmountCents: invoice.sumCents,
      },
      include: supplierInvoiceInclude,
    });
  });
  invalidateWarehouseReadCaches();
  return { ok: true as const, invoice: mapSupplierInvoice(updated) };
}
