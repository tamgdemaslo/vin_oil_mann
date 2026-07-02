"use client";

import Link from "next/link";
import { Download, Printer } from "lucide-react";

export function ClosingDocumentToolbar({
  shipmentId,
  documentId,
  pdfHref,
}: {
  shipmentId: string;
  documentId?: string;
  pdfHref: string;
}) {
  return (
    <nav className="cdoc-toolbar no-print" aria-label="Действия с закрывающим документом">
      <Link href={`/shipment/${encodeURIComponent(shipmentId)}`}>К отгрузке</Link>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => window.print()}>
          <Printer size={16} aria-hidden />
          Печать
        </button>
        <a className="is-primary" href={pdfHref} target="_blank" rel="noreferrer">
          <Download size={16} aria-hidden />
          Скачать PDF
        </a>
        {documentId ? <Link href={`/shipment/${encodeURIComponent(shipmentId)}/closing?documentId=${encodeURIComponent(documentId)}`}>Открыть snapshot</Link> : null}
      </div>
    </nav>
  );
}
