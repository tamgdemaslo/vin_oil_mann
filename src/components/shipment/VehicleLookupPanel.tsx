"use client";

import { useRef, useState } from "react";
import type { MannVehicleCandidate, MannVehicleResolution } from "@/lib/mann-vehicle-resolver";
import type { MannTechnicalCapacity, MannTransmissionType, MannUnifiedTechnicalProfile } from "@/lib/mann-unified-technical-profile";
import type { NormalizedVehicleIdentity, VehicleLookupResult } from "@/lib/vehicle-identity-client";

type LookupTab = "vin" | "plate" | "manual";
type LookupFeedbackTone = "neutral" | "success" | "warning";

export type VehicleLookupManualContext = {
  reason?: "manual" | "plate_not_found" | "lookup_unavailable" | "partial";
  vehicle?: NormalizedVehicleIdentity | null;
  message?: string;
};

type Props = {
  organizationId?: string | null;
  warehouseId?: string | null;
  initialVin?: string;
  onUseVehicle: (vehicle: NormalizedVehicleIdentity, resolution: MannVehicleResolution | null) => void;
  onConfirmMannCandidate: (vehicle: NormalizedVehicleIdentity, candidate: MannVehicleCandidate) => void;
  onConfirmTransmission?: (vehicle: NormalizedVehicleIdentity, transmissionType: MannTransmissionType, variantIds: string[]) => void;
  onLookupStart: () => void;
  onManualMode: (context?: VehicleLookupManualContext) => void;
};

type LookupResponse = VehicleLookupResult & { error?: string };
type LookupFeedback = {
  tone: LookupFeedbackTone;
  title: string;
  body?: string;
  actionLabel?: string;
  action?: "manual" | "vin";
  secondaryActionLabel?: string;
};

const PLATE_LATIN_TO_CYRILLIC: Record<string, string> = {
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  K: "К",
  M: "М",
  O: "О",
  P: "Р",
  T: "Т",
  X: "Х",
  Y: "У",
};

async function responseJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function normalizeVinInput(value: string): string {
  return value.toUpperCase().replace(/\s+/g, "");
}

function normalizePlateDraft(value: string): string {
  return value
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/Ё/g, "Е")
    .replace(/[ABCEHKMOPTXY]/g, (char) => PLATE_LATIN_TO_CYRILLIC[char] ?? char)
    .replace(/[^0-9А-Я]/g, "");
}

function isLikelyRussianPlate(value: string): boolean {
  return /^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2}\d{2,3}$/.test(value);
}

function vehicleTitle(vehicle: NormalizedVehicleIdentity): string {
  const title = [vehicle.makeRaw ?? vehicle.makeCanonical, vehicle.modelRaw ?? vehicle.modelCanonical, vehicle.generationRaw].filter(Boolean).join(" ");
  return vehicle.bodyName && !title.includes(vehicle.bodyName) ? `${title} (${vehicle.bodyName})` : title || "Автомобиль";
}

function vehicleDetails(vehicle: NormalizedVehicleIdentity): string {
  return [
    vehicle.licensePlate,
    vehicle.year,
    vehicle.engineVolumeLiters ? `${vehicle.engineVolumeLiters} л` : undefined,
    vehicle.engineCode,
    vehicle.powerHp ? `${Math.round(vehicle.powerHp)} л.с.` : undefined,
  ].filter(Boolean).join(" · ");
}

function sourceLabel(vehicle: NormalizedVehicleIdentity): string {
  if (vehicle.sourceMethods.includes("tronk_frame")) return "TRONK · номер кузова";
  if (vehicle.sourceMethods.includes("tronk_plate")) return "TRONK · госномер";
  if (vehicle.sourceMethods.includes("tronk_convertb2b") || vehicle.sourceMethods.includes("tronk_convertgate")) return "TRONK · госномер без VIN";
  if (vehicle.sourceMethods.includes("tronk_vindecode2")) return "TRONK · VIN (уточнённая расшифровка)";
  return "TRONK · VIN";
}

function confidenceLabel(value?: "high" | "medium" | "low"): string {
  if (value === "high") return "высокая";
  if (value === "medium") return "средняя";
  return "низкая";
}

function mannStatusCopy(resolution: MannVehicleResolution | null, resolving: boolean): string {
  if (resolving) return "Подбираем MANN-модификацию...";
  if (resolution?.status === "resolved") {
    return `MANN-модификация выбрана: ${resolution.selectedApplication?.effectiveVehicleText ?? resolution.selectedApplication?.vehicleText ?? "точное совпадение"}.`;
  }
  if (resolution?.status === "candidates") return "Выберите MANN-модификацию.";
  return "MANN-модификация не найдена. Выберите автомобиль вручную.";
}

function candidateLabel(candidate: MannVehicleCandidate): string {
  const rawTitle = candidate.effectiveVehicleText ?? candidate.vehicleText ?? "Все модификации";
  const title = rawTitle.trim().toLowerCase() === "all models" ? "Все модификации" : rawTitle;
  const details = [candidate.engineCode, candidate.kw ? `${candidate.kw} кВт` : null, candidate.hp ? `${candidate.hp} л.с.` : null, candidate.vehicleYears].filter(Boolean);
  return details.length ? `${title} · ${details.join(" · ")}` : title;
}

function formatLiters(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);
}

function capacityLabel(capacity: MannTechnicalCapacity): string {
  let value = "";
  if (capacity.nominalLiters != null) {
    value = `${formatLiters(capacity.nominalLiters)} л`;
    if (capacity.toleranceLiters != null && capacity.toleranceLiters > 0) {
      value += ` ± ${formatLiters(capacity.toleranceLiters)} л`;
    }
  } else if (capacity.minLiters != null && capacity.maxLiters != null) {
    value = `${formatLiters(capacity.minLiters)}–${formatLiters(capacity.maxLiters)} л`;
  } else if (capacity.maxLiters != null) {
    value = `до ${formatLiters(capacity.maxLiters)} л`;
  } else if (capacity.minLiters != null) {
    value = `от ${formatLiters(capacity.minLiters)} л`;
  }
  return [value, capacity.serviceContextLabel].filter(Boolean).join(" · ");
}

function TechnicalProfile({
  profile,
  loading,
  error,
  onSelectTransmission,
}: {
  profile: MannUnifiedTechnicalProfile | null;
  loading: boolean;
  error: string;
  onSelectTransmission: (transmissionType: MannTransmissionType) => void;
}) {
  return (
    <div className="eco-vehicle-lookup__profile" aria-live="polite" aria-busy={loading}>
      <div className="eco-vehicle-lookup__profile-head">
        <strong>Технические жидкости</strong>
        {profile?.status === "active" ? <span className="is-active">Активные данные</span> : null}
        {profile?.status === "staged_preview" ? <span className="is-preview">Проверено · тест</span> : null}
        {profile?.status === "catalog_preview" ? <span className="is-catalog">Каталог · предварительно</span> : null}
      </div>
      {profile?.transmissionOptions.length ? (
        <fieldset className="eco-vehicle-lookup__transmission-choice">
          <legend>Коробка передач</legend>
          <div>
            {profile.transmissionOptions.map((option) => (
              <button
                type="button"
                key={option.type}
                className={profile.selectedTransmissionType === option.type ? "is-selected" : ""}
                aria-pressed={profile.selectedTransmissionType === option.type}
                disabled={loading}
                onClick={() => onSelectTransmission(option.type)}
              >
                {option.label}
              </button>
            ))}
            {loading ? <span role="status">Обновляем…</span> : null}
            {profile.selectedTransmissionType ? <em>Указано вручную</em> : <span>Выберите установленный тип — покажем жидкость и объём.</span>}
          </div>
        </fieldset>
      ) : null}
      {loading ? (
        <div className="eco-vehicle-lookup__profile-loading" role="status">
          <span className="eco-sr-only">Загружаем технический профиль…</span>
          <i />
          <i />
        </div>
      ) : error ? (
        <div className="eco-vehicle-lookup__profile-state is-warning">{error}</div>
      ) : profile?.items.length ? (
        <>
          <div className="eco-vehicle-lookup__profile-items">
            {profile.items.map((item) => (
              <div className="eco-vehicle-lookup__profile-item" key={item.revisionId}>
                <div className="eco-vehicle-lookup__profile-main">
                  <div>
                    <strong>{item.systemLabel}</strong>
                    {item.componentModel ? <span>{item.componentModel}</span> : null}
                  </div>
                  {item.capacities.length ? (
                    <div className="eco-vehicle-lookup__profile-capacities">
                      {item.capacities.map((capacity, index) => <b key={`${capacityLabel(capacity)}-${index}`}>{capacityLabel(capacity)}</b>)}
                    </div>
                  ) : null}
                </div>
                {item.userConfirmedTransmission ? <span className="is-confirmed">Тип коробки подтверждён вручную.</span> : null}
                {item.specifications.length ? (
                  <span><em>Допуски / классы</em>{item.specifications.join(" · ")}</span>
                ) : null}
                {item.viscosityGrades.length ? (
                  <span><em>Вязкость</em>{item.viscosityGrades.join(" · ")}</span>
                ) : null}
                {!item.specifications.length && !item.viscosityGrades.length ? (
                  <span className="is-muted">
                    {item.sourceStatus === "catalog_preview"
                      ? "Допуски и вязкость для этой записи в исходном каталоге не указаны."
                      : "Допуски и вязкость для этой записи пока не подтверждены."}
                  </span>
                ) : null}
                {item.requiresReview ? <span className="is-review">Числовой объём скрыт: строка требует проверки разбора.</span> : null}
                {item.recommendation ? <span><em>Рекомендация</em>{item.recommendation}</span> : null}
                {item.replacementInterval ? <span><em>Интервал</em>{item.replacementInterval}</span> : null}
                {item.evidence.length ? (
                  <details className="eco-vehicle-lookup__profile-source">
                    <summary>Источник: {item.evidence[0]?.publisher ?? item.evidence[0]?.title ?? "технический каталог"}</summary>
                    <div>
                      {item.evidence.map((source, index) => {
                        const label = [source.title ?? source.publisher ?? "Документ", source.printedPage != null ? `стр. ${source.printedPage}` : null].filter(Boolean).join(" · ");
                        return source.url ? (
                          <a href={source.url} target="_blank" rel="noreferrer" key={`${source.url}-${index}`}>{label}</a>
                        ) : <span key={`${label}-${index}`}>{label}</span>;
                      })}
                    </div>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
          {profile.notice ? <p className="eco-vehicle-lookup__profile-notice">{profile.notice}</p> : null}
        </>
      ) : (
        <div className="eco-vehicle-lookup__profile-state">Для этой модификации технических данных пока нет.</div>
      )}
    </div>
  );
}

export function VehicleLookupPanel({ organizationId, warehouseId, initialVin, onUseVehicle, onConfirmMannCandidate, onConfirmTransmission, onLookupStart, onManualMode }: Props) {
  const [tab, setTab] = useState<LookupTab>("vin");
  const [input, setInput] = useState(initialVin ?? "");
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [resolution, setResolution] = useState<MannVehicleResolution | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<LookupFeedback | null>(null);
  const [appliedVehicle, setAppliedVehicle] = useState<NormalizedVehicleIdentity | null>(null);
  const [appliedFromCache, setAppliedFromCache] = useState(false);
  const [technicalProfile, setTechnicalProfile] = useState<MannUnifiedTechnicalProfile | null>(null);
  const [technicalProfileVariantKeys, setTechnicalProfileVariantKeys] = useState<string[]>([]);
  const [selectedTransmissionType, setSelectedTransmissionType] = useState<MannTransmissionType | undefined>();
  const [technicalProfileLoading, setTechnicalProfileLoading] = useState(false);
  const [technicalProfileError, setTechnicalProfileError] = useState("");
  const lookupRequestIdRef = useRef(0);
  const resolutionRequestIdRef = useRef(0);
  const technicalProfileRequestIdRef = useRef(0);
  const lookupControllerRef = useRef<AbortController | null>(null);
  const resolutionControllerRef = useRef<AbortController | null>(null);
  const technicalProfileControllerRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastAutomaticLookupRef = useRef("");

  const selectedVehicle = lookup && lookup.candidates.length > 1
    ? lookup.candidates.find((candidate) => candidate.key === selectedKey)?.vehicle ?? null
    : lookup?.vehicle ?? null;

  const openManualMode = (context?: VehicleLookupManualContext) => {
    setTab("manual");
    onManualMode(context);
  };

  const resetLookupState = () => {
    technicalProfileRequestIdRef.current += 1;
    technicalProfileControllerRef.current?.abort();
    setLookup(null);
    setResolution(null);
    setSelectedKey(null);
    setFeedback(null);
    setAppliedVehicle(null);
    setAppliedFromCache(false);
    setTechnicalProfile(null);
    setTechnicalProfileVariantKeys([]);
    setSelectedTransmissionType(undefined);
    setTechnicalProfileLoading(false);
    setTechnicalProfileError("");
  };

  const loadTechnicalProfile = async (variantKeys: string[], transmissionType?: MannTransmissionType) => {
    const requestId = ++technicalProfileRequestIdRef.current;
    technicalProfileControllerRef.current?.abort();
    const controller = new AbortController();
    technicalProfileControllerRef.current = controller;
    setTechnicalProfileVariantKeys(variantKeys);
    setSelectedTransmissionType(transmissionType);
    if (!transmissionType) {
      setTechnicalProfile(null);
    } else {
      setTechnicalProfile((current) => current ? { ...current, selectedTransmissionType: transmissionType } : current);
    }
    setTechnicalProfileError("");
    setTechnicalProfileLoading(true);
    try {
      const response = await fetch("/api/mann-catalog/technical-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantKeys, transmissionType }),
        signal: controller.signal,
      });
      const data = await responseJson<MannUnifiedTechnicalProfile & { error?: string }>(response);
      if (requestId !== technicalProfileRequestIdRef.current) return;
      if (!response.ok || !data) {
        setTechnicalProfileError(data?.error ?? "Не удалось загрузить технический профиль.");
        return;
      }
      setTechnicalProfile(data);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (requestId !== technicalProfileRequestIdRef.current) return;
      setTechnicalProfileError("Технический профиль временно недоступен. Подбор фильтров продолжает работать.");
    } finally {
      if (requestId === technicalProfileRequestIdRef.current) setTechnicalProfileLoading(false);
    }
  };

  const handleResolution = async (vehicle: NormalizedVehicleIdentity, fromCache?: boolean) => {
    const requestId = ++resolutionRequestIdRef.current;
    resolutionControllerRef.current?.abort();
    const controller = new AbortController();
    resolutionControllerRef.current = controller;
    setResolving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/mann-catalog/resolve-decoded-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, warehouseId, normalizedVehicle: vehicle }),
        signal: controller.signal,
      });
      const data = await responseJson<MannVehicleResolution & { error?: string }>(response);
      if (requestId !== resolutionRequestIdRef.current) return;
      if (!response.ok || !data) {
        setFeedback({
          tone: "warning",
          title: "Сервис MANN временно недоступен",
          body: "Можно продолжить ручной подбор по каталогу.",
          actionLabel: "Перейти к ручному подбору",
        });
        openManualMode({ reason: "lookup_unavailable", vehicle, message: "Сервис MANN временно недоступен" });
        return;
      }

      setResolution(data);

      onUseVehicle(vehicle, data);
      if (data.status === "resolved") {
        setAppliedVehicle(vehicle);
        setAppliedFromCache(Boolean(fromCache));
        setFeedback(null);
        if (data.selectedApplication) void loadTechnicalProfile(data.selectedApplication.variantIds);
        return;
      }

      setFeedback({
        tone: "neutral",
        title: data.status === "candidates" ? "Автомобиль определён" : "Автомобиль определён частично",
        body: data.status === "candidates"
          ? "Выберите подходящую MANN-модификацию ниже. Она пока не установлена автоматически."
          : "Точное соответствие MANN не найдено. Можно перейти к ручному подбору.",
        actionLabel: data.status === "unresolved" ? "Перейти к ручному подбору" : undefined,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (requestId !== resolutionRequestIdRef.current) return;
      setFeedback({
        tone: "warning",
        title: "Сервис MANN временно недоступен",
        body: "Можно продолжить ручной подбор по каталогу.",
        actionLabel: "Перейти к ручному подбору",
      });
      openManualMode({ reason: "lookup_unavailable", vehicle, message: "Сервис MANN временно недоступен" });
    } finally {
      if (requestId === resolutionRequestIdRef.current) setResolving(false);
    }
  };

  const runLookup = async (extended = false, refresh = false, rawValue?: string) => {
    const sourceValue = rawValue ?? input;
    const value = tab === "plate" ? normalizePlateDraft(sourceValue) : normalizeVinInput(sourceValue);
    setInput(value);
    if (!value) return;

    if (tab === "plate" && !isLikelyRussianPlate(value)) {
      resetLookupState();
      setInput(value);
      setFeedback({
        tone: "warning",
        title: "Проверьте формат госномера.",
        body: "Например: Т332ЕК39. Лишние пробелы и дефисы можно не удалять вручную.",
      });
      return;
    }

    const endpoint = tab === "plate" ? "/api/vehicle-lookup/plate" : extended ? "/api/vehicle-lookup/vin/extended" : "/api/vehicle-lookup/vin";
    const body = tab === "plate" ? { plate: value, organizationId, refresh } : { vin: value, organizationId, refresh };
    const requestId = ++lookupRequestIdRef.current;
    resolutionRequestIdRef.current += 1;
    lookupControllerRef.current?.abort();
    resolutionControllerRef.current?.abort();
    technicalProfileControllerRef.current?.abort();
    const controller = new AbortController();
    lookupControllerRef.current = controller;
    onLookupStart();
    setLoading(true);
    setResolving(false);
    setLookup(null);
    setResolution(null);
    setSelectedKey(null);
    setFeedback(null);
    setAppliedVehicle(null);
    setAppliedFromCache(false);
    setTechnicalProfile(null);
    setTechnicalProfileVariantKeys([]);
    setSelectedTransmissionType(undefined);
    setTechnicalProfileLoading(false);
    setTechnicalProfileError("");

    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const data = await responseJson<LookupResponse>(response);
      if (requestId !== lookupRequestIdRef.current) return;
      if (!response.ok || !data) {
        const message = data?.error ?? "Повторите попытку позже или продолжите подбор вручную.";
        setFeedback({
          tone: "warning",
          title: tab === "plate" ? "Сервис определения автомобиля временно недоступен" : "Не удалось определить автомобиль",
          body: message,
          actionLabel: "Перейти к ручному подбору",
        });
        openManualMode({ reason: "lookup_unavailable", message });
        return;
      }

      setLookup(data);

      if (data.status === "not_found" || (!data.vehicle && data.status !== "unavailable")) {
        setFeedback({
          tone: "neutral",
          title: tab === "plate" ? "Не удалось точно определить автомобиль по госномеру" : "Автомобиль не найден",
          body: tab === "plate" ? "Можно ввести VIN или выбрать марку, модель, год и двигатель вручную." : "Выберите марку, модель, год и двигатель вручную.",
          actionLabel: tab === "plate" ? "Ввести VIN" : "Выбрать автомобиль вручную",
          action: tab === "plate" ? "vin" : "manual",
          secondaryActionLabel: tab === "plate" ? "Выбрать автомобиль вручную" : undefined,
        });
        return;
      }

      if (data.status === "unavailable") {
        setFeedback({
          tone: "warning",
          title: "Сервис определения автомобиля временно недоступен",
          body: data.message ?? "Повторите попытку позже или продолжите подбор вручную.",
          actionLabel: "Перейти к ручному подбору",
        });
        openManualMode({ reason: "lookup_unavailable", vehicle: data.vehicle, message: data.message ?? "Сервис определения автомобиля временно недоступен" });
        return;
      }

      if (data.candidates.length > 1) {
        setFeedback({
          tone: data.fromCache ? "success" : "neutral",
          title: data.fromCache ? "Автомобиль определён ранее" : "Найдено несколько вариантов",
          body: data.fromCache ? "Используем данные из карточки автомобиля. Выберите подходящий вариант или определите заново." : "Выберите подходящий автомобиль из списка.",
        });
        return;
      }

      if (data.vehicle) {
        setLoading(false);
        await handleResolution(data.vehicle, data.fromCache);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      if (requestId !== lookupRequestIdRef.current) return;
      setFeedback({
        tone: "warning",
        title: "Сервис определения автомобиля временно недоступен",
        body: "Можно продолжить вручную.",
        actionLabel: "Перейти к ручному подбору",
      });
      openManualMode({ reason: "lookup_unavailable", message: "Сервис определения автомобиля временно недоступен" });
    } finally {
      if (requestId === lookupRequestIdRef.current) setLoading(false);
    }
  };

  const chooseCandidate = (key: string) => {
    setSelectedKey(key);
    const candidate = lookup?.candidates.find((item) => item.key === key)?.vehicle;
    if (candidate) void handleResolution(candidate, lookup?.fromCache);
  };

  const confirmMannCandidate = (vehicle: NormalizedVehicleIdentity, candidate: MannVehicleCandidate) => {
    setAppliedVehicle(vehicle);
    setAppliedFromCache(Boolean(lookup?.fromCache));
    setFeedback(null);
    void loadTechnicalProfile(candidate.variantIds);
    onConfirmMannCandidate(vehicle, candidate);
  };

  const changeTab = (next: LookupTab) => {
    if (next === tab) {
      if (next !== "manual") inputRef.current?.focus();
      return;
    }
    lookupRequestIdRef.current += 1;
    resolutionRequestIdRef.current += 1;
    lookupControllerRef.current?.abort();
    resolutionControllerRef.current?.abort();
    technicalProfileControllerRef.current?.abort();
    setTab(next);
    setLookup(null);
    setResolution(null);
    setFeedback(null);
    setAppliedVehicle(null);
    setAppliedFromCache(false);
    setTechnicalProfile(null);
    setTechnicalProfileVariantKeys([]);
    setSelectedTransmissionType(undefined);
    setTechnicalProfileLoading(false);
    setTechnicalProfileError("");
    setInput("");
    lastAutomaticLookupRef.current = "";
    if (next === "manual") {
      onManualMode({ reason: "manual" });
      return;
    }
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const chooseAnotherVehicle = () => {
    lookupRequestIdRef.current += 1;
    resolutionRequestIdRef.current += 1;
    lookupControllerRef.current?.abort();
    resolutionControllerRef.current?.abort();
    technicalProfileControllerRef.current?.abort();
    resetLookupState();
    setInput("");
    lastAutomaticLookupRef.current = "";
    onLookupStart();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (appliedVehicle) {
    return (
      <section className="eco-vehicle-lookup is-compact" aria-label="Определить автомобиль и подобрать фильтры">
        <div className="eco-vehicle-lookup__selected">
          <div className="eco-vehicle-lookup__identity">
            <div className="eco-vehicle-lookup__identity-head">
              <span className="eco-vehicle-lookup__status is-ready">Автомобиль и MANN подобраны</span>
              {appliedFromCache ? <em>Из карточки</em> : null}
            </div>
            <strong>{vehicleTitle(appliedVehicle)}</strong>
            <span>{vehicleDetails(appliedVehicle) || "Автомобиль определён. Фильтры MANN готовы ниже."}</span>
          </div>
          <div className="eco-vehicle-lookup__actions">
            <button type="button" onClick={() => openManualMode({ reason: "manual", vehicle: appliedVehicle })}>
              Изменить
            </button>
            <details className="eco-vehicle-lookup__more">
              <summary aria-label="Другие действия с автомобилем" title="Другие действия">⋯</summary>
              <div>
                <button type="button" onClick={() => void runLookup(false, true)} disabled={loading}>
                  Повторить определение
                </button>
                <button type="button" onClick={chooseAnotherVehicle}>
                  Выбрать другой автомобиль
                </button>
              </div>
            </details>
          </div>
        </div>
        <TechnicalProfile
          profile={technicalProfile}
          loading={technicalProfileLoading}
          error={technicalProfileError}
          onSelectTransmission={(transmissionType) => {
            if (!technicalProfileVariantKeys.length || transmissionType === selectedTransmissionType) return;
            onConfirmTransmission?.(appliedVehicle, transmissionType, technicalProfileVariantKeys);
            void loadTechnicalProfile(technicalProfileVariantKeys, transmissionType);
          }}
        />
      </section>
    );
  }

  return (
    <section
      className={`eco-vehicle-lookup ${loading || resolving ? "is-decoding" : ""}`}
      aria-label="Определить автомобиль и подобрать фильтры"
      aria-busy={loading || resolving}
    >
      <div className="eco-vehicle-lookup__query">
        <div className="eco-vehicle-lookup__tabs" role="tablist" aria-label="Способ определения автомобиля">
          <button type="button" role="tab" aria-selected={tab === "vin"} className={tab === "vin" ? "is-active" : ""} onClick={() => changeTab("vin")}>VIN</button>
          <button type="button" role="tab" aria-selected={tab === "plate"} className={tab === "plate" ? "is-active" : ""} onClick={() => changeTab("plate")}>Госномер</button>
          <button type="button" role="tab" aria-selected={tab === "manual"} className={tab === "manual" ? "is-active" : ""} onClick={() => changeTab("manual")}>Вручную</button>
        </div>
        {tab !== "manual" ? (
          <div className="eco-vehicle-lookup__controls">
            <label className="eco-vehicle-lookup__field">
              <span className="eco-sr-only">{tab === "vin" ? "VIN или номер кузова" : "Госномер"}</span>
              <input
                ref={inputRef}
                className="eco-input"
                value={input}
                onChange={(event) => {
                  const nextValue = tab === "plate" ? normalizePlateDraft(event.target.value) : event.target.value.toUpperCase();
                  const normalizedValue = tab === "plate" ? normalizePlateDraft(nextValue) : normalizeVinInput(nextValue);
                  const isComplete = tab === "plate"
                    ? isLikelyRussianPlate(normalizedValue)
                    : /^[A-HJ-NPR-Z0-9]{17}$/.test(normalizedValue);
                  setInput(nextValue);
                  if (!isComplete) {
                    lastAutomaticLookupRef.current = "";
                    return;
                  }
                  const lookupKey = `${tab}:${normalizedValue}`;
                  if (lastAutomaticLookupRef.current === lookupKey) return;
                  lastAutomaticLookupRef.current = lookupKey;
                  void runLookup(false, false, nextValue);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !loading) {
                    event.preventDefault();
                    void runLookup();
                  }
                }}
                placeholder={tab === "vin" ? "Введите VIN — поиск начнётся автоматически" : "Введите госномер, например Т332ЕК39"}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <button type="button" className="eco-btn eco-btn--primary" disabled={loading || resolving || !input.trim()} onClick={() => void runLookup()}>
              {loading || resolving ? <span className="eco-vehicle-lookup__spinner" aria-hidden /> : null}
              {loading ? "Определяем" : resolving ? "Подбираем" : tab === "vin" ? "Найти по VIN" : "Найти по номеру"}
            </button>
          </div>
        ) : null}
      </div>
      {loading || resolving ? (
        <div className="eco-vehicle-lookup__loading" role="status" aria-live="polite">
          <span className="eco-vehicle-lookup__loading-mark" aria-hidden>
            <i />
          </span>
          <div className="eco-vehicle-lookup__loading-copy">
            <strong>{loading ? "Определяем автомобиль" : "Автомобиль найден — подбираем фильтры"}</strong>
            <span>
              {loading
                ? tab === "plate"
                  ? "Ищем VIN и характеристики по госномеру"
                  : "Проверяем VIN и получаем характеристики"
                : "Сопоставляем модификацию с каталогом MANN"}
            </span>
          </div>
          <span className="eco-vehicle-lookup__loading-track" aria-hidden><i /></span>
        </div>
      ) : null}
      {feedback && !(selectedVehicle && resolution?.status === "candidates") ? (
        <div className={`eco-vehicle-lookup__feedback is-${feedback.tone}`} aria-live="polite">
          <div>
            <strong>{feedback.title}</strong>
            {feedback.body ? <span>{feedback.body}</span> : null}
          </div>
          {feedback.actionLabel ? (
            <div className="eco-vehicle-lookup__actions">
              <button type="button" onClick={() => {
                if (feedback.action === "vin") {
                  changeTab("vin");
                  setInput("");
                  return;
                }
                openManualMode({ reason: tab === "plate" ? "plate_not_found" : "manual", vehicle: selectedVehicle, message: feedback.title });
              }}>
                {feedback.actionLabel}
              </button>
              {feedback.secondaryActionLabel ? (
                <button type="button" onClick={() => openManualMode({ reason: "plate_not_found", vehicle: selectedVehicle, message: feedback.title })}>
                  {feedback.secondaryActionLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {lookup?.message && !feedback ? <p className="eco-vehicle-lookup__message">{lookup.message}</p> : null}
      {lookup && lookup.candidates.length > 1 ? (
        <div className="eco-vehicle-lookup__candidates">
          <strong>Найдено несколько вариантов</strong>
          <div>
            {lookup.candidates.map((candidate) => (
              <button type="button" key={candidate.key} className={candidate.key === selectedKey ? "is-selected" : ""} onClick={() => chooseCandidate(candidate.key)}>
                <b>{vehicleTitle(candidate.vehicle)}</b>
                <span>{candidate.differences.join(" · ") || "Уточните модификацию"}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {selectedVehicle ? (
        <article className="eco-vehicle-lookup__result">
          <div className="eco-vehicle-lookup__identity">
            <div className="eco-vehicle-lookup__identity-head">
              <span className="eco-vehicle-lookup__status">Автомобиль найден</span>
              {lookup?.fromCache ? <em>Из карточки</em> : null}
            </div>
            <strong>{vehicleTitle(selectedVehicle)}</strong>
            <span>
              {[
                vehicleDetails(selectedVehicle) || "Технические параметры не указаны",
                selectedVehicle.transmissionName ?? selectedVehicle.transmissionType,
                selectedVehicle.driveType,
              ].filter(Boolean).join(" · ")}
            </span>
            <details className="eco-vehicle-lookup__technical">
              <summary>Данные распознавания</summary>
              <div className="eco-vehicle-lookup__technical-body">
                <small>{selectedVehicle.vin ? `VIN: ${selectedVehicle.vin}` : selectedVehicle.frameNumber ? `Кузов: ${selectedVehicle.frameNumber}` : "VIN не получен"}</small>
                <small>Источник: {sourceLabel(selectedVehicle)} · уверенность {confidenceLabel(selectedVehicle.confidence)}</small>
                {selectedVehicle.vinStatus === "check_digit_absent" ? <small>Контрольная цифра VIN отсутствует или не применяется.</small> : null}
                <div className="eco-vehicle-lookup__technical-actions">
                  {lookup?.fromCache ? <button type="button" onClick={() => void runLookup(false, true)} disabled={loading || resolving}>Определить заново</button> : null}
                  {tab === "vin" ? <button type="button" onClick={() => void runLookup(true)} disabled={loading || resolving}>Получить расширенные данные</button> : null}
                </div>
              </div>
            </details>
          </div>
          <div className="eco-vehicle-lookup__actions">
            <button type="button" onClick={() => openManualMode({ reason: "manual", vehicle: selectedVehicle })}>Изменить</button>
          </div>
          {(resolving || (resolution && resolution.status !== "candidates")) ? (
            <div className={`eco-vehicle-lookup__mann is-${resolution?.status ?? "loading"}`}>
              {mannStatusCopy(resolution, resolving)}
              {resolution?.selectedApplication?.warnings.length ? <span>{resolution.selectedApplication.warnings.join(" ")}</span> : null}
            </div>
          ) : null}
          {resolution?.status === "candidates" ? (
            <div className="eco-vehicle-lookup__mann-candidates">
              <div className="eco-vehicle-lookup__mann-candidates-head">
                <strong>Выберите модификацию MANN</strong>
                <span>Это нужно для точного подбора фильтров.</span>
              </div>
              {resolution.candidates.map((candidate) => (
                <div key={candidate.applicationId}>
                  <div>
                    <b>{candidateLabel(candidate)}</b>
                    {candidate.warnings.length ? <span>{candidate.warnings.join(" ")}</span> : null}
                  </div>
                  <button
                    type="button"
                    aria-label={`Выбрать MANN-модификацию: ${candidateLabel(candidate)}`}
                    onClick={() => confirmMannCandidate(selectedVehicle, candidate)}
                  >
                    Выбрать
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => openManualMode({ reason: "partial", vehicle: selectedVehicle })}>Не нашли нужную? Подобрать вручную</button>
            </div>
          ) : null}
          {process.env.NODE_ENV !== "production" && resolution?.trace ? (
            <details className="eco-vehicle-lookup__trace">
              <summary>Диагностика сопоставления MANN</summary>
              <pre>{JSON.stringify(resolution.trace, null, 2)}</pre>
            </details>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
