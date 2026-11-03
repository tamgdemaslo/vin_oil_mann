import { prisma } from '@/lib/db';
import { getScopedBranchId } from '@/lib/request-tenant-store';
import { resolveAqsiCashRegister } from '@/lib/aqsi-integration';
import { aqsiFetchJson } from '@/lib/aqsi';
import { moneyCents, sumKnown, type MoneyValue } from '@/lib/dashboard-money-domain';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
// Strict reader: undocumented/missing fields must not silently become cash or zero.
export function receiptCashCents(value: unknown, deviceId: string, from: string, till: string, fromUtc?: number, tillUtc?: number): number {
  const row = record(value);
  const device = record(row.device);
  const deviceValue = row.deviceId ?? device.id ?? row.device;
  // v2 rows do not include a device ID; the API query MUST filter devices server-side.
  if (deviceValue != null && String(deviceValue) !== deviceId) return 0;
  const date = String(row.processedAt ?? row.dateTime ?? '').replace(' ', 'T');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(date)) throw new Error('Receipt date missing');
  if (/[zZ]|[+-]\d\d:\d\d$/.test(date)) {
    const instant = Date.parse(date);
    if (!Number.isFinite(instant) || fromUtc === undefined || tillUtc === undefined) throw new Error('Invalid receipt timezone');
    if (instant < fromUtc || instant > tillUtc) return 0;
  } else if (date < from || date > till) return 0;
  const content = record(row.content);
  const type = Number(content.type ?? row.type);
  if (![1,2,3,4].includes(type)) throw new Error('Unknown receipt type');
  const close = record(content.checkClose);
  const payments = close.payments ?? row.payments;
  if (!Array.isArray(payments)) throw new Error('Receipt payments missing');
  if (row.isNonFiscal === true || row.fiscalizationStatus === 3) throw new Error('Unconfirmed receipt');
  let cash = 0;
  let paid = 0;
  for (const value of payments) {
    const payment = record(value);
    const paymentType = Number(payment.type);
    if (payment.type === undefined || ![0,1,13,14,15].includes(paymentType)) throw new Error('Unknown payment type');
    const amount = moneyCents(payment.amount ?? payment.sum);
    if (amount < 0) throw new Error('Negative receipt payment');
    paid += amount;
    if (paymentType === 0) cash += amount;
  }
  const amount = moneyCents(row.amount);
  const change = moneyCents(row.change ?? 0);
  if (paid !== amount) {
    if (change < 0 || paid - change !== amount || cash < change) throw new Error('Receipt totals do not reconcile');
    cash -= change;
  }
  if (!Number.isSafeInteger(cash)) throw new Error('Invalid cash total');
  return [2,3].includes(type) ? -cash : cash;
}
async function cashReceipts(shift: { openedAt: Date; timezone: string; aqsiRegisterId: string | null }, now: Date) {
  const config = await resolveAqsiCashRegister(shift.aqsiRegisterId);
  if (!config.deviceId) throw new Error('Select AQSI device');
  const local = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: shift.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const part = (name: string) => parts.find(item => item.type === name)?.value;
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
  };
  const from = local(shift.openedAt);
  const till = local(now);
  const seen = new Set<string>();
  let total = 0;
  const signal = AbortSignal.timeout(15_000);
  for (let page = 0; page < 500; page++) {
    const query = new URLSearchParams({ 'filtered.beginDate': from, 'filtered.endDate': till, 'filtered.devices': config.deviceId, pageSize: '100', page: String(page) });
    const body = await aqsiFetchJson<unknown>(config, `/v2/Receipts?${query}`, { signal });
    const envelope = record(body);
    const items = Array.isArray(body) ? body : ['items','data','rows','list','receipts','cheques','result'].map(key => envelope[key]).find(Array.isArray);
    if (envelope.noData === true && envelope.pages === 0 && (envelope.rows == null || Array.isArray(envelope.rows) && envelope.rows.length === 0)) return total;
    if (!Array.isArray(items)) throw new Error('Invalid receipt response');
    for (const item of items) {
      const row = record(item); const id = String(row.id ?? row.guid ?? '');
      if (!id || seen.has(id)) throw new Error('Incomplete receipt pagination');
      seen.add(id);
      total += receiptCashCents(item, config.deviceId, from, till, shift.openedAt.getTime(), now.getTime());
    }
    if (!Number.isSafeInteger(total)) throw new Error('Invalid cash total');
    if (envelope.pages !== undefined) {
      const pages = Number(envelope.pages);
      if (!Number.isSafeInteger(pages) || pages < 0 || pages > 500) throw new Error('Invalid receipt pagination');
      if (page + 1 >= pages) return total;
      if (!items.length) throw new Error('Incomplete receipt pagination');
    } else if (items.length < 100) return total;
  }
  throw new Error('Receipt limit reached');
}
export async function getDashboardCash(now = new Date()): Promise<MoneyValue> {
  const branchId = getScopedBranchId();
  const open = await prisma.cashShift.findMany({ where: { branchId, status: 'open' }, orderBy: { openedAt: 'desc' }, take: 2 });
  if (open.length > 1) return { cents: null, message: 'Открыто несколько смен. Проверьте кассу.', at: null };
  if (!open.length) {
    const closed = await prisma.cashShift.findFirst({ where: { branchId, status: 'closed' }, orderBy: [{ closedAt: 'desc' }, { openedAt: 'desc' }] });
    return { cents: closed?.actualCashCents ?? null, message: closed ? 'Факт последней закрытой смены' : 'Нет пересчитанного остатка кассы', at: closed?.closedAt?.toISOString() ?? null };
  }
  const shift = open[0];
  try {
    const [receipts, withdrawals, expenses] = await Promise.all([
      cashReceipts(shift, now),
      prisma.cashWithdrawal.aggregate({ where: { branchId, shiftId: shift.id }, _sum: { amountCents: true } }),
      prisma.cashExpenseOrder.aggregate({ where: { branchId, shiftId: shift.id, status: 'posted', paymentType: 'cash' }, _sum: { amountCents: true } }),
    ]);
    return { cents: sumKnown([shift.openingCashCents, receipts, -(withdrawals._sum.amountCents ?? 0), -(expenses._sum.amountCents ?? 0)]), message: 'Расчёт открытой смены · чеки AQSI', at: now.toISOString() };
  } catch { return { cents: null, message: 'Не удалось рассчитать кассу. Проверьте AQSI и устройство кассы.', at: null }; }
}
