"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import type { ServiceHistoryPage } from "@/lib/customer-service-history";
import styles from "./CustomerServiceHistory.module.css";

const quantityFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 });

function mileageLabel(value: string | null) {
  const digits = value?.trim().replace(/\s|км/gi, "");
  return digits && /^\d+$/.test(digits) && Number(digits) > 0
    ? `${quantityFormat.format(Number(digits))} км`
    : "Пробег не указан";
}

export function CustomerServiceHistory({ counterpartyId, recentOnly = false }: { counterpartyId: string; recentOnly?: boolean }) {
  const group = useId();
  const [page, setPage] = useState<ServiceHistoryPage | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    const query = recentOnly ? "?recent=1" : cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
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
  }, [attempt, counterpartyId, cursor, recentOnly]);

  return (
    <section className={styles.history} aria-label="История обслуживания">
      <h3>История обслуживания</h3>
      {page?.items.length ? (
        <ul className={styles.list}>
          {page.items.map((item) => {
            const positions = item.positions ?? [];
            const label = <><time dateTime={item.date}>{item.date.split("-").reverse().join(".")}</time> · {item.branch}</>;
            if (!recentOnly) {
              return (
                <li key={item.id}>
                  <div className={styles.summary}>
                    {item.href ? <Link href={item.href}>{label}</Link> : <span>{label}</span>}
                    <span className={styles.status}>{item.posted ? "Проведена" : "Черновик"}</span>
                  </div>
                  {item.services.length > 0 && <div className={styles.status}>{item.services.join(", ")}</div>}
                </li>
              );
            }
            return (
              <li key={item.id}>
                <details className={styles.shipment} name={group}>
                  <summary className={styles.summary}>
                    <span>{label}</span>
                    <span className={styles.status}>{mileageLabel(item.mileage)}</span>
                  </summary>
                  <div className={styles.positions}>
                    {positions.length === 0 && <p className={styles.status}>В отгрузке нет позиций.</p>}
                    {[{ title: "Услуги", service: true }, { title: "Товары", service: false }].map(({ title, service }) => {
                      const group = positions.filter((position) => position.service === service);
                      if (!group.length) return null;
                      return (
                        <div key={title}>
                          <h4>{title}</h4>
                          <ul className={styles.positionList}>
                            {group.map((position) => (
                              <li key={position.id}>
                                <span>{position.name.trim() || "Без наименования"}</span>
                                <span aria-label="Количество">× {quantityFormat.format(Number(position.quantity))}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                    {item.href && <Link href={item.href}>Открыть отгрузку</Link>}
                  </div>
                </details>
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
      {!recentOnly && status === "ready" && page?.nextCursor && (
        <button type="button" onClick={() => { setStatus("loading"); setCursor(page.nextCursor); }}>Показать ещё</button>
      )}
    </section>
  );
}
