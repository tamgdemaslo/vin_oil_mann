"use client";

import { useEffect, useState } from "react";
import { loyaltyMoney, loyaltyNumber, loyaltyRequest } from "./client";

type Totals = { before: number; cash: number; spent: number; spentCents: number; earned: number };

export function LoyaltySalesTotals({ from, to, store, branchScope, refreshedAt }: {
  from: string; to: string; store?: string; branchScope: string; refreshedAt: string;
}) {
  const [totals, setTotals] = useState<Totals>();
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ from, to, ...(store ? { store } : {}) });
    loyaltyRequest<Totals>(`/api/loyalty/report?${params}`, undefined, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setError(""); setTotals(data); } })
      .catch((reason: Error) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [from, to, store, branchScope, refreshedAt]);
  return <section className="eco-card eco-card--padded">
    <h3>Оплата и бонусы по отгрузкам</h3>
    <p>Все товарные группы и услуги за период, с учётом отмен и зарегистрированных возвратов.</p>
    {error ? <p role="alert">{error}</p> : totals ? <dl className="eco-loyalty-metrics">
      <div><dt>После обычных скидок</dt><dd>{loyaltyMoney(totals.before)}</dd></div>
      <div><dt>Списано бонусов</dt><dd>{loyaltyNumber(totals.spent)} · {loyaltyMoney(totals.spentCents)}</dd></div>
      <div><dt>Оплачено деньгами</dt><dd>{loyaltyMoney(totals.cash)}</dd></div>
      <div><dt>Начислено за покупку</dt><dd>{loyaltyNumber(totals.earned)}</dd></div>
    </dl> : <p role="status">Считаем итоги…</p>}
  </section>;
}
