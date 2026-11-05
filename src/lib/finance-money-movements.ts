import type { User } from "@/lib/auth";
import { bankCategoryNameKey } from "@/lib/bank-operation-category-domain";
import { cashReceipts } from "@/lib/cash-available";
import { prisma } from "@/lib/db";
import { getMessengerOrganizationId } from "@/lib/messenger/messenger-tenant";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { getTBankStatement } from "@/lib/tbank";

export async function readFinanceMoneyMovements(dateFrom: string, dateTo: string, user: User, seenAccounts: Set<string>) {
  const branchId = getScopedBranchId();
  const range = { gte: dateFrom, lte: dateTo };
  const [orders, shifts, deposits, accounts, withdrawals] = await Promise.all([
    prisma.cashExpenseOrder.findMany({ where: { branchId, expenseDate: range, status: "posted", paymentType: "cash" }, select: { amountCents: true, expenseItemName: true } }),
    prisma.cashShift.findMany({ where: { branchId, serviceDate: range }, select: { id: true, status: true, cashOrdersTotalCents: true, openedAt: true, timezone: true, aqsiRegisterId: true } }),
    prisma.bankCashTransfer.aggregate({ where: { branchId, cashDate: range }, _sum: { amountCents: true } }),
    prisma.tBankSettlementAccount.findMany({
      where: { branchId, isActive: true, integration: { branchId, organizationId: getMessengerOrganizationId(), tokenEncrypted: { not: null } } },
      select: { id: true, integrationId: true, accountNumberHash: true },
    }),
    prisma.cashWithdrawal.aggregate({ where: { branchId, shift: { serviceDate: range } }, _sum: { amountCents: true } }),
  ]);
  const categories = new Map<string, { name: string; cashIn: number; cashOut: number; bankIn: number; bankOut: number }>();
  function add(name: string, column: "cashIn" | "cashOut" | "bankIn" | "bankOut", amount: number) {
    const key = bankCategoryNameKey(name);
    const row = categories.get(key) ?? { name, cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0 };
    row[column] += amount;
    categories.set(key, row);
  }
  for (const order of orders) {
    const name = order.expenseItemName === "Оплата поставщику" ? "Закупка товаров и материалов" : order.expenseItemName;
    add(name || "Без категории", "cashOut", order.amountCents);
  }
  let cashIncomplete = false;
  for (const shift of shifts) {
    const receipts = shift.status === "open" ? await cashReceipts(shift, new Date()).catch(() => null) : shift.cashOrdersTotalCents;
    if (receipts == null) cashIncomplete = true;
    else if (receipts >= 0) add("Продажи и оплата от клиентов", "cashIn", receipts);
    else add("Возвраты", "cashOut", -receipts);
  }
  let bankIncomplete = accounts.length === 0;
  let matchedBankOut = 0;
  let transferBankIn = 0;
  let transferBankOut = 0;
  let unlinkedTransferOut = 0;
  for (const account of accounts) {
    if (!account.accountNumberHash) { bankIncomplete = true; continue; }
    if (seenAccounts.has(account.accountNumberHash)) { bankIncomplete = true; continue; }
    const result = await getTBankStatement({ dateFrom, dateTo, accountId: account.id, connectionId: account.integrationId }, user).catch(() => null);
    if (!result?.ok || !["RUB", "643", "810"].includes(result.statement.currency)) { bankIncomplete = true; continue; }
    seenAccounts.add(account.accountNumberHash);
    const catalog = new Map(result.statement.categories.map(category => [category.id, category]));
    for (const operation of result.statement.operations) {
      const category = operation.categoryId ? catalog.get(operation.categoryId) : undefined;
      if (operation.cashTransferDate) {
        matchedBankOut += operation.amountCents;
      } else if (operation.direction === "internal") {
        transferBankIn += operation.amountCents;
        transferBankOut += operation.amountCents;
      } else if (category?.kind === "transfer") {
        if (operation.direction === "income") transferBankIn += operation.amountCents;
        else if (category.code === "cash_withdrawal") unlinkedTransferOut += operation.amountCents;
        else transferBankOut += operation.amountCents;
      } else {
        add(category?.name ?? "Без категории", operation.direction === "income" ? "bankIn" : "bankOut", operation.amountCents);
      }
    }
  }
  return {
    categories: [...categories.values()].sort((a, b) => b.cashOut + b.bankOut - a.cashOut - a.bankOut || a.name.localeCompare(b.name, "ru")),
    cashIncomplete, bankIncomplete, matchedBankOut, transferBankIn, transferBankOut, unlinkedTransferOut,
    depositedCash: deposits._sum.amountCents ?? 0,
    unlinkedCashOut: withdrawals._sum.amountCents ?? 0,
  };
}

export type FinanceMoneyMovements = Awaited<ReturnType<typeof readFinanceMoneyMovements>>;
