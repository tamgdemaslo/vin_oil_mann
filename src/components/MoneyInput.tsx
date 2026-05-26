"use client";

import {
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
} from "react";

type MoneyValue = number | string | null | undefined;

type MoneyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "inputMode"
> & {
  value: MoneyValue;
  onValueChange: (value: number, draft: string) => void;
  fractionDigits?: number;
  emptyWhenZero?: boolean;
};

function roundMoney(value: number, fractionDigits: number) {
  const factor = 10 ** fractionDigits;
  return Math.round(value * factor) / factor;
}

export function parseMoneyInput(value: MoneyValue, fractionDigits = 2): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? roundMoney(Math.max(0, value), fractionDigits) : 0;
  }

  const raw = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!raw || raw === ".") return 0;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? roundMoney(Math.max(0, parsed), fractionDigits) : 0;
}

export function sanitizeMoneyInput(value: string, fractionDigits = 2): string {
  let result = "";
  let hasSeparator = false;

  for (const char of value.replace(/\s/g, "")) {
    if (/\d/.test(char)) {
      result += char;
      continue;
    }

    if ((char === "," || char === ".") && !hasSeparator) {
      result += ",";
      hasSeparator = true;
    }
  }

  if (!result) return "";

  const [integerRaw, fractionRaw = ""] = result.split(",");
  const integer = integerRaw.replace(/^0+(?=\d)/, "");

  if (hasSeparator) {
    return `${integer || "0"},${fractionRaw.slice(0, fractionDigits)}`;
  }

  return integer || "0";
}

function formatMoneyInputValue(value: MoneyValue, fractionDigits: number, emptyWhenZero: boolean) {
  const parsed = parseMoneyInput(value, fractionDigits);
  if (emptyWhenZero && parsed === 0) return "";
  return parsed.toLocaleString("ru-RU", {
    useGrouping: false,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export default function MoneyInput({
  value,
  onValueChange,
  fractionDigits = 2,
  emptyWhenZero = true,
  onBlur,
  onFocus,
  ...props
}: MoneyInputProps) {
  const [draft, setDraft] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const displayValue = isFocused
    ? draft
    : formatMoneyInputValue(value, fractionDigits, emptyWhenZero);

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    setIsFocused(true);
    if (emptyWhenZero && parseMoneyInput(value, fractionDigits) === 0) {
      setDraft("");
    } else {
      setDraft(formatMoneyInputValue(value, fractionDigits, emptyWhenZero));
    }
    onFocus?.(event);
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    setIsFocused(false);
    setDraft(formatMoneyInputValue(draft, fractionDigits, emptyWhenZero));
    onBlur?.(event);
  }

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={(event) => {
        const nextDraft = sanitizeMoneyInput(event.target.value, fractionDigits);
        setDraft(nextDraft);
        onValueChange(parseMoneyInput(nextDraft, fractionDigits), nextDraft);
      }}
    />
  );
}
