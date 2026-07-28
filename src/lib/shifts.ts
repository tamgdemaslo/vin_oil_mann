import { prisma } from "@/lib/db";
import { canonicalizeLogin, getLoginVariants } from "@/lib/auth";
import { requireBranchContext } from "@/lib/branch-context";
import {
  toLocalDateString,
  nowInAppTz,
  getYesterdayLocal,
} from "@/lib/time";

const UNCLOSED_PENALTY_CENTS = 300 * 100;

async function activeBranchId() {
  const context = await requireBranchContext({ allowAll: false, requireActive: true });
  if (!context.branchId) throw new Error("Активный филиал не выбран");
  return context.branchId;
}

export type CloseType = "by_employee" | "by_owner" | "auto";

/** Автоматический штраф за позднее открытие смены отключён: поздние открытия не влияют на payroll. */
export function calculateLatePenaltyCents(startedAt: Date, shiftDate: string): number {
  void startedAt;
  void shiftDate;
  return 0;
}

/** Найти ставку смены для сотрудника на дату (последняя с effectiveFrom <= shiftDate) */
export async function getShiftRateCents(userLogin: string, shiftDate: string): Promise<number | null> {
  const branchId = await activeBranchId();
  const userLogins = getLoginVariants(userLogin);
  const row = await prisma.shiftRate.findFirst({
    where: { branchId, userLogin: { in: userLogins }, effectiveFrom: { lte: shiftDate } },
    orderBy: { effectiveFrom: "desc" },
  });
  return row?.amountCents ?? null;
}

/** Открыть смену. Один раз в сутки на пользователя. */
export async function startShift(userLogin: string): Promise<
  | { ok: true; shift: { id: string; shiftDate: string; startedAt: Date } }
  | { ok: false; error: string }
> {
  const canonicalUserLogin = canonicalizeLogin(userLogin);
  const branchId = await activeBranchId();
  const userLogins = getLoginVariants(userLogin);
  const now = nowInAppTz();
  const shiftDate = toLocalDateString(now);

  const existing = await prisma.shift.findFirst({
    where: { branchId, userLogin: { in: userLogins }, shiftDate },
  });
  if (existing) {
    return { ok: false, error: "На сегодня смена уже открыта" };
  }

  const startedAt = new Date();
  const latePenaltyCents = calculateLatePenaltyCents(startedAt, shiftDate);

  const shift = await prisma.shift.create({
    data: {
      branchId,
      userLogin: canonicalUserLogin,
      shiftDate,
      startedAt,
      endedAt: null,
      closeType: "by_employee",
      latePenaltyCents: latePenaltyCents > 0 ? latePenaltyCents : null,
    },
  });

  return {
    ok: true,
    shift: { id: shift.id, shiftDate: shift.shiftDate, startedAt: shift.startedAt },
  };
}

/** Закрыть смену сотрудником. Нельзя закрыть уже закрытую (в т.ч. авто). */
export async function endShift(userLogin: string): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const branchId = await activeBranchId();
  const userLogins = getLoginVariants(userLogin);
  const now = nowInAppTz();
  const shiftDate = toLocalDateString(now);

  const shift = await prisma.shift.findFirst({
    where: { branchId, userLogin: { in: userLogins }, shiftDate },
  });
  if (!shift) return { ok: false, error: "Нет открытой смены на сегодня" };
  if (shift.endedAt) return { ok: false, error: "Смена уже закрыта" };

  await prisma.shift.update({
    where: { id: shift.id },
    data: { endedAt: new Date(), closeType: "by_employee" },
  });
  return { ok: true };
}

/** Владелец вручную закрывает смену сотрудника (до автозакрытия). */
export async function closeShiftByOwner(
  shiftId: string,
  ownerLogin: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const branchId = await activeBranchId();
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, branchId } });
  if (!shift) return { ok: false, error: "Смена не найдена" };
  if (shift.endedAt) return { ok: false, error: "Смена уже закрыта" };

  await prisma.shift.update({
    where: { id: shiftId },
    data: {
      endedAt: new Date(),
      closeType: "by_owner",
      closedByLogin: canonicalizeLogin(ownerLogin),
    },
  });
  return { ok: true };
}

/** Автозакрытие смен за вчера: закрыть все открытые смены за shiftDate = вчера, начислить штраф 300 ₽. */
export async function autoCloseShifts(): Promise<{ closed: number }> {
  const yesterday = getYesterdayLocal();
  const open = await prisma.shift.findMany({
    where: { shiftDate: yesterday, endedAt: null },
  });

  for (const shift of open) {
    await prisma.shift.update({
      where: { id: shift.id },
      data: {
        endedAt: new Date(),
        closeType: "auto",
        closedByLogin: null,
        unclosedPenaltyCents: UNCLOSED_PENALTY_CENTS,
      },
    });
    await prisma.bonusPenalty.create({
      data: {
        branchId: shift.branchId,
        userLogin: canonicalizeLogin(shift.userLogin),
        date: yesterday,
        amountCents: -UNCLOSED_PENALTY_CENTS,
        type: "penalty_unclosed",
        comment: "Смена не закрыта до 00:00",
        createdByLogin: "system",
      },
    });
  }
  return { closed: open.length };
}

/** Текущая открытая смена пользователя (если есть). */
export async function getCurrentShift(userLogin: string): Promise<{
  id: string;
  shiftDate: string;
  startedAt: Date;
  endedAt: Date | null;
  closeType: string;
  latePenaltyCents: number | null;
} | null> {
  const branchId = await activeBranchId();
  const userLogins = getLoginVariants(userLogin);
  const today = toLocalDateString(nowInAppTz());
  const shift = await prisma.shift.findFirst({
    where: { branchId, userLogin: { in: userLogins }, shiftDate: today, endedAt: null },
  });
  if (!shift) return null;
  return {
    id: shift.id,
    shiftDate: shift.shiftDate,
    startedAt: shift.startedAt,
    endedAt: shift.endedAt,
    closeType: shift.closeType,
    latePenaltyCents: shift.latePenaltyCents,
  };
}

/** Список смен: для мастера/админа — свои, для владельца — все (с фильтром по логину и периоду). */
export async function listShifts(params: {
  userLogin: string;
  role: string;
  targetLogin?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  const branchId = await activeBranchId();
  const { userLogin, role, targetLogin, dateFrom, dateTo } = params;
  const isOwner = role === "owner";

  const where: { branchId: string; userLogin?: string | { in: string[] }; shiftDate?: { gte?: string; lte?: string } } = { branchId };
  if (!isOwner) where.userLogin = { in: getLoginVariants(userLogin) };
  else if (targetLogin) where.userLogin = { in: getLoginVariants(targetLogin) };
  if (dateFrom) where.shiftDate = { ...where.shiftDate, gte: dateFrom };
  if (dateTo) where.shiftDate = { ...where.shiftDate, lte: dateTo };

  const shifts = await prisma.shift.findMany({
    where,
    orderBy: [{ shiftDate: "desc" }, { startedAt: "desc" }],
  });
  return shifts.map((shift) => ({
    ...shift,
    userLogin: canonicalizeLogin(shift.userLogin),
    closedByLogin: shift.closedByLogin ? canonicalizeLogin(shift.closedByLogin) : shift.closedByLogin,
  }));
}
