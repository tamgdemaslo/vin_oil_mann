"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Keep the cell picker beside its trigger, outside the table's scrolling box. */
export default function ReceiptCellPopover({ anchor, onClose, children }: {
  anchor: HTMLButtonElement;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ left: 0, top: 0, maxHeight: 400, ready: false });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const place = () => {
      if (!anchor.isConnected || !anchor.getClientRects().length) {
        onClose();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const margin = 12;
      const gap = 6;
      const below = window.innerHeight - rect.bottom - gap - margin;
      const above = rect.top - gap - margin;
      const openAbove = below < Math.min(panel.scrollHeight, 360) && above > below;
      const maxHeight = Math.max(80, openAbove ? above : below);
      const height = Math.min(panel.scrollHeight, maxHeight);
      setLayout({
        left: Math.max(margin, Math.min(rect.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - margin)),
        top: openAbove ? Math.max(margin, rect.top - gap - height) : rect.bottom + gap,
        maxHeight,
        ready: true,
      });
    };
    place();
    panel.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const dismiss = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchor.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismiss);
    panel.addEventListener("keydown", escape);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", dismiss);
      panel.removeEventListener("keydown", escape);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={panelRef} id="receipt-cell-picker" className="eco-receipt-cell-anchor"
      style={{ left: layout.left, top: layout.top, maxHeight: layout.maxHeight, opacity: layout.ready ? 1 : 0 }}>
      {children}
    </div>,
    anchor.closest("[role=dialog]") ?? document.body,
  );
}
