"use client";

import MoneyInput from "./MoneyInput";
import type { ComponentProps } from "react";

// Preserve the editable string while totals use the numeric value.
export default function QuantityInput(props: Omit<ComponentProps<typeof MoneyInput>, "fractionDigits" | "minimumFractionDigits">) {
  return <MoneyInput {...props} fractionDigits={3} minimumFractionDigits={0} />;
}
