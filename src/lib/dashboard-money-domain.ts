export type MoneyValue = { cents: number | null; message: string; at: string | null };
export type BranchMoney = { id: string; name: string; cash: MoneyValue; bank: MoneyValue; totalCents: number | null };
export type DashboardMoney = { mode: 'branch' | 'all'; branches: BranchMoney[]; cashCents: number | null; bankCents: number | null; totalCents: number | null; fetchedAt: string };
export function sumKnown(values: Array<number | null>) {
  if (!values.length || values.some(value => value === null)) return null;
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (!Number.isSafeInteger(total)) throw new Error('Invalid balance total');
  return total;
}
export function moneyCents(value: unknown) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !String(value).trim() || !/^-?\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('Invalid money');
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error('Invalid money');
  return cents;
}
export function summarizeMoney(mode: 'branch' | 'all', rows: Omit<BranchMoney, 'totalCents'>[], fetchedAt: string): DashboardMoney {
  const branches = rows.map(row => ({ ...row, totalCents: sumKnown([row.cash.cents, row.bank.cents]) }));
  const cashCents = sumKnown(branches.map(row => row.cash.cents));
  const bankCents = sumKnown(branches.map(row => row.bank.cents));
  return { mode, branches, cashCents, bankCents, totalCents: sumKnown([cashCents, bankCents]), fetchedAt };
}
