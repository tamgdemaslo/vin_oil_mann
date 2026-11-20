"use client";

import { useEffect, useRef, useState } from "react";
import { quoteRub, type QuoteExtra, type QuoteStockProduct } from "@/lib/maintenance-quote";
import { quoteFluidOfferAmount } from "@/lib/maintenance-fluid-offer-amount";
import { mannQuoteServiceCapacities } from "@/lib/mann-quote-service-capacities";
import { MANN_FLUID_LABELS, MANN_FLUID_SYSTEMS, type MannFluidSystem } from "@/lib/mann-fluid-systems";
import type { MannTechnicalProfileItem, MannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";
import styles from "./FluidQuotePicker.module.css";

type FluidStockProduct = QuoteStockProduct & {
  compatibilityEvidence: string;
  approvalStatus: "unknown" | "manufacturer_claim" | "official_approval";
  requiresManualReview: boolean;
  source?: "rossko";
  localProductId?: string;
  deliveryLabel?: string;
  deliveryAt?: string | null;
  deliveryDays?: number | null;
  quantityMultiple?: number;
  packageEvidence?: string;
};
type FluidReference = Pick<FluidStockProduct, "id" | "name" | "brand" | "article" | "unit" | "litresPerUnit" | "compatibilityEvidence" | "approvalStatus" | "requiresManualReview">;
type Props = {
  profile: MannUnifiedTechnicalProfile | null;
  warehouseId?: string | null;
  organizationId?: string | null;
  onAdd: (row: QuoteExtra) => void;
  selectedSystemCodes: string[];
};

function validOffer(value: unknown): value is FluidStockProduct {
  if (!value || typeof value !== "object") return false;
  const offer = value as Partial<FluidStockProduct>;
  return typeof offer.id === "string" && typeof offer.name === "string" && typeof offer.unit === "string"
    && typeof offer.price === "number" && Number.isFinite(offer.price) && offer.price > 0
    && typeof offer.available === "number" && Number.isFinite(offer.available) && offer.available >= 0
    && (offer.litresPerUnit === null || (typeof offer.litresPerUnit === "number" && Number.isFinite(offer.litresPerUnit) && offer.litresPerUnit > 0))
    && typeof offer.compatibilityEvidence === "string" && Boolean(offer.compatibilityEvidence.trim())
    && ["unknown", "manufacturer_claim", "official_approval"].includes(offer.approvalStatus ?? "")
    && typeof offer.requiresManualReview === "boolean";
}

function validReference(value: unknown): value is FluidReference {
  if (!value || typeof value !== "object") return false;
  const reference = value as Partial<FluidReference>;
  return typeof reference.id === "string" && Boolean(reference.id) && typeof reference.name === "string"
    && typeof reference.article === "string" && typeof reference.unit === "string"
    && (reference.litresPerUnit === null || (typeof reference.litresPerUnit === "number" && Number.isFinite(reference.litresPerUnit) && reference.litresPerUnit > 0))
    && typeof reference.compatibilityEvidence === "string" && Boolean(reference.compatibilityEvidence.trim())
    && ["unknown", "manufacturer_claim", "official_approval"].includes(reference.approvalStatus ?? "")
    && typeof reference.requiresManualReview === "boolean";
}

function FluidItem({ item, profile, warehouseId, onAdd, alreadySelected }: {
  item: MannTechnicalProfileItem;
  profile: MannUnifiedTechnicalProfile;
  warehouseId?: string | null;
  onAdd: Props["onAdd"];
  alreadySelected: boolean;
}) {
  const label = MANN_FLUID_LABELS[item.systemCode as MannFluidSystem] ?? item.systemLabel;
  const selectable = !item.requiresReview && !item.researchResult && item.sourceStatus === "primary_source"
    && item.automaticSelectionEligible && item.specifications.some(value => value.trim());
  const methods = mannQuoteServiceCapacities({ ...profile, items: [item] }, item.systemCode);
  const viscosities = [...new Set(item.viscosityGrades.map(value => value.trim()).filter(Boolean))];
  const [methodKey, setMethodKey] = useState("");
  const [viscosity, setViscosity] = useState(viscosities.length === 1 ? viscosities[0] : "");
  const [offers, setOffers] = useState<FluidStockProduct[] | null>(null);
  const [references, setReferences] = useState<FluidReference[] | null>(null);
  const [activeReferenceId, setActiveReferenceId] = useState<string | null>(null);
  const [offerSource, setOfferSource] = useState<"stock" | "rossko">("stock");
  const [confirmedOffers, setConfirmedOffers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const method = methods.find(value => value.key === methodKey);
  const canSearch = selectable && Boolean(warehouseId && method) && (viscosities.length === 0 || Boolean(viscosity)) && !alreadySelected;
  const clearOffers = () => { controller.current?.abort(); controller.current = null; setOffers(null); setReferences(null); setActiveReferenceId(null); setConfirmedOffers([]); setMessage(""); setBusy(false); };
  const requestBody = () => ({ storeId: warehouseId, systemCode: item.systemCode, specifications: item.specifications, ...(viscosity ? { viscosity } : {}) });
  async function fetchOffers(signal: AbortSignal, source: "stock" | "rossko" = "stock", productId?: string): Promise<{ products: FluidStockProduct[]; reason?: string }> {
    const response = await fetch(`/api/maintenance-quote/fluid-${source === "rossko" ? "rossko" : "stock"}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ ...requestBody(), ...(source === "rossko" ? { mode: "offers", productId } : {}) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "Не удалось проверить предложения жидкости.");
    const products: FluidStockProduct[] = Array.isArray(data?.products) ? data.products.filter(validOffer) : [];
    return { products: source === "rossko" ? products.filter(offer => offer.source === "rossko" && offer.localProductId === productId
      && typeof offer.packageEvidence === "string" && Boolean(offer.packageEvidence.trim())
      && typeof offer.deliveryLabel === "string" && Boolean(offer.deliveryLabel.trim())
      && Number.isInteger(offer.quantityMultiple) && offer.quantityMultiple! > 0) : products.filter(offer => offer.source !== "rossko"),
      reason: typeof data?.reason === "string" ? data.reason : undefined };
  }
  async function searchReferences() {
    if (!canSearch) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setBusy(true); setMessage(""); setOffers(null); setReferences(null); setActiveReferenceId(null); setConfirmedOffers([]); setOfferSource("rossko");
    try {
      const response = await fetch("/api/maintenance-quote/fluid-rossko", { method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
        body: JSON.stringify({ ...requestBody(), mode: "references" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Не удалось найти подходящие артикулы.");
      if (!mounted.current || request.signal.aborted) return;
      const found = Array.isArray(result?.references) ? result.references.filter(validReference) : [];
      setReferences(found); if (!found.length) setMessage(typeof result?.reason === "string" ? result.reason : "Подходящих артикулов для поиска у РОССКО не найдено.");
    } catch (error) { if (mounted.current && !request.signal.aborted) setMessage(error instanceof Error ? error.message : "Не удалось найти артикулы."); }
    finally { if (mounted.current && !request.signal.aborted) setBusy(false); }
  }
  async function searchSupplier(reference: FluidReference) {
    if (!canSearch || !references?.some(value => value.id === reference.id)) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setBusy(true); setMessage(""); setOffers(null); setConfirmedOffers([]); setActiveReferenceId(reference.id); setOfferSource("rossko");
    try {
      const result = await fetchOffers(request.signal, "rossko", reference.id);
      if (!mounted.current || request.signal.aborted) return;
      setOffers(result.products); if (!result.products.length) setMessage(result.reason || "У РОССКО нет подтверждённых предложений для выбранного артикула.");
    } catch (error) { if (mounted.current && !request.signal.aborted) setMessage(error instanceof Error ? error.message : "Не удалось проверить предложения РОССКО."); }
    finally { if (mounted.current && !request.signal.aborted) setBusy(false); }
  }
  async function search() {
    if (!canSearch) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setBusy(true); setMessage(""); setOffers(null); setReferences(null); setActiveReferenceId(null); setConfirmedOffers([]); setOfferSource("stock");
    try {
      const result = await fetchOffers(request.signal);
      if (!mounted.current || request.signal.aborted) return;
      setOffers(result.products); if (!result.products.length) setMessage(result.reason || "Подходящих товаров на выбранном складе не найдено.");
    } catch (error) { if (mounted.current && !request.signal.aborted) setMessage(error instanceof Error ? error.message : "Не удалось подобрать жидкость."); }
    finally { if (mounted.current && !request.signal.aborted) setBusy(false); }
  }
  async function add(offer: FluidStockProduct) {
    if (!canSearch || !method || !warehouseId) return;
    const supplier = offer.source === "rossko";
    if (supplier && (!offer.localProductId || activeReferenceId !== offer.localProductId || offerSource !== "rossko")) return;
    const reviewRequired = offer.requiresManualReview || offer.approvalStatus !== "official_approval";
    if (reviewRequired && !confirmedOffers.includes(offer.id)) return;
    const amount = quoteFluidOfferAmount(offer, method.litres);
    if (!amount?.enough || offer.price <= 0) return;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setBusy(true); setMessage("");
    try {
      const result = await fetchOffers(request.signal, supplier ? "rossko" : "stock", supplier ? offer.localProductId : undefined);
      if (!mounted.current || request.signal.aborted) return;
      const current = result.products.find(value => value.id === offer.id);
      setOffers(result.products);
      const currentAmount = current ? quoteFluidOfferAmount(current, method.litres) : null;
      if (!current || !currentAmount?.enough) { setConfirmedOffers([]); setMessage("Товар недоступен в нужном количестве. Остатки обновлены."); return; }
      const changed = current.price !== offer.price || current.litresPerUnit !== offer.litresPerUnit || current.unit !== offer.unit
        || current.available !== offer.available || current.approvalStatus !== offer.approvalStatus
        || current.requiresManualReview !== offer.requiresManualReview || current.compatibilityEvidence !== offer.compatibilityEvidence
        || current.quantityMultiple !== offer.quantityMultiple || current.packageEvidence !== offer.packageEvidence
        || current.deliveryLabel !== offer.deliveryLabel || current.deliveryAt !== offer.deliveryAt || current.deliveryDays !== offer.deliveryDays
        || current.localProductId !== offer.localProductId || current.source !== offer.source;
      if (changed) { setConfirmedOffers([]); setMessage("Цена, фасовка, остаток, срок поставки или сведения о совместимости изменились. Проверьте обновлённый вариант и нажмите «Добавить» ещё раз."); return; }
      const row: QuoteExtra = {
        id: `fluid:${item.systemCode}`, name: current.name, quantity: currentAmount.quantity, price: current.price, stockStoreId: warehouseId,
        ...(supplier ? { supplierProductId: current.id, supplierDeliveryLabel: current.deliveryLabel,
          ...(current.deliveryAt && Number.isFinite(Date.parse(current.deliveryAt)) ? { supplierDeliveryAt: Date.parse(current.deliveryAt) } : {}) } : {}),
        fluid: { systemCode: item.systemCode, systemLabel: item.componentModel ? `${label} · ${item.componentModel}` : label, specification: item.specifications.join("; "), ...(viscosity ? { viscosity } : {}),
          serviceMethodLabel: method.label, serviceLitres: method.litres, productId: current.id, profileRevisionId: item.revisionId,
          ...(item.componentModel ? { componentModel: item.componentModel } : {}), litresPerUnit: current.litresPerUnit!,
          suppliedLitres: currentAmount.suppliedLitres, approvalStatus: current.approvalStatus, unit: current.unit, manualCompatibilityConfirmed: reviewRequired ? confirmedOffers.includes(offer.id) : true,
          ...(supplier ? { source: "rossko" as const, localProductId: current.localProductId, supplierOfferId: current.id,
            quantityMultiple: current.quantityMultiple, deliveryLabel: current.deliveryLabel, packageEvidence: current.packageEvidence } : {}) },
      };
      onAdd(row); setMessage("Добавлено в расчёт.");
    } catch (error) { if (mounted.current && !request.signal.aborted) setMessage(error instanceof Error ? error.message : "Не удалось проверить товар перед добавлением."); }
    finally { if (mounted.current && !request.signal.aborted) setBusy(false); }
  }
  return <article className={styles.card} aria-label={label}>
    <div className={styles.heading}><h4>{label}{item.componentModel ? ` · ${item.componentModel}` : ""}</h4><span>{alreadySelected ? "Добавлено в расчёт" : selectable ? "Данные по источнику" : "Требует проверки"}</span></div>
    {item.specifications.length ? <p className={styles.spec}>{item.specifications.join("; ")}</p> : <p>Допуск не установлен.</p>}
    {item.researchVolumeText ? <p>{item.researchVolumeText}</p> : null}
    {!selectable ? <p className={styles.note}>Подбор товара доступен после подтверждения применяемости, допуска и сервисного объёма. Предварительные сведения сохранены для проверки.</p> : !methods.length ? <p className={styles.note}>Точный сервисный объём не установлен. Полный или сухой объём системы не используется для расчёта.</p> : <>
      <div className={styles.fields}>
        <label>Способ обслуживания<select value={methodKey} disabled={busy || alreadySelected} onChange={event => { clearOffers(); setMethodKey(event.target.value); }}><option value="">Выберите способ</option>{methods.map(value => <option key={value.key} value={value.key}>{value.label} · {value.litres} л</option>)}</select></label>
        {viscosities.length ? <label>Вязкость<select value={viscosity} disabled={busy || alreadySelected} onChange={event => { clearOffers(); setViscosity(event.target.value); }}><option value="">Выберите вязкость</option>{viscosities.map(value => <option key={value} value={value}>{value}</option>)}</select></label> : <p className={styles.note}>{["BRAKE_FLUID", "ENGINE_COOLANT"].includes(item.systemCode) ? "Вязкость SAE не применяется; подбор выполняется по допуску." : "Вязкость не указана в профиле; подбор выполняется по допуску."}</p>}
      </div>
      {!warehouseId ? <p className={styles.note}>Выберите склад для проверки наличия.</p> : null}
      <div className={styles.actions}><button type="button" className="eco-btn" disabled={!canSearch || busy} onClick={search}>Подобрать со склада</button>
        <button type="button" className="eco-btn" disabled={!canSearch || busy} onClick={searchReferences}>Подобрать у РОССКО</button></div>
      {busy ? <p role="status" className={styles.note}>Проверяем предложения…</p> : null}
    </>}
    {message ? <p role="status" className={styles.note}>{message}</p> : null}
    {references?.length ? <div className={styles.references}><h5>Артикулы для поиска у РОССКО</h5><p className={styles.note}>Выберите товар. Наличие, цена и срок поставки будут проверены после нажатия «Найти предложения».</p><ul className={styles.offers}>{references.map(reference => <li key={reference.id} className={activeReferenceId === reference.id ? styles.activeReference : undefined}>
      <strong>{reference.name}</strong><p>{[reference.brand, reference.article].filter(Boolean).join(" · ")}</p>
      <p>{reference.litresPerUnit ? `Фасовка: ${reference.litresPerUnit} л / ${reference.unit}` : "Объём фасовки не установлен"}</p>
      <p>{reference.compatibilityEvidence}</p><p className={styles.note}>{reference.approvalStatus === "official_approval" && !reference.requiresManualReview ? "Одобрение подтверждено в данных товара." : "Совместимость потребуется подтвердить перед добавлением."}</p>
      <button type="button" className="eco-btn" disabled={!canSearch || busy} onClick={() => searchSupplier(reference)}>Найти предложения</button>
    </li>)}</ul></div> : null}
    {offers?.length ? <ul className={styles.offers}>{offers.map(offer => {
      const amount = method ? quoteFluidOfferAmount(offer, method.litres) : null;
      const needsReview = offer.requiresManualReview || offer.approvalStatus !== "official_approval";
      return <li key={offer.id}>
        <strong>{offer.name}</strong><p>{quoteRub(Math.round(offer.price * 100))} / {offer.unit} · Доступно: {offer.available} {offer.unit}</p>
        {amount ? <p>{amount.quantity} {offer.unit} · В упаковках: {amount.suppliedLitres} л · Итого: {quoteRub(amount.cents)}{!amount.enough ? (offer.source === "rossko" ? " · Недостаточно у поставщика" : " · Недостаточно на складе") : ""}</p> : <p>Объём фасовки не установлен. Добавление недоступно.</p>}
        {offer.source === "rossko" ? <><p>РОССКО · {offer.deliveryLabel}</p><p>Кратность заказа: {offer.quantityMultiple} {offer.unit}</p><p>{offer.packageEvidence}</p></> : null}
        <p>{offer.compatibilityEvidence}</p>
        {needsReview ? <label className={styles.confirm}><input type="checkbox" checked={confirmedOffers.includes(offer.id)} disabled={busy || alreadySelected} onChange={event => setConfirmedOffers(previous => event.target.checked ? [...previous, offer.id] : previous.filter(id => id !== offer.id))} />{offer.source === "rossko" ? "Я проверил совместимость, фасовку и условия поставки." : "Я проверил совместимость и применяемость товара."}</label> : <p className={styles.note}>Одобрение производителя подтверждено в данных товара.</p>}
        <button type="button" className="eco-btn" disabled={busy || alreadySelected || !canSearch || !amount?.enough || (needsReview && !confirmedOffers.includes(offer.id))} onClick={() => add(offer)}>Добавить</button>
      </li>;
    })}</ul> : null}
    {item.evidence.map((source, index) => source.url ? <a className={styles.source} href={source.url} target="_blank" rel="noreferrer" key={index}>{source.title ?? source.publisher ?? "Источник"}</a> : null)}
  </article>;
}

export function FluidQuotePicker({ profile, warehouseId, organizationId, onAdd, selectedSystemCodes }: Props) {
  if (!profile) return null;
  const items = profile.items.filter(item => item.systemCode !== "ENGINE_OIL" && MANN_FLUID_SYSTEMS.includes(item.systemCode as MannFluidSystem));
  if (!items.length) return <p className={styles.note}>Другие жидкости пока не определены по автомобилю.</p>;
  const context = JSON.stringify({ warehouseId, organizationId, profile });
  return <section className={styles.root} aria-label="Подбор остальных жидкостей"><h3>Остальные жидкости</h3><p className={styles.note}>Выберите способ обслуживания для каждого подтверждённого узла. Неподтверждённые сведения доступны для просмотра.</p>{items.map(item => <FluidItem key={`${context}:${item.revisionId}`} item={item} profile={profile} warehouseId={warehouseId} onAdd={onAdd} alreadySelected={selectedSystemCodes.includes(item.systemCode)} />)}</section>;
}
