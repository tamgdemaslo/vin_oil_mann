"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ServiceHistoryPage } from "@/lib/customer-service-history";
import styles from "./CustomerServiceHistory.module.css";

export function CustomerServiceHistory({ counterpartyId }: { counterpartyId: string }) {
  const [page, setPage] = useState<ServiceHistoryPage | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    fetch(`/api/local-inventory/counterparties/${encodeURIComponent(counterpartyId)}/service-history${query}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить историю");
        return await response.json() as ServiceHistoryPage;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        setPage((previous) => {
          if (!cursor || !previous) return result;
          const items = new Map(previous.items.map((item) => [item.id, item]));
          for (const item of result.items) items.set(item.id, item);
          return { ...result, items: [...items.values()] };
        });
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [attempt, counterpartyId, cursor]);

  return (
    <section className={styles.history} aria-label="История обслуживания">
      <h3>История обслуживания</h3>
      {page?.items.length ? (
        <ul className={styles.list}>
          {page.items.map((item) => {
            const label = <><time dateTime={item.date}>{item.date.split("-").reverse().join(".")}</time> · {item.branch}</>;
            return (
              <li key={item.id}>
                <div className={styles.summary}>
                  {item.href ? <Link href={item.href}>{label}</Link> : <span>{label}</span>}
                  <span className={styles.status}>{item.posted ? "Проведена" : "Черновик"}</span>
                </div>
                {item.services.length > 0 && <div className={styles.services}>{item.services.join(", ")}</div>}
              </li>
            );
          })}
        </ul>
      ) : status === "ready" && <p className={styles.status}>Отгрузок пока нет.</p>}
      {status === "loading" && <p role="status" className={styles.status}>Загрузка истории…</p>}
      {status === "error" && (
        <div role="status" className={styles.summary}>
          <span>Не удалось загрузить историю.</span>
          <button type="button" onClick={() => { setStatus("loading"); setAttempt(attempt + 1); }}>Повторить</button>
        </div>
      )}
      {status === "ready" && page?.nextCursor && (
        <button type="button" onClick={() => { setStatus("loading"); setCursor(page.nextCursor); }}>Показать ещё</button>
      )}
    </section>
  );
}
