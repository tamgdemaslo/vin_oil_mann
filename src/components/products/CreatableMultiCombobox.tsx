"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, ChevronDown, Loader2, Plus, RotateCcw, X } from "lucide-react";
import type { ProductAttributeField } from "@/lib/product-attribute-values";
import {
  parseComboboxValues,
  serializeComboboxValues,
  useComboboxPopover,
  useProductAttributeOptions,
} from "@/components/products/useProductAttributeOptions";

export default function CreatableMultiCombobox({
  id,
  label,
  field,
  value,
  onChange,
  placeholder = "Начните вводить…",
  hint,
  disabled = false,
}: {
  id: string;
  label: string;
  field: ProductAttributeField;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
}) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = useMemo(() => parseComboboxValues(value), [value]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pendingCustom, setPendingCustom] = useState<string | null>(null);
  const { anchorRef, popupRef, position } = useComboboxPopover(open);
  const { data, loading, loadingMore, error, loadMoreError, retry, loadMore } = useProductAttributeOptions({ field, open, query, selected });
  const selectedKeys = new Set(selected.map((item) => item.toLocaleUpperCase("ru-RU")));
  const options = (data?.options ?? []).filter((option) => !selectedKeys.has(option.value.toLocaleUpperCase("ru-RU")));
  const visibleActiveIndex = Math.min(activeIndex, Math.max(0, options.length - 1));
  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || popupRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
      setPendingCustom(null);
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [anchorRef, open, popupRef]);

  useEffect(() => {
    if (!open || !options.length) return;
    document.getElementById(`${listboxId}-${visibleActiveIndex}`)?.scrollIntoView({ block: "nearest" });
    if (visibleActiveIndex >= options.length - 5) void loadMore();
  }, [listboxId, loadMore, open, options.length, visibleActiveIndex]);

  const commitValues = (values: string[]) => onChange(serializeComboboxValues(values));
  const addValue = (nextValue: string) => {
    const clean = nextValue.trim();
    if (!clean) return;
    commitValues([...selected, clean]);
    setQuery("");
    setPendingCustom(null);
    setOpen(true);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };
  const removeValue = (index: number) => {
    commitValues(selected.filter((_, selectedIndex) => selectedIndex !== index));
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };
  const requestCustom = () => {
    const custom = query.trim();
    if (!custom) return;
    const normalization = data?.normalization;
    if (normalization && normalization.status !== "CUSTOM" && normalization.status !== "AMBIGUOUS") {
      addValue(normalization.value);
      return;
    }
    if (data?.suggestion && data.suggestion !== custom) {
      setPendingCustom(custom);
      return;
    }
    addValue(custom);
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
      if (open && options[visibleActiveIndex]) addValue(options[visibleActiveIndex].value);
      else requestCustom();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      setPendingCustom(null);
    } else if (event.key === "Backspace" && !query && selected.length) {
      event.preventDefault();
      removeValue(selected.length - 1);
    } else if (event.key === "ArrowLeft" && !query && selected.length) {
      event.preventDefault();
      chipRefs.current[selected.length - 1]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
      setQuery("");
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    const parts = pasted.split(/[;\r\n]+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return;
    event.preventDefault();
    commitValues([...selected, ...parts]);
    setQuery("");
    setOpen(true);
  };

  const handleOptionsScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= 96) void loadMore();
  };

  const statusFor = (selectedValue: string) => data?.resolvedSelected.find((match) => match.input === selectedValue || match.value === selectedValue)?.status;
  const customAvailable = Boolean(query.trim() && !options.some((option) => option.value.toLocaleUpperCase("ru-RU") === query.trim().toLocaleUpperCase("ru-RU")));
  const normalizationPreview = data?.normalization && data.normalization.value !== query.trim() && !["CUSTOM", "AMBIGUOUS"].includes(data.normalization.status)
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
          <span>Будет добавлено: <strong>{normalizationPreview}</strong></span>
        </div>
      ) : null}
      {pendingCustom ? (
        <div className="product-attribute-suggestion" role="alert">
          <AlertCircle aria-hidden />
          <div>
            <strong>Возможно, вы имели в виду {data?.suggestion}</strong>
            <span>Проверьте канонический вариант перед сохранением.</span>
            <div>
              <button type="button" onClick={() => addValue(data?.suggestion ?? pendingCustom)}>Использовать {data?.suggestion}</button>
              <button type="button" onClick={() => addValue(pendingCustom)}>Оставить своё значение</button>
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
          <div
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            aria-busy={loadingMore}
            className="product-attribute-options"
            onScroll={handleOptionsScroll}
            onWheel={(event) => event.stopPropagation()}
          >
            {options.map((option, index) => (
              <button
                id={`${listboxId}-${index}`}
                key={option.value}
                type="button"
                role="option"
                aria-selected="false"
                className={index === visibleActiveIndex ? "is-active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => addValue(option.value)}
              >
                <span>{option.value}</span>
                {option.usageCount > 0 ? <small>часто: {option.usageCount}</small> : null}
              </button>
            ))}
            {!options.length ? <div className="product-attribute-empty">Ничего не найдено</div> : null}
          </div>
          {loadingMore ? <div className="product-attribute-load-more" role="status"><Loader2 aria-hidden className="animate-spin" />Загружаем ещё…</div> : null}
          {loadMoreError ? <button type="button" className="product-attribute-load-more is-error" onClick={() => void loadMore()}><RotateCcw aria-hidden />Повторить загрузку</button> : null}
          {customAvailable ? (
            <button type="button" className="product-attribute-create" onMouseDown={(event) => event.preventDefault()} onClick={requestCustom}>
              <Plus aria-hidden />
              <span>Добавить пользовательское значение <strong>«{query.trim()}»</strong></span>
            </button>
          ) : null}
          {data?.metadata.missingSource ? <div className="product-attribute-source-note">Справочник пока неполный; своё значение можно сохранить.</div> : null}
        </>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <div className="product-editor-field product-attribute-field is-multi">
      <label htmlFor={id} className="product-editor-label"><span>{label}</span></label>
      <div
        ref={anchorRef}
        className={`product-attribute-control product-attribute-multi-control ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""}`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) inputRef.current?.focus();
        }}
      >
        <div className="product-attribute-chips">
          {selected.map((selectedValue, index) => {
            const status = statusFor(selectedValue);
            const isCustom = status === "CUSTOM" || status === "AMBIGUOUS";
            return (
              <span key={`${selectedValue}-${index}`} className={`product-attribute-chip ${isCustom ? "is-custom" : ""}`} title={isCustom ? "Пользовательское значение" : "Каноническое значение"}>
                <span>{selectedValue}</span>
                {isCustom ? <small>своё</small> : null}
                <button
                  ref={(element) => { chipRefs.current[index] = element; }}
                  type="button"
                  disabled={disabled}
                  aria-label={`Удалить ${selectedValue}`}
                  onClick={() => removeValue(index)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft") chipRefs.current[Math.max(0, index - 1)]?.focus();
                    if (event.key === "ArrowRight") (chipRefs.current[index + 1] ?? inputRef.current)?.focus();
                  }}
                >
                  <X aria-hidden />
                </button>
              </span>
            );
          })}
          <input
            ref={inputRef}
            id={id}
            value={query}
            disabled={disabled}
            placeholder={selected.length ? "Добавить…" : placeholder}
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={open && options[visibleActiveIndex] ? `${listboxId}-${visibleActiveIndex}` : undefined}
            autoComplete="off"
            onFocus={() => { setActiveIndex(0); setOpen(true); }}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setPendingCustom(null); setOpen(true); }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
        </div>
        <ChevronDown aria-hidden className="product-attribute-chevron" />
      </div>
      {hint ? <span className="product-editor-hint">{hint}</span> : null}
      {popup}
    </div>
  );
}
