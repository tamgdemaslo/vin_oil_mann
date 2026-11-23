export const LOYALTY_DEFAULTS = {
  enabled: false,
  centsPerPoint: 100,
  productRate: 500,
  serviceRate: 500,
  spendRate: 3000,
  compensationLimit: 1000,
  groupRates: {} as Record<string, number>,
};

export type LoyaltyLineInput = { beforeCents: number; rate: number; quantityMilli: number };
export type LoyaltyLine = LoyaltyLineInput & { cashCents: number; spendCents: number; earned: number };
export type LoyaltyTotals = { beforeCents: number; cashCents: number; spent: number; earned: number; centsPerPoint: number };
export type LoyaltyQuote = LoyaltyTotals & { maximum: number; balance: number; token: string };
export type LoyaltyIntent = { points: number; token?: string; skip?: boolean };

function floorRatio(numerator: bigint, denominator: bigint) {
  return Number(numerator / denominator);
}

/** Apportion integer units by remainder, with the original line order as the tie breaker. */
function distribute(numerators: bigint[], denominator: bigint) {
  const result = numerators.map((n) => floorRatio(n, denominator));
  const target = floorRatio(numerators.reduce((sum, n) => sum + n, BigInt(0)), denominator);
  const ordered = numerators.map((n, index) => ({ index, remainder: n % denominator }))
    .sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  const extra = target - result.reduce((sum, n) => sum + n, 0);
  for (const { index } of ordered.slice(0, extra)) result[index] += 1;
  return result;
}

export function loyaltyLineCents(quantity: number, priceCents: number, discount: number) {
  const quantityMilli = Math.round(quantity * 1000);
  const discountMilli = Math.round(discount * 1000);
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli < 0 || !Number.isSafeInteger(priceCents) || priceCents < 0
    || !Number.isSafeInteger(discountMilli) || discountMilli < 0 || discountMilli > 100_000) {
    throw new Error("Проверьте количество, цену и скидку");
  }
  const value = BigInt(quantityMilli) * BigInt(priceCents) * BigInt(100_000 - discountMilli);
  return Number((value + BigInt(50_000_000)) / BigInt(100_000_000));
}

export function calculateLoyalty(
  lines: LoyaltyLineInput[],
  rules: Pick<typeof LOYALTY_DEFAULTS, "centsPerPoint" | "spendRate">,
  balance: number,
  requested: number,
) {
  if (!Number.isSafeInteger(requested) || requested < 0) throw new Error("Проверьте сумму списания");
  if (lines.some((line) => !Number.isSafeInteger(line.beforeCents) || line.beforeCents < 0 || !Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0)) {
    throw new Error("Проверьте цены, скидки и количество в отгрузке");
  }
  const beforeCents = lines.reduce((sum, line) => sum + line.beforeCents, 0);
  if (beforeCents > 2_147_483_647) throw new Error("Сумма отгрузки превышает допустимый предел");
  const maximum = Math.max(0, Math.min(balance, floorRatio(BigInt(beforeCents) * BigInt(rules.spendRate), BigInt(rules.centsPerPoint) * BigInt(10_000))));
  const spent = Math.min(maximum, requested);
  const spendCents = spent * rules.centsPerPoint;
  const allocated = beforeCents > 0
    ? distribute(lines.map((line) => BigInt(line.beforeCents) * BigInt(spendCents)), BigInt(beforeCents))
    : lines.map(() => 0);
  const cash = lines.map((line, index) => line.beforeCents - allocated[index]);
  const earned = distribute(lines.map((line, index) => BigInt(cash[index]) * BigInt(line.rate)), BigInt(rules.centsPerPoint) * BigInt(10_000));
  return {
    beforeCents, cashCents: beforeCents - spendCents, spent, maximum, balance,
    earned: earned.reduce((sum, value) => sum + value, 0), centsPerPoint: rules.centsPerPoint,
    lines: lines.map((line, index) => ({ ...line, spendCents: allocated[index], cashCents: cash[index], earned: earned[index] })),
  };
}

export function returnLineDelta(line: LoyaltyLine, previousMilli: number, nextMilli: number) {
  if (previousMilli < 0 || nextMilli <= previousMilli || nextMilli > line.quantityMilli) {
    throw new Error("Количество возврата превышает остаток исходной позиции");
  }
  const delta = (total: number) => {
    const portion = (quantity: number) => floorRatio(BigInt(total) * BigInt(quantity), BigInt(line.quantityMilli));
    return portion(nextMilli) - portion(previousMilli);
  };
  const cashCents = delta(line.cashCents);
  const spendCents = delta(line.spendCents);
  return { beforeCents: cashCents + spendCents, cashCents, spendCents, earned: delta(line.earned) };
}

export function loyaltyExpiration(date?: string | null) {
  if (!date) return null;
  const midnight = new Date(date + "T00:00:00.000Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+midnight) || midnight.toISOString().slice(0, 10) !== date) {
    throw new Error("Укажите корректную дату окончания");
  }
  return new Date(+midnight + 22 * 60 * 60 * 1000);
}
