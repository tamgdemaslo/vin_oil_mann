"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function AIAssistantError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ai-assistant] route error", error);
  }, [error]);

  return (
    <main className="eco-page eco-page--wide eco-aiw-page">
      <section className="eco-aiw-recovery" role="alert" aria-live="assertive">
        <AlertTriangle size={24} aria-hidden />
        <div>
          <p className="eco-page-kicker">ИИ-помощник</p>
          <h1>Не удалось открыть диалог</h1>
          <p>Данные могли обновиться во время загрузки. Повторите попытку — сообщения и расчёты не будут потеряны.</p>
          <div className="eco-aiw-recovery__actions">
            <button type="button" className="is-primary" onClick={reset}><RefreshCw size={16} /> Повторить загрузку</button>
            <button type="button" onClick={() => window.location.reload()}>Обновить страницу</button>
          </div>
        </div>
      </section>
    </main>
  );
}
