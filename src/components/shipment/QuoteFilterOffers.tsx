"use client";

import { Check, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { quoteRub, sortQuoteFilterOffers, type QuoteFilterGroup } from "@/lib/maintenance-quote";
import styles from "./MaintenanceQuotePanel.module.css";

type Offer = QuoteFilterGroup["products"][number];
type Props = {
  products: Offer[];
  selectedId: string;
  label: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  initiallyExpanded?: boolean;
  compact?: boolean;
};

export function QuoteFilterOffers({ products, selectedId, label, onSelect, disabled, initiallyExpanded = false, compact = false }: Props) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [priority, setPriority] = useState<"price" | "delivery">("delivery");
  const [warehouseLimit, setWarehouseLimit] = useState(3);
  const [supplierLimit, setSupplierLimit] = useState(3);
  const warehouse = products.filter(item => item.source !== "rossko");
  const supplier = useMemo(
    () => sortQuoteFilterOffers(products.filter(item => item.source === "rossko"), priority),
    [products, priority],
  );

  function renderOffer(item: Offer) {
    const selected = selectedId === item.id;
    const price = quoteRub(Math.round(item.price * 100));
    const availability = item.source === "rossko"
      ? [item.available > 0 ? `${item.available} шт.` : null, item.deliveryLabel].filter(Boolean).join(" · ")
      : item.available > 0 ? `${item.available} шт. в наличии` : item.orderable ? "Под заказ" : "Нет в наличии";
    const source = item.source === "rossko" ? "Росско" : "Наш склад";
    return <div key={item.id} className={styles.supplierOffer} data-selected={selected}>
      <div className={styles.supplierOfferInfo}>
        <strong>{item.name}</strong>
        <small>{[item.article || "Артикул не указан", source, item.relation === "analogue" ? "Аналог" : null, availability].filter(Boolean).join(" · ")}</small>
      </div>
      <div className={styles.supplierOfferAction}>
        <strong>{price}</strong>
        <button type="button" className={`eco-btn ${styles.offerAdd}`}
          aria-label={`${selected ? "Добавлено" : "Добавить"} ${item.name}, ${price}, ${source}`}
          aria-pressed={selected}
          disabled={disabled || selected || (item.available < 1 && !item.orderable)}
          onClick={() => onSelect(item.id)}>
          {selected ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
          {compact && <span>{selected ? "В расчёте" : "Добавить"}</span>}
        </button>
      </div>
    </div>;
  }

  function renderOffers(offers: Offer[], limit: number, setLimit: (limit: number) => void) {
    const visible = compact ? offers.slice(0, limit) : offers;
    const selected = offers.find(item => item.id === selectedId);
    const pinnedSelection = selected && !visible.some(item => item.id === selected.id) ? selected : null;
    return <>
      {pinnedSelection && renderOffer(pinnedSelection)}
      {visible.map(renderOffer)}
      {compact && offers.length > limit && <button type="button" className={styles.moreOffers}
        onClick={() => setLimit(limit + 10)}>
        Показать ещё · {offers.length - limit}
      </button>}
      {compact && limit > 3 && offers.length > 3 && <button type="button" className={styles.moreOffers}
        onClick={() => setLimit(3)}>Свернуть список</button>}
    </>;
  }

  return <details className={`${styles.supplierComparison} ${compact ? styles.compactOffers : ""}`}
    open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Предложения · {products.length}</summary>
    <div className={styles.supplierOfferList} aria-label={`Предложения для ${label}`}>
      <section aria-label="Наш склад">
        <div className={styles.supplierToolbar}><strong>Наш склад</strong></div>
        {warehouse.length ? renderOffers(warehouse, warehouseLimit, setWarehouseLimit)
          : <p className={styles.offerEmpty}>На выбранном складе нет совпадений.</p>}
      </section>
      <section aria-label="Росско">
        <div className={styles.supplierToolbar}>
          <strong>Росско</strong>
          {supplier.length > 1 && <div className={styles.supplierSort} role="group" aria-label={`Сортировка Росско для ${label}`}>
            <button type="button" aria-pressed={priority === "price"} onClick={() => { setPriority("price"); setSupplierLimit(3); }}>Дешевле</button>
            <button type="button" aria-pressed={priority === "delivery"} onClick={() => { setPriority("delivery"); setSupplierLimit(3); }}>Быстрее</button>
          </div>}
        </div>
        {supplier.length ? renderOffers(supplier, supplierLimit, setSupplierLimit)
          : <p className={styles.offerEmpty}>Доступных предложений нет.</p>}
      </section>
    </div>
  </details>;
}
