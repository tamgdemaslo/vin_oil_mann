"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, type KeyboardEvent, type MouseEvent } from "react";
import { EcoBadge } from "@/components/platform/EcoUI";
import { ShipmentRowActions } from "./ShipmentRowActions";

type ShipmentListRowProps = {
  row: {
    id: string;
    name: string;
    applicable: boolean;
    paymentStatus: "paid" | "unpaid" | "unknown";
    sum: number;
    organization?: { name?: string };
    store?: { name?: string };
  };
  moment: { date: string; time: string };
  counterpartyName: string;
  counterpartyHref: string | null;
  counterpartyId: string | null;
  vehiclePrimary: string;
  vehicleSecondary: string;
  vehicleTitle: string;
  ecoUserName: string;
  sumLabel: string;
  phone: string;
  vin: string;
  positionCount: number;
  selected: boolean;
  selectionActive: boolean;
  showPhone: boolean;
  showVin: boolean;
  showPositionCount: boolean;
  onSelectionChange: (selected: boolean) => void;
};

function shipmentNumberLabel(name: string): string {
  const clean = name.trim();
  const numeric = clean.match(/^\d+$/)?.[0] ?? clean.match(/-(\d+)$/)?.[1] ?? "";
  return numeric ? numeric.padStart(4, "0") : clean;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "a, button, input, select, textarea, summary, details, svg, [role='button'], [data-row-action]"
    )
  );
}

export function ShipmentListRow({
  row,
  moment,
  counterpartyName,
  counterpartyHref,
  counterpartyId,
  vehiclePrimary,
  vehicleSecondary,
  vehicleTitle,
  ecoUserName,
  sumLabel,
  phone,
  vin,
  positionCount,
  selected,
  selectionActive,
  showPhone,
  showVin,
  showPositionCount,
  onSelectionChange,
}: ShipmentListRowProps) {
  const router = useRouter();
  const href = `/shipment/${row.id}`;
  const numberLabel = shipmentNumberLabel(row.name);

  function openRow(event: MouseEvent<HTMLTableRowElement>) {
    if (isInteractiveTarget(event.target)) return;
    if (selectionActive) {
      onSelectionChange(!selected);
      return;
    }
    router.push(href);
  }

  function openRowFromKeyboard(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();
    if (selectionActive) {
      onSelectionChange(!selected);
      return;
    }
    router.push(href);
  }

  function toggleSelection(event: ChangeEvent<HTMLInputElement>) {
    event.stopPropagation();
    onSelectionChange(event.target.checked);
  }

  return (
    <tr
      className={`eco-shipment-list-row ${selected ? "is-selected" : ""}`}
      onClick={openRow}
      onKeyDown={openRowFromKeyboard}
      tabIndex={0}
      role="link"
      aria-label={`Открыть отгрузку ${row.name}`}
    >
      <td className="eco-shipment-cell--select" data-row-action>
        <input
          type="checkbox"
          className="eco-shipment-select"
          checked={selected}
          onChange={toggleSelection}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Выбрать отгрузку ${numberLabel}`}
        />
      </td>
      <td className="eco-shipment-cell--document">
        <Link href={href} className="l-mono eco-shipment-list-number-link">
          {numberLabel}
        </Link>
        <div className="l-mono eco-shipment-list-subtext">
          {moment.date} · {moment.time}{showPositionCount && positionCount > 0 ? ` · ${positionCount} поз.` : ""}
        </div>
      </td>
      <td className="eco-shipment-cell--client">
        {counterpartyHref ? (
          <Link
            href={counterpartyHref}
            className="eco-shipment-list-counterparty-link"
            title="Открыть контрагента"
          >
            {counterpartyName}
          </Link>
        ) : (
          <div className="eco-shipment-list-strong">{counterpartyName}</div>
        )}
      </td>
      {showPhone ? <td className="l-mono eco-shipment-list-secondary eco-shipment-cell--phone">{phone || "—"}</td> : null}
      <td className="eco-shipment-cell--vehicle" title={vehicleTitle}>
        <div className={vehiclePrimary === "—" ? "eco-shipment-list-soft" : "eco-shipment-list-strong"}>{vehiclePrimary}</div>
        {vehicleSecondary ? <div className="l-mono eco-shipment-list-subtext">{vehicleSecondary}</div> : null}
      </td>
      {showVin ? <td className="l-mono eco-shipment-list-secondary eco-shipment-cell--vin" title={vin}>{vin || "—"}</td> : null}
      <td className="eco-shipment-cell--store">
        <div>{row.store?.name ?? "—"}</div>
      </td>
      <td className="eco-shipment-cell--creator">{ecoUserName}</td>
      <td className="eco-shipment-cell--status">
        <EcoBadge tone={row.applicable ? "success" : "neutral"} dot>
          {row.applicable ? "Проведено" : "Черновик"}
        </EcoBadge>
      </td>
      <td className="eco-shipment-cell--payment">
        <EcoBadge tone={row.paymentStatus === "paid" ? "success" : row.paymentStatus === "unpaid" ? "warning" : "neutral"} dot>
          {row.paymentStatus === "paid" ? "Оплачено" : row.paymentStatus === "unpaid" ? "Не оплачено" : "Не указано"}
        </EcoBadge>
      </td>
      <td className="l-money eco-shipment-list-sum eco-shipment-cell--sum">{sumLabel}</td>
      <td className="eco-shipment-list-actions eco-shipment-cell--actions" data-row-action>
        <ShipmentRowActions
          shipmentId={row.id}
          counterpartyId={counterpartyId}
          counterpartyName={counterpartyName}
          phone={phone}
          vehicleLabel={vehicleTitle || vehiclePrimary}
        />
      </td>
    </tr>
  );
}
