"use client";

import { useEffect, useId, useRef } from "react";
import { getMotorOilMarkingCodeError, GS } from "@/lib/marking";

export default function BarrelCodeInput({ value, disabled, label, onCommit }: {
  value: string; disabled: boolean; label: string; onCommit: (value: string) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useRef(onCommit);
  useEffect(() => { commit.current = onCommit; }, [onCommit]);
  const hintId = useId();
  useEffect(() => {
    if (input.current && document.activeElement !== input.current) input.current.value = value;
  }, [value]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function flush() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const code = input.current?.value ?? "";
    commit.current(code);
  }
  const error = value ? getMotorOilMarkingCodeError(value) : null;
  return <div className="eco-barrel-code-input">
    <textarea ref={input} rows={2} defaultValue={value} disabled={disabled} aria-label={label}
      aria-describedby={hintId} aria-invalid={Boolean(error)} spellCheck={false} autoCapitalize="off" autoComplete="off"
      placeholder="Отсканируйте DataMatrix" onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.currentTarget.select()}
      onChange={() => {
        // Keep native input while the scanner types; rerender the document once per scan.
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, 150);
      }} onBlur={flush} onKeyDown={(event) => {
        event.stopPropagation();
        if (event.ctrlKey && event.code === "BracketRight") {
          event.preventDefault();
          event.currentTarget.setRangeText(GS, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, "end");
        }
        if (event.key === "Enter" || event.key === "Tab") {
          if (event.key === "Enter") event.preventDefault();
          flush();
        }
      }} />
    <small id={hintId} className={error ? "is-error" : undefined} aria-live="polite">
      {error || (value ? "Формат кода распознан" : "Сканируйте код целиком")}
    </small>
  </div>;
}
