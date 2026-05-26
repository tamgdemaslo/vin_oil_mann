"use client";

import { useEffect, useState } from "react";

type PublicStats = {
  replacementsCount?: number;
};

const DEFAULT_REPLACEMENTS_COUNT = 4217;

function formatCount(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

export default function ClientSiteStats() {
  const [count, setCount] = useState(DEFAULT_REPLACEMENTS_COUNT);

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      try {
        const response = await fetch("/api/public/stats", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as PublicStats;
        if (!cancelled && typeof data.replacementsCount === "number") {
          setCount(data.replacementsCount);
        }
      } catch {
        // The static fallback keeps the page usable when the public API is unavailable.
      }
    }

    void loadStats();
    const intervalId = window.setInterval(loadStats, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <div className="client-kpi" aria-live="polite">
      <span className="client-kpi__value">{formatCount(count)}</span>
      <span className="client-kpi__label">Замен всего по сети</span>
    </div>
  );
}
