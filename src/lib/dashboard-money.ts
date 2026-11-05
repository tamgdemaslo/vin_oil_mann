import type { BranchContext } from '@/lib/branch-context';
import { runWithRequestTenant } from '@/lib/request-tenant-store';
import { getDashboardCash } from '@/lib/dashboard-cash';
import { getTBankDashboardBalances } from '@/lib/tbank';
import { summarizeMoney, sumKnown, type MoneyValue } from '@/lib/dashboard-money-domain';
export async function getDashboardMoney(context: BranchContext) {
  const branches = context.mode === 'all' ? context.branches : context.branches.filter(branch => branch.id === context.branchId);
  const rows = [];
  // Bound external-provider concurrency even when a business group has many branches.
  for (let index = 0; index < branches.length; index += 3) {
    rows.push(...await Promise.all(branches.slice(index, index + 3).map(branch => runWithRequestTenant({
      mode: 'branch', branchId: branch.id, organizationId: branch.legacyOrganizationId ?? branch.id,
      allowedBranchIds: [branch.id], businessGroupId: context.businessGroupId, userId: context.userId,
    }, async () => {
      const [cashResult, bankResult] = await Promise.allSettled([getDashboardCash(), getTBankDashboardBalances()]);
      const cash: MoneyValue = cashResult.status === 'fulfilled' ? cashResult.value : { cents: null, message: 'Касса недоступна', at: null };
      const accounts = bankResult.status === 'fulfilled' ? bankResult.value : [];
      return { id: branch.id, name: branch.displayName || branch.shortName || branch.name, cash, accounts };
    }))));
  }
  const owners = new Map<string, Set<string>>();
  for (const row of rows) for (const account of row.accounts) if (account.accountHash) {
    const ids = owners.get(account.accountHash) ?? new Set<string>(); ids.add(row.id); owners.set(account.accountHash, ids);
  }
  return summarizeMoney(context.mode, rows.map(row => {
    const unique = new Map(row.accounts.map(account => [account.accountHash ?? 'missing', account]));
    const conflict = [...unique.keys()].some(hash => (owners.get(hash)?.size ?? 0) > 1);
    const cents = conflict ? null : sumKnown([...unique.values()].map(account => account.cents));
    const bank: MoneyValue = { cents, message: conflict ? 'Один счёт привязан к нескольким филиалам. Проверьте настройки.'
      : !row.accounts.length ? 'Подключите счёт этого филиала'
      : cents === null ? 'Не все банковские остатки доступны. Проверьте подключения.'
      : [...unique.values()].map(account => account.message).join(' · '), at: cents === null ? null : new Date().toISOString() };
    return { id: row.id, name: row.name, cash: row.cash, bank };
  }), new Date().toISOString());
}
