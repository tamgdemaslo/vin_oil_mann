"use client";

import { useEffect, useRef, useState } from "react";
import { quoteRub, type QuoteStockProduct } from "@/lib/maintenance-quote";
import styles from "./MaintenanceQuotePanel.module.css";

type Props = {
  name: string;
  products: QuoteStockProduct[];
  cents: number | null;
  onCommit: (prices: Record<string, number>) => void;
};

export function InlineOilPrice({ name, products, cents, onCommit }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const firstInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const finished = useRef(false);

  useEffect(() => {
    if (editing) {
      firstInput.current?.focus();
      firstInput.current?.select();
    }
  }, [editing]);

  function close(restoreFocus: boolean) {
    finished.current = true;
    setEditing(false);
    if (restoreFocus) window.requestAnimationFrame(() => trigger.current?.focus());
  }

  function commit(restoreFocus: boolean) {
    if (finished.current) return;
    const prices = Object.fromEntries(products.map(product => [product.id, Number((draft[product.id] ?? "").replace(",", "."))]));
    if (Object.values(prices).some(price => !Number.isFinite(price) || price <= 0)) {
      setError("Укажите цену больше нуля.");
      return;
    }
    onCommit(Object.fromEntries(Object.entries(prices).map(([id, price]) => [id, Math.round(price * 100) / 100])));
    close(restoreFocus);
  }

  return <div className={styles.inlineOilPrice} data-editing={editing}>
    {editing ? <div className={styles.inlinePriceFields}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) commit(false);
      }}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); commit(true); }
        if (event.key === "Escape") { event.preventDefault(); close(true); }
      }}>
      {products.map((product, index) => <label key={product.id}>
        {product.unit.toLowerCase().startsWith("л") ? "Цена за литр, ₽" : `Цена за ${product.litresPerUnit ?? "?"} л, ₽`}
        <input ref={index === 0 ? firstInput : undefined} type="text" inputMode="decimal"
          aria-label={`Цена ${product.name}, ₽`} aria-invalid={Boolean(error)}
          value={draft[product.id] ?? ""}
          onChange={event => { setDraft(values => ({ ...values, [product.id]: event.target.value })); setError(""); }} />
      </label>)}
      {error && <small role="alert">{error}</small>}
    </div> : <button ref={trigger} type="button" className={styles.priceValue}
      aria-label={`Изменить цену ${name}`} title="Изменить цену"
      onClick={() => {
        finished.current = false;
        setDraft(Object.fromEntries(products.map(product => [product.id, Number.isFinite(product.price) ? String(product.price) : ""])));
        setError(""); setEditing(true);
      }}>{cents === null ? "Уточните цену" : quoteRub(cents)}</button>}
  </div>;
}
