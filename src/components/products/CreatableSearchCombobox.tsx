"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, ChevronDown, Loader2, Plus, RotateCcw, X } from "lucide-react";
import type { ProductAttributeField } from "@/lib/product-attribute-values";
import { useComboboxPopover, useProductAttributeOptions } from "@/components/products/useProductAttributeOptions";

export default function CreatableSearchCombobox({
  id,
  label,
  field,
  value,
  onChange,
  placeholder,
  hint,
  disabled = false,
  required = false,
}: {
  id: string;
  label: string;
  field: ProductAttributeField;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [hasTyped, setHasTyped] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingCustom, setPendingCustom] = useState<string | null>(null);
  const { anchorRef, popupRef, position } = useComboboxPopover(open);
  const { data, loading, error, retry } = useProductAttributeOptions({ field, open, query: hasTyped ? draft : "", selected: value ? [value] : [] });
  const options = data?.options ?? [];
  const visibleDraft = hasTyped ? draft : value;
  const visibleActiveIndex = Math.min(activeIndex, Math.max(0, options.length - 1));

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
      setHasTyped(false);
      setDraft(value);
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [anchorRef, open, popupRef, value]);

  const selectValue = (nextValue: string) => {
    onChange(nextValue);
    setDraft(nextValue);
    setPendingCustom(null);
    setHasTyped(false);
    setOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const requestCustom = () => {
    const custom = visibleDraft.trim();
    if (!custom) return;
    const normalization = data?.normalization;
    if (normalization && normalization.status !== "CUSTOM" && normalization.status !== "AMBIGUOUS") {
      selectValue(normalization.value);
      return;
    }
    if (data?.suggestion && data.suggestion !== custom) {
      setPendingCustom(custom);
      return;
    }
    selectValue(custom);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActiveIndex((current) => Math.min(options.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && options[visibleActiveIndex]) selectValue(options[visibleActiveIndex].value);
      else requestCustom();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setPendingCustom(null);
      setHasTyped(false);
      setDraft(value);
    } else if (event.key === "Tab") {
      setOpen(false);
      setHasTyped(false);
      setDraft(value);
    }
  };

  const customAvailable = Boolean(hasTyped && draft.trim() && !options.some((option) => option.value.toLocaleUpperCase("ru-RU") === draft.trim().toLocaleUpperCase("ru-RU")));
  const normalizationPreview = hasTyped && data?.normalization && data.normalization.value !== draft.trim() && !["CUSTOM", "AMBIGUOUS"].includes(data.normalization.status)
    ? data.normalization.value
    : null;

  const popup = open && position && typeof document !== "undefined" ? createPortal(
    <div
      ref={popupRef}
      className="product-attribute-popover"
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
    >
      {normalizationPreview ? (
        <div className="product-attribute-normalization-note">
          <Check aria-hidden />
          <span>Будет сохранено: <strong>{normalizationPreview}</strong></span>
        </div>
      ) : null}
      {pendingCustom ? (
        <div className="product-attribute-suggestion" role="alert">
          <AlertCircle aria-hidden />
          <div>
            <strong>Возможно, вы имели в виду {data?.suggestion}</strong>
            <span>Проверьте канонический вариант перед сохранением.</span>
            <div>
              <button type="button" onClick={() => selectValue(data?.suggestion ?? pendingCustom)}>Использовать {data?.suggestion}</button>
              <button type="button" onClick={() => selectValue(pendingCustom)}>Оставить своё значение</button>
            </div>
          </div>
        </div>
      ) : error ? (
        <div className="product-attribute-state is-error" role="alert">
          <AlertCircle aria-hidden />
          <span>Не удалось загрузить справочник</span>
          <button type="button" onClick={retry}><RotateCcw aria-hidden />Повторить</button>
        </div>
      ) : loading && !data ? (
        <div className="product-attribute-state" aria-live="polite"><Loader2 aria-hidden className="animate-spin" />Загружаем справочник…</div>
      ) : (
        <>
          <div id={listboxId} role="listbox" aria-label={label} className="product-attribute-options">
            {options.map((option, index) => (
              <button
                id={`${listboxId}-${index}`}
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={index === visibleActiveIndex ? "is-active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectValue(option.value)}
              >
                <span>{option.value}</span>
                {option.value === value ? <Check aria-hidden /> : option.usageCount > 0 ? <small>часто: {option.usageCount}</small> : null}
              </button>
            ))}
            {!options.length ? <div className="product-attribute-empty">Ничего не найдено</div> : null}
          </div>
          {customAvailable ? (
            <button type="button" className="product-attribute-create" onMouseDown={(event) => event.preventDefault()} onClick={requestCustom}>
              <Plus aria-hidden />
              <span>Добавить пользовательское значение <strong>«{draft.trim()}»</strong></span>
            </button>
          ) : null}
          {data?.metadata.missingSource ? <div className="product-attribute-source-note">Справочник пока неполный; своё значение можно сохранить.</div> : null}
        </>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="product-editor-field product-attribute-field">
      <label htmlFor={id} className="product-editor-label">
        <span>{label}{required ? <b aria-hidden="true"> *</b> : null}</span>
      </label>
      <div ref={anchorRef} className={`product-attribute-control ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""}`}>
        <input
          ref={inputRef}
          id={id}
          value={visibleDraft}
          disabled={disabled}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[visibleActiveIndex] ? `${listboxId}-${visibleActiveIndex}` : undefined}
          autoComplete="off"
          onFocus={(event) => { setHasTyped(false); setActiveIndex(0); setOpen(true); event.currentTarget.select(); }}
          onChange={(event) => { setDraft(event.target.value); setHasTyped(true); setActiveIndex(0); setPendingCustom(null); setOpen(true); }}
          onKeyDown={handleKeyDown}
          className="eco-input product-editor-input"
        />
        {value && !disabled ? (
          <button type="button" className="product-attribute-clear" aria-label={`Очистить поле ${label}`} onClick={() => selectValue("")}>
            <X aria-hidden />
          </button>
        ) : (
          <ChevronDown aria-hidden className="product-attribute-chevron" />
        )}
      </div>
      {hint ? <span className="product-editor-hint">{hint}</span> : null}
      {popup}
    </div>
  );
}
