"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./MaintenanceQuotePanel.module.css";

export function QuoteSearchField({ label, value, options, onChange, inputMode }: {
  label: string; value: string; options: string[]; onChange: (value: string) => void; inputMode?: "decimal";
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<{left:number;top?:number;bottom?:number;width:number;maxHeight:number} | null>(null);
  const key = (text: string) => text.toLocaleLowerCase("ru-RU").replace(/[,]/g, ".").replace(/[\s.-]/g, "");
  const matches = [...new Set(options)].filter(option => {
    if (!typed) return true;
    if (inputMode === "decimal") return option.replace(",", ".").startsWith(value.trim().replace(",", "."));
    return key(option).includes(key(value));
  }).slice(0, 8);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect(); if (!rect) return;
      const height = Math.min(248, Math.max(100, window.innerHeight - 24));
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const showAbove = below < 160 && above > below;
      const maxHeight = Math.min(height, showAbove ? above : below);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)), ...(showAbove ? {bottom: window.innerHeight - rect.top + 4} : {top: rect.bottom + 4}), width: Math.min(rect.width, window.innerWidth - 16), maxHeight: Math.max(60,maxHeight) });
    };
    place(); window.addEventListener("resize",place); window.addEventListener("scroll",place,true);
    return () => { window.removeEventListener("resize",place); window.removeEventListener("scroll",place,true); };
  }, [open]);
  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({block: "nearest"});
  }, [open, active, id]);
  function choose(option: string) { onChange(option); setOpen(false); setTyped(false); setActive(-1); }
  return <div ref={anchor} className={styles.searchField}>
    <label htmlFor={id}>{label}</label>
    <input id={id} role="combobox" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined} aria-autocomplete="list" aria-activedescendant={open && active >= 0 && matches[active] ? `${id}-option-${active}` : undefined} value={value} autoComplete="off" inputMode={inputMode} placeholder="Начните вводить…"
      onFocus={event => { event.currentTarget.select(); setOpen(true); setTyped(false); setActive(-1); }}
      onBlur={() => setOpen(false)}
      onChange={event => { onChange(event.target.value); setTyped(true); setOpen(true); setActive(-1); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, matches.length - 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0,index - 1)); }
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        if (event.key === "Enter" && open) { event.preventDefault(); if (active >= 0 && matches[active]) choose(matches[active]); else setOpen(false); }
      }} />
    {open && position ? createPortal(<div className={styles.searchPopup} style={position} onMouseDown={event => event.preventDefault()}>
      <div id={`${id}-options`} role="listbox" aria-label={label}>
        {matches.map((option,index) => <button id={`${id}-option-${index}`} type="button" role="option" aria-selected={value === option} key={option} className={active === index ? styles.activeOption : undefined} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>{option}</button>)}
      </div>
      <p>{matches.length ? "Введите точнее, чтобы сузить список" : "Совпадений нет — можно оставить введённое значение"}</p>
    </div>, document.body) : null}
  </div>;
}
