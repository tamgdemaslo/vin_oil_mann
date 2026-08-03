"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";

export function ShipmentRowActions({ shipmentId }: { shipmentId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "copy" | "delete">("idle");

  async function handleCopy(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (phase !== "idle") return;
    setPhase("copy");
    try {
      const res = await fetch(`/api/demands/${encodeURIComponent(shipmentId)}/copy`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(typeof json.error === "string" ? json.error : "Не удалось скопировать отгрузку");
        return;
      }
      const copiedId = typeof json.id === "string" ? json.id : typeof json.demand?.id === "string" ? json.demand.id : "";
      if (copiedId) {
        router.push(`/shipment/${copiedId}/edit?copied=1`);
        return;
      }
      console.error("[shipment] copy response without id:", json);
      window.alert("Отгрузка могла быть скопирована, но сервер не вернул id нового черновика");
    } catch {
      window.alert("Ошибка сети при копировании");
    } finally {
      setPhase("idle");
    }
  }

  async function handleDelete(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (phase !== "idle") return;
    if (!window.confirm("Удалить локальную отгрузку? Действие необратимо.")) return;
    setPhase("delete");
    try {
      const res = await fetch(`/api/demands/${encodeURIComponent(shipmentId)}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(typeof json.error === "string" ? json.error : "Не удалось удалить отгрузку");
        return;
      }
      router.refresh();
    } catch {
      window.alert("Ошибка сети при удалении");
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <button
        type="button"
        onClick={(e) => void handleCopy(e)}
        disabled={phase !== "idle"}
        className="rounded border border-zinc-200 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-700"
      >
        {phase === "copy" ? "…" : "Копировать"}
      </button>
      <button
        type="button"
        onClick={(e) => void handleDelete(e)}
        disabled={phase !== "idle"}
        className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
      >
        {phase === "delete" ? "…" : "Удалить"}
      </button>
    </div>
  );
}
