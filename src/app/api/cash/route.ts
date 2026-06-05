import { NextRequest, NextResponse } from "next/server";
import {
  addExpense,
  addWithdrawal,
  cancelExpense,
  closeShift,
  getCurrentShift,
  listOperationsForShift,
  listShifts,
  openShift,
  postExpense,
  requireSessionUser,
  updateExpenseDraft,
} from "@/lib/cashbox";

export const dynamic = "force-dynamic";

function statusFromCashError(message: string): number {
  const normalized = message.toLowerCase();
  if (normalized.includes("требуется авторизация")) return 401;
  if (normalized.includes("доступ")) return 403;
  if (
    normalized.includes("не указан") ||
    normalized.includes("укажите") ||
    normalized.includes("выберите") ||
    normalized.includes("долж") ||
    normalized.includes("можно только") ||
    normalized.includes("нельзя") ||
    normalized.includes("не найдена") ||
    normalized.includes("уже открыта") ||
    normalized.includes("уже была открыта")
  ) {
    return 400;
  }
  return 500;
}

export async function GET(request: NextRequest) {
  try {
    // Требуется любая авторизация; фильтрация по ролям уже в lib, где нужно
    await requireSessionUser();

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") ?? "current";

    if (mode === "history") {
      const shifts = await listShifts(100);
      return NextResponse.json({ shifts });
    }

    if (mode === "shift") {
      const shiftId = searchParams.get("shiftId")?.trim();
      if (!shiftId) {
        return NextResponse.json(
          { error: "Не указан shiftId" },
          { status: 400 }
        );
      }
      const shifts = await listShifts(100);
      const shift = shifts.find((s) => s.id === shiftId);
      if (!shift) {
        return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });
      }
      const operations = await listOperationsForShift(shift.id);
      return NextResponse.json({ shift, operations });
    }

    const shift = await getCurrentShift();
    if (!shift) {
      return NextResponse.json({ shift: null, operations: [] });
    }
    const operations = await listOperationsForShift(shift.id);
    return NextResponse.json({ shift, operations });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка сервера";
    return NextResponse.json({ error: msg }, { status: statusFromCashError(msg) });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = String(body.action || "").trim();

    switch (action) {
      case "openShift": {
        const openingCash = Number(body.openingCash ?? 0);
        const shift = await openShift(openingCash);
        const operations = [] as unknown[];
        return NextResponse.json({ shift, operations });
      }
      case "addWithdrawal": {
        const shiftId = String(body.shiftId || "");
        const amount = Number(body.amount ?? 0);
        const reason = String(body.reason || "").trim();
        const comment = typeof body.comment === "string" ? body.comment : undefined;
        if (!shiftId) {
          return NextResponse.json({ error: "Не указан shiftId" }, { status: 400 });
        }
        if (!reason) {
          return NextResponse.json({ error: "Укажите причину изъятия" }, { status: 400 });
        }
        const op = await addWithdrawal({ shiftId, amount, reason, comment });
        return NextResponse.json({ operation: op });
      }
      case "addExpense": {
        const shiftId = String(body.shiftId || "");
        const amount = Number(body.amount ?? 0);
        const expenseItemId =
          typeof body.expenseItemId === "string" ? body.expenseItemId.trim() : undefined;
        const expenseItemName = String(body.expenseItemName || "").trim();
        const expenseItemMetaHref =
          typeof body.expenseItemMetaHref === "string" ? body.expenseItemMetaHref : undefined;
        const counterpartyId =
          typeof body.counterpartyId === "string" ? body.counterpartyId.trim() : undefined;
        const counterpartyName = String(body.counterpartyName || "").trim();
        const counterpartyMetaHref =
          typeof body.counterpartyMetaHref === "string" ? body.counterpartyMetaHref : undefined;
        const article = String(body.article || "").trim() || expenseItemName;
        const expenseDate =
          typeof body.expenseDate === "string" ? body.expenseDate.trim() : undefined;
        const paymentType = body.paymentType === "card" ? "card" : "cash";
        const comment = typeof body.comment === "string" ? body.comment : undefined;
        const attachmentUrl =
          typeof body.attachmentUrl === "string" ? body.attachmentUrl : undefined;
        const moyskladCashoutHref =
          typeof body.moyskladCashoutHref === "string"
            ? body.moyskladCashoutHref
            : undefined;
        const status = body.status === "draft" ? "draft" : "posted";
        if (!shiftId) {
          return NextResponse.json({ error: "Не указан shiftId" }, { status: 400 });
        }
        if (!expenseDate) {
          return NextResponse.json({ error: "Укажите дату расходного ордера" }, { status: 400 });
        }
        if (!expenseItemName) {
          return NextResponse.json({ error: "Выберите статью расхода из списка" }, { status: 400 });
        }
        if (!counterpartyName) {
          return NextResponse.json({ error: "Выберите контрагента" }, { status: 400 });
        }
        const op = await addExpense({
          shiftId,
          amount,
          article,
          expenseDate,
          expenseItemId,
          counterpartyId,
          counterpartyName,
          counterpartyMetaHref,
          expenseItemName,
          expenseItemMetaHref,
          paymentType,
          status,
          comment,
          attachmentUrl,
          moyskladCashoutHref,
        });
        return NextResponse.json({ operation: op });
      }
      case "updateExpense": {
        const id = String(body.id || "").trim();
        if (!id) {
          return NextResponse.json({ error: "Не указан id расходного ордера" }, { status: 400 });
        }
        const op = await updateExpenseDraft({
          id,
          amount: body.amount == null ? undefined : Number(body.amount),
          article: typeof body.article === "string" ? body.article : undefined,
          expenseDate: typeof body.expenseDate === "string" ? body.expenseDate : undefined,
          expenseItemId: typeof body.expenseItemId === "string" ? body.expenseItemId : undefined,
          expenseItemName: typeof body.expenseItemName === "string" ? body.expenseItemName : undefined,
          expenseItemMetaHref:
            typeof body.expenseItemMetaHref === "string" ? body.expenseItemMetaHref : undefined,
          counterpartyId: typeof body.counterpartyId === "string" ? body.counterpartyId : undefined,
          counterpartyName: typeof body.counterpartyName === "string" ? body.counterpartyName : undefined,
          counterpartyMetaHref:
            typeof body.counterpartyMetaHref === "string" ? body.counterpartyMetaHref : undefined,
          paymentType: body.paymentType === "card" ? "card" : body.paymentType === "cash" ? "cash" : undefined,
          comment: typeof body.comment === "string" ? body.comment : undefined,
          attachmentUrl: typeof body.attachmentUrl === "string" ? body.attachmentUrl : undefined,
        });
        return NextResponse.json({ operation: op });
      }
      case "postExpense": {
        const id = String(body.id || "").trim();
        if (!id) {
          return NextResponse.json({ error: "Не указан id расходного ордера" }, { status: 400 });
        }
        const op = await postExpense({ id });
        return NextResponse.json({ operation: op });
      }
      case "cancelExpense": {
        const id = String(body.id || "").trim();
        if (!id) {
          return NextResponse.json({ error: "Не указан id расходного ордера" }, { status: 400 });
        }
        const reason = typeof body.reason === "string" ? body.reason : undefined;
        const op = await cancelExpense({ id, reason });
        return NextResponse.json({ operation: op });
      }
      case "closeShift": {
        const shiftId = String(body.shiftId || "");
        const actualCash = Number(body.actualCash ?? 0);
        const cashOrdersTotal = Number(body.cashOrdersTotal ?? 0);
        const cardOrdersTotal = Number(body.cardOrdersTotal ?? 0);
        const comment = typeof body.comment === "string" ? body.comment : undefined;
        if (!shiftId) {
          return NextResponse.json({ error: "Не указан shiftId" }, { status: 400 });
        }
        const shift = await closeShift({
          shiftId,
          actualCash,
          cashOrdersTotal,
          cardOrdersTotal,
          comment,
        });
        const operations = await listOperationsForShift(shift.id);
        return NextResponse.json({ shift, operations });
      }
      default:
        return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка сервера";
    return NextResponse.json({ error: msg }, { status: statusFromCashError(msg) });
  }
}
