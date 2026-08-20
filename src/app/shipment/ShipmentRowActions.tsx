"use client";

import Link from "next/link";
import { Copy, ExternalLink, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import { ContactActionButton } from "@/components/messenger/ContactActionButton";

type ShipmentRowActionsProps = {
  shipmentId: string;
  counterpartyId: string | null;
  counterpartyName: string;
  phone?: string | null;
  vehicleLabel: string;
};

export function ShipmentRowActions({
  shipmentId,
  counterpartyId,
  counterpartyName,
  phone,
  vehicleLabel,
}: ShipmentRowActionsProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "copy" | "delete">("idle");

  async function handleCopy(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (phase !== "idle") return;
    if (!window.confirm("Создать копию отгрузки? Клиент, автомобиль и позиции сохранятся, а новый документ будет черновиком.")) return;
    setPhase("copy");
    try {
      const res = await fetch(`/api/demands/${encodeURIComponent(shipmentId)}/copy`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(typeof json.error === "string" ? json.error : "Не удалось создать копию");
        return;
      }
      const copiedId = typeof json.id === "string" ? json.id : typeof json.demand?.id === "string" ? json.demand.id : "";
      if (copiedId) {
        router.push(`/shipment/${copiedId}/edit?copied=1`);
        return;
      }
      window.alert("Копия создана, но сервер не вернул её идентификатор");
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
    if (!window.confirm("Удалить эту отгрузку? Действие необратимо.")) return;
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
    <details className="eco-shipment-row-menu">
      <summary aria-label="Действия с отгрузкой" title="Действия">
        <MoreHorizontal aria-hidden />
      </summary>
      <div className="eco-shipment-row-menu__popover">
        <Link href={`/shipment/${shipmentId}`}>
          <ExternalLink aria-hidden />
          Открыть
        </Link>
        <button type="button" onClick={(event) => void handleCopy(event)} disabled={phase !== "idle"}>
          <Copy aria-hidden />
          {phase === "copy" ? "Создаём копию…" : "Создать копию"}
        </button>
        <ContactActionButton
          variant="link"
          size="sm"
          label="Написать клиенту"
          entityType="shipment"
          entityId={shipmentId}
          counterpartyId={counterpartyId}
          phone={phone}
          displayName={counterpartyName}
          context={{ entityType: "shipment", entityId: shipmentId, shipmentId, car: vehicleLabel }}
        />
        <span className="eco-shipment-row-menu__divider" />
        <button type="button" className="is-danger" onClick={(event) => void handleDelete(event)} disabled={phase !== "idle"}>
          <Trash2 aria-hidden />
          {phase === "delete" ? "Удаляем…" : "Удалить"}
        </button>
      </div>
    </details>
  );
}
