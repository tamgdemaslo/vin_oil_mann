"use client";

import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, FileText, Loader2, Printer, X } from "lucide-react";

export type ShipmentPrintTemplate =
  | "eco_poster"
  | "eco_poster_akpp_partial"
  | "eco_poster_akpp_full"
  | "under_hood_tags"
  | "under_hood_tags_akpp_partial"
  | "under_hood_tags_akpp_full";

type ClosingDocumentType = "closing_work_order" | "work_act" | "upd_print";
type PrintMenuItem =
  | { key: ShipmentPrintTemplate; label: string; hrefKind: "poster" | "tags"; variant?: string }
  | { key: `closing_${ClosingDocumentType}` | "closing_bundle" | "closing_history"; label: string; closingType?: ClosingDocumentType; closingBundle?: boolean; history?: boolean };

type ClosingPayload = {
  document: {
    type: ClosingDocumentType;
    number: string;
    documentDate: string;
    completionDate: string;
    shipmentNumber: string;
    shipmentApplicable: boolean;
    sellerSnapshot: { name: string; shortName: string; inn: string; kpp: string; ogrn: string; ogrnip: string; legalAddress: string; actualAddress: string; signatoryPosition: string; signatoryName: string; signatoryBasis: string };
    buyerSnapshot: { name: string; shortName: string; inn: string; kpp: string; ogrn: string; ogrnip: string; legalAddress: string; actualAddress: string; signatoryPosition: string; signatoryName: string; signatoryBasis: string };
    vehicleSnapshot: { makeModel: string; plate: string; vin: string; mileage: string };
    totalsSnapshot: { totalCents: number; worksCount: number; materialsCount: number };
    vatSnapshot: { label: string };
    updSnapshot?: {
      functionCode: "1" | "2";
      seller: string;
      buyer: string;
      shipper: string;
      consignee: string;
      transferBasis: string;
      paymentDocument: string;
      currencyName: string;
      currencyCode: string;
      vatLabel: string;
      transferInfo: string;
      receiptInfo: string;
      transferDate: string;
      receiptDate: string;
    };
    performerSignatorySnapshot: { position: string; name: string; basis: string };
    customerSignatorySnapshot: { position: string; name: string; basis: string };
  };
  validation: { canIssue: boolean; missing: string[]; warnings: string[] };
  existing: Array<{
    id: string;
    type: ClosingDocumentType;
    number: string;
    revision: number;
    status: string;
    documentDate: string;
    createdByName: string;
    createdAt: string;
    isOutdated: boolean;
  }>;
};

type UpdSettings = {
  documentDate: string;
  completionDate: string;
  functionCode: "1" | "2";
  seller: string;
  buyer: string;
  shipper: string;
  consignee: string;
  transferBasis: string;
  paymentDocument: string;
  currencyName: string;
  currencyCode: string;
  vatLabel: string;
  transferInfo: string;
  receiptInfo: string;
  transferDate: string;
  receiptDate: string;
  sellerPosition: string;
  sellerName: string;
  sellerBasis: string;
  buyerPosition: string;
  buyerName: string;
  buyerBasis: string;
};

type ShipmentPrintMenuProps = {
  shipmentId?: string | null;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
  align?: "left" | "right";
  onBeforePrint?: () => Promise<boolean> | boolean;
};

const PRINT_GROUPS: Array<{
  key: string;
  title: string;
  items: PrintMenuItem[];
}> = [
  {
    key: "poster",
    title: "Заказ-наряд",
    items: [
      { key: "eco_poster", label: "Заказ-наряд — постер Эко (А4)", hrefKind: "poster" },
      { key: "eco_poster_akpp_partial", label: "Заказ-наряд — постер · АКПП частичная (+20 тыс. км)", hrefKind: "poster", variant: "akpp_partial" },
      { key: "eco_poster_akpp_full", label: "Заказ-наряд — постер · АКПП полная (+60 тыс. км)", hrefKind: "poster", variant: "akpp_full" },
    ],
  },
  {
    key: "tags",
    title: "Бирка под капот",
    items: [
      { key: "under_hood_tags", label: "Бирка под капот (интервал из настроек)", hrefKind: "tags" },
      { key: "under_hood_tags_akpp_partial", label: "Бирка под капот · АКПП частичная (+20 тыс. км)", hrefKind: "tags", variant: "akpp_partial" },
      { key: "under_hood_tags_akpp_full", label: "Бирка под капот · АКПП полная (+60 тыс. км)", hrefKind: "tags", variant: "akpp_full" },
    ],
  },
  {
    key: "closing",
    title: "Закрывающие документы",
    items: [
      { key: "closing_closing_work_order", label: "Заказ-наряд — закрывающий документ", closingType: "closing_work_order" },
      { key: "closing_work_act", label: "Акт выполненных работ", closingType: "work_act" },
      { key: "closing_bundle", label: "Заказ-наряд + акт", closingType: "closing_work_order", closingBundle: true },
      { key: "closing_upd_print", label: "УПД", closingType: "upd_print" },
      { key: "closing_history", label: "Ранее сформированные документы", history: true },
    ],
  },
];

function printHref(shipmentId: string, hrefKind: "poster" | "tags", variant?: string): string {
  const params = new URLSearchParams({ autoprint: "1" });
  if (variant) params.set("variant", variant);
  return `/shipment/${encodeURIComponent(shipmentId)}/${hrefKind}?${params.toString()}`;
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("ru-RU", { style: "currency", currency: "RUB" });
}

function closingTypeLabel(type: ClosingDocumentType): string {
  if (type === "work_act") return "Акт выполненных работ";
  if (type === "upd_print") return "УПД";
  return "Заказ-наряд — закрывающий документ";
}

function partyLine(party: ClosingPayload["document"]["sellerSnapshot"] | ClosingPayload["document"]["buyerSnapshot"]): string {
  const requisites = [
    party.inn ? `ИНН ${party.inn}` : "",
    party.kpp ? `КПП ${party.kpp}` : "",
    party.ogrnip ? `ОГРНИП ${party.ogrnip}` : party.ogrn ? `ОГРН ${party.ogrn}` : "",
  ].filter(Boolean);
  return [party.name || party.shortName, requisites.join(", ")].filter(Boolean).join(", ");
}

function partyAddressLine(party: ClosingPayload["document"]["sellerSnapshot"] | ClosingPayload["document"]["buyerSnapshot"]): string {
  return [party.name || party.shortName, party.legalAddress || party.actualAddress].filter(Boolean).join(", ");
}

function initUpdSettings(payload: ClosingPayload): UpdSettings {
  const document = payload.document;
  const upd = document.updSnapshot;
  return {
    documentDate: document.documentDate,
    completionDate: document.completionDate,
    functionCode: upd?.functionCode ?? "2",
    seller: upd?.seller || partyLine(document.sellerSnapshot),
    buyer: upd?.buyer || partyLine(document.buyerSnapshot),
    shipper: upd?.shipper || partyAddressLine(document.sellerSnapshot) || "Он же",
    consignee: upd?.consignee || partyAddressLine(document.buyerSnapshot),
    transferBasis: upd?.transferBasis || `Отгрузка ${document.shipmentNumber} от ${document.completionDate}`,
    paymentDocument: upd?.paymentDocument || "",
    currencyName: upd?.currencyName || "Российский рубль",
    currencyCode: upd?.currencyCode || "643",
    vatLabel: upd?.vatLabel || document.vatSnapshot.label,
    transferInfo: upd?.transferInfo || "",
    receiptInfo: upd?.receiptInfo || "Товары, работы и услуги получены без замечаний",
    transferDate: upd?.transferDate || document.completionDate,
    receiptDate: upd?.receiptDate || document.completionDate,
    sellerPosition: document.performerSignatorySnapshot.position || document.sellerSnapshot.signatoryPosition,
    sellerName: document.performerSignatorySnapshot.name || document.sellerSnapshot.signatoryName,
    sellerBasis: document.performerSignatorySnapshot.basis || document.sellerSnapshot.signatoryBasis,
    buyerPosition: document.customerSignatorySnapshot.position || document.buyerSnapshot.signatoryPosition,
    buyerName: document.customerSignatorySnapshot.name || document.buyerSnapshot.signatoryName,
    buyerBasis: document.customerSignatorySnapshot.basis || document.buyerSnapshot.signatoryBasis,
  };
}

export function ShipmentPrintMenu({
  shipmentId,
  disabled,
  disabledReason = "Сначала сохраните отгрузку",
  className = "",
  align = "right",
  onBeforePrint,
}: ShipmentPrintMenuProps) {
  const [open, setOpen] = useState(false);
  const [printingKey, setPrintingKey] = useState<ShipmentPrintTemplate | null>(null);
  const [lastUsedKey, setLastUsedKey] = useState<ShipmentPrintTemplate>("eco_poster");
  const [error, setError] = useState<string | null>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties | null>(null);
  const [closingType, setClosingType] = useState<ClosingDocumentType>("closing_work_order");
  const [closingOpen, setClosingOpen] = useState(false);
  const [closingBundle, setClosingBundle] = useState(false);
  const [closingLoading, setClosingLoading] = useState(false);
  const [closingIssuing, setClosingIssuing] = useState(false);
  const [closingPayload, setClosingPayload] = useState<ClosingPayload | null>(null);
  const [closingError, setClosingError] = useState<string | null>(null);
  const [customerRemarks, setCustomerRemarks] = useState("");
  const [hasRemarks, setHasRemarks] = useState(false);
  const [updSettings, setUpdSettings] = useState<UpdSettings | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const isDisabled = disabled || !shipmentId;
  const menuId = useId();

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const updatePanelPosition = () => {
      const button = buttonRef.current;
      if (!button || window.innerWidth <= 760) {
        setPanelStyle(null);
        return;
      }

      const rect = button.getBoundingClientRect();
      const width = Math.min(430, window.innerWidth - 32);
      const leftEdge = align === "left" ? rect.left : rect.right - width;
      const left = Math.min(Math.max(16, leftEdge), Math.max(16, window.innerWidth - width - 16));
      const spaceBelow = window.innerHeight - rect.bottom - 16;
      const spaceAbove = rect.top - 16;
      const openUp = spaceBelow < 320 && spaceAbove > spaceBelow;
      const availableHeight = Math.max(220, openUp ? spaceAbove : spaceBelow);

      setPanelStyle({
        position: "fixed",
        left,
        right: "auto",
        top: openUp ? "auto" : rect.bottom + 8,
        bottom: openUp ? window.innerHeight - rect.top + 8 : "auto",
        width,
        maxHeight: Math.min(420, availableHeight),
      });
    };

    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [align, open]);

  function updateUpdSetting<K extends keyof UpdSettings>(key: K, value: UpdSettings[K]) {
    setUpdSettings((current) => current ? { ...current, [key]: value } : current);
  }

  function closingDocumentHrefFor(type: ClosingDocumentType, bundle = false, extra?: { autoprint?: boolean; pdf?: boolean }): string {
    if (!shipmentId) return "#";
    const params = new URLSearchParams({ type });
    if (bundle) params.set("bundle", "1");
    if (extra?.autoprint) params.set("autoprint", "1");
    if (extra?.pdf) params.set("pdf", "1");
    if (type === "upd_print" && updSettings && !bundle) {
      params.set("documentDate", updSettings.documentDate);
      params.set("completionDate", updSettings.completionDate);
      params.set("updFunctionCode", updSettings.functionCode);
      params.set("updSeller", updSettings.seller);
      params.set("updBuyer", updSettings.buyer);
      params.set("updShipper", updSettings.shipper);
      params.set("updConsignee", updSettings.consignee);
      params.set("updTransferBasis", updSettings.transferBasis);
      params.set("updPaymentDocument", updSettings.paymentDocument);
      params.set("updCurrencyName", updSettings.currencyName);
      params.set("updCurrencyCode", updSettings.currencyCode);
      params.set("updVatLabel", updSettings.vatLabel);
      params.set("updTransferInfo", updSettings.transferInfo);
      params.set("updReceiptInfo", updSettings.receiptInfo);
      params.set("updTransferDate", updSettings.transferDate);
      params.set("updReceiptDate", updSettings.receiptDate);
      params.set("sellerPosition", updSettings.sellerPosition);
      params.set("sellerName", updSettings.sellerName);
      params.set("sellerBasis", updSettings.sellerBasis);
      params.set("buyerPosition", updSettings.buyerPosition);
      params.set("buyerName", updSettings.buyerName);
      params.set("buyerBasis", updSettings.buyerBasis);
    }
    return `/shipment/${encodeURIComponent(shipmentId)}/closing?${params.toString()}`;
  }

  function closingPdfHrefFor(type: ClosingDocumentType, bundle = false): string {
    if (!shipmentId) return "#";
    const href = new URL(closingDocumentHrefFor(type, bundle), window.location.origin);
    const params = href.searchParams;
    const pdfParams = new URLSearchParams();
    for (const [key, value] of params.entries()) pdfParams.set(key, value);
    return `/api/demands/${encodeURIComponent(shipmentId)}/closing-documents/pdf?${pdfParams.toString()}`;
  }

  async function openClosingDocument(type: ClosingDocumentType, bundle = false) {
    if (!shipmentId || isDisabled) return;
    setOpen(false);
    setClosingType(type);
    setClosingBundle(bundle);
    setClosingOpen(true);
    setClosingLoading(true);
    setClosingError(null);
    setCustomerRemarks("");
    setHasRemarks(false);
    try {
      const response = await fetch(`/api/demands/${encodeURIComponent(shipmentId)}/closing-documents?type=${encodeURIComponent(type)}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Не удалось загрузить закрывающий документ");
      setClosingPayload(payload);
      setUpdSettings(type === "upd_print" ? initUpdSettings(payload) : null);
    } catch (err) {
      setClosingError(err instanceof Error ? err.message : "Не удалось загрузить закрывающий документ");
      setClosingPayload(null);
    } finally {
      setClosingLoading(false);
    }
  }

  async function issueClosingDocument(allowIncomplete = false) {
    if (!shipmentId || closingIssuing) return;
    setClosingIssuing(true);
    setClosingError(null);
    try {
      const types: ClosingDocumentType[] = closingBundle ? ["closing_work_order", "work_act"] : [closingType];
      let firstId = "";
      for (const type of types) {
        const isUpd = type === "upd_print" && updSettings;
        const response = await fetch(`/api/demands/${encodeURIComponent(shipmentId)}/closing-documents`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            allowIncomplete,
            newRevision: true,
            documentDate: isUpd ? updSettings.documentDate : undefined,
            completionDate: isUpd ? updSettings.completionDate : undefined,
            customerRemarks: hasRemarks ? customerRemarks : "",
            upd: isUpd ? {
              functionCode: updSettings.functionCode,
              seller: updSettings.seller,
              buyer: updSettings.buyer,
              shipper: updSettings.shipper,
              consignee: updSettings.consignee,
              transferBasis: updSettings.transferBasis,
              paymentDocument: updSettings.paymentDocument,
              currencyName: updSettings.currencyName,
              currencyCode: updSettings.currencyCode,
              vatLabel: updSettings.vatLabel,
              transferInfo: updSettings.transferInfo,
              receiptInfo: updSettings.receiptInfo,
              transferDate: updSettings.transferDate,
              receiptDate: updSettings.receiptDate,
            } : undefined,
            sellerSignatory: isUpd ? {
              position: updSettings.sellerPosition,
              name: updSettings.sellerName,
              basis: updSettings.sellerBasis,
            } : undefined,
            customerSignatory: isUpd ? {
              position: updSettings.buyerPosition,
              name: updSettings.buyerName,
              basis: updSettings.buyerBasis,
            } : undefined,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          const missing = payload?.validation?.missing?.length ? `: ${payload.validation.missing.join(", ")}` : "";
          throw new Error((payload?.error || "Не удалось сформировать документ") + missing);
        }
        if (!firstId && payload?.document?.id) firstId = payload.document.id;
      }
      if (firstId) window.open(`/shipment/${encodeURIComponent(shipmentId)}/closing?documentId=${encodeURIComponent(firstId)}`, "_blank", "noopener,noreferrer");
      await openClosingDocument(closingType, closingBundle);
    } catch (err) {
      setClosingError(err instanceof Error ? err.message : "Не удалось сформировать документ");
    } finally {
      setClosingIssuing(false);
    }
  }

  async function handlePrint(item: PrintMenuItem) {
    if ("history" in item && item.history) {
      await openClosingDocument("closing_work_order", false);
      return;
    }
    if ("closingType" in item && item.closingType) {
      await openClosingDocument(item.closingType, Boolean(item.closingBundle));
      return;
    }
    if (!shipmentId || isDisabled || printingKey) return;
    setPrintingKey(item.key as ShipmentPrintTemplate);
    setError(null);
    try {
      const canPrint = onBeforePrint ? await onBeforePrint() : true;
      if (!canPrint) return;
      setLastUsedKey(item.key as ShipmentPrintTemplate);
      setOpen(false);
      if ("hrefKind" in item) {
        window.open(printHref(shipmentId, item.hrefKind, item.variant), "_blank", "noopener,noreferrer");
      }
    } catch {
      setError("Не удалось сформировать печатную форму");
    } finally {
      setPrintingKey(null);
    }
  }

  const menu = (
    <div className={`eco-print-menu__panel ${align === "left" ? "is-left" : "is-right"}`} role="menu" id={menuId} style={panelStyle ?? undefined}>
      <div className="eco-print-menu__eyebrow">Печать из CRM</div>
      {PRINT_GROUPS.map((group) => (
        <section key={group.key} className="eco-print-menu__group">
          <div className="eco-print-menu__group-title">{group.title}</div>
          {group.items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={Boolean(printingKey)}
              onClick={() => void handlePrint(item)}
              className="eco-print-menu__item"
            >
              <span className="eco-print-menu__check">
                {lastUsedKey === item.key ? <Check aria-hidden /> : "closingType" in item || "history" in item ? <FileText aria-hidden /> : null}
              </span>
              <span>{item.label}</span>
              {printingKey === item.key ? <Loader2 className="eco-print-menu__spinner" aria-hidden /> : null}
            </button>
          ))}
        </section>
      ))}
      {error ? <div className="eco-print-menu__error">{error}</div> : null}
    </div>
  );
  const menuLayer = open ? (
    <>
      <button type="button" className="eco-print-menu__scrim" aria-label="Закрыть печать" onClick={() => setOpen(false)} />
      {menu}
    </>
  ) : null;
  const renderedMenuLayer = portalReady && menuLayer ? createPortal(menuLayer, document.body) : menuLayer;

  return (
    <div className={`eco-print-menu ${open ? "is-open" : ""} ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        className="eco-print-menu__button"
        disabled={isDisabled || Boolean(printingKey)}
        title={isDisabled ? disabledReason : undefined}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          if (isDisabled) return;
          setOpen((value) => !value);
        }}
      >
        {printingKey ? <Loader2 className="eco-print-menu__spinner" aria-hidden /> : <Printer aria-hidden />}
        <span>{printingKey ? "Готовим…" : "Печать"}</span>
        <ChevronDown aria-hidden />
      </button>
      {renderedMenuLayer}
      {closingOpen ? (
        <div className="eco-closing-modal-backdrop" role="presentation" onMouseDown={() => setClosingOpen(false)}>
          <aside className="eco-closing-modal" role="dialog" aria-modal="true" aria-label="Закрывающий документ" onMouseDown={(event) => event.stopPropagation()}>
            <header className="eco-closing-modal__header">
              <div>
                <div className="eco-page-kicker">Закрывающий документ</div>
                <h2>{closingBundle ? "Заказ-наряд + акт" : closingTypeLabel(closingType)}</h2>
              </div>
              <button type="button" className="eco-icon-btn" aria-label="Закрыть" onClick={() => setClosingOpen(false)}>
                <X aria-hidden />
              </button>
            </header>

            {closingLoading ? (
              <div className="eco-closing-state"><Loader2 className="eco-print-menu__spinner" aria-hidden /> Загружаем данные…</div>
            ) : closingError ? (
              <div className="eco-closing-error">{closingError}</div>
            ) : closingPayload ? (
              <div className="eco-closing-modal__body">
                <div className="eco-closing-summary">
                  <div><span>Номер</span><strong>{closingPayload.document.number}</strong></div>
                  <div><span>Дата</span><strong>{closingPayload.document.documentDate}</strong></div>
                  <div><span>Исполнитель</span><strong>{closingPayload.document.sellerSnapshot.name || "не указан"}</strong></div>
                  <div><span>Заказчик</span><strong>{closingPayload.document.buyerSnapshot.name || "не указан"}</strong></div>
                  <div><span>НДС</span><strong>{closingPayload.document.vatSnapshot.label}</strong></div>
                  <div><span>Итого</span><strong>{formatMoney(closingPayload.document.totalsSnapshot.totalCents)}</strong></div>
                </div>

                {closingPayload.validation.missing.length > 0 ? (
                  <section className="eco-closing-check is-error">
                    <strong>Для закрывающего документа не хватает:</strong>
                    <ul>{closingPayload.validation.missing.map((item) => <li key={item}>{item}</li>)}</ul>
                    <div className="eco-closing-check__actions">
                      <button type="button" className="eco-btn eco-btn--sm" onClick={() => window.open("/cabinet", "_blank", "noopener,noreferrer")}>
                        К карточке организации
                      </button>
                      <button type="button" className="eco-btn eco-btn--sm" onClick={() => window.open("/inventory/counterparties", "_blank", "noopener,noreferrer")}>
                        К карточке клиента
                      </button>
                    </div>
                  </section>
                ) : (
                  <section className="eco-closing-check is-ok">Проверка заполненности пройдена.</section>
                )}

                {closingPayload.validation.warnings.length > 0 ? (
                  <section className="eco-closing-check is-warning">
                    <strong>Предупреждения:</strong>
                    <ul>{closingPayload.validation.warnings.map((item) => <li key={item}>{item}</li>)}</ul>
                  </section>
                ) : null}

                {closingType === "upd_print" && updSettings ? (
                  <section className="eco-closing-upd-settings">
                    <h3>Настройки УПД</h3>
                    <div className="eco-closing-form-grid">
                      <label>
                        <span>Номер УПД</span>
                        <input className="eco-input" value={closingPayload.document.number} readOnly />
                      </label>
                      <label>
                        <span>Дата УПД</span>
                        <input type="date" className="eco-input" value={updSettings.documentDate} onChange={(event) => updateUpdSetting("documentDate", event.target.value)} />
                      </label>
                      <label>
                        <span>Дата отгрузки / выполнения</span>
                        <input type="date" className="eco-input" value={updSettings.completionDate} onChange={(event) => {
                          updateUpdSetting("completionDate", event.target.value);
                          updateUpdSetting("transferDate", event.target.value);
                          updateUpdSetting("receiptDate", event.target.value);
                        }} />
                      </label>
                      <label>
                        <span>Функция документа</span>
                        <select className="eco-input" value={updSettings.functionCode} onChange={(event) => updateUpdSetting("functionCode", event.target.value === "1" ? "1" : "2")}>
                          <option value="2">Передаточный документ</option>
                          <option value="1">Счёт-фактура + передаточный документ</option>
                        </select>
                      </label>
                      <label className="is-wide">
                        <span>Продавец</span>
                        <textarea className="eco-input" rows={2} value={updSettings.seller} onChange={(event) => updateUpdSetting("seller", event.target.value)} />
                      </label>
                      <label className="is-wide">
                        <span>Покупатель</span>
                        <textarea className="eco-input" rows={2} value={updSettings.buyer} onChange={(event) => updateUpdSetting("buyer", event.target.value)} />
                      </label>
                      <label className="is-wide">
                        <span>Грузоотправитель</span>
                        <textarea className="eco-input" rows={2} value={updSettings.shipper} onChange={(event) => updateUpdSetting("shipper", event.target.value)} />
                      </label>
                      <label className="is-wide">
                        <span>Грузополучатель</span>
                        <textarea className="eco-input" rows={2} value={updSettings.consignee} onChange={(event) => updateUpdSetting("consignee", event.target.value)} />
                      </label>
                      <label className="is-wide">
                        <span>Основание передачи</span>
                        <input className="eco-input" value={updSettings.transferBasis} onChange={(event) => updateUpdSetting("transferBasis", event.target.value)} />
                      </label>
                      <label className="is-wide">
                        <span>Платёжно-расчётный документ</span>
                        <input className="eco-input" value={updSettings.paymentDocument} onChange={(event) => updateUpdSetting("paymentDocument", event.target.value)} placeholder="№ и дата платежного документа, если есть" />
                      </label>
                      <label>
                        <span>Валюта</span>
                        <input className="eco-input" value={updSettings.currencyName} onChange={(event) => updateUpdSetting("currencyName", event.target.value)} />
                      </label>
                      <label>
                        <span>Код валюты</span>
                        <input className="eco-input" value={updSettings.currencyCode} onChange={(event) => updateUpdSetting("currencyCode", event.target.value)} />
                      </label>
                      <label>
                        <span>Ставка НДС</span>
                        <input className="eco-input" value={updSettings.vatLabel} onChange={(event) => updateUpdSetting("vatLabel", event.target.value)} />
                      </label>
                      <label>
                        <span>Дата передачи</span>
                        <input type="date" className="eco-input" value={updSettings.transferDate} onChange={(event) => updateUpdSetting("transferDate", event.target.value)} />
                      </label>
                      <label className="is-wide">
                        <span>Сведения о передаче</span>
                        <textarea className="eco-input" rows={2} value={updSettings.transferInfo} onChange={(event) => updateUpdSetting("transferInfo", event.target.value)} />
                      </label>
                      <label>
                        <span>Дата получения</span>
                        <input type="date" className="eco-input" value={updSettings.receiptDate} onChange={(event) => updateUpdSetting("receiptDate", event.target.value)} />
                      </label>
                      <label className="is-wide">
                        <span>Сведения о получении</span>
                        <textarea className="eco-input" rows={2} value={updSettings.receiptInfo} onChange={(event) => updateUpdSetting("receiptInfo", event.target.value)} />
                      </label>
                    </div>
                    <div className="eco-closing-signers-grid">
                      <fieldset>
                        <legend>Подписант со стороны исполнителя</legend>
                        <input className="eco-input" value={updSettings.sellerPosition} onChange={(event) => updateUpdSetting("sellerPosition", event.target.value)} placeholder="Должность" />
                        <input className="eco-input" value={updSettings.sellerName} onChange={(event) => updateUpdSetting("sellerName", event.target.value)} placeholder="Ф. И. О." />
                        <input className="eco-input" value={updSettings.sellerBasis} onChange={(event) => updateUpdSetting("sellerBasis", event.target.value)} placeholder="Основание полномочий" />
                      </fieldset>
                      <fieldset>
                        <legend>Подписант со стороны клиента</legend>
                        <input className="eco-input" value={updSettings.buyerPosition} onChange={(event) => updateUpdSetting("buyerPosition", event.target.value)} placeholder="Должность" />
                        <input className="eco-input" value={updSettings.buyerName} onChange={(event) => updateUpdSetting("buyerName", event.target.value)} placeholder="Ф. И. О." />
                        <input className="eco-input" value={updSettings.buyerBasis} onChange={(event) => updateUpdSetting("buyerBasis", event.target.value)} placeholder="Основание полномочий" />
                      </fieldset>
                    </div>
                  </section>
                ) : null}

                <label className="eco-closing-remarks-toggle">
                  <input type="checkbox" checked={hasRemarks} onChange={(event) => setHasRemarks(event.target.checked)} />
                  Есть замечания заказчика
                </label>
                {hasRemarks ? (
                  <textarea
                    className="eco-input"
                    rows={3}
                    value={customerRemarks}
                    onChange={(event) => setCustomerRemarks(event.target.value)}
                    placeholder="Замечания будут напечатаны в документе"
                  />
                ) : null}

                <section className="eco-closing-history">
                  <h3>Ранее сформированные документы</h3>
                  {closingPayload.existing.length === 0 ? (
                    <p>Пока нет сформированных snapshot.</p>
                  ) : (
                    <ul>
                      {closingPayload.existing.map((doc) => (
                        <li key={doc.id}>
                          <a href={`/shipment/${encodeURIComponent(shipmentId ?? "")}/closing?documentId=${encodeURIComponent(doc.id)}`} target="_blank" rel="noreferrer">
                            {closingTypeLabel(doc.type)} {doc.number} · ред. {doc.revision}
                          </a>
                          <span>{doc.status}{doc.isOutdated ? " · отгрузка изменилась" : ""}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            ) : null}

            <footer className="eco-closing-modal__footer">
              <button type="button" className="eco-btn" onClick={() => shipmentId && window.open(closingDocumentHrefFor(closingType, closingBundle), "_blank", "noopener,noreferrer")} disabled={!shipmentId}>
                Предпросмотр
              </button>
              <button type="button" className="eco-btn" onClick={() => shipmentId && window.open(closingPdfHrefFor(closingType, closingBundle), "_blank", "noopener,noreferrer")} disabled={!shipmentId}>
                Скачать PDF
              </button>
              <button type="button" className="eco-btn" onClick={() => shipmentId && window.open(closingDocumentHrefFor(closingType, closingBundle, { autoprint: true }), "_blank", "noopener,noreferrer")} disabled={!shipmentId}>
                Печать
              </button>
              <button type="button" className="eco-btn eco-btn--primary" onClick={() => void issueClosingDocument(false)} disabled={closingIssuing || closingLoading || !closingPayload}>
                {closingIssuing ? "Формируем…" : closingBundle ? "Сформировать документы" : "Сформировать документ"}
              </button>
              {closingPayload?.validation.missing.length ? (
                <button type="button" className="eco-btn eco-btn--danger" onClick={() => void issueClosingDocument(true)} disabled={closingIssuing}>
                  Продолжить с пустыми полями
                </button>
              ) : null}
            </footer>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
