"use client";

import { useEffect, useState } from "react";
import styles from "./maintenance-quote.module.css";

export type QuoteVehicleSelection = { variantId: string; make: string; model: string; year?: number | null };
type Variant = { variantId: string; effectiveVehicleText?: string; vehicleText?: string; engineCode?: string; vehicleYears?: string };

function useCatalogOptions<T>(path: string, field: string) {
  const [result, setResult] = useState<{ path: string; items: T[]; failed?: boolean }>();
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    fetch(`/api/mann-catalog/${path}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Ошибка каталога");
      const data = await response.json() as Record<string, T[]>;
      if (!controller.signal.aborted) setResult({ path, items: data[field] ?? [] });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ path, items: [], failed: true });
    });
    return () => controller.abort();
  }, [path, field]);
  return result?.path === path ? result : undefined;
}

export function ManualVehiclePicker({ active, onSelect }: { active: boolean; onSelect: (selection: QuoteVehicleSelection | null) => void }) {
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [variantId, setVariantId] = useState("");
  const makes = useCatalogOptions<{ make: string }>(active ? "makes" : "", "makes");
  const models = useCatalogOptions<{ model: string }>(active && make ? `models?${new URLSearchParams({ make })}` : "", "models");
  const variants = useCatalogOptions<Variant>(active && model ? `variants?${new URLSearchParams({ make, model })}` : "", "variants");
  return <>
    <div className={styles.catalogFields}>
      <label>Марка
        <select value={make} onChange={(event) => { setMake(event.target.value); setModel(""); setVariantId(""); onSelect(null); }}>
          <option value="">{makes ? "Выберите марку" : "Загружаем марки…"}</option>
          {makes?.items.map((item) => <option key={item.make}>{item.make}</option>)}
        </select>
      </label>
      <label>Модель
        <select value={model} disabled={!make || !models} onChange={(event) => { setModel(event.target.value); setVariantId(""); onSelect(null); }}>
          <option value="">{make && !models ? "Загружаем модели…" : "Выберите модель"}</option>
          {models?.items.map((item) => <option key={item.model}>{item.model}</option>)}
        </select>
      </label>
      <label>Модификация
        <select value={variantId} disabled={!model || !variants} onChange={(event) => {
          const next = event.target.value;
          setVariantId(next);
          onSelect(next ? { make, model, variantId: next } : null);
        }}>
          <option value="">{model && !variants ? "Загружаем модификации…" : "Выберите модификацию"}</option>
          {variants?.items.map((item) => <option key={item.variantId} value={item.variantId}>
            {[item.effectiveVehicleText || item.vehicleText, item.engineCode, item.vehicleYears].filter(Boolean).join(" · ") || item.variantId}
          </option>)}
        </select>
      </label>
    </div>
    {(makes?.failed || models?.failed || variants?.failed) && <p className={styles.error} role="status">Не удалось загрузить каталог MANN. Можно указать артикул фильтра вручную.</p>}
  </>;
}
