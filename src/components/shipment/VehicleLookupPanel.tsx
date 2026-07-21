"use client";

import { useState } from "react";
import type { MannVehicleResolution } from "@/lib/mann-vehicle-resolver";
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
  onManualMode: (context?: VehicleLookupManualContext) => void;
};

type LookupResponse = VehicleLookupResult & { error?: string };
type LookupFeedback = { tone: LookupFeedbackTone; title: string; body?: string; actionLabel?: string };

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
  return [vehicle.makeRaw ?? vehicle.makeCanonical, vehicle.modelRaw ?? vehicle.modelCanonical, vehicle.generationRaw].filter(Boolean).join(" ") || "Автомобиль";
}

function vehicleDetails(vehicle: NormalizedVehicleIdentity): string {
  return [
    vehicle.licensePlate,
    vehicle.year,
    vehicle.engineVolumeLiters ? `${vehicle.engineVolumeLiters} л` : undefined,
    vehicle.engineCode,
    vehicle.powerHp ? `${vehicle.powerHp} л.с.` : undefined,
  ].filter(Boolean).join(" · ");
}

function sourceLabel(vehicle: NormalizedVehicleIdentity): string {
  if (vehicle.sourceMethods.includes("tronk_frame")) return "TRONK · номер кузова";
  if (vehicle.sourceMethods.includes("tronk_plate")) return "TRONK · госномер";
  if (vehicle.sourceMethods.includes("tronk_convertb2b") || vehicle.sourceMethods.includes("tronk_convertgate")) return "TRONK · госномер без VIN";
  return "TRONK · VIN";
}

function confidenceLabel(value?: "high" | "medium" | "low"): string {
  if (value === "high") return "высокая";
  if (value === "medium") return "средняя";
  return "низкая";
}

function mannStatusCopy(resolution: MannVehicleResolution | null, resolving: boolean): string {
  if (resolving) return "Автомобиль найден, подбираем фильтры MANN...";
  if (resolution?.status === "matched") {
    return `MANN: ${resolution.selected?.effectiveVehicleText ?? resolution.selected?.vehicleText ?? "модификация найдена"}. Фильтры готовы к проверке.`;
  }
  if (resolution?.status === "needs_confirmation") return "Автомобиль найден, но модификацию нужно выбрать вручную.";
  return "Автомобиль определён, но точного соответствия MANN нет. Продолжите ручной подбор.";
}

export function VehicleLookupPanel({ organizationId, warehouseId, initialVin, onUseVehicle, onManualMode }: Props) {
  const [tab, setTab] = useState<LookupTab>("vin");
  const [input, setInput] = useState(initialVin ?? "");
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [resolution, setResolution] = useState<MannVehicleResolution | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<LookupFeedback | null>(null);
  const [appliedVehicle, setAppliedVehicle] = useState<NormalizedVehicleIdentity | null>(null);
  const [appliedResolution, setAppliedResolution] = useState<MannVehicleResolution | null>(null);
  const [appliedFromCache, setAppliedFromCache] = useState(false);

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
    setAppliedResolution(null);
    setAppliedFromCache(false);
  };

  const handleResolution = async (vehicle: NormalizedVehicleIdentity, fromCache?: boolean) => {
    setResolving(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/mann-catalog/resolve-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, warehouseId, vehicle }),
      });
      const data = await responseJson<MannVehicleResolution & { error?: string }>(response);
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

      if (data.status === "matched") {
        setAppliedVehicle(vehicle);
        setAppliedResolution(data);
        setAppliedFromCache(Boolean(fromCache));
        onUseVehicle(vehicle, data);
        setFeedback(null);
        return;
      }

      onUseVehicle(vehicle, data);
      setFeedback({
        tone: "neutral",
        title: data.status === "needs_confirmation" ? "Автомобиль найден" : "Автомобиль найден частично",
        body: `${vehicleTitle(vehicle)}${vehicle.licensePlate ? ` · ${vehicle.licensePlate}` : ""}. Уточните двигатель и модификацию вручную.`,
        actionLabel: "Перейти к ручному подбору",
      });
      openManualMode({ reason: "partial", vehicle, message: "Уточните двигатель и модификацию" });
    } catch {
      setFeedback({
        tone: "warning",
        title: "Сервис MANN временно недоступен",
        body: "Можно продолжить ручной подбор по каталогу.",
        actionLabel: "Перейти к ручному подбору",
      });
      openManualMode({ reason: "lookup_unavailable", vehicle, message: "Сервис MANN временно недоступен" });
    } finally {
      setResolving(false);
    }
  };

  const runLookup = async (extended = false, refresh = false) => {
    const value = tab === "plate" ? normalizePlateDraft(input) : normalizeVinInput(input);
    if (tab === "plate") setInput(value);
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
    setLoading(true);
    setResolving(false);
    setLookup(null);
    setResolution(null);
    setSelectedKey(null);
    setFeedback(null);
    setAppliedVehicle(null);
    setAppliedResolution(null);
    setAppliedFromCache(false);

    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await responseJson<LookupResponse>(response);
      if (!response.ok || !data) {
        setFeedback({
          tone: "warning",
          title: tab === "plate" ? "Сервис определения автомобиля временно недоступен" : "Не удалось определить автомобиль",
          body: tab === "plate" ? "Можно продолжить вручную." : data?.error ?? "Попробуйте ещё раз или продолжите вручную.",
          actionLabel: "Перейти к ручному подбору",
        });
        openManualMode({ reason: "lookup_unavailable", message: data?.error });
        return;
      }

      setLookup(data);

      if (data.status === "not_found" || !data.vehicle) {
        setFeedback({
          tone: "neutral",
          title: tab === "plate" ? "По госномеру автомобиль не найден" : "Автомобиль не найден",
          body: "Выберите автомобиль вручную — мы продолжим подбор по каталогу MANN.",
          actionLabel: "Перейти к ручному подбору",
        });
        openManualMode({ reason: tab === "plate" ? "plate_not_found" : "manual", message: "Продолжите подбор вручную" });
        return;
      }

      if (data.status === "unavailable") {
        setFeedback({
          tone: "warning",
          title: "Сервис определения автомобиля временно недоступен",
          body: "Можно продолжить вручную.",
          actionLabel: "Перейти к ручному подбору",
        });
        openManualMode({ reason: "lookup_unavailable", vehicle: data.vehicle, message: data.message });
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

      await handleResolution(data.vehicle, data.fromCache);
    } catch {
      setFeedback({
        tone: "warning",
        title: "Сервис определения автомобиля временно недоступен",
        body: "Можно продолжить вручную.",
        actionLabel: "Перейти к ручному подбору",
      });
      openManualMode({ reason: "lookup_unavailable", message: "Сервис определения автомобиля временно недоступен" });
    } finally {
      setLoading(false);
    }
  };

  const chooseCandidate = (key: string) => {
    setSelectedKey(key);
    const candidate = lookup?.candidates.find((item) => item.key === key)?.vehicle;
    if (candidate) void handleResolution(candidate, lookup?.fromCache);
  };

  const changeTab = (next: LookupTab) => {
    setTab(next);
    setLookup(null);
    setResolution(null);
    setFeedback(null);
    setAppliedVehicle(null);
    setAppliedResolution(null);
    setAppliedFromCache(false);
    if (next === "manual") onManualMode({ reason: "manual" });
  };

  if (appliedVehicle) {
    return (
      <section className="eco-vehicle-lookup is-compact" aria-label="Определить автомобиль и подобрать фильтры">
        <div className="eco-vehicle-lookup__selected">
          <div>
            <strong>{vehicleTitle(appliedVehicle)}</strong>
            <span>{vehicleDetails(appliedVehicle) || "Автомобиль определён. Фильтры MANN готовы ниже."}</span>
          </div>
          {appliedFromCache ? <em>Автомобиль определён ранее</em> : null}
          <div className="eco-vehicle-lookup__actions">
            {appliedFromCache ? (
              <button type="button" className="eco-btn eco-btn--primary" onClick={() => onUseVehicle(appliedVehicle, appliedResolution)}>
                Использовать
              </button>
            ) : null}
            <button type="button" onClick={() => openManualMode({ reason: "manual", vehicle: appliedVehicle })}>
              Изменить вручную
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
    <section className="eco-vehicle-lookup" aria-label="Определить автомобиль и подобрать фильтры">
      <div className="eco-vehicle-lookup__head">
        <div>
          <strong>Выберите автомобиль</strong>
          <span>VIN, госномер или ручной подбор по MANN.</span>
        </div>
        {lookup?.fromCache && selectedVehicle ? <em>Автомобиль определён ранее</em> : null}
      </div>
      <div className="eco-vehicle-lookup__tabs" role="tablist" aria-label="Способ определения автомобиля">
        <button type="button" role="tab" aria-selected={tab === "vin"} className={tab === "vin" ? "is-active" : ""} onClick={() => changeTab("vin")}>По VIN</button>
        <button type="button" role="tab" aria-selected={tab === "plate"} className={tab === "plate" ? "is-active" : ""} onClick={() => changeTab("plate")}>По госномеру</button>
        <button type="button" role="tab" aria-selected={tab === "manual"} className={tab === "manual" ? "is-active" : ""} onClick={() => changeTab("manual")}>Вручную по MANN</button>
      </div>
      {tab !== "manual" ? (
        <div className="eco-vehicle-lookup__controls">
          <label className="eco-field">
            <span>{tab === "vin" ? "VIN или номер кузова" : "Госномер"}</span>
            <input
              className="eco-input"
              value={input}
              onChange={(event) => setInput(tab === "plate" ? normalizePlateDraft(event.target.value) : event.target.value.toUpperCase())}
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
            {loading ? "Ищем автомобиль..." : tab === "vin" ? "Расшифровать и подобрать фильтры" : "Найти автомобиль"}
          </button>
        </div>
      ) : (
        <p className="eco-vehicle-lookup__manual">Ручной подбор открыт ниже. Выберите марку, модель и модификацию.</p>
      )}
      {feedback ? (
        <div className={`eco-vehicle-lookup__feedback is-${feedback.tone}`} aria-live="polite">
          <div>
            <strong>{feedback.title}</strong>
            {feedback.body ? <span>{feedback.body}</span> : null}
          </div>
          {feedback.actionLabel ? (
            <button type="button" onClick={() => openManualMode({ reason: tab === "plate" ? "plate_not_found" : "manual", vehicle: selectedVehicle, message: feedback.title })}>
              {feedback.actionLabel}
            </button>
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
          <div>
            <strong>{vehicleTitle(selectedVehicle)}</strong>
            <span>{vehicleDetails(selectedVehicle) || "Технические параметры не указаны"}</span>
            {[selectedVehicle.transmissionType ?? selectedVehicle.transmissionName, selectedVehicle.driveType].filter(Boolean).length > 0 ? (
              <span>{[selectedVehicle.transmissionType ?? selectedVehicle.transmissionName, selectedVehicle.driveType].filter(Boolean).join(" · ")}</span>
            ) : null}
            <small>{selectedVehicle.vin ? `VIN: ${selectedVehicle.vin}` : selectedVehicle.frameNumber ? `Кузов: ${selectedVehicle.frameNumber}` : "VIN не получен"} · Источник: {sourceLabel(selectedVehicle)} · Уверенность: {confidenceLabel(selectedVehicle.confidence)}</small>
            {selectedVehicle.vinStatus === "check_digit_absent" ? <small>Контрольная цифра VIN отсутствует или не применяется.</small> : null}
          </div>
          <div className="eco-vehicle-lookup__actions">
            {lookup?.fromCache ? <span className="eco-vehicle-lookup__cache-note">Используем данные из карточки автомобиля</span> : null}
            <button type="button" className="eco-btn eco-btn--primary" disabled={resolving} onClick={() => onUseVehicle(selectedVehicle, resolution)}>
              Использовать
            </button>
            {lookup?.fromCache ? <button type="button" onClick={() => void runLookup(false, true)} disabled={loading || resolving}>Определить заново</button> : null}
            {tab === "vin" ? <button type="button" onClick={() => void runLookup(true)} disabled={loading || resolving}>Получить расширенные данные</button> : null}
            <button type="button" onClick={() => openManualMode({ reason: "manual", vehicle: selectedVehicle })}>Изменить вручную</button>
          </div>
          {(resolving || resolution) ? (
            <div className={`eco-vehicle-lookup__mann is-${resolution?.status ?? "loading"}`}>
              {mannStatusCopy(resolution, resolving)}
              {resolution?.selected?.warnings.length ? <span>{resolution.selected.warnings.join(" ")}</span> : null}
            </div>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
