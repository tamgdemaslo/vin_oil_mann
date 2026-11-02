"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toServiceDateInput } from "@/lib/date-time";

export default function SalesPlanBanner({ ownerLogin, branchId, pathname }: { ownerLogin: string; branchId: string; pathname: string }) {
  const [missingCount, setMissingCount] = useState(0);
  const [checkedScope, setCheckedScope] = useState("");
  const [, setCheckedDate] = useState("");
  const [period, setPeriod] = useState("");
  const [hiddenKey, setHiddenKey] = useState("");
  const today = toServiceDateInput(new Date());
  const dismissalKey = `eco-sales-plan:${ownerLogin}:${branchId}:${period}:${today}`;

  useEffect(() => {
    let cancelled = false;
    let activeMonth = "";
    let revision = 0;
    let controller: AbortController | null = null;
    async function check(force = false) {
      const month = toServiceDateInput(new Date()).slice(0, 7);
      if (!force && month === activeMonth) return;
      activeMonth = month;
      const requestRevision = ++revision;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`/api/warehouse/analytics/sales-plans?month=${encodeURIComponent(month)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) { activeMonth = ""; return; }
        const data = await response.json() as { branchIds?: string[]; plans?: { branchId: string }[] };
        if (!Array.isArray(data.branchIds) || !Array.isArray(data.plans)) { activeMonth = ""; return; }
        const planned = new Set(data.plans.map((plan) => plan.branchId));
        const count = data.branchIds.filter((id) => !planned.has(id)).length;
        if (cancelled || requestRevision !== revision) return;
        setCheckedScope(`${ownerLogin}:${branchId}`);
        setCheckedDate(toServiceDateInput(new Date()));
        setPeriod(month);
        setMissingCount(count);
        const key = `eco-sales-plan:${ownerLogin}:${branchId}:${month}:${toServiceDateInput(new Date())}`;
        try { if (localStorage.getItem(key) === "hidden") setHiddenKey(key); } catch { /* Storage can be disabled. */ }
      } catch { if (!cancelled && requestRevision === revision) activeMonth = ""; }
    }
    void check(true);
    const onFocus = () => { void check(true); };
    const timer = window.setInterval(() => { void check(); }, 60_000);
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; controller?.abort(); window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [ownerLogin, branchId, pathname]);

  if (checkedScope !== `${ownerLogin}:${branchId}` || !missingCount || !period || hiddenKey === dismissalKey || pathname === "/warehouse/product-analytics") return null;
  const label = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T12:00:00Z`));
  return (
    <aside className="eco-sales-plan-banner" aria-label="План продаж на текущий месяц">
      <div><strong>Задайте план продаж на {label}</strong><p>{missingCount > 1 ? `План ещё не задан для ${missingCount} филиалов.` : "На текущий месяц план продаж ещё не задан."}</p></div>
      <Link className="eco-btn eco-btn--primary" href="/warehouse/product-analytics?tab=sales-plan&salesTab=plan">Установить план</Link>
      <button className="eco-btn eco-btn--ghost" type="button" title="Скрыть плашку до завтра" onClick={() => { setHiddenKey(dismissalKey); try { localStorage.setItem(dismissalKey, "hidden"); } catch { /* Keep the in-memory dismissal. */ } }}>Позже</button>
    </aside>
  );
}
