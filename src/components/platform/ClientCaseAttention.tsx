import React from "react";
import Link from "next/link";
import type { ClientCaseAttention } from "@/lib/client-case-attention";

export function ClientAttentionBadges({ counts }: { counts: ClientCaseAttention | null }) {
  if (!counts || (!counts.overdue && !counts.calculationNeeded)) return null;
  return <span className="platform-shell__client-attention" aria-live="polite">
    {counts.overdue > 0 && <span className="platform-shell__client-count is-overdue" title={`Просроченных дел: ${counts.overdue}`} aria-label={`Просроченных дел: ${counts.overdue}`}>{counts.overdue} проср.</span>}
    {counts.calculationNeeded > 0 && <span className="platform-shell__client-count is-calculation" title={`Нужно рассчитать: ${counts.calculationNeeded}`} aria-label={`Нужно рассчитать: ${counts.calculationNeeded}`}>{counts.calculationNeeded} расч.</span>}
  </span>;
}

export function ClientAttentionLinks({ counts, mobile = false, onNavigate }: { counts: ClientCaseAttention | null; mobile?: boolean; onNavigate?: () => void }) {
  if (!counts) return null;
  const className = mobile ? "platform-shell__mobile-link" : "platform-shell__dropdown-link";
  return <>
    {counts.overdue > 0 && <Link href="/crm?filter=overdue" prefetch={false} onClick={onNavigate} className={className} role={mobile ? undefined : "menuitem"}><span>Просроченные дела · {counts.overdue}</span><small>Требуют внимания</small></Link>}
    {counts.calculationNeeded > 0 && <Link href="/crm?filter=calculation_needed" prefetch={false} onClick={onNavigate} className={className} role={mobile ? undefined : "menuitem"}><span>Нужно рассчитать · {counts.calculationNeeded}</span><small>Включая заявки с сайта</small></Link>}
  </>;
}
