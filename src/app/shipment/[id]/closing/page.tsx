import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { buildClosingDocumentPayload, loadClosingDocument, type ClosingDocumentType } from "@/lib/closing-documents";
import { ClosingDocumentPrint, ClosingDocumentStyles } from "@/components/closing-documents/ClosingDocumentPrint";
import { ClosingDocumentToolbar } from "@/components/closing-documents/ClosingDocumentToolbar";
import { PosterAutoPrint } from "@/components/print/PosterAutoPrint";

function isClosingType(value: string | undefined): value is ClosingDocumentType {
  return value === "closing_work_order" || value === "work_act" || value === "upd_print";
}

function canBypassForPdf(renderKey: string | undefined): boolean {
  const expected = process.env.CLOSING_DOCUMENT_RENDER_KEY || process.env.SESSION_SECRET;
  return Boolean(expected && renderKey && renderKey === expected);
}

type ClosingSearchParams = {
  type?: string;
  documentId?: string;
  bundle?: string;
  autoprint?: string;
  pdf?: string;
  renderKey?: string;
  documentDate?: string;
  completionDate?: string;
  updFunctionCode?: string;
  updSeller?: string;
  updBuyer?: string;
  updShipper?: string;
  updConsignee?: string;
  updTransferBasis?: string;
  updPaymentDocument?: string;
  updCurrencyName?: string;
  updCurrencyCode?: string;
  updVatLabel?: string;
  updTransferInfo?: string;
  updReceiptInfo?: string;
  updTransferDate?: string;
  updReceiptDate?: string;
  sellerPosition?: string;
  sellerName?: string;
  sellerBasis?: string;
  buyerPosition?: string;
  buyerName?: string;
  buyerBasis?: string;
};

function updBuildOptions(type: ClosingDocumentType, sp: ClosingSearchParams) {
  if (type !== "upd_print") return { type };
  const functionCode: "1" | "2" | undefined = sp.updFunctionCode === "1" ? "1" : sp.updFunctionCode === "2" ? "2" : undefined;
  return {
    type,
    documentDate: sp.documentDate,
    completionDate: sp.completionDate,
    upd: {
      functionCode,
      seller: sp.updSeller,
      buyer: sp.updBuyer,
      shipper: sp.updShipper,
      consignee: sp.updConsignee,
      transferBasis: sp.updTransferBasis,
      paymentDocument: sp.updPaymentDocument,
      currencyName: sp.updCurrencyName,
      currencyCode: sp.updCurrencyCode,
      vatLabel: sp.updVatLabel,
      transferInfo: sp.updTransferInfo,
      receiptInfo: sp.updReceiptInfo,
      transferDate: sp.updTransferDate,
      receiptDate: sp.updReceiptDate,
    },
    sellerSignatory: {
      position: sp.sellerPosition,
      name: sp.sellerName,
      basis: sp.sellerBasis,
    },
    customerSignatory: {
      position: sp.buyerPosition,
      name: sp.buyerName,
      basis: sp.buyerBasis,
    },
  };
}

export default async function ClosingDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    [key: string]: string | undefined;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await getSession();
  if (!session && !canBypassForPdf(sp.renderKey)) {
    const qs = new URLSearchParams();
    if (sp.type) qs.set("type", sp.type);
    if (sp.documentId) qs.set("documentId", sp.documentId);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    redirect(`/login?from=${encodeURIComponent(`/shipment/${id}/closing${suffix}`)}`);
  }

  const type = isClosingType(sp.type) ? sp.type : "closing_work_order";
  const existing = sp.documentId ? await loadClosingDocument(sp.documentId) : null;
  const bundle = sp.bundle === "1" && !existing;
  const payload = existing ? null : await buildClosingDocumentPayload(id, updBuildOptions(type, sp));
  const actPayload = bundle ? await buildClosingDocumentPayload(id, { type: "work_act" }) : null;
  const document = existing ?? payload?.document ?? null;
  const documents = [document, actPayload?.document ?? null].filter((item): item is NonNullable<typeof document> => Boolean(item));

  if (!document) {
    return (
      <main className="eco-page">
        <h1 className="eco-page-title">Закрывающий документ не найден</h1>
        <p className="eco-page-subtitle">Проверьте отгрузку или сформированный snapshot.</p>
        <Link className="eco-btn" href={`/shipment/${encodeURIComponent(id)}`}>Вернуться к отгрузке</Link>
      </main>
    );
  }

  const pdfHref = existing?.id
    ? `/api/closing-documents/${encodeURIComponent(existing.id)}/pdf`
    : `/api/demands/${encodeURIComponent(id)}/closing-documents/pdf?type=${encodeURIComponent(type)}${bundle ? "&bundle=1" : ""}`;

  return (
    <>
      <ClosingDocumentStyles />
      <main className="cdoc-screen eco-print-inter-font">
        <PosterAutoPrint enabled={sp.autoprint === "1"} />
        {sp.pdf !== "1" ? (
          <ClosingDocumentToolbar shipmentId={id} documentId={existing?.id} pdfHref={pdfHref} />
        ) : null}
        {documents.map((doc) => <ClosingDocumentPrint key={`${doc.type}-${doc.number}`} document={doc} />)}
      </main>
    </>
  );
}
