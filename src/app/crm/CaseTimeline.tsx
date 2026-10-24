"use client";

import { useEffect, useId, useState } from "react";
import { caseHistoryLines, type CaseHistoryEvent } from "@/lib/client-case-history";
import { formatServiceDateTime } from "@/lib/date-time";
import styles from "./simple-crm.module.css";

export default function CaseTimeline({ caseId, version, employeeName }: { caseId: string; version: string; employeeName: (login: string) => string }) {
  const [events, setEvents] = useState<CaseHistoryEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  useEffect(() => {
    const controller = new AbortController();
    setEvents(null); setError(null); setShowAll(false);
    void (async () => {
      try {
        const response = await fetch(`/api/client-cases/${encodeURIComponent(caseId)}/timeline`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось загрузить историю");
        if (!controller.signal.aborted) setEvents(data.events ?? []);
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Не удалось загрузить историю");
      }
    })();
    return () => controller.abort();
  }, [caseId, version, retry]);
  const entries = (events ?? []).map(event => ({ ...event, lines: caseHistoryLines(event) })).filter(event => event.lines.length);
  const visibleEntries = showAll ? entries : entries.slice(0, 3);
  return <section className={styles.timeline} aria-label="История изменений заявки">
    <h3>История изменений</h3>
    {error ? <p role="alert">{error} <button type="button" className="eco-btn" onClick={() => setRetry(value => value + 1)}>Повторить</button></p> : events === null ? <p role="status">Загружаем историю…</p> : entries.length ? <><ol id={listId}>{visibleEntries.map(event => <li key={event.id}>
      <div className={styles.timelineMeta}><strong>{event.actorLogin ? employeeName(event.actorLogin) : "Автор не указан"}</strong><time dateTime={event.createdAt}>{formatServiceDateTime(event.createdAt)}</time></div>
      {event.lines.map((line, index) => <p key={index}>{line}</p>)}
    </li>)}</ol>{entries.length > 3 && <button type="button" className={`eco-btn ${styles.timelineToggle}`} aria-expanded={showAll} aria-controls={listId} onClick={() => setShowAll(value => !value)}>{showAll ? "Свернуть историю" : "Вся история"}</button>}</> : <p>Изменений статуса или срока пока не зафиксировано.</p>}
  </section>;
}
