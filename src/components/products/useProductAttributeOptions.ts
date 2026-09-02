"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProductAttributeField, ProductAttributeMatch } from "@/lib/product-attribute-values";

export type ProductAttributeOptionResponse = {
  field: ProductAttributeField;
  options: Array<{ value: string; matchKind: string; usageCount: number }>;
  suggestion: string | null;
  normalization: ProductAttributeMatch | null;
  resolvedSelected: ProductAttributeMatch[];
  metadata: { version: string; generatedAt: string; complete: boolean; missingSource: boolean };
  error?: string;
};

const responseCache = new Map<string, ProductAttributeOptionResponse>();

export function parseComboboxValues(value: string) {
  return value.split(/[;\r\n]+/).map((part) => part.trim()).filter(Boolean);
}

export function serializeComboboxValues(values: readonly string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.normalize("NFKC").trim().toLocaleUpperCase("ru-RU");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join("; ");
}

export function useProductAttributeOptions(input: {
  field: ProductAttributeField;
  open: boolean;
  query: string;
  selected: string[];
}) {
  const [data, setData] = useState<ProductAttributeOptionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const selectedKey = useMemo(() => input.selected.join("\u0000"), [input.selected]);

  useEffect(() => {
    if (!input.open) return;
    const timer = window.setTimeout(async () => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      const params = new URLSearchParams({ field: input.field, q: input.query.trim(), limit: "40" });
      for (const selected of selectedKey ? selectedKey.split("\u0000") : []) params.append("selected", selected);
      const cacheKey = `${input.field}\u0000${input.query.trim().toLocaleUpperCase("ru-RU")}\u0000${selectedKey}`;
      const cached = responseCache.get(cacheKey);
      if (cached && revision === 0) {
        setData(cached);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/inventory/product-attribute-options?${params}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => ({})) as ProductAttributeOptionResponse;
        if (!response.ok) throw new Error(payload.error || "Не удалось загрузить справочник");
        if (!controller.signal.aborted) {
          responseCache.set(cacheKey, payload);
          setData(payload);
          setRevision(0);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить справочник");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, input.query.trim() ? 120 : 0);
    return () => {
      window.clearTimeout(timer);
      requestRef.current?.abort();
    };
  }, [input.field, input.open, input.query, revision, selectedKey]);

  const retry = useCallback(() => setRevision((current) => current + 1), []);
  return { data, loading, error, retry };
}

export function useComboboxPopover(open: boolean) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rectangle = anchorRef.current?.getBoundingClientRect();
      if (!rectangle) return;
      const padding = 10;
      const mobile = window.innerWidth <= 640;
      if (mobile) {
        setPosition({ top: Math.max(padding, window.innerHeight * 0.18), left: padding, width: window.innerWidth - padding * 2, maxHeight: window.innerHeight * 0.72 });
        return;
      }
      const width = Math.min(Math.max(rectangle.width, 340), window.innerWidth - padding * 2);
      const roomBelow = window.innerHeight - rectangle.bottom - padding;
      const roomAbove = rectangle.top - padding;
      const maxHeight = Math.min(380, Math.max(190, Math.max(roomBelow, roomAbove)));
      const top = roomBelow >= Math.min(260, maxHeight) ? rectangle.bottom + 6 : Math.max(padding, rectangle.top - maxHeight - 6);
      setPosition({ top, left: Math.min(Math.max(padding, rectangle.left), window.innerWidth - width - padding), width, maxHeight });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  return { anchorRef, popupRef, position };
}
