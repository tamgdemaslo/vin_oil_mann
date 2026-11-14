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
    const unavailable = !(item.available > 0);
    const priceMissing = !Number.isFinite(item.price) || item.price <= 0;
    const price = priceMissing ? "—" : quoteRub(Math.round(item.price * 100));
    const source = item.source === "rossko" ? "Росско" : "Наш склад";
    const stock = unavailable ? "Нет" : `${item.available} шт.`;
    const delivery = item.source === "rossko"
      ? item.deliveryLabel?.replace(/^доставка\s*:\s*/i, "") || "Не указан"
      : "—";
    return <div key={item.id} className={styles.supplierOffer} role="row"
      data-selected={selected} data-unavailable={unavailable} aria-disabled={unavailable || undefined}>
      <div className={styles.supplierOfferInfo} role="cell"><strong>{item.name}</strong></div>
      <div className={styles.offerDelivery} role="cell" aria-label={`Поставка ${delivery}`}>{delivery}</div>
      <div className={styles.offerPrice} role="cell">{price}</div>
      <div className={styles.offerStock} role="cell" aria-label={unavailable ? "Нет в наличии" : `Остаток ${stock}`}>{stock}</div>
      <div className={styles.supplierOfferAction} role="cell">
        <button type="button" className={`eco-btn ${styles.offerAdd}`}
          aria-label={`${selected ? "Добавлено" : "Добавить"} ${item.name}, ${price}, ${source}`}
          aria-pressed={selected} title={unavailable ? "Нет в наличии" : selected ? "В расчёте" : "Добавить в расчёт"}
          disabled={disabled || selected || unavailable || priceMissing}
          onClick={() => onSelect(item.id)}>
          {selected ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
        </button>
      </div>
    </div>;
  }

  function renderOffers(offers: Offer[], limit: number, setLimit: (limit: number) => void) {
    const visible = compact ? offers.slice(0, limit) : offers;
    const selected = offers.find(item => item.id === selectedId);
    const pinned = selected && !visible.some(item => item.id === selected.id) ? selected : null;
    return <>
      <div role="table" aria-label={`Товары для ${label}`}>
        <div className={styles.offerColumns} role="row">
          <span role="columnheader">Наименование</span><span role="columnheader">Поставка</span>
          <span role="columnheader">Цена</span><span role="columnheader">Остаток</span><span role="columnheader" aria-label="Добавить" />
        </div>
        <div className={styles.offerRows} role="rowgroup">
          {pinned && renderOffer(pinned)}
          {visible.map(renderOffer)}
        </div>
      </div>
      {compact && offers.length > limit && <button type="button" className={styles.moreOffers}
        onClick={() => setLimit(limit + 10)}>Показать ещё · {offers.length - limit}</button>}
      {compact && limit > 3 && offers.length > 3 && <button type="button" className={styles.moreOffers}
        onClick={() => setLimit(3)}>Свернуть</button>}
    </>;
  }

  return <details className={`${styles.supplierComparison} ${compact ? styles.compactOffers : ""}`}
    open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Предложения · {products.length}</summary>
    <div className={styles.supplierOfferList} aria-label={`Предложения для ${label}`}>
      <section className={styles.warehouseOffers} aria-label="Наш склад">
        <div className={styles.supplierToolbar}><strong>Наш склад</strong></div>
        {warehouse.length ? renderOffers(warehouse, warehouseLimit, setWarehouseLimit)
          : <p className={styles.offerEmpty}>Нет в наличии</p>}
      </section>
      <section className={styles.rosskoOffers} aria-label="Росско">
        <div className={styles.supplierToolbar}>
          <strong>Росско</strong>
          {supplier.length > 1 && <div className={styles.supplierSort} role="group" aria-label={`Сортировка Росско для ${label}`}>
            <button type="button" aria-pressed={priority === "price"} onClick={() => { setPriority("price"); setSupplierLimit(3); }}>Дешевле</button>
            <button type="button" aria-pressed={priority === "delivery"} onClick={() => { setPriority("delivery"); setSupplierLimit(3); }}>Быстрее</button>
          </div>}
        </div>
        {supplier.length ? renderOffers(supplier, supplierLimit, setSupplierLimit)
          : <p className={styles.offerEmpty}>Нет предложений</p>}
      </section>
    </div>
  </details>;
}
