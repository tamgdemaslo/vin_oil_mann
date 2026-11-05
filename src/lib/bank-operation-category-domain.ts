export type BankCategoryKind = "operating" | "transfer" | "owner";
export type BankCategory = { id: string; code: string; name: string; kind: BankCategoryKind; archived: boolean };
export type CategorizedBankOperation = { id: string; direction: string; amountCents: number; categoryId: string | null };
export const BANK_CATEGORY_KINDS: Array<{ value: BankCategoryKind; label: string }> = [
  { value: "operating", label: "Расходы и поступления бизнеса" },
  { value: "transfer", label: "Переводы между своими счетами" },
  { value: "owner", label: "Личные средства собственника" },
];
export const DEFAULT_BANK_CATEGORIES: Array<{ code: string; name: string; kind: BankCategoryKind }> = [
  { code: "sales", name: "Продажи и оплата от клиентов", kind: "operating" },
  { code: "acquiring_income", name: "Поступления эквайринга", kind: "operating" },
  { code: "purchases", name: "Закупка товаров и материалов", kind: "operating" },
  { code: "rent", name: "Аренда", kind: "operating" },
  { code: "payroll", name: "Зарплата", kind: "operating" },
  { code: "taxes", name: "Налоги и взносы", kind: "operating" },
  { code: "bank_fees", name: "Комиссии и обслуживание банка", kind: "operating" },
  { code: "acquiring_fees", name: "Комиссии эквайринга", kind: "operating" },
  { code: "marketing", name: "Реклама", kind: "operating" },
  { code: "transport", name: "Транспорт и доставка", kind: "operating" },
  { code: "utilities", name: "Связь, коммунальные и хозяйственные расходы", kind: "operating" },
  { code: "services", name: "Услуги и подписки", kind: "operating" },
  { code: "refunds", name: "Возвраты", kind: "operating" },
  { code: "other", name: "Прочие расходы и поступления", kind: "operating" },
  { code: "own_transfer", name: "Перевод между своими счетами", kind: "transfer" },
  { code: "owner_withdrawal", name: "Вывод собственных средств", kind: "owner" },
  { code: "owner_contribution", name: "Взнос собственных средств", kind: "owner" },
];
export function bankCategoryNameKey(name: string) {
  return name.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ru-RU");
}
export function summarizeBankCategories(operations: CategorizedBankOperation[], categories: BankCategory[]) {
  const catalog = new Map(categories.map(category => [category.id, category]));
  const result = new Map<string, { categoryId: string | null; name: string; kind: BankCategoryKind | "uncategorized"; archived: boolean; count: number; incomeCents: number; expenseCents: number }>();
  for (const operation of operations) {
    if (!Number.isSafeInteger(operation.amountCents) || operation.amountCents < 0) throw new Error("Некорректная сумма банковской операции");
    if (!["income", "expense", "internal"].includes(operation.direction)) throw new Error("Неизвестное направление банковской операции");
    const category = operation.categoryId ? catalog.get(operation.categoryId) : undefined;
    const key = category?.id ?? "uncategorized";
    const row = result.get(key) ?? { categoryId: category?.id ?? null, name: category?.name ?? "Без категории", kind: category?.kind ?? "uncategorized", archived: category?.archived ?? false, count: 0, incomeCents: 0, expenseCents: 0 };
    row.count += 1;
    if (operation.direction !== "expense") row.incomeCents += operation.amountCents;
    if (operation.direction !== "income") row.expenseCents += operation.amountCents;
    if (!Number.isSafeInteger(row.incomeCents) || !Number.isSafeInteger(row.expenseCents)) throw new Error("Сумма банковских операций слишком велика");
    result.set(key, row);
  }
  return [...result.values()].sort((a, b) => (b.expenseCents - a.expenseCents) || (b.incomeCents - a.incomeCents) || a.name.localeCompare(b.name, "ru"));
}

export type BankExpenseMatch = {
  direction: string;
  counterparty: string;
  inn: string;
  purpose: string;
};

export function bankExpenseMerchantKey(operation: BankExpenseMatch) {
  if (operation.direction !== "expense") return null;
  const name = bankCategoryNameKey(operation.counterparty);
  const inn = operation.inn.replace(/\D/g, "");
  if (name.length < 3 || name.length > 200 || !/\p{L}/u.test(name)) return null;
  if (![10, 12].includes(inn.length) && /^(?:перевод|плат[её]ж|оплата|получатель|банк|сбп|физическое лицо)(?:\s|$)/iu.test(name)) return null;
  return JSON.stringify([name, [10, 12].includes(inn.length) ? inn : ""]);
}

export function automaticBankCategory(
  operation: BankExpenseMatch,
  categories: BankCategory[],
  ruleCategoryId?: string,
) {
  if (operation.direction !== "expense") return undefined;
  const rule = categories.find(category => category.id === ruleCategoryId && !category.archived);
  if (rule) return rule;
  const description = bankCategoryNameKey(operation.counterparty + " " + operation.purpose);
  if (/(?:возврат|refund|сторно)/iu.test(description)) return undefined;
  if (/(?:^|[^\p{L}\p{N}])(?:авито|avito)(?=$|[^\p{L}\p{N}])/iu.test(description)) {
    return categories.find(category => category.code === "marketing" && !category.archived);
  }
}

export function needsBankExpenseReview(operation: CategorizedBankOperation & { hiddenFromReview?: boolean }) {
  return operation.direction === "expense" && Boolean(operation.id) && !operation.categoryId && !operation.hiddenFromReview;
}
