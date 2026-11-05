'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardMoney } from '@/lib/dashboard-money-domain';
import { formatServiceTime } from '@/lib/date-time';
import styles from './MoneyOverview.module.css';
const money = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(value / 100);
export function MoneyOverviewView({ data, loading, error, refresh }: { data: DashboardMoney | null; loading: boolean; error: string | null; refresh: () => void }) {
  return <section className={styles.section} aria-label="Остатки денег" aria-busy={loading}>
    <header className={styles.header}><div><h2>Деньги сейчас</h2><p>{data?.mode === 'all' ? 'Все филиалы · наличные и банковские счета' : 'Наличные и банковский счёт филиала'}</p></div><button className="eco-btn" type="button" onClick={refresh} disabled={loading}>{loading ? 'Обновляем…' : 'Обновить остатки'}</button></header>
    {error && <p role="alert">{error}</p>}
    <dl className={styles.totals}><div><dt>Наличные в кассе</dt><dd>{money(data?.cashCents)}</dd></div><div><dt>На счёте / карте</dt><dd>{money(data?.bankCents)}</dd></div><div className={styles.total}><dt>Всего денег</dt><dd>{money(data?.totalCents)}</dd></div></dl>
    {loading && !data && <p role="status">Получаем остатки кассы и банка…</p>}
    {data && <>
      {data.totalCents === null && <p className={styles.notice}>Общий итог неполный: не все остатки доступны. Недостающие суммы не считаются нулевыми.</p>}
      <div className={styles.scroll}><table><caption className="eco-visually-hidden">Деньги по филиалам</caption><thead><tr><th scope="col">Филиал</th><th scope="col">Наличные</th><th scope="col">Счёт / карта</th><th scope="col">Итого</th></tr></thead><tbody>{data.branches.map(branch => <tr key={branch.id}><th scope="row">{branch.name}</th><td><strong>{money(branch.cash.cents)}</strong><small>{branch.cash.message}{branch.cash.at ? ` · ${formatServiceTime(branch.cash.at)}` : ''}</small></td><td><strong>{money(branch.bank.cents)}</strong><small>{branch.bank.message}</small></td><td><strong>{money(branch.totalCents)}</strong></td></tr>)}</tbody></table></div>
      <footer className={styles.footer}><span>{error ? 'Показаны ранее загруженные данные. ' : ''}Обновлено {formatServiceTime(data.fetchedAt)}. В банке — текущий остаток на счёте; наличные открытой смены — расчётные.</span>{data.mode === 'branch' && <Link href="/finance/bank">Операции по счёту →</Link>}</footer>
    </>}
  </section>;
}
export default function MoneyOverview({ compact = false, refreshToken }: { compact?: boolean; refreshToken?: number | null } = {}) {
  const [data,setData] = useState<DashboardMoney | null>(null);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true); setError(null);
    try {
      const response = await fetch('/api/dashboard/money', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Не удалось обновить остатки. Повторите попытку.');
      const value = await response.json() as DashboardMoney;
      if (!controller.signal.aborted) setData(value);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Ошибка загрузки'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  },[]);
  useEffect(() => { void load(); return () => request.current?.abort(); },[load, refreshToken]);
  if (compact) {
    return (
      <section className="eco-owner-brief__cash" aria-label="Остатки сейчас" aria-busy={loading}>
        <h2>Остатки сейчас</h2>
        <div><span>В кассе</span><strong>{money(data?.cashCents)}</strong></div>
        <div><span>На счёте</span><strong>{money(data?.bankCents)}</strong></div>
        {error && <small role="status">{data ? "Показаны последние остатки" : "Остатки недоступны"}</small>}
        <Link href="/finance/bank">Операции по счёту →</Link>
      </section>
    );
  }
  return <MoneyOverviewView data={data} loading={loading} error={error} refresh={() => void load()} />;
}
