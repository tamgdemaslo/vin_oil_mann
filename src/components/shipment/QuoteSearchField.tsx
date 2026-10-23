"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./MaintenanceQuotePanel.module.css";

export function QuoteSearchField({ label, value, options, onChange, inputMode, groups }: {
  label: string; value: string; options: string[]; onChange: (value: string) => void; inputMode?: "decimal"; groups?: { label: string; options: string[] }[];
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [category, setCategory] = useState("");
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current); }, []);
  function commit(next: string) {
    if (pending.current) clearTimeout(pending.current);
    if (next !== value) onChange(next);
  }
  const anchor = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<{left:number;top?:number;bottom?:number;width:number;maxHeight:number} | null>(null);
  const key = (text: string) => text.toLocaleLowerCase("ru-RU").replace(/[,]/g, ".").replace(/[\s.-]/g, "");
  const matches = [...new Set(category ? groups?.find(group => group.label === category)?.options ?? options : options)].filter(option => {
    if (!typed) return true;
    if (inputMode === "decimal") return option.replace(",", ".").startsWith(draft.trim().replace(",", "."));
    return key(option).includes(key(draft));
  });
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !popup.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
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
  function choose(option: string) { setDraft(option); commit(option); setOpen(false); setTyped(false); setActive(-1); }
  return <div ref={anchor} className={styles.searchField}>
    <label htmlFor={id}>{label}</label>
    <input id={id} role="combobox" aria-expanded={open} aria-controls={open ? `${id}-options` : undefined} aria-autocomplete="list" aria-activedescendant={open && active >= 0 && matches[active] ? `${id}-option-${active}` : undefined} value={draft} autoComplete="off" inputMode={inputMode} placeholder="Выберите или введите…"
      onFocus={event => { event.currentTarget.select(); setOpen(true); setTyped(false); setActive(-1); }}
      onBlur={() => { commit(draft); setOpen(false); }}
      onChange={event => { const next = event.target.value; setDraft(next); if (pending.current) clearTimeout(pending.current); pending.current = setTimeout(() => onChange(next), 350); setTyped(true); setOpen(true); setActive(-1); }}
      onKeyDown={event => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, matches.length - 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(0,index - 1)); }
        if (open && event.key === "End") { event.preventDefault(); setActive(matches.length - 1); }
        if (open && event.key === "Home") { event.preventDefault(); setActive(0); }
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        if (event.key === "Enter" && open) { event.preventDefault(); if (active >= 0 && matches[active]) choose(matches[active]); else { commit(draft); setOpen(false); } }
      }} />
    <button type="button" className={styles.searchToggle} aria-label={`Показать все: ${label}`} aria-expanded={open} onMouseDown={event => event.preventDefault()} onClick={() => { setOpen(!open); setCategory(""); setTyped(false); setActive(-1); }}>⌄</button>
    {open && position ? createPortal(<div ref={popup} className={styles.searchPopup} style={position} onMouseDown={event => event.preventDefault()}>
      {groups ? <div className={styles.searchCategories} aria-label="Раздел справочника">{[{label: "Все", options}, ...groups].map(group => <button key={group.label} type="button" aria-pressed={category === (group.label === "Все" ? "" : group.label)} onClick={() => { setCategory(group.label === "Все" ? "" : group.label); setTyped(false); setActive(-1); }}>{group.label}</button>)}</div> : null}
      <div className={styles.searchList} id={`${id}-options`} role="listbox" aria-label={label}>
        {matches.map((option,index) => <button id={`${id}-option-${index}`} type="button" role="option" aria-selected={value === option} key={option} className={active === index ? styles.activeOption : undefined} onMouseEnter={() => setActive(index)} onClick={() => choose(option)}>{option}</button>)}
      </div>
      <p>{matches.length ? "Прокрутите список или уточните поиском" : "Совпадений нет — можно оставить введённое значение"}</p>
    </div>, document.body) : null}
  </div>;
}
