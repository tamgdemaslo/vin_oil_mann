import { prisma } from "@/lib/db";
import { canonicalizeLogin, getLoginVariants } from "@/lib/auth";
import {
  toLocalDateString,
  getWorkdayStart,
  nowInAppTz,
  getYesterdayLocal,
} from "@/lib/time";

const LATE_PENALTY_PER_5MIN_CENTS = 500 * 100; // 500 ₽
const LATE_PENALTY_MAX_CENTS = 1500 * 100;
const UNCLOSED_PENALTY_CENTS = 300 * 100;

export type CloseType = "by_employee" | "by_owner" | "auto";

const APP_TZ = process.env.APP_TIMEZONE ?? "Europe/Moscow";

/** Штраф за опоздание: 500 ₽ за каждые полные 5 минут, макс 1500 ₽. Округление вниз. Время в поясе приложения. */
export function calculateLatePenaltyCents(startedAt: Date, shiftDate: string): number {
  const startedLocalStr = startedAt.toLocaleString("sv-SE", { timeZone: APP_TZ });
  const startedDateOnly = startedLocalStr.slice(0, 10);
  if (startedDateOnly !== shiftDate) return 0;
  const [, timePart] = startedLocalStr.split(" ");
  const [hours, min] = (timePart ?? "00:00:00").split(":").map(Number);
  const workStart = getWorkdayStart(new Date(shiftDate + "T12:00:00"));
  if (hours < workStart.hours || (hours === workStart.hours && min < workStart.minutes)) return 0;
  const minutesLate = (hours - workStart.hours) * 60 + (min - workStart.minutes);
  const full5Min = Math.floor(minutesLate / 5);
  return Math.min(full5Min * LATE_PENALTY_PER_5MIN_CENTS, LATE_PENALTY_MAX_CENTS);
}

/** Найти ставку смены для сотрудника на дату (последняя с effectiveFrom <= shiftDate) */
export async function getShiftRateCents(userLogin: string, shiftDate: string): Promise<number | null> {
  const userLogins = getLoginVariants(userLogin);
  const row = await prisma.shiftRate.findFirst({
    where: { userLogin: { in: userLogins }, effectiveFrom: { lte: shiftDate } },
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
  const userLogins = getLoginVariants(userLogin);
  const now = nowInAppTz();
  const shiftDate = toLocalDateString(now);

  const existing = await prisma.shift.findFirst({
    where: { userLogin: { in: userLogins }, shiftDate },
  });
  if (existing) {
    return { ok: false, error: "На сегодня смена уже открыта" };
  }

  const startedAt = new Date();
  const latePenaltyCents = calculateLatePenaltyCents(startedAt, shiftDate);

  const shift = await prisma.shift.create({
    data: {
      userLogin: canonicalUserLogin,
      shiftDate,
      startedAt,
      endedAt: null,
      closeType: "by_employee",
      latePenaltyCents: latePenaltyCents > 0 ? latePenaltyCents : null,
    },
  });

  if (latePenaltyCents > 0) {
    await prisma.bonusPenalty.create({
      data: {
        userLogin: canonicalUserLogin,
        date: shiftDate,
        amountCents: -latePenaltyCents,
        type: "penalty_late",
        comment: "Опоздание на смену",
        createdByLogin: "system",
      },
    });
  }

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
  const userLogins = getLoginVariants(userLogin);
  const now = nowInAppTz();
  const shiftDate = toLocalDateString(now);

  const shift = await prisma.shift.findFirst({
    where: { userLogin: { in: userLogins }, shiftDate },
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
  const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
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
  const userLogins = getLoginVariants(userLogin);
  const today = toLocalDateString(nowInAppTz());
  const shift = await prisma.shift.findFirst({
    where: { userLogin: { in: userLogins }, shiftDate: today, endedAt: null },
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
  const { userLogin, role, targetLogin, dateFrom, dateTo } = params;
  const isOwner = role === "owner";

  const where: { userLogin?: string | { in: string[] }; shiftDate?: { gte?: string; lte?: string } } = {};
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
