"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProductAttributeField, ProductAttributeMatch } from "@/lib/product-attribute-values";

export type ProductAttributeOptionResponse = {
  field: ProductAttributeField;
  options: Array<{ value: string; matchKind: string; usageCount: number }>;
  suggestion: string | null;
  normalization: ProductAttributeMatch | null;
  resolvedSelected: ProductAttributeMatch[];
  pagination: { offset: number; limit: number; total: number; hasMore: boolean; nextOffset: number | null };
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const loadMoreRequestRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);
  const selectedKey = useMemo(() => input.selected.join("\u0000"), [input.selected]);
  const requestKey = `${input.field}\u0000${input.query.trim().toLocaleUpperCase("ru-RU")}\u0000${selectedKey}`;

  const fetchPage = useCallback(async (offset: number, append: boolean, force = false) => {
    if (append && loadingMoreRef.current) return;
    const controller = new AbortController();
    if (append) {
      loadMoreRequestRef.current?.abort();
      loadMoreRequestRef.current = controller;
      loadingMoreRef.current = true;
      setLoadingMore(true);
      setLoadMoreError(null);
    } else {
      requestRef.current?.abort();
      requestRef.current = controller;
      setLoading(true);
      setError(null);
    }

    const params = new URLSearchParams({ field: input.field, q: input.query.trim(), limit: "40", offset: String(offset) });
    for (const selected of selectedKey ? selectedKey.split("\u0000") : []) params.append("selected", selected);
    const cacheKey = `${requestKey}\u0000${offset}`;
    const applyPayload = (payload: ProductAttributeOptionResponse) => {
      setData((current) => {
        if (!append || !current) return payload;
        const seen = new Set(current.options.map((option) => option.value));
        return {
          ...payload,
          options: [...current.options, ...payload.options.filter((option) => !seen.has(option.value))],
          resolvedSelected: current.resolvedSelected,
        };
      });
    };

    try {
      const cached = !force ? responseCache.get(cacheKey) : null;
      if (cached) {
        applyPayload(cached);
        return;
      }
      const response = await fetch(`/api/inventory/product-attribute-options?${params}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => ({})) as ProductAttributeOptionResponse;
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить справочник");
      if (!controller.signal.aborted) {
        responseCache.set(cacheKey, payload);
        applyPayload(payload);
        if (!append) setRevision(0);
      }
    } catch (loadError) {
      if (!controller.signal.aborted) {
        const message = loadError instanceof Error ? loadError.message : "Не удалось загрузить справочник";
        if (append) setLoadMoreError(message);
        else setError(message);
      }
    } finally {
      if (!controller.signal.aborted) {
        if (append) {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        } else {
          setLoading(false);
        }
      }
    }
  }, [input.field, input.query, requestKey, selectedKey]);

  useEffect(() => {
    if (!input.open) return;
    loadMoreRequestRef.current?.abort();
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);
    const timer = window.setTimeout(() => { void fetchPage(0, false, revision > 0); }, input.query.trim() ? 120 : 0);
    return () => {
      window.clearTimeout(timer);
      requestRef.current?.abort();
      loadMoreRequestRef.current?.abort();
    };
  }, [fetchPage, input.open, input.query, revision]);

  const retry = useCallback(() => setRevision((current) => current + 1), []);
  const loadMore = useCallback(async () => {
    if (!data?.pagination.hasMore || data.pagination.nextOffset === null || loadingMoreRef.current) return;
    await fetchPage(data.pagination.nextOffset, true);
  }, [data, fetchPage]);
  return { data, loading, loadingMore, error, loadMoreError, retry, loadMore };
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
