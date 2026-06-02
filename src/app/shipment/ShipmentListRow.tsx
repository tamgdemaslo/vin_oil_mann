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
  plate: string;
  ecoUserName: string;
  sumLabel: string;
};

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
  plate,
  ecoUserName,
  sumLabel,
}: ShipmentListRowProps) {
  const router = useRouter();
  const href = `/shipment/${row.id}`;

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
          {row.name}
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
      <td>
        <div className="eco-shipment-list-soft">—</div>
        <div className="l-mono eco-shipment-list-subtext">{plate}</div>
      </td>
      <td>
        <div>{row.organization?.name ?? "—"}</div>
        <div className="eco-shipment-list-subtext">{row.store?.name ?? "—"}</div>
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
