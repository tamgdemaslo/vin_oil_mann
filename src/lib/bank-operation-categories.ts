import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { User } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { getMessengerOrganizationId } from "@/lib/messenger/messenger-tenant";
import { BANK_CATEGORY_KINDS, DEFAULT_BANK_CATEGORIES, automaticBankCategory, bankCategoryNameKey, bankExpenseMerchantKey, type BankCategory, type BankCategoryKind, type BankExpenseMatch } from "@/lib/bank-operation-category-domain";

type CategoryRow = { id: string; code: string; name: string; kind: string; archived: boolean };
const mapCategory = (row: CategoryRow): BankCategory => ({ id: row.id, code: row.code, name: row.name, kind: row.kind as BankCategoryKind, archived: row.archived });
const categorySelect = { id: true, code: true, name: true, kind: true, archived: true } as const;
export class BankCategoryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function requireCategoryAccess(user: User) {
  if (user.role !== "owner" && user.role !== "admin") throw new BankCategoryError("Недостаточно прав для работы с категориями банковских операций.", 403);
}
function defaults(branchId: string): BankCategory[] {
  return DEFAULT_BANK_CATEGORIES.map(category => ({ ...category, id: `bankcat_${crypto.createHash("sha256").update(`${branchId}:${category.code}`).digest("hex").slice(0, 24)}`, archived: false }));
}
// Default categories are virtual until first edited or assigned: reads never seed the database.
export async function listBankOperationCategories(): Promise<BankCategory[]> {
  const branchId = getScopedBranchId();
  const stored = await prisma.bankOperationCategory.findMany({ where: { branchId }, select: categorySelect, orderBy: { name: "asc" } });
  const result = new Map(defaults(branchId).map(category => [category.id, category]));
  for (const row of stored) result.set(row.id, mapCategory(row));
  return [...result.values()];
}
export async function bankOperationCategoryData(
  accountNumberHash: string,
  operations: (BankExpenseMatch & { id: string })[],
) {
  const branchId = getScopedBranchId();
  const [categories, rules] = await Promise.all([
    listBankOperationCategories(),
    prisma.bankOperationCategoryRule.findMany({ where: { branchId }, select: { merchantKey: true, categoryId: true } }),
  ]);
  const saved = new Map<string, { categoryId: string | null; hiddenFromReview: boolean }>();
  const ids = [...new Set(operations.map(operation => operation.id).filter(Boolean))];
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const rows = await prisma.bankOperationClassification.findMany({
      where: { branchId, accountNumberHash, operationId: { in: ids.slice(offset, offset + 1000) } },
      select: { operationId: true, categoryId: true, hiddenFromReview: true },
    });
    for (const row of rows) saved.set(row.operationId, row);
  }
  const rulesByMerchant = new Map(rules.map(rule => [rule.merchantKey, rule.categoryId]));
  const assignments = new Map(operations.map(operation => {
    const merchantKey = bankExpenseMerchantKey(operation);
    const ruleCategoryId = merchantKey ? rulesByMerchant.get(merchantKey) : undefined;
    const manual = saved.get(operation.id);
    const auto = operation.id && !manual ? automaticBankCategory(operation, categories, ruleCategoryId) : undefined;
    return [operation.id, {
      categoryId: manual ? manual.categoryId : auto?.id ?? null,
      hiddenFromReview: manual?.hiddenFromReview ?? false,
      categorySource: manual ? "manual" : auto ? "automatic" : null,
      canRemember: Boolean(merchantKey),
      hasRule: Boolean(ruleCategoryId),
    }] as const;
  }));
  return { categories, assignments };
}

async function categoryAudit(tx: Prisma.TransactionClient, user: User, action: string, metadata: Prisma.InputJsonValue) {
  await tx.integrationAuditLog.create({ data: {
    id: crypto.randomUUID(), branchId: getScopedBranchId(), organizationId: getMessengerOrganizationId(),
    channel: "tbank", actorId: user.login, action, status: "ok", metadataJson: metadata,
  } });
}
export async function saveBankOperationCategory(input: unknown, user: User, editing: boolean) {
  requireCategoryAccess(user);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BankCategoryError("Неверные данные категории.");
  const body = input as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.normalize("NFKC").replace(/\s+/gu, " ").trim() : "";
  if (name.length < 2 || name.length > 80 || /[\u0000-\u001f\u007f]/u.test(name)) throw new BankCategoryError("Название категории должно содержать от 2 до 80 символов.");
  if (!BANK_CATEGORY_KINDS.some(kind => kind.value === body.kind)) throw new BankCategoryError("Выберите вид категории.");
  const kind = body.kind as BankCategoryKind;
  const branchId = getScopedBranchId();
  const categories = await listBankOperationCategories();
  const existing = editing && typeof body.id === "string" ? categories.find(category => category.id === body.id) : undefined;
  if (editing && !existing) throw new BankCategoryError("Категория не найдена в выбранном филиале.", 404);
  const nameKey = bankCategoryNameKey(name);
  if (categories.some(category => category.id !== existing?.id && bankCategoryNameKey(category.name) === nameKey)) throw new BankCategoryError("Категория с таким названием уже есть. Выберите её в списке.", 409);
  if (body.archived !== undefined && typeof body.archived !== "boolean") throw new BankCategoryError("Неверный статус категории.");
  const archived = typeof body.archived === "boolean" ? body.archived : existing?.archived ?? false;
  const id = existing?.id ?? crypto.randomUUID();
  const code = existing?.code ?? `custom_${id}`;
  try {
    await prisma.$transaction(async tx => {
      await tx.bankOperationCategory.upsert({
        where: { branchId_id: { branchId, id } },
        create: { id, branchId, code, name, nameKey, kind, archived, createdById: user.login, updatedById: user.login },
        update: { name, nameKey, kind, archived, updatedById: user.login },
      });
      await categoryAudit(tx, user, existing ? "bank_category_updated" : "bank_category_created", { categoryId: id, name, kind, archived });
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new BankCategoryError("Категория с таким названием уже есть.", 409);
    throw error;
  }
  return { categories: await listBankOperationCategories(), categoryId: id };
}
export async function assignBankOperationCategory(input: unknown, user: User) {
  requireCategoryAccess(user);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BankCategoryError("Неверные данные банковской операции.");
  const body = input as Record<string, unknown>;
  if (typeof body.accountId !== "string" || !body.accountId || body.accountId.length > 128) throw new BankCategoryError("Выберите счёт.");
  if (typeof body.operationId !== "string" || !body.operationId.trim() || body.operationId.length > 180 || /[\u0000-\u001f\u007f]/u.test(body.operationId)) throw new BankCategoryError("Не указан идентификатор банковской операции.");
  if (body.categoryId !== null && (typeof body.categoryId !== "string" || !body.categoryId || body.categoryId.length > 128)) throw new BankCategoryError("Выберите категорию или «Без категории».");
  if (body.hiddenFromReview !== undefined && typeof body.hiddenFromReview !== "boolean") throw new BankCategoryError("Неверное состояние операции.");
  const hiddenFromReview = body.hiddenFromReview === true;
  if (hiddenFromReview && body.categoryId !== null) throw new BankCategoryError("Скрыть можно операцию без категории.");
  if (body.rule !== undefined && body.rule !== "remember" && body.rule !== "forget") throw new BankCategoryError("Неизвестное действие с правилом.");
  let merchantKey: string | null = null;
  if (body.rule) {
    if (typeof body.counterparty !== "string" || typeof body.inn !== "string" || body.inn.length > 24 || body.counterparty.length > 200) {
      throw new BankCategoryError("Для правила нужен получатель.");
    }
    merchantKey = bankExpenseMerchantKey({ direction: "expense", counterparty: body.counterparty, inn: body.inn, purpose: "" });
    if (!merchantKey || (body.rule === "remember" && !body.categoryId)) throw new BankCategoryError("Выберите категорию и получателя для правила.");
  }
  const branchId = getScopedBranchId();
  const account = await prisma.tBankSettlementAccount.findFirst({
    where: { id: body.accountId, branchId, isActive: true, integration: { branchId, organizationId: getMessengerOrganizationId() } },
    select: { accountNumberHash: true },
  });
  if (!account) throw new BankCategoryError("Счёт не найден в выбранном филиале.", 404);
  if (!account.accountNumberHash || !/^[a-f0-9]{64}$/.test(account.accountNumberHash)) throw new BankCategoryError("Обновите настройки счёта перед назначением категории.", 409);
  const selected = body.categoryId === null ? null : (await listBankOperationCategories()).find(category => category.id === body.categoryId);
  if (body.categoryId !== null && (!selected || selected.archived)) throw new BankCategoryError("Категория недоступна в выбранном филиале.", 404);
  const accountNumberHash = account.accountNumberHash;
  const operationId = body.operationId.trim();
  const categoryId = selected?.id ?? null;
  await prisma.$transaction(async tx => {
    if (merchantKey && body.rule === "forget") {
      await tx.bankOperationCategoryRule.deleteMany({ where: { branchId, merchantKey } });
      await categoryAudit(tx, user, "bank_category_rule_removed", { merchantKey });
      return;
    }
    if (selected) {
      const category = await tx.bankOperationCategory.upsert({
        where: { branchId_id: { branchId, id: selected.id } },
        create: { id: selected.id, branchId, code: selected.code, name: selected.name, nameKey: bankCategoryNameKey(selected.name), kind: selected.kind, createdById: user.login, updatedById: user.login },
        update: {}, select: { archived: true },
      });
      if (category.archived) throw new BankCategoryError("Категория находится в архиве.", 409);
    }
    const where = { branchId_accountNumberHash_operationId: { branchId, accountNumberHash, operationId } };
    const before = await tx.bankOperationClassification.findUnique({ where, select: { categoryId: true } });
    await tx.bankOperationClassification.upsert({
      where,
      create: { branchId, accountNumberHash, operationId, categoryId, hiddenFromReview, createdById: user.login, updatedById: user.login },
      update: { categoryId, hiddenFromReview, updatedById: user.login },
    });
    await categoryAudit(tx, user, "bank_operation_categorized", { accountNumberHash, operationId, previousCategoryId: before?.categoryId ?? null, categoryId, hiddenFromReview });
    if (merchantKey && categoryId && body.rule === "remember") {
      await tx.bankOperationCategoryRule.upsert({
        where: { branchId_merchantKey: { branchId, merchantKey } },
        create: { branchId, merchantKey, categoryId },
        update: { categoryId },
      });
      await categoryAudit(tx, user, "bank_category_rule_saved", { merchantKey, categoryId });
    }
  });
  return { categoryId, hiddenFromReview };
}
