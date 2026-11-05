import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { lockOpenCashShift } from "@/lib/cash-available";
import { prisma } from "@/lib/db";
import { getTBankStatement } from "@/lib/tbank";

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const { user, branchId } = access.context;
  if (!branchId || !["owner", "admin"].includes(user.role)) {
    return NextResponse.json({ error: "Недостаточно прав для внесения в кассу." }, { status: 403 });
  }
  const input = await request.json().catch(() => null);
  const { accountId, operationId, bankDate } = input ?? {};
  if (typeof accountId !== "string" || typeof operationId !== "string" || !operationId || operationId.length > 180 ||
      typeof bankDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(bankDate)) {
    return NextResponse.json({ error: "Укажите банковскую операцию." }, { status: 400 });
  }

  return runWithBranchApiContext(access.context, async () => {
    try {
      const account = await prisma.tBankSettlementAccount.findFirst({
        where: { id: accountId, branchId, isActive: true },
        select: { integrationId: true, accountNumberHash: true },
      });
      if (!account?.accountNumberHash) return NextResponse.json({ error: "Банковский счёт не найден." }, { status: 404 });
      const identity = { branchId, accountNumberHash: account.accountNumberHash, operationId };
      const where = { branchId_accountNumberHash_operationId: identity };
      const existing = await prisma.bankCashTransfer.findUnique({ where, select: { cashDate: true } });
      if (existing) return NextResponse.json(existing);
      const statement = await getTBankStatement({ dateFrom: bankDate, dateTo: bankDate, accountId, connectionId: account.integrationId }, user);
      if (!statement.ok) return NextResponse.json({ error: statement.error }, { status: statement.status });
      const matching = statement.statement.operations.filter(row => row.id === operationId);
      const operation = matching[0];
      if (matching.length !== 1 || operation.direction !== "expense" || operation.amountCents <= 0 ||
          !["RUB", "643", "810"].includes(statement.statement.currency)) {
        return NextResponse.json({ error: "Выберите рублёвое списание из выписки." }, { status: 422 });
      }
      const shifts = await prisma.cashShift.findMany({ where: { branchId, status: "open" }, select: { id: true }, take: 2 });
      if (shifts.length !== 1) return NextResponse.json({ error: "Для внесения нужна одна открытая кассовая смена филиала." }, { status: 409 });
      const deposit = await prisma.$transaction(async tx => {
        const shift = await lockOpenCashShift(tx, branchId, shifts[0].id);
        if (shift.serviceDate < bankDate) throw new Error("Дата внесения раньше банковской операции.");
        return tx.bankCashTransfer.upsert({
          where,
          create: { ...identity, shiftId: shift.id, bankDate, cashDate: shift.serviceDate, amountCents: operation.amountCents, createdBy: user.login },
          update: {},
          select: { cashDate: true },
        });
      });
      return NextResponse.json(deposit);
    } catch (error) {
      console.error("[bank-cash-transfer]", error instanceof Error ? error.name : "unknown");
      return NextResponse.json({ error: "Не удалось внести наличные. Проверьте открытую смену и привязку операции." }, { status: 409 });
    }
  });
}
