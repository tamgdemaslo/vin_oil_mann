"use client";

import { useMemo, useState } from "react";
import { quoteRub, sortQuoteFilterOffers, type QuoteFilterGroup } from "@/lib/maintenance-quote";
import styles from "./MaintenanceQuotePanel.module.css";

type Props = {
  products: QuoteFilterGroup["products"];
  selectedId: string;
  label: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  initiallyExpanded?: boolean;
};

export function QuoteFilterOffers({ products, selectedId, label, onSelect, disabled, initiallyExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [priority, setPriority] = useState<"price" | "delivery">("delivery");
  const warehouse = products.filter(item => item.source !== "rossko");
  const supplier = useMemo(() => sortQuoteFilterOffers(products.filter(item => item.source === "rossko"), priority), [products, priority]);

  function renderOffer(item: Props["products"][number]) {
    const selected = selectedId === item.id;
    const price = quoteRub(Math.round(item.price * 100));
    const availability = item.source === "rossko"
      ? `${item.relation === "analogue" ? "Аналог · " : ""}${item.available} шт. · ${item.deliveryLabel}`
      : item.available > 0 ? `${item.available} шт. в наличии` : item.orderable ? "Под заказ" : "Нет в наличии";
    return <div key={item.id} className={styles.supplierOffer} data-selected={selected}>
      <div><strong>{item.name}</strong><small>{[item.article, availability].filter(Boolean).join(" · ")}</small></div>
      <div className={styles.supplierOfferAction}>
        <strong>{price}</strong>
        <button type="button" className="eco-btn"
          aria-label={`Выбрать ${item.name}, ${price}, ${item.source === "rossko" ? "Роско" : "наш склад"}`}
          aria-pressed={selected} disabled={disabled || selected || (item.available < 1 && !item.orderable)}
          onClick={() => onSelect(item.id)}>{selected ? "Выбран" : "Выбрать"}</button>
      </div>
    </div>;
  }

  return <details className={styles.supplierComparison} open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Предложения · {products.length}</summary>
    <div className={styles.supplierOfferList} aria-label={`Предложения для ${label}`}>
      <section aria-label="Наш склад">
        <div className={styles.supplierToolbar}><strong>Наш склад</strong></div>
        {warehouse.length ? warehouse.map(renderOffer) : <p className={styles.offerEmpty}>Совпадений на выбранном складе нет.</p>}
      </section>
      <section aria-label="Роско">
        <div className={styles.supplierToolbar}>
          <strong>Роско</strong>
          {supplier.length > 1 && <div className={styles.supplierSort} role="group" aria-label={`Сортировка Роско: ${label}`}>
            <button type="button" aria-pressed={priority === "price"} onClick={() => setPriority("price")}>Дешевле</button>
            <button type="button" aria-pressed={priority === "delivery"} onClick={() => setPriority("delivery")}>Быстрее</button>
          </div>}
        </div>
        {supplier.length ? supplier.map(renderOffer) : <p className={styles.offerEmpty}>Подходящих предложений пока нет.</p>}
      </section>
    </div>
  </details>;
}
