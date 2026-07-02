"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type MouseEvent } from "react";
import { EcoBadge } from "@/components/platform/EcoUI";
import { ShipmentRowActions } from "./ShipmentRowActions";

type ShipmentListRowProps = {
  row: {
    id: string;
    name: string;
    applicable: boolean;
    sum: number;
    organization?: { name?: string };
    store?: { name?: string };
  };
  moment: { date: string; time: string };
  counterpartyName: string;
  counterpartyHref: string | null;
  vehiclePrimary: string;
  vehicleSecondary: string;
  vehicleTitle: string;
  ecoUserName: string;
  sumLabel: string;
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
  vehiclePrimary,
  vehicleSecondary,
  vehicleTitle,
  ecoUserName,
  sumLabel,
}: ShipmentListRowProps) {
  const router = useRouter();
  const href = `/shipment/${row.id}`;
  const numberLabel = shipmentNumberLabel(row.name);

  function openRow(event: MouseEvent<HTMLTableRowElement>) {
    if (isInteractiveTarget(event.target)) return;
    router.push(href);
  }

  function openRowFromKeyboard(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();
    router.push(href);
  }

  return (
    <tr
      className="eco-shipment-list-row"
      onClick={openRow}
      onKeyDown={openRowFromKeyboard}
      tabIndex={0}
      role="link"
      aria-label={`Открыть отгрузку ${row.name}`}
    >
      <td data-row-action>
        <span className="eco-check" />
      </td>
      <td>
        <Link href={href} className="l-mono eco-shipment-list-number-link">
          {numberLabel}
        </Link>
        <div className="l-mono eco-shipment-list-subtext">
          {moment.date} · {moment.time}
        </div>
      </td>
      <td>
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
        <div className="l-mono eco-shipment-list-subtext">телефон в карточке клиента</div>
      </td>
      <td title={vehicleTitle}>
        <div className="eco-shipment-list-strong">{vehiclePrimary}</div>
        <div className="l-mono eco-shipment-list-subtext">{vehicleSecondary || " "}</div>
      </td>
      <td>
        <div>{row.store?.name ?? "—"}</div>
        <div className="eco-shipment-list-subtext">склад отгрузки</div>
      </td>
      <td>{ecoUserName}</td>
      <td>
        <EcoBadge tone={row.applicable ? "success" : "neutral"} dot>
          {row.applicable ? "Проведено" : "Черновик"}
        </EcoBadge>
      </td>
      <td>
        <EcoBadge tone={row.sum > 0 ? "success" : "warning"} dot>
          {row.sum > 0 ? "Оплачено" : "Не оплачено"}
        </EcoBadge>
      </td>
      <td className="l-money eco-shipment-list-sum">{sumLabel}</td>
      <td className="eco-shipment-list-actions" data-row-action>
        <div className="eco-row-actions">
          <ShipmentRowActions shipmentId={row.id} />
        </div>
      </td>
    </tr>
  );
}
