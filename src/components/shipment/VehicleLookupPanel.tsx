"use client";

import { useState } from "react";
import type { MannVehicleResolution } from "@/lib/mann-vehicle-resolver";
import type { NormalizedVehicleIdentity, VehicleLookupResult } from "@/lib/vehicle-identity-client";

type LookupTab = "vin" | "plate" | "manual";

type Props = {
  organizationId?: string | null;
  warehouseId?: string | null;
  initialVin?: string;
  onUseVehicle: (vehicle: NormalizedVehicleIdentity, resolution: MannVehicleResolution | null) => void;
  onManualMode: () => void;
};

type LookupResponse = VehicleLookupResult & { error?: string };

async function responseJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function vehicleTitle(vehicle: NormalizedVehicleIdentity): string {
  return [vehicle.makeRaw ?? vehicle.makeCanonical, vehicle.modelRaw ?? vehicle.modelCanonical, vehicle.generationRaw].filter(Boolean).join(" ") || "Автомобиль";
}

function vehicleDetails(vehicle: NormalizedVehicleIdentity): string {
  return [
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

export function VehicleLookupPanel({ organizationId, warehouseId, initialVin, onUseVehicle, onManualMode }: Props) {
  const [tab, setTab] = useState<LookupTab>("vin");
  const [input, setInput] = useState(initialVin ?? "");
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [resolution, setResolution] = useState<MannVehicleResolution | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedVehicle = lookup && lookup.candidates.length > 1
    ? lookup.candidates.find((candidate) => candidate.key === selectedKey)?.vehicle ?? null
    : lookup?.vehicle ?? null;

  const runLookup = async (extended = false) => {
    const value = input.trim();
    if (!value) return;
    const endpoint = tab === "plate" ? "/api/vehicle-lookup/plate" : extended ? "/api/vehicle-lookup/vin/extended" : "/api/vehicle-lookup/vin";
    const body = tab === "plate" ? { plate: value, organizationId } : { vin: value, organizationId };
    setLoading(true);
    setResolving(false);
    setLookup(null);
    setResolution(null);
    setSelectedKey(null);
    setError(null);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await responseJson<LookupResponse>(response);
      if (!response.ok || !data) {
        setError(data?.error ?? "Не удалось определить автомобиль");
        return;
      }
      setLookup(data);
      if (!data.vehicle || data.candidates.length > 1) return;
      await resolveVehicle(data.vehicle);
    } catch {
      setError("Нет связи с сервисом определения автомобиля");
    } finally {
      setLoading(false);
    }
  };

  const resolveVehicle = async (vehicle: NormalizedVehicleIdentity) => {
    setResolving(true);
    try {
      const response = await fetch("/api/mann-catalog/resolve-vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, warehouseId, vehicle }),
      });
      const data = await responseJson<MannVehicleResolution & { error?: string }>(response);
      if (!response.ok || !data) {
        setError(data?.error ?? "Автомобиль найден, но MANN-подбор временно недоступен");
        return;
      }
      setResolution(data);
    } catch {
      setError("Автомобиль найден, но MANN-подбор временно недоступен");
    } finally {
      setResolving(false);
    }
  };

  const chooseCandidate = (key: string) => {
    setSelectedKey(key);
    const candidate = lookup?.candidates.find((item) => item.key === key)?.vehicle;
    if (candidate) void resolveVehicle(candidate);
  };

  const changeTab = (next: LookupTab) => {
    setTab(next);
    setLookup(null);
    setResolution(null);
    setError(null);
    if (next === "manual") onManualMode();
  };

  return (
    <section className="eco-vehicle-lookup" aria-label="Определить автомобиль и подобрать фильтры">
      <div className="eco-vehicle-lookup__head">
        <div>
          <strong>Определить автомобиль и подобрать фильтры</strong>
          <span>VIN, госномер или ручный подбор по MANN.</span>
        </div>
        {lookup?.fromCache ? <em>Данные получены ранее</em> : null}
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
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void runLookup(); }}
              placeholder={tab === "vin" ? "Введите 17-значный VIN" : "Например, Т332ЕК39"}
              autoCapitalize="characters"
            />
          </label>
          <button type="button" className="eco-btn eco-btn--primary" disabled={loading || !input.trim()} onClick={() => void runLookup()}>
            {loading ? "Определяем…" : tab === "vin" ? "Расшифровать и подобрать фильтры" : "Найти автомобиль"}
          </button>
        </div>
      ) : (
        <p className="eco-vehicle-lookup__manual">Выберите марку, модель и модификацию ниже — ручный режим всегда остаётся доступен.</p>
      )}
      {lookup?.message ? <p className="eco-vehicle-lookup__message">{lookup.message}</p> : null}
      {error ? <p className="eco-vin-alert">{error}</p> : null}
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
            <button type="button" className="eco-btn eco-btn--primary" onClick={() => onUseVehicle(selectedVehicle, resolution)}>Использовать в отгрузке</button>
            {tab === "vin" ? <button type="button" onClick={() => void runLookup(true)} disabled={loading}>Получить расширенные данные</button> : null}
            <button type="button" onClick={onManualMode}>Изменить вручную</button>
          </div>
          <div className={`eco-vehicle-lookup__mann is-${resolution?.status ?? "loading"}`}>
            {resolving ? "Автомобиль найден, подбираем фильтры MANN…" : resolution?.status === "matched" ? `MANN: ${resolution.selected?.effectiveVehicleText ?? resolution.selected?.vehicleText ?? "модификация найдена"}. Фильтры готовы к проверке.` : resolution?.status === "needs_confirmation" ? "Модификацию MANN нужно подтвердить: ниже доступны наиболее вероятные варианты." : "Автомобиль определён, но точного соответствия MANN нет — продолжите ручной подбор."}
            {resolution?.selected?.warnings.length ? <span>{resolution.selected.warnings.join(" ")}</span> : null}
          </div>
        </article>
      ) : null}
    </section>
  );
}
