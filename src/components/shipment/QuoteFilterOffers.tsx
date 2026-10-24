"use client";

import { useMemo, useState } from "react";
import { quoteRub, sortQuoteFilterOffers, type QuoteFilterGroup } from "@/lib/maintenance-quote";
import styles from "./MaintenanceQuotePanel.module.css";

type Props = { products: QuoteFilterGroup["products"]; selectedId: string; label: string; onSelect: (id: string) => void; disabled?: boolean };

export function QuoteFilterOffers({products, selectedId, label, onSelect, disabled}: Props) {
  const [priority, setPriority] = useState<"price" | "delivery">("delivery");
  const hasMann = products.some(item => item.relation !== "analogue");
  const hasAnalogues = products.some(item => item.relation === "analogue");
  const [expanded, setExpanded] = useState(!hasMann);
  const minimumPrice = Math.min(...products.map(item => item.price));
  const sorted = useMemo(() => sortQuoteFilterOffers(products, priority), [products, priority]);
  return <details className={styles.supplierComparison} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Сравнить предложения Роско · {products.length} · от {quoteRub(Math.round(minimumPrice * 100))}</summary>
    <div className={styles.supplierToolbar}>
      <span>{hasMann ? hasAnalogues ? "MANN и аналоги Роско" : "Предложения MANN" : "MANN недоступен — доступны аналоги Роско"}</span>
      <div className={styles.supplierSort} role="group" aria-label={`Сортировка Роско: ${label}`}>
        <button type="button" aria-pressed={priority === "price"} onClick={() => setPriority("price")}>Дешевле</button>
        <button type="button" aria-pressed={priority === "delivery"} onClick={() => setPriority("delivery")}>Быстрее</button>
      </div>
    </div>
    <div className={styles.supplierOfferList} role="group" aria-label={`Предложения Роско: ${label}`}>
      {sorted.map(item => <div key={item.id} className={styles.supplierOffer} data-selected={selectedId === item.id}>
        <div><strong>{item.name}</strong><small>{item.relation === "analogue" ? `Аналог Роско для MANN ${item.referenceArticle}` : "Исходный артикул MANN"}</small><p>{item.available} шт. у поставщика · {item.deliveryLabel}</p></div>
        <div className={styles.supplierOfferAction}><strong>{quoteRub(Math.round(item.price * 100))}</strong><button type="button" className="eco-btn" aria-label={`Выбрать ${item.name}, ${quoteRub(Math.round(item.price * 100))}, ${item.deliveryLabel}`} aria-pressed={selectedId === item.id} disabled={disabled || selectedId === item.id} onClick={() => onSelect(item.id)}>{selectedId === item.id ? "Выбран" : "Выбрать"}</button></div>
      </div>)}
    </div>
    <p className={styles.note}>Аналоги связаны с артикулом MANN в Роско. Перед заказом сверьте применяемость и условия подбора автомобиля.</p>
  </details>;
}
