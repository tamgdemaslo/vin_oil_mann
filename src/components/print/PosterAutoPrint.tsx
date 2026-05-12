"use client";

import { useEffect } from "react";

/** После загрузки шрифтов открывает диалог печати (как в макете HTML). */
export function PosterAutoPrint({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        if (document.fonts?.ready) await document.fonts.ready;
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 450));
      if (!cancelled) window.print();
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return null;
}
