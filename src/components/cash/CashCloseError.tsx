"use client";

import React, { useEffect, useRef } from "react";
import Link from "next/link";
import type { OverdueClientCase } from "@/lib/client-case-alerts";
import { formatServiceDateTime } from "@/lib/date-time";

export function CashCloseError({ message, cases }: { message: string | null; cases: OverdueClientCase[] }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!message) return;
    container.current?.focus({ preventScroll: true });
    container.current?.scrollIntoView({ block: "nearest" });
  }, [message]);
  if (!message) return null;
  return <div ref={container} className="eco-cash-error eco-cash-close-error" role="alert" tabIndex={-1}>
    <strong>{message}</strong>
    {cases.length > 0 && <>
      <p>Откройте дело в новой вкладке — введённые суммы в кассе сохранятся.</p>
      <ul className="eco-cash-overdue-cases" aria-label="Дела, мешающие закрытию кассы">
        {cases.map(item => <li key={item.id}>
          <Link href={`/crm?dealId=${encodeURIComponent(item.id)}`} target="_blank" rel="noopener noreferrer" prefetch={false}>
            {item.title || "Дело клиента"} <span aria-label="Открыть в новой вкладке">↗</span>
          </Link>
          {item.client && item.client !== item.title && <span>{item.client}</span>}
          {item.nextAction && item.nextAction !== item.title && <span>{item.nextAction}</span>}
          <span>Срок: <time dateTime={item.deadline}>{formatServiceDateTime(item.deadline)}</time></span>
        </li>)}
      </ul>
    </>}
  </div>;
}
