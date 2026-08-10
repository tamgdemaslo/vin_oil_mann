"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, Loader2, Plus, Search, X } from "lucide-react";

export type ProductSupplierChoice = {
  id: string;
  displayName: string;
  inn: string;
  legalForm: string;
  status: string;
  phone?: string;
  contactPerson?: string;
};

export default function ProductSupplierPicker({
  value,
  onChange,
  disabled = false,
  compact = false,
  placeholder = "Выберите поставщика",
}: {
  value: ProductSupplierChoice | null;
  onChange: (supplier: ProductSupplierChoice | null) => void;
  disabled?: boolean;
  compact?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ProductSupplierChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickInn, setQuickInn] = useState("");
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<ProductSupplierChoice[]>([]);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (query.trim()) params.set("search", query.trim());
        const response = await fetch(`/api/suppliers?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json() as { suppliers?: ProductSupplierChoice[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Не удалось загрузить поставщиков");
        setOptions(Array.isArray(data.suppliers) ? data.suppliers : []);
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : "Не удалось загрузить поставщиков");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24);
      setPosition({
        top: Math.min(rect.bottom + 6, window.innerHeight - 12),
        left: Math.min(Math.max(12, rect.left), window.innerWidth - width - 12),
        width,
      });
    };
    const closeOutside = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!triggerRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) setOpen(false);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("mousedown", closeOutside);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("mousedown", closeOutside);
    };
  }, [open]);

  async function createSupplier(allowDuplicate = false) {
    if (!quickName.trim()) return setQuickError("Укажите название поставщика");
    setQuickSaving(true);
    setQuickError(null);
    try {
      const response = await fetch("/api/suppliers/quick-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: quickName.trim(), inn: quickInn.trim(), legalForm: "LEGAL_ENTITY", allowDuplicate }),
      });
      const data = await response.json() as ProductSupplierChoice & { error?: string; candidates?: ProductSupplierChoice[] };
      if (response.status === 409) {
        setDuplicates(Array.isArray(data.candidates) ? data.candidates : []);
        setQuickError(data.error || "Похожий поставщик уже существует");
        return;
      }
      if (!response.ok) throw new Error(data.error || "Не удалось создать поставщика");
      onChange(data);
      setQuickOpen(false);
      setQuickName("");
      setQuickInn("");
      setDuplicates([]);
    } catch (requestError) {
      setQuickError(requestError instanceof Error ? requestError.message : "Не удалось создать поставщика");
    } finally {
      setQuickSaving(false);
    }
  }

  const popup = open && position && typeof document !== "undefined" ? createPortal(
    <div ref={popupRef} className="product-supplier-popover" role="listbox" aria-label="Поставщики" style={position}>
      <div className="product-supplier-popover__search"><Search size={15} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, ИНН, контакт или телефон" /></div>
      <div className="product-supplier-popover__results">
        {loading ? <p className="product-supplier-popover__hint"><Loader2 size={15} className="animate-spin" /> Ищем поставщиков…</p> : null}
        {error ? <p className="product-supplier-popover__error">{error}</p> : null}
        {!loading && !error && !options.length ? <p className="product-supplier-popover__hint">Поставщики не найдены.</p> : null}
        {options.map((supplier) => <button key={supplier.id} type="button" role="option" aria-selected={supplier.id === value?.id} onClick={() => { onChange(supplier); setOpen(false); }}><Building2 size={15} className="eco-icon" /><span><b>{supplier.displayName}</b><em>{supplier.inn ? `ИНН ${supplier.inn} · Поставщик` : `${supplier.contactPerson || "без ИНН"} · Поставщик`}</em></span></button>)}
      </div>
      <div className="product-supplier-popover__actions">
        <button type="button" onClick={() => { onChange(null); setOpen(false); }}>Без поставщика</button>
        <button type="button" onClick={() => { setOpen(false); setQuickOpen(true); setQuickError(null); }}><Plus size={14} /> Создать нового поставщика</button>
      </div>
    </div>, document.body
  ) : null;

  return <>
    <div ref={triggerRef} className={`rossko-supplier-picker ${compact ? "is-compact" : ""}`}>
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setQuery(""); setOpen((current) => !current); }} title={value ? `${value.displayName}${value.inn ? `, ИНН ${value.inn}` : ""}` : placeholder}>
        <Building2 size={compact ? 13 : 15} />
        <span><b>{value?.displayName || placeholder}</b>{!compact && value?.inn ? <em>ИНН {value.inn}</em> : null}</span>
      </button>
      {value && !disabled ? <button type="button" className="rossko-supplier-picker__clear" onClick={() => onChange(null)} aria-label="Убрать поставщика"><X size={13} /></button> : null}
    </div>
    {popup}
    {quickOpen && typeof document !== "undefined" ? createPortal(
      <div className="product-supplier-modal-backdrop" role="presentation" onMouseDown={() => !quickSaving && setQuickOpen(false)}>
        <section className="product-supplier-modal" role="dialog" aria-modal="true" aria-labelledby="rossko-quick-supplier-title" onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span>Быстрое создание</span><h3 id="rossko-quick-supplier-title">Новый поставщик</h3></div><button type="button" onClick={() => setQuickOpen(false)} aria-label="Закрыть"><X size={17} /></button></header>
          <p>Поставщик будет создан в текущем филиале и сразу выбран для импорта.</p>
          <div className="product-supplier-modal__grid">
            <label className="is-full">Название *<input autoFocus value={quickName} onChange={(event) => setQuickName(event.target.value)} /></label>
            <label className="is-full">ИНН<input inputMode="numeric" value={quickInn} onChange={(event) => setQuickInn(event.target.value.replace(/\D+/g, ""))} /></label>
          </div>
          {quickError ? <div className="product-supplier-modal__error">{quickError}</div> : null}
          {duplicates.length ? <div className="product-supplier-modal__duplicates">{duplicates.map((supplier) => <button key={supplier.id} type="button" onClick={() => { onChange(supplier); setQuickOpen(false); }}><b>{supplier.displayName}</b><span>{supplier.inn ? `ИНН ${supplier.inn}` : "без ИНН"}</span></button>)}</div> : null}
          <footer><button type="button" className="eco-btn" onClick={() => setQuickOpen(false)} disabled={quickSaving}>Отмена</button>{duplicates.length ? <button type="button" className="eco-btn" onClick={() => void createSupplier(true)} disabled={quickSaving}>Всё равно создать</button> : null}<button type="button" className="eco-btn eco-btn--primary" onClick={() => void createSupplier()} disabled={quickSaving}>{quickSaving ? "Создаём…" : "Создать и выбрать"}</button></footer>
        </section>
      </div>, document.body
    ) : null}
  </>;
}
