import { NextRequest, NextResponse } from "next/server";
import {
  addExpense,
  addWithdrawal,
  closeShift,
  getCurrentShift,
  listOperationsForShift,
  listShifts,
  openShift,
  requireSessionUser,
} from "@/lib/cashbox";

export async function GET(request: NextRequest) {
  try {
    // Требуется любая авторизация; фильтрация по ролям уже в lib, где нужно
    await requireSessionUser();

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode") ?? "current";

    if (mode === "history") {
      const shifts = listShifts(100);
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
      const shifts = listShifts(100);
      const shift = shifts.find((s) => s.id === shiftId);
      if (!shift) {
        return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });
      }
      const operations = listOperationsForShift(shift.id);
      return NextResponse.json({ shift, operations });
    }

    const shift = getCurrentShift();
    if (!shift) {
      return NextResponse.json({ shift: null, operations: [] });
    }
    const operations = listOperationsForShift(shift.id);
    return NextResponse.json({ shift, operations });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка сервера";
    const normalized = msg.toLowerCase();
    const status = normalized.includes("требуется авторизация")
      ? 401
      : normalized.includes("доступ")
        ? 403
        : 500;
    return NextResponse.json({ error: msg }, { status });
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
        const expenseItemName = String(body.expenseItemName || "").trim();
        const expenseItemMetaHref =
          typeof body.expenseItemMetaHref === "string" ? body.expenseItemMetaHref : undefined;
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
        if (!shiftId) {
          return NextResponse.json({ error: "Не указан shiftId" }, { status: 400 });
        }
        if (!expenseItemName || !expenseItemMetaHref) {
          return NextResponse.json({ error: "Выберите статью расхода из списка" }, { status: 400 });
        }
        if (!counterpartyName || !counterpartyMetaHref) {
          return NextResponse.json({ error: "Выберите контрагента" }, { status: 400 });
        }
        const op = await addExpense({
          shiftId,
          amount,
          article,
          expenseDate,
          counterpartyName,
          counterpartyMetaHref,
          expenseItemName,
          expenseItemMetaHref,
          paymentType,
          comment,
          attachmentUrl,
          moyskladCashoutHref,
        });
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
        const operations = listOperationsForShift(shift.id);
        return NextResponse.json({ shift, operations });
      }
      default:
        return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка сервера";
    const normalized = msg.toLowerCase();
    const status = normalized.includes("требуется авторизация")
      ? 401
      : normalized.includes("доступ")
        ? 403
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

