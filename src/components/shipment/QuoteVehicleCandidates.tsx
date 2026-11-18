"use client";

import { useId } from "react";
import type { MannVehicleCandidate } from "@/lib/mann-vehicle-resolver";
import styles from "./QuoteVehicleCandidates.module.css";

type Props = {
  candidates: MannVehicleCandidate[];
  selectedId?: string;
  headingId: string;
  onChoose: (candidate: MannVehicleCandidate) => void;
  onManual?: () => void;
};

const fields = [
  { label: "Модификация", keys: ["базовая модель", "поколение", "код кузова"] },
  { label: "Двигатель", keys: ["код двигателя", "семейство двигателя", "объём двигателя"] },
  { label: "Мощность", keys: ["мощность"] },
  { label: "Выпуск", keys: ["год"] },
];

export function quoteCandidateName(candidate: MannVehicleCandidate) {
  return candidate.effectiveVehicleText || candidate.vehicleText || "Модификация не указана";
}

export function quoteCandidateEngine(candidate: MannVehicleCandidate) {
  return candidate.engineCode || candidate.technicalIdentity?.engineOptions?.join(" / ") || candidate.technicalIdentity?.engineCode || "Не указан";
}

export function QuoteVehicleCandidates({ candidates, selectedId, headingId, onChoose, onManual }: Props) {
  const hintId = useId();
  return <section className={styles.step} aria-labelledby={headingId}>
    <header className={styles.heading}>
      <h3 id={headingId}>Уточните модификацию автомобиля</h3>
      <p id={hintId}>Сверьте двигатель, мощность и период выпуска перед подбором фильтров.</p>
    </header>
    <table className={styles.table} role="table" aria-labelledby={headingId} aria-describedby={hintId}>
      <colgroup><col /><col /><col /><col /><col className={styles.actionColumn} /></colgroup>
      <thead role="rowgroup"><tr role="row">
        {fields.map(field => <th key={field.label} role="columnheader" scope="col">{field.label}</th>)}
        <th role="columnheader" scope="col">Выбрать</th>
      </tr></thead>
      <tbody role="rowgroup">
        {candidates.map(candidate => {
          const selected = candidate.applicationId === selectedId;
          const name = quoteCandidateName(candidate);
          const engine = quoteCandidateEngine(candidate);
          const power = candidate.hp ? `${candidate.hp} л.с.` : candidate.kw ? `${candidate.kw} кВт` : "Не указана";
          const years = candidate.vehicleYears || "Не указан";
          const values = [name, engine, power, years];
          const otherMismatch = candidate.mismatchedFields.filter(key => !fields.some(field => field.keys.includes(key)));
          const warnings = candidate.warnings.filter(warning => !warning.includes("не повышает score"));
          return <tr key={candidate.applicationId} role="row" data-selected={selected}>
            {fields.map(({ label, keys }, index) => {
              const mismatches = candidate.mismatchedFields.filter(key => keys.includes(key));
              const Cell = index === 0 ? "th" : "td";
              return <Cell key={label} scope={index === 0 ? "row" : undefined} role={index === 0 ? "rowheader" : "cell"}>
                {index > 0 && <span className={styles.mobileLabel} aria-hidden="true">{label}</span>}
                <span className={styles.value}>{values[index]}</span>
                {mismatches.length > 0 && <small className={styles.mismatch}>Проверьте: {mismatches.join(", ")}</small>}
                {index === 0 && (otherMismatch.length > 0 || warnings.length > 0 || candidate.condition) &&
                  <details className={styles.conditions}>
                    <summary>Условия и расхождения</summary>
                    {otherMismatch.map(key => {
                      const evidence = candidate.featureContributions.find(item => item.feature === key)?.evidence;
                      return <p key={key}>Проверьте: {key}{evidence && ` · ${evidence}`}</p>;
                    })}
                    {warnings.map(warning => <p key={warning}>{warning}</p>)}
                    {candidate.condition && <p>{candidate.condition}</p>}
                  </details>}
              </Cell>;
            })}
            <td role="cell" className={styles.action}>
              <button type="button" className={`eco-btn ${selected ? "" : "eco-btn--primary"}`}
                aria-disabled={selected || undefined}
                aria-label={`${selected ? "Выбран" : "Выбрать"}: ${name}, ${engine}, ${power}, ${years}`}
                onClick={() => { if (!selected) onChoose(candidate); }}>
                {selected ? "Выбран" : "Выбрать"}
              </button>
            </td>
          </tr>;
        })}
      </tbody>
    </table>
    {onManual && <button type="button" className={`eco-btn ${styles.manual}`} onClick={onManual}>Нет нужной? Подобрать вручную</button>}
  </section>;
}
