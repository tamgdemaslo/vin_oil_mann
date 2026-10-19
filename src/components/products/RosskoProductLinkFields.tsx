"use client";

import { useEffect, useRef, useState } from "react";

export default function RosskoProductLinkFields({ disabled, onFill, onLoadingChange }: {
  disabled: boolean;
  onFill: (fields: Record<string, string>) => boolean;
  onLoadingChange: (loading: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const latestFill = useRef(onFill);
  useEffect(() => { latestFill.current = onFill; }, [onFill]);
  useEffect(() => () => { pending.current?.abort(); onLoadingChange(false); }, [onLoadingChange]);

  async function load() {
    if (!url.trim() || loading || disabled) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    onLoadingChange(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/products/rossko/link", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить товар ROSSKO");
      if (controller.signal.aborted) return;
      if (latestFill.current(data.fields)) setMessage(data.message);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Не удалось загрузить товар ROSSKO");
    } finally {
      if (!controller.signal.aborted) { setLoading(false); onLoadingChange(false); }
    }
  }

  return (
    <section className="product-editor-section" aria-label="Заполнение по ссылке ROSSKO" aria-busy={loading}>
      <div className="product-editor-section-head"><div>
        <h3>Товар по ссылке ROSSKO</h3>
        <p>Вставьте ссылку на товар, чтобы заполнить карточку перед сохранением.</p>
      </div></div>
      <label className="product-editor-field">
        <span className="product-editor-label">Ссылка на товар ROSSKO</span>
        <input className="eco-input product-editor-input" type="url" value={url} disabled={loading || disabled}
          onChange={(event) => { setUrl(event.target.value); setError(""); setMessage(""); }}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void load(); } }}
          placeholder="https://kgd.rossko.ru/product/?text=NSIN…" />
      </label>
      <button className="eco-btn" type="button" onClick={() => void load()} disabled={!url.trim() || loading || disabled}>
        {loading ? "Загружаем товар…" : "Заполнить по ссылке"}
      </button>
      {error ? <p className="product-editor-alert is-error" role="alert">{error}</p> : null}
      {message ? <p className="product-editor-alert" role="status">{message}</p> : null}
    </section>
  );
}
