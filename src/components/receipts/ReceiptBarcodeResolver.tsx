"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Link2, Loader2, X } from "lucide-react";
import { EcoButton } from "@/components/platform/EcoUI";
import type { ProductOption } from "@/app/inventory/StockDocumentClient";

export default function ReceiptBarcodeResolver({ barcode, onAdded, onCancel, onBusyChange }: {
  barcode: string;
  onAdded: (product: ProductOption) => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selected, setSelected] = useState<ProductOption | null>(null);
  const [searching, setSearching] = useState(false);
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    const search = query.trim();
    if (search.length < 2 || selected) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search, limit: "12" });
        const response = await fetch(`/api/local-inventory/products?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json().catch(() => ({ error: "Не удалось загрузить товары. Повторите поиск." }));
        if (!response.ok) throw new Error(data.error || "Не удалось найти товары");
        if (!controller.signal.aborted) setProducts((Array.isArray(data.products) ? data.products : []).filter((product: ProductOption) => product.entityType !== "service"));
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Не удалось найти товары");
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, selected]);

  async function bind() {
    if (!selected || pending.current) return;
    pending.current = true;
    setBinding(true);
    onBusyChange(true);
    setError("");
    try {
      const response = await fetch("/api/local-inventory/products/barcode", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode, productId: selected.id }),
      });
      const data = await response.json().catch(() => ({ error: "Не удалось сохранить штрихкод. Повторите попытку." }));
      if (!response.ok || !data.product) throw new Error(data.error || "Не удалось сохранить штрихкод");
      onAdded(data.product);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось сохранить штрихкод");
    } finally {
      pending.current = false;
      setBinding(false);
      onBusyChange(false);
    }
  }

  return <section className="eco-receipt-barcode-resolver" aria-labelledby="receipt-barcode-title" aria-busy={binding}>
    <div className="eco-receipt-barcode-head">
      <div><h4 id="receipt-barcode-title">Штрихкод не найден</h4><p>Выберите товар, которому он принадлежит.</p></div>
      <EcoButton type="button" size="sm" onClick={onCancel} disabled={binding} aria-label="Отменить привязку штрихкода"><X size={16} />Отмена</EcoButton>
    </div>
    <code className="eco-receipt-barcode-value">{barcode}</code>
    <label className="eco-receipt-field">
      <span>Найти существующий товар</span>
      <input className="eco-input" ref={input} value={query} disabled={binding}
        onChange={(event) => { setQuery(event.target.value); setProducts([]); setSelected(null); setError(""); setSearching(event.target.value.trim().length >= 2); }}
        placeholder="Название, артикул или код товара" />
    </label>
    <div aria-live="polite">
      {searching ? <p className="eco-receipt-result-hint"><Loader2 size={15} className="animate-spin" />Ищем товары…</p> : null}
      {!selected && products.length > 0 ? <div className="eco-receipt-barcode-options" aria-label="Найденные товары">
        {products.map((product) => <button type="button" key={product.id} disabled={binding} onClick={() => { setSelected(product); setQuery(product.name); setProducts([]); setSearching(false); }}>
          <strong>{product.name}</strong><span>{[product.article, product.brand, product.groupPath].filter(Boolean).join(" · ") || "Без артикула"}</span>
        </button>)}
      </div> : null}
      {!selected && !searching && query.trim().length >= 2 && products.length === 0 && !error ? <p className="eco-receipt-result-hint">Товары не найдены. Попробуйте другой артикул или название.</p> : null}
      {selected ? <div className="eco-receipt-barcode-selected"><Check size={18} /><div><strong>{selected.name}</strong><span>{[selected.article, selected.brand].filter(Boolean).join(" · ")}</span></div></div> : null}
      {error ? <p className="eco-receipt-result-hint is-error" role="alert"><AlertTriangle size={16} />{error}</p> : null}
    </div>
    <p className="eco-receipt-barcode-note">Штрихкод сохранится в карточке товара для следующих сканирований.</p>
    <EcoButton type="button" variant="primary" disabled={!selected || binding} onClick={() => void bind()}>
      {binding ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
      {binding ? "Сохраняем штрихкод…" : "Привязать и добавить 1 шт."}
    </EcoButton>
  </section>;
}
