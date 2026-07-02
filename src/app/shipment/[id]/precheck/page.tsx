"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Printer,
  Receipt,
  RefreshCw,
  Send,
} from "lucide-react";
import { EcoBadge, EcoButton } from "@/components/platform/EcoUI";
import { formatServiceDateTime } from "@/lib/date-time";
import {
  isLikelyBulkMotorOilProductCandidate,
  isRecognizedMotorOilMarkingCode,
  parseMarkingCodesInput,
  requiredMarkingCodeCount,
} from "@/lib/marking";
import {
  isBulkOilMarkingMode,
  isLiterSaleUnit,
  isPackagedMarkedGoodMode,
  normalizeProductMarkingMode,
  normalizeProductMarkingSettings,
  productMarkingProblemReasons,
} from "@/lib/product-marking";

type Meta = {
  href: string;
  type: string;
  mediaType: string;
};

type Header = {
  id: string;
  name: string;
  moment: string;
  applicable?: boolean;
  description?: string;
  sum: number;
  agentName: string;
  organizationName?: string;
  storeName?: string;
};

type Attribute = {
  id?: string;
  name?: string;
  type?: string;
  meta?: Meta;
  value?: unknown;
};

type Position = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  discount?: number;
  slotName?: string;
  assortmentMeta?: Meta;
  product?: {
    id: string;
    name: string;
    uomName?: string | null;
    groupPath?: string | null;
    packageVolume?: string | null;
    volume?: string | null;
    barcodeEan13?: string | null;
    markingEnabled?: boolean;
    markingMode?: string | null;
    markingStatus?: string | null;
    markingSettings?: unknown;
  };
};

type DetailResponse = {
  header: Header;
  attributes?: Attribute[];
  positions: Position[];
  raw?: unknown;
};

type SendState = "idle" | "sending" | "sent" | "error";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function normalizeAttrName(value?: string): string {
  return (value ?? "").toString().trim().toLowerCase().replace(/ё/g, "е");
}

function attributeValueToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

function formatMoney(valueKopecks: number): string {
  return `${((Number(valueKopecks) || 0) / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ₽`;
}

function formatDateTime(value?: string): string {
  if (!value) return "не указана";
  const formatted = formatServiceDateTime(value);
  return formatted === "—" ? value : formatted;
}

function positionBaseTotal(position: Position): number {
  return (Number(position.price) || 0) * (Number(position.quantity) || 0);
}

function positionTotal(position: Position): number {
  const discount = typeof position.discount === "number" ? position.discount : 0;
  return positionBaseTotal(position) * (1 - discount / 100);
}

function getAttributeValue(attributes: Attribute[] | undefined, matcher: RegExp): string {
  const attr = (attributes ?? []).find((item) => matcher.test(normalizeAttrName(item.name)));
  return attributeValueToString(attr?.value).trim();
}

function getRawAgent(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const agent = (raw as { agent?: unknown }).agent;
  return agent && typeof agent === "object" ? (agent as Record<string, unknown>) : null;
}

function getAgentPhone(raw: unknown): string {
  const agent = getRawAgent(raw);
  if (!agent) return "";
  if (typeof agent.phone === "string" && agent.phone.trim()) return agent.phone.trim();
  const phones = agent.phones;
  if (Array.isArray(phones)) {
    for (const item of phones) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (item && typeof item === "object") {
        const phone = (item as { phone?: unknown }).phone;
        if (typeof phone === "string" && phone.trim()) return phone.trim();
      }
    }
  }
  return "";
}

function getAssortmentSource(position: Position): { label: string; code: string } {
  const meta = position.assortmentMeta;
  if (!meta?.href) return { label: "ручная позиция", code: "" };
  const source = meta.href.startsWith("local://") ? "локальная БД" : "архивный источник";
  const rawCode = (() => {
    if (meta.href.startsWith("local://")) {
      return meta.href.split("/").filter(Boolean).at(-1) ?? "";
    }
    try {
      const url = new URL(meta.href);
      return url.pathname.split("/").filter(Boolean).at(-1) ?? "";
    } catch {
      return meta.href.split(/[?#]/)[0]?.split("/").filter(Boolean).at(-1) ?? "";
    }
  })();
  const code = rawCode.length > 14 ? `${rawCode.slice(0, 6)}…${rawCode.slice(-4)}` : rawCode;
  return { label: source, code };
}

function positionMarkingContext(position: Position) {
  return {
    productName: position.product?.name ?? position.name,
    groupPath: position.product?.groupPath,
    uomName: position.product?.uomName,
  };
}

function positionNeedsMarking(position: Position): boolean {
  return Boolean(position.product?.markingEnabled) && normalizeProductMarkingMode(position.product?.markingMode) !== "NOT_MARKED";
}

function positionBulkCandidate(position: Position): boolean {
  return isLikelyBulkMotorOilProductCandidate(positionMarkingContext(position));
}

function positionMarkingMode(position: Position) {
  return normalizeProductMarkingMode(position.product?.markingMode);
}

function positionIsBulkOil(position: Position): boolean {
  return positionNeedsMarking(position) && isBulkOilMarkingMode(positionMarkingMode(position));
}

function positionIsPackagedMarkedGood(position: Position): boolean {
  return positionNeedsMarking(position) && isPackagedMarkedGoodMode(positionMarkingMode(position));
}

function positionMeasuredPour(position: Position): boolean {
  return positionIsBulkOil(position);
}

function positionRequiredCodeCount(position: Position): number {
  if (positionIsBulkOil(position)) return 1;
  return requiredMarkingCodeCount(position.quantity, { measuredPour: false });
}

function positionMarkingBlockingReason(position: Position): string | null {
  if (!positionNeedsMarking(position)) return null;
  const mode = positionMarkingMode(position);
  const settings = normalizeProductMarkingSettings(position.product?.markingSettings);
  if (mode === "REQUIRES_CHECK") {
    return "Товар требует проверки маркировки. Откройте карточку товара и выберите сценарий.";
  }
  if (!positionIsBulkOil(position)) {
    const problemReasons = productMarkingProblemReasons({
      markingEnabled: true,
      markingMode: mode,
      markingStatus: position.product?.markingStatus,
      groupPath: position.product?.groupPath,
      uomName: position.product?.uomName,
      settings: position.product?.markingSettings,
    });
    if (problemReasons.length) return problemReasons.join(" ");
  }
  if (!positionIsBulkOil(position)) return null;
  if (!isLiterSaleUnit(position.product?.uomName)) return "Для масла на разлив единица продажи должна быть «л».";
  if (!settings.partialWithdrawalEnabled) return "Для активной бочки не включено частичное выбытие.";
  if (!settings.activeBarrelMarkingCode) return "Для товара на разлив не выбрана активная бочка с кодом маркировки.";
  if (settings.currentVolumeLiters != null && position.quantity > settings.currentVolumeLiters) {
    return `Недостаточно остатка в активной бочке. Остаток: ${settings.currentVolumeLiters} л, требуется: ${position.quantity} л.`;
  }
  return null;
}

function positionMarkingNote(position: Position): string {
  if (!positionNeedsMarking(position)) {
    return positionBulkCandidate(position)
      ? "Похоже, это масло на разлив. Проверьте настройки маркировки в карточке товара."
      : "Маркировка не требуется";
  }
  if (positionIsBulkOil(position)) {
    const settings = normalizeProductMarkingSettings(position.product?.markingSettings);
    const rest = settings.currentVolumeLiters == null ? "остаток не указан" : `остаток ${settings.currentVolumeLiters} л`;
    return `Маркировка: разлив · Litre · ${settings.activeBarrelMarkingCode ? "активная бочка" : "нет активной бочки"} · ${rest}`;
  }
  if (positionIsPackagedMarkedGood(position)) return "Маркировка: упаковка · код списывается целиком";
  return "Маркировка требует настройки";
}

function PrecheckSkeleton() {
  return (
    <main className="eco-page eco-page--wide eco-precheck-page">
      <section className="eco-precheck-head eco-precheck-skeleton-head">
        <span className="eco-skeleton-line is-code" />
        <span className="eco-skeleton-line is-title" />
        <span className="eco-skeleton-line is-code" />
      </section>
      <div className="eco-precheck-layout">
        <div className="eco-precheck-main">
          <section className="eco-card eco-precheck-card">
            <div className="eco-card__head">
              <span className="eco-skeleton-line is-code" />
            </div>
            <div className="eco-precheck-context-grid">
              {Array.from({ length: 8 }).map((_, index) => (
                <span key={index} className="eco-skeleton-line is-code" />
              ))}
            </div>
          </section>
          <section className="eco-card eco-precheck-card">
            <div className="eco-card__head">
              <span className="eco-skeleton-line is-code" />
            </div>
            <div className="eco-precheck-skeleton-table">
              {Array.from({ length: 5 }).map((_, index) => (
                <span key={index} className="eco-skeleton-line is-code" />
              ))}
            </div>
          </section>
        </div>
        <aside className="eco-precheck-aside">
          <section className="eco-card eco-precheck-total-card">
            <div className="eco-shipment-card-head">
              <span className="eco-skeleton-line is-code" />
            </div>
            <div className="eco-precheck-total-body">
              <span className="eco-skeleton-line is-title" />
              <span className="eco-skeleton-line is-code" />
              <span className="eco-skeleton-pill" />
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

export default function ShipmentPrecheckPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [markingInputs, setMarkingInputs] = useState<Record<string, string>>({});
  const [bypassed, setBypassed] = useState<Record<string, boolean>>({});
  const [bypassPassword, setBypassPassword] = useState("");

  const loadData = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      let cancelled = false;
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      setError(null);
      setSuccess(null);
      try {
        const sess = await fetch("/api/auth/session").then((r) => r.json());
        if (!sess?.user) {
          router.push(`/login?from=/shipment/${id}/precheck`);
          return () => {
            cancelled = true;
          };
        }
        const res = await fetch(`/api/demands/${id}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) {
          setData(null);
          setError(json.error ?? "Не удалось сформировать предчек");
          return () => {
            cancelled = true;
          };
        }
        if (!cancelled) {
          setData(json);
          setSendState("idle");
          setSentAt(null);
        }
      } catch (e) {
        if (!cancelled) {
          setData(null);
          setError(e instanceof Error ? e.message : "Ошибка сети");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
      return () => {
        cancelled = true;
      };
    },
    [id, router]
  );

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const cleanup = await loadData("initial");
      if (cancelled) cleanup?.();
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  const requiredPositions = useMemo(
    () => (data?.positions ?? []).filter(positionNeedsMarking),
    [data?.positions]
  );

  const invalidBulkPositions = useMemo(
    () => requiredPositions.filter((position) => Boolean(positionMarkingBlockingReason(position))),
    [requiredPositions]
  );

  const missingPositions = useMemo(
    () =>
      requiredPositions.filter((position) => {
        if (positionIsBulkOil(position) || positionMarkingBlockingReason(position)) return false;
        const codes = parseMarkingCodesInput(markingInputs[position.id] ?? "");
        const needed = positionRequiredCodeCount(position);
        const hasEnoughCodes = codes.length >= needed;
        const codesRecognized = codes.slice(0, needed).every(isRecognizedMotorOilMarkingCode);
        return !bypassed[position.id] && (!hasEnoughCodes || !codesRecognized);
      }),
    [bypassed, markingInputs, requiredPositions]
  );

  const totals = useMemo(() => {
    const positions = data?.positions ?? [];
    const subtotal = positions.reduce((sum, position) => sum + positionBaseTotal(position), 0);
    const total = positions.reduce((sum, position) => sum + positionTotal(position), 0);
    return {
      subtotal,
      discount: Math.max(0, subtotal - total),
      total,
      quantity: positions.reduce((sum, position) => sum + (Number(position.quantity) || 0), 0),
    };
  }, [data?.positions]);

  const precheckStatus = useMemo(() => {
    if (sendState === "sending") return { label: "Отправляем…", tone: "warning" as const };
    if (sendState === "sent") return { label: "Отправлен на кассу", tone: "success" as const };
    if (sendState === "error") return { label: "Ошибка отправки", tone: "danger" as const };
    if (!data || data.positions.length === 0) return { label: "Черновик", tone: "neutral" as const };
    if (invalidBulkPositions.length > 0) return { label: "Блокировка", tone: "danger" as const };
    if (missingPositions.length > 0) return { label: "Не отправлен", tone: "warning" as const };
    return { label: "Готов к отправке", tone: "rust" as const };
  }, [data, invalidBulkPositions.length, missingPositions.length, sendState]);

  const clientName = data?.header.agentName?.trim() || "не указан";
  const phone = getAgentPhone(data?.raw);
  const vehicleModel = getAttributeValue(data?.attributes, /^модель авто$/i);
  const vehicleYear = getAttributeValue(data?.attributes, /^год$/i);
  const vehiclePlate = getAttributeValue(data?.attributes, /гос.*номер|номер/i);
  const documentVin = getAttributeValue(data?.attributes, /vin/i);
  const vehicleTitle = [vehicleModel, vehicleYear].filter(Boolean).join(" · ");
  const createdAt = formatDateTime(data?.header.moment);
  const canSend = Boolean(data && data.positions.length > 0 && missingPositions.length === 0 && invalidBulkPositions.length === 0);

  async function handleBypass(position: Position) {
    const password = window.prompt(`Пароль для пропуска маркировки: ${position.name}`);
    if (!password) return;
    setBypassPassword(password);
    setBypassed((prev) => ({ ...prev, [position.id]: true }));
    setError(null);
    if (sendState === "error") setSendState("idle");
  }

  async function handleSend() {
    if (!data || sendState === "sending" || sendState === "sent" || !canSend) return;
    setSendState("sending");
    setError(null);
    setSuccess(null);
    try {
      const markingCodes = Object.fromEntries(
        Object.entries(markingInputs).map(([positionId, value]) => [
          positionId,
          parseMarkingCodesInput(value),
        ])
      );
      const markingBypassPositionIds = Object.entries(bypassed)
        .filter(([, value]) => value)
        .map(([positionId]) => positionId);

      const res = await fetch(`/api/demands/${id}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          markingCodes,
          markingBypassPositionIds,
          markingBypassPassword:
            markingBypassPositionIds.length > 0 ? bypassPassword : undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSendState("error");
        setError(typeof json.error === "string" ? json.error : "Не удалось отправить заказ на кассу");
        return;
      }
      setSendState("sent");
      setSentAt(new Date().toISOString());
      const aqsiTarget = json.shopId
        ? `магазин AQSI ${json.shopId}`
        : json.deviceId
          ? `устройство AQSI ${json.deviceId}`
          : "AQSI";
      setSuccess(
        json.status
          ? `Заказ создан в ${aqsiTarget}. Статус: ${json.status}.`
          : `Заказ создан в ${aqsiTarget} и ожидает синхронизации с кассой.`
      );
    } catch (e) {
      setSendState("error");
      setError(e instanceof Error ? e.message : "Ошибка отправки на кассу");
    }
  }

  if (loading) return <PrecheckSkeleton />;

  if (!data) {
    return (
      <main className="eco-page eco-page--wide eco-precheck-page">
        <section className="eco-card eco-card--padded eco-precheck-state-card is-error">
          <AlertTriangle className="eco-precheck-state-icon" aria-hidden />
          <div>
            <div className="eco-page-kicker">Предчек</div>
            <h1>Не удалось сформировать предчек</h1>
            <p>{error ?? "Проверьте позиции отгрузки и попробуйте ещё раз."}</p>
          </div>
          <div className="eco-actions">
            <EcoButton type="button" variant="primary" onClick={() => void loadData("initial")}>
              <RefreshCw className="eco-icon" aria-hidden />
              Повторить
            </EcoButton>
            <Link href={`/shipment/${id}`} className="eco-btn">
              <ArrowLeft className="eco-icon" aria-hidden />
              К отгрузке
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="eco-page eco-page--wide eco-precheck-page">
      <header className="eco-precheck-head">
        <div>
          <Link href={`/shipment/${id}`} className="eco-precheck-back-link">
            <ArrowLeft className="eco-icon" aria-hidden />
            К отгрузке
          </Link>
          <div className="eco-page-kicker eco-precheck-crumbs">
            <Link href="/shipment">Операции / Отгрузки</Link>
            <span>/ Предчек</span>
          </div>
          <div className="eco-precheck-title-row">
            <h1 className="eco-page-title">Предчек {data.header.name}</h1>
            <EcoBadge tone={precheckStatus.tone} dot>
              {precheckStatus.label}
            </EcoBadge>
          </div>
          <p className="eco-page-subtitle">
            {clientName} · Отгрузка <span className="eco-precheck-mono">{data.header.name}</span> · {createdAt}
          </p>
          <p className="eco-precheck-head-meta">
            {data.header.organizationName || "организация не указана"} · {data.header.storeName || "склад не указан"}
          </p>
        </div>
        <div className="eco-actions">
          <EcoButton type="button" onClick={() => void loadData("refresh")} disabled={refreshing || sendState === "sending"}>
            <RefreshCw className={cx("eco-icon", refreshing && "eco-precheck-spin")} aria-hidden />
            {refreshing ? "Обновляем…" : "Обновить"}
          </EcoButton>
          <button type="button" className="eco-btn" onClick={() => window.print()}>
            <Printer className="eco-icon" aria-hidden />
            Печать
          </button>
        </div>
      </header>

      <div className="eco-precheck-layout">
        <div className="eco-precheck-main">
          <section className="eco-card eco-precheck-card">
            <div className="eco-card__head">
              <div>
                <div className="eco-page-kicker">Документ</div>
                <h2>Клиент и документ</h2>
              </div>
              <EcoBadge tone={data.header.applicable ? "success" : "neutral"} dot>
                {data.header.applicable ? "Отгрузка проведена" : "Отгрузка черновик"}
              </EcoBadge>
            </div>
            <div className="eco-precheck-context-grid">
              <div className="eco-precheck-context-item is-wide">
                <span>Клиент</span>
                <strong>{clientName}</strong>
              </div>
              <div className="eco-precheck-context-item">
                <span>Телефон</span>
                <strong>{phone || "не указан"}</strong>
              </div>
              <div className="eco-precheck-context-item">
                <span>Автомобиль</span>
                <strong>{vehicleTitle || "не указан"}</strong>
              </div>
              <div className="eco-precheck-context-item">
                <span>Гос. номер</span>
                <strong className="eco-precheck-mono">{vehiclePlate || "не указан"}</strong>
              </div>
              <div className="eco-precheck-context-item">
                <span>VIN</span>
                <strong className="eco-precheck-mono">{documentVin || "не указан"}</strong>
              </div>
              <div className="eco-precheck-context-item">
                <span>Отгрузка</span>
                <strong className="eco-precheck-mono">{data.header.name}</strong>
              </div>
              <div className="eco-precheck-context-item">
                <span>Организация</span>
                <strong>{data.header.organizationName || "не указана"}</strong>
              </div>
              <div className="eco-precheck-context-item">
                <span>Склад</span>
                <strong>{data.header.storeName || "не указан"}</strong>
              </div>
              <div className="eco-precheck-context-item">
                <span>Дата</span>
                <strong>{createdAt}</strong>
              </div>
            </div>
          </section>

          <section className="eco-card eco-precheck-card eco-precheck-positions">
            <div className="eco-card__head">
              <div>
                <div className="eco-page-kicker">Документ</div>
                <h2>Позиции предчека</h2>
              </div>
              <EcoBadge tone={data.positions.length > 0 ? "rust" : "neutral"}>
                {data.positions.length} поз.
              </EcoBadge>
            </div>

            {data.positions.length === 0 ? (
              <div className="eco-precheck-empty-state">
                <Receipt className="eco-precheck-state-icon" aria-hidden />
                <strong>В предчеке пока нет позиций</strong>
                <span>Вернитесь к отгрузке и добавьте товары или услуги.</span>
                <Link href={`/shipment/${id}`} className="eco-btn eco-btn--primary">
                  <ArrowLeft className="eco-icon" aria-hidden />
                  К отгрузке
                </Link>
              </div>
            ) : (
              <>
                <div className="eco-precheck-position-cards">
                  {data.positions.map((position, index) => {
                    const source = getAssortmentSource(position);
                    const needsMarking = positionNeedsMarking(position);
                    const bulkOil = positionIsBulkOil(position);
                    const blockingReason = positionMarkingBlockingReason(position);
                    const needed = positionRequiredCodeCount(position);
                    const codes = parseMarkingCodesInput(markingInputs[position.id] ?? "");
                    const codesRecognized = codes.slice(0, needed).every(isRecognizedMotorOilMarkingCode);
                    const isMissing =
                      needsMarking && !bulkOil && !blockingReason && !bypassed[position.id] && (codes.length < needed || !codesRecognized);

                    return (
                      <article key={position.id} className={cx("eco-precheck-position-card", (isMissing || blockingReason) && "is-warning")}>
                        <div className="eco-precheck-position-card-head">
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <div>
                            <strong>{position.name}</strong>
                            <small>
                              {source.label}
                              {source.code ? ` · ${source.code}` : ""}
                            </small>
                          </div>
                        </div>
                        <div className="eco-precheck-position-card-grid">
                          <span>Кол-во <strong>{position.quantity}</strong></span>
                          <span>Цена <strong>{formatMoney(position.price)}</strong></span>
                          <span>Скидка <strong>{position.discount ? `${position.discount}%` : "0"}</strong></span>
                          <span>Сумма <strong>{formatMoney(positionTotal(position))}</strong></span>
                        </div>
                        {blockingReason && (
                          <div className="eco-precheck-message is-error" role="alert">
                            <AlertTriangle className="eco-icon" aria-hidden />
                            {blockingReason}
                          </div>
                        )}
                        {needsMarking ? (
                          <div className="eco-precheck-marking-box">
                            <EcoBadge tone={blockingReason || isMissing ? "warning" : "success"} dot>
                              {blockingReason
                                ? "Маркировка требует проверки"
                                : bulkOil
                                  ? "Разлив · Litre"
                                  : bypassed[position.id]
                                    ? "Пропуск разрешён"
                                    : isMissing
                                      ? "Нужна маркировка"
                                      : "Маркировка готова"}
                            </EcoBadge>
                            <span className="eco-precheck-marking-note">{positionMarkingNote(position)}</span>
                            {!bulkOil && !blockingReason ? (
                              <>
                                <textarea
                                  value={markingInputs[position.id] ?? ""}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    setMarkingInputs((prev) => ({ ...prev, [position.id]: value }));
                                    if (parseMarkingCodesInput(value).length >= needed) {
                                      setBypassed((prev) => ({ ...prev, [position.id]: false }));
                                    }
                                    if (sendState === "error") setSendState("idle");
                                  }}
                                  rows={needed > 1 ? Math.min(needed, 4) : 2}
                                  placeholder="Код маркировки"
                                  wrap="off"
                                  spellCheck={false}
                                  autoCapitalize="off"
                                  autoCorrect="off"
                                  className="eco-precheck-marking-input"
                                />
                                <div className="eco-precheck-marking-actions">
                                  <span>{bypassed[position.id] ? "пропуск" : `${Math.min(codes.length, needed)} из ${needed}`}</span>
                                  {bypassed[position.id] ? (
                                    <button type="button" onClick={() => setBypassed((prev) => ({ ...prev, [position.id]: false }))}>
                                      Отменить пропуск
                                    </button>
                                  ) : (
                                    <button type="button" onClick={() => void handleBypass(position)}>
                                      Пропустить без маркировки
                                    </button>
                                  )}
                                </div>
                              </>
                            ) : null}
                          </div>
                        ) : (
                          <EcoBadge tone={positionBulkCandidate(position) ? "warning" : "neutral"}>
                            {positionMarkingNote(position)}
                          </EcoBadge>
                        )}
                      </article>
                    );
                  })}
                </div>

                <div className="eco-precheck-table-wrap">
                  <table className="eco-precheck-table">
                    <thead>
                      <tr>
                        <th>№</th>
                        <th>Товар / услуга</th>
                        <th>Артикул / код / источник</th>
                        <th>Кол-во</th>
                        <th>Цена</th>
                        <th>Скидка</th>
                        <th>Сумма</th>
                        <th>Маркировка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.positions.map((position, index) => {
                        const source = getAssortmentSource(position);
                        const needsMarking = positionNeedsMarking(position);
                        const measuredPour = positionMeasuredPour(position);
                        const bulkOil = positionIsBulkOil(position);
                        const blockingReason = positionMarkingBlockingReason(position);
                        const needed = positionRequiredCodeCount(position);
                        const codes = parseMarkingCodesInput(markingInputs[position.id] ?? "");
                        const codesRecognized = codes.slice(0, needed).every(isRecognizedMotorOilMarkingCode);
                        const isMissing =
                          needsMarking && !bulkOil && !blockingReason && !bypassed[position.id] && (codes.length < needed || !codesRecognized);

                        return (
                          <tr key={position.id} className={isMissing || blockingReason ? "is-warning" : undefined}>
                            <td className="eco-precheck-table-index">{index + 1}</td>
                            <td>
                              <strong className="eco-precheck-position-name">{position.name}</strong>
                              <span className="eco-precheck-position-sub">
                                {position.slotName ? `Ячейка: ${position.slotName}` : "позиция предчека"}
                              </span>
                            </td>
                            <td>
                              <span>{source.label}</span>
                              <code>{source.code || "код не указан"}</code>
                            </td>
                            <td className="is-num">
                              {position.quantity}
                              {measuredPour ? " л" : ""}
                            </td>
                            <td className="is-num">{formatMoney(position.price)}</td>
                            <td className="is-num">{position.discount ? `${position.discount}%` : "0"}</td>
                            <td className="is-num is-total">{formatMoney(positionTotal(position))}</td>
                            <td className="eco-precheck-marking-cell">
                              {needsMarking ? (
                                <div className="eco-precheck-marking-box">
                                  <EcoBadge tone={blockingReason || isMissing ? "warning" : "success"} dot>
                                    {blockingReason
                                      ? "Проверить"
                                      : bulkOil
                                        ? "Разлив · Litre"
                                        : bypassed[position.id]
                                          ? "Пропуск"
                                          : isMissing
                                            ? "Нужна маркировка"
                                            : "Готово"}
                                  </EcoBadge>
                                  <span className="eco-precheck-marking-note">{blockingReason ?? positionMarkingNote(position)}</span>
                                  {!bulkOil && !blockingReason ? (
                                    <>
                                      <textarea
                                        value={markingInputs[position.id] ?? ""}
                                        onChange={(event) => {
                                          const value = event.target.value;
                                          setMarkingInputs((prev) => ({ ...prev, [position.id]: value }));
                                          if (parseMarkingCodesInput(value).length >= needed) {
                                            setBypassed((prev) => ({ ...prev, [position.id]: false }));
                                          }
                                          if (sendState === "error") setSendState("idle");
                                        }}
                                        rows={needed > 1 ? Math.min(needed, 4) : 2}
                                        placeholder="Код маркировки"
                                        wrap="off"
                                        spellCheck={false}
                                        autoCapitalize="off"
                                        autoCorrect="off"
                                        className="eco-precheck-marking-input"
                                      />
                                      <div className="eco-precheck-marking-actions">
                                        <span>{bypassed[position.id] ? "пропуск" : `${Math.min(codes.length, needed)} из ${needed}`}</span>
                                        {codes.length > 0 && !codes.every(isRecognizedMotorOilMarkingCode) && (
                                          <span className="is-danger">формат не распознан</span>
                                        )}
                                        {bypassed[position.id] ? (
                                          <button type="button" onClick={() => setBypassed((prev) => ({ ...prev, [position.id]: false }))}>
                                            Отменить
                                          </button>
                                        ) : (
                                          <button type="button" onClick={() => void handleBypass(position)}>
                                            Пропустить
                                          </button>
                                        )}
                                      </div>
                                    </>
                                  ) : null}
                                </div>
                              ) : (
                                <EcoBadge tone={positionBulkCandidate(position) ? "warning" : "neutral"}>
                                  {positionBulkCandidate(position) ? "Проверьте настройки" : "Не требуется"}
                                </EcoBadge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={6}>Итого по предчеку</td>
                        <td className="is-num is-total">{formatMoney(totals.total)}</td>
                        <td>{data.positions.length} поз.</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
          </section>

          {(data.header.description || error || success) && (
            <section className="eco-card eco-precheck-card">
              <div className="eco-card__head">
                <div>
                  <div className="eco-page-kicker">Служебно</div>
                  <h2>Комментарий и статус</h2>
                </div>
              </div>
              <div className="eco-precheck-service-body">
                {data.header.description && <p>{data.header.description}</p>}
                {error && (
                  <div className="eco-precheck-message is-error" role="alert">
                    <AlertTriangle className="eco-icon" aria-hidden />
                    {error}
                  </div>
                )}
                {success && (
                  <div className="eco-precheck-message is-success">
                    <CheckCircle2 className="eco-icon" aria-hidden />
                    {success}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        <aside className="eco-precheck-aside">
          <section className="eco-card eco-precheck-total-card">
            <div className="eco-shipment-card-head">
              <h2>Итого</h2>
              <EcoBadge tone={precheckStatus.tone} dot>
                {precheckStatus.label}
              </EcoBadge>
            </div>
            <div className="eco-precheck-total-body">
              <div className="eco-precheck-total-line">
                <span>Подытог</span>
                <strong>{formatMoney(totals.subtotal)}</strong>
              </div>
              <div className="eco-precheck-total-line">
                <span>Скидка</span>
                <strong>{totals.discount > 0 ? `− ${formatMoney(totals.discount)}` : "0 ₽"}</strong>
              </div>
              <div className="eco-precheck-total-main">
                <span>К оплате</span>
                <strong>{formatMoney(totals.total)}</strong>
              </div>
              <div className="eco-precheck-total-line is-muted">
                <span>Количество позиций</span>
                <strong>{data.positions.length}</strong>
              </div>
              <div className="eco-precheck-total-line is-muted">
                <span>Количество единиц</span>
                <strong>{totals.quantity.toLocaleString("ru-RU")}</strong>
              </div>
              <div className="eco-precheck-total-line">
                <span>Статус предчека</span>
                <strong>{precheckStatus.label}</strong>
              </div>
              <div className="eco-precheck-total-line">
                <span>Касса</span>
                <strong>{sendState === "sent" ? "отправлен" : sendState === "error" ? "ошибка" : "не отправлен"}</strong>
              </div>
              {invalidBulkPositions.length > 0 && (
                <div className="eco-readiness-list">
                  {invalidBulkPositions.map((position) => (
                    <span key={position.id}>• {positionMarkingBlockingReason(position)} — {position.name}</span>
                  ))}
                </div>
              )}
              {sentAt && (
                <div className="eco-precheck-total-line is-muted">
                  <span>Отправлен</span>
                  <strong>{formatDateTime(sentAt)}</strong>
                </div>
              )}
              {missingPositions.length > 0 && (
                <div className="eco-readiness-list">
                  {missingPositions.map((position) => (
                    <span key={position.id}>• Нужна маркировка: {position.name}</span>
                  ))}
                </div>
              )}
              <EcoButton
                type="button"
                onClick={() => void handleSend()}
                disabled={!canSend || sendState === "sending" || sendState === "sent"}
                title={!canSend ? "Заполните позиции, маркировку и настройки разливного товара" : undefined}
                variant="primary"
                className="eco-precheck-submit"
              >
                {sendState === "sending" ? (
                  <Loader2 className="eco-icon eco-precheck-spin" aria-hidden />
                ) : sendState === "sent" ? (
                  <CheckCircle2 className="eco-icon" aria-hidden />
                ) : (
                  <Send className="eco-icon" aria-hidden />
                )}
                {sendState === "sending"
                  ? "Отправляем…"
                  : sendState === "sent"
                    ? "Отправлен на кассу"
                    : "Отправить заказ на кассу"}
              </EcoButton>
              <div className="eco-precheck-side-actions">
                <Link href={`/shipment/${id}`} className="eco-btn">
                  <ArrowLeft className="eco-icon" aria-hidden />
                  Вернуться к отгрузке
                </Link>
                <button type="button" className="eco-btn" onClick={() => void loadData("refresh")} disabled={refreshing || sendState === "sending"}>
                  <RefreshCw className={cx("eco-icon", refreshing && "eco-precheck-spin")} aria-hidden />
                  Обновить данные
                </button>
                <button type="button" className="eco-btn" onClick={() => window.print()}>
                  <Printer className="eco-icon" aria-hidden />
                  Печать
                </button>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
