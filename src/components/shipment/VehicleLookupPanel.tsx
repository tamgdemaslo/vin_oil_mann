"use client";

import { useRef, useState } from "react";
import type { MannVehicleCandidate, MannVehicleResolution } from "@/lib/mann-vehicle-resolver";
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

export function VehicleLookupPanel({ organizationId, warehouseId, initialVin, onUseVehicle, onConfirmMannCandidate, onLookupStart, onManualMode }: Props) {
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
  const lookupRequestIdRef = useRef(0);
  const resolutionRequestIdRef = useRef(0);
  const lookupControllerRef = useRef<AbortController | null>(null);
  const resolutionControllerRef = useRef<AbortController | null>(null);
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
    setLookup(null);
    setResolution(null);
    setSelectedKey(null);
    setFeedback(null);
    setAppliedVehicle(null);
    setAppliedFromCache(false);
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

      if (data.vehicle) await handleResolution(data.vehicle, data.fromCache);
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
    setTab(next);
    setLookup(null);
    setResolution(null);
    setFeedback(null);
    setAppliedVehicle(null);
    setAppliedFromCache(false);
    setInput("");
    lastAutomaticLookupRef.current = "";
    if (next === "manual") {
      onManualMode({ reason: "manual" });
      return;
    }
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
            <button type="button" onClick={() => void runLookup(false, true)} disabled={loading}>
              Определить заново
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`eco-vehicle-lookup ${loading || resolving ? "is-decoding" : ""}`}
      aria-label="Определить автомобиль и подобрать фильтры"
      aria-busy={loading || resolving}
    >
      <span className="eco-vehicle-lookup__decode-glow" aria-hidden />
      <div className="eco-vehicle-lookup__tabs" role="tablist" aria-label="Способ определения автомобиля">
        <button type="button" role="tab" aria-selected={tab === "vin"} className={tab === "vin" ? "is-active" : ""} onClick={() => changeTab("vin")}>VIN</button>
        <button type="button" role="tab" aria-selected={tab === "plate"} className={tab === "plate" ? "is-active" : ""} onClick={() => changeTab("plate")}>Госномер</button>
        <button type="button" role="tab" aria-selected={tab === "manual"} className={tab === "manual" ? "is-active" : ""} onClick={() => changeTab("manual")}>Вручную</button>
      </div>
      {tab !== "manual" ? (
        <div className="eco-vehicle-lookup__controls">
          <label className="eco-field">
            <span>{tab === "vin" ? "VIN или номер кузова" : "Госномер"}</span>
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
              placeholder={tab === "vin" ? "Введите 17-значный VIN" : "Например, Т332ЕК39"}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <button type="button" className="eco-btn eco-btn--primary" disabled={loading || !input.trim()} onClick={() => void runLookup()}>
            {loading ? <span className="eco-vehicle-lookup__spinner" aria-hidden /> : null}
            {loading ? "Ищем..." : tab === "vin" ? "Найти по VIN" : "Найти по номеру"}
          </button>
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
