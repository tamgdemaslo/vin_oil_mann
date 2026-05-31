"use client";

import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Loader2, Printer } from "lucide-react";

export type ShipmentPrintTemplate =
  | "eco_poster"
  | "eco_poster_akpp_partial"
  | "eco_poster_akpp_full"
  | "under_hood_tags"
  | "under_hood_tags_akpp_partial"
  | "under_hood_tags_akpp_full";

type ShipmentPrintMenuProps = {
  shipmentId?: string | null;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
  align?: "left" | "right";
  onBeforePrint?: () => Promise<boolean> | boolean;
};

const PRINT_GROUPS: Array<{
  key: string;
  title: string;
  items: Array<{ key: ShipmentPrintTemplate; label: string; hrefKind: "poster" | "tags"; variant?: string }>;
}> = [
  {
    key: "poster",
    title: "Заказ-наряд",
    items: [
      { key: "eco_poster", label: "Заказ-наряд — постер Эко (А4)", hrefKind: "poster" },
      { key: "eco_poster_akpp_partial", label: "Заказ-наряд — постер · АКПП частичная (+20 тыс. км)", hrefKind: "poster", variant: "akpp_partial" },
      { key: "eco_poster_akpp_full", label: "Заказ-наряд — постер · АКПП полная (+60 тыс. км)", hrefKind: "poster", variant: "akpp_full" },
    ],
  },
  {
    key: "tags",
    title: "Бирка под капот",
    items: [
      { key: "under_hood_tags", label: "Бирка под капот (интервал из настроек)", hrefKind: "tags" },
      { key: "under_hood_tags_akpp_partial", label: "Бирка под капот · АКПП частичная (+20 тыс. км)", hrefKind: "tags", variant: "akpp_partial" },
      { key: "under_hood_tags_akpp_full", label: "Бирка под капот · АКПП полная (+60 тыс. км)", hrefKind: "tags", variant: "akpp_full" },
    ],
  },
];

function printHref(shipmentId: string, hrefKind: "poster" | "tags", variant?: string): string {
  const params = new URLSearchParams({ autoprint: "1" });
  if (variant) params.set("variant", variant);
  return `/shipment/${encodeURIComponent(shipmentId)}/${hrefKind}?${params.toString()}`;
}

export function ShipmentPrintMenu({
  shipmentId,
  disabled,
  disabledReason = "Сначала сохраните отгрузку",
  className = "",
  align = "right",
  onBeforePrint,
}: ShipmentPrintMenuProps) {
  const [open, setOpen] = useState(false);
  const [printingKey, setPrintingKey] = useState<ShipmentPrintTemplate | null>(null);
  const [lastUsedKey, setLastUsedKey] = useState<ShipmentPrintTemplate>("eco_poster");
  const [error, setError] = useState<string | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const isDisabled = disabled || !shipmentId;
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const updatePanelPosition = () => {
      const button = buttonRef.current;
      if (!button || window.innerWidth <= 760) {
        setPanelStyle(null);
        return;
      }

      const rect = button.getBoundingClientRect();
      const width = Math.min(430, window.innerWidth - 32);
      const leftEdge = align === "left" ? rect.left : rect.right - width;
      const left = Math.min(Math.max(16, leftEdge), Math.max(16, window.innerWidth - width - 16));
      const spaceBelow = window.innerHeight - rect.bottom - 16;
      const spaceAbove = rect.top - 16;
      const openUp = spaceBelow < 320 && spaceAbove > spaceBelow;
      const availableHeight = Math.max(220, openUp ? spaceAbove : spaceBelow);

      setPanelStyle({
        position: "fixed",
        left,
        right: "auto",
        top: openUp ? "auto" : rect.bottom + 8,
        bottom: openUp ? window.innerHeight - rect.top + 8 : "auto",
        width,
        maxHeight: Math.min(420, availableHeight),
      });
    };

    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [align, open]);

  async function handlePrint(
    item: { key: ShipmentPrintTemplate; label: string; hrefKind: "poster" | "tags"; variant?: string }
  ) {
    if (!shipmentId || isDisabled || printingKey) return;
    setPrintingKey(item.key);
    setError(null);
    try {
      const canPrint = onBeforePrint ? await onBeforePrint() : true;
      if (!canPrint) return;
      setLastUsedKey(item.key);
      setOpen(false);
      window.open(printHref(shipmentId, item.hrefKind, item.variant), "_blank", "noopener,noreferrer");
    } catch {
      setError("Не удалось сформировать печатную форму");
    } finally {
      setPrintingKey(null);
    }
  }

  const menu = (
    <div className={`eco-print-menu__panel ${align === "left" ? "is-left" : "is-right"}`} role="menu" id={menuId} style={panelStyle ?? undefined}>
      <div className="eco-print-menu__eyebrow">Печать из CRM</div>
      {PRINT_GROUPS.map((group) => (
        <section key={group.key} className="eco-print-menu__group">
          <div className="eco-print-menu__group-title">{group.title}</div>
          {group.items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={Boolean(printingKey)}
              onClick={() => void handlePrint(item)}
              className="eco-print-menu__item"
            >
              <span className="eco-print-menu__check">
                {lastUsedKey === item.key ? <Check aria-hidden /> : null}
              </span>
              <span>{item.label}</span>
              {printingKey === item.key ? <Loader2 className="eco-print-menu__spinner" aria-hidden /> : null}
            </button>
          ))}
        </section>
      ))}
      {error ? <div className="eco-print-menu__error">{error}</div> : null}
    </div>
  );

  return (
    <div className={`eco-print-menu ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className="eco-print-menu__button"
        disabled={isDisabled || Boolean(printingKey)}
        title={isDisabled ? disabledReason : undefined}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          if (isDisabled) return;
          setOpen((value) => !value);
        }}
      >
        {printingKey ? <Loader2 className="eco-print-menu__spinner" aria-hidden /> : <Printer aria-hidden />}
        <span>{printingKey ? "Готовим…" : "Печать"}</span>
        <ChevronDown aria-hidden />
      </button>
      {open ? (
        <>
          <button type="button" className="eco-print-menu__scrim" aria-label="Закрыть печать" onClick={() => setOpen(false)} />
          {menu}
        </>
      ) : null}
    </div>
  );
}
