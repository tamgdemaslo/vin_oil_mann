"use client";

import { Check, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { quoteRub, sortQuoteFilterOffers, type QuoteFilterGroup } from "@/lib/maintenance-quote";
import styles from "./MaintenanceQuotePanel.module.css";

type Offer = QuoteFilterGroup["products"][number];
type Props = {
  warehouse: Offer[];
  article: string;
  label: string;
  selectedId: string;
  onSelect: (offer: Offer) => void;
  disabled?: boolean;
  warehouseStatus?: string;
};

export function QuoteFilterOffers({ warehouse, article, label, selectedId, onSelect, disabled, warehouseStatus }: Props) {
  const [priority, setPriority] = useState<"price" | "delivery">("delivery");
  const [warehouseLimit, setWarehouseLimit] = useState(3);
  const [supplierLimit, setSupplierLimit] = useState(3);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ article: string; revision: number; products: Offer[]; error?: string } | null>(null);
  const current = result?.article === article && result.revision === revision ? result : null;
  const supplier = sortQuoteFilterOffers(current?.products ?? [], priority);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/maintenance-quote/rossko?${new URLSearchParams({ article })}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось получить предложения.");
        if (!controller.signal.aborted) setResult({ article, revision, products: data.products });
      } catch (error) {
        if (!controller.signal.aborted) setResult({
          article, revision, products: [], error: error instanceof Error ? error.message : "Не удалось получить предложения.",
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [article, revision]);

  function renderOffer(item: Offer) {
    const selected = selectedId === item.id;
    const price = quoteRub(Math.round(item.price * 100));
    const articleLabel = item.article || "Артикул не указан";
    const availability = item.available > 0 ? `Остаток: ${item.available} шт.` : item.orderable ? "Под заказ" : "Нет в наличии";
    const delivery = item.source === "rossko" ? item.deliveryLabel : item.available > 0 ? "Со склада" : null;
    return <div key={item.id} className={styles.supplierOffer} data-selected={selected}>
      <div className={styles.supplierOfferInfo}>
        <div className={styles.offerHeadline}>
          <strong>{[item.brand, articleLabel].filter(Boolean).join(" ")}</strong>
          <strong className={styles.offerPrice}>{price}</strong>
        </div>
        <small>{[item.relation === "analogue" ? "Аналог" : null, delivery, availability].filter(Boolean).join(" · ")}</small>
        {selected && <small className={styles.offerSelected}>В расчёте</small>}
      </div>
      <button type="button" className={`eco-btn ${selected ? "" : "eco-btn--primary"} ${styles.offerAdd}`}
        aria-label={`${selected ? "В расчёте" : "Добавить в расчёт"}: ${item.name}, ${articleLabel}, ${price}`}
        aria-disabled={selected || undefined}
        disabled={disabled || (item.available < 1 && !item.orderable)}
        onClick={() => { if (!selected) onSelect(item); }}>
        {selected ? <Check size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
      </button>
    </div>;
  }

  function renderOffers(offers: Offer[], limit: number, setLimit: (limit: number) => void) {
    const visible = offers.slice(0, limit);
    const selected = offers.find(item => item.id === selectedId);
    return <>
      {selected && !visible.includes(selected) && renderOffer(selected)}
      {visible.map(renderOffer)}
      {offers.length > limit && <button type="button" className={`eco-btn ${styles.filterSecondary}`}
        onClick={() => setLimit(limit + 10)}>Показать ещё · {offers.length - limit}</button>}
      {limit > 3 && offers.length > 3 && <button type="button" className={`eco-btn ${styles.filterSecondary}`}
        onClick={() => setLimit(3)}>Свернуть список</button>}
    </>;
  }

  return <div className={styles.supplierOfferList} aria-label={`Предложения для ${label}`}>
    <section aria-label="Наш склад" className={styles.offerSource}>
      <h4>Наш склад</h4>
      {warehouseStatus ? <p className={styles.offerEmpty} role="status">{warehouseStatus}</p>
        : warehouse.length ? renderOffers(warehouse, warehouseLimit, setWarehouseLimit)
        : <p className={styles.offerEmpty}>На выбранном складе нет совпадений.</p>}
    </section>
    <section aria-label="Росско" className={styles.offerSource}>
      <div className={styles.supplierToolbar}>
        <h4>Росско</h4>
        <div className={styles.supplierSort} role="group" aria-label="Предложения Росско">
          {supplier.length > 1 && <>
            <button type="button" className="eco-btn" aria-pressed={priority === "price"} onClick={() => { setPriority("price"); setSupplierLimit(3); }}>Дешевле</button>
            <button type="button" className="eco-btn" aria-pressed={priority === "delivery"} onClick={() => { setPriority("delivery"); setSupplierLimit(3); }}>Быстрее</button>
          </>}
          <button type="button" className="eco-btn" aria-disabled={!current} onClick={() => { if (current) setRevision(value => value + 1); }}>Обновить</button>
        </div>
      </div>
      {!current ? <p className={styles.offerEmpty} role="status">Проверяем цену и доставку…</p>
        : current.error ? <p className={styles.offerEmpty} role="status">{current.error}</p>
        : supplier.length ? renderOffers(supplier, supplierLimit, setSupplierLimit)
        : <p className={styles.offerEmpty}>Доступных предложений нет.</p>}
    </section>
  </div>;
}
