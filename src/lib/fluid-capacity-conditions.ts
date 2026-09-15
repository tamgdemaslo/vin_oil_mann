import { parseFluidCapacities, type ParsedFluidCapacity } from "./fluid-capacity-parser";
import { normalizeEngineCode } from "./vehicle-normalization";

export type FluidCapacityCondition =
  | { kind: "rearAirConditioning"; value: "present" | "absent" }
  | { kind: "transmission"; value: "automatic" | "manual" | "cvt" }
  | { kind: "drive"; value: "2WD" | "4WD" | "AWD" | "FWD" | "RWD" }
  | { kind: "engine"; value: string }
  | { kind: "engineTransmission"; value: string; engineCode: string; transmissionType: "manual" | "automatic" | "robot" | "cvt" };
export type ConditionalFluidCapacity = {
  condition: FluidCapacityCondition;
  capacity: ParsedFluidCapacity;
  sourceSegment: string;
  start: number;
  end: number;
};

// An additive, strict parser. It never clears the original parser's warnings
// or authorizes publication; unknown/shared conditions remain for review.
export function parseConditionalFluidCapacities(value: unknown, systemCode?: string | null, explicitEngineCodes: string[] = []) {
  const sourceText = String(value ?? "");
  const normalizedText = sourceText.replace(/\u00a0/g, " ").trim();
  const original = parseFluidCapacities(sourceText, systemCode);
  const review = (reason: string) => ({ status: "review" as const, reason, sourceText, normalizedText, branches: [] as ConditionalFluidCapacity[], publicationAllowed: false as const });
  if (original.capacities.length < 2) return review("NO_EXPLICIT_CAPACITY_ALTERNATIVES");
  if (original.rejected.length || original.suspicious.some(d => d.code !== "UNRESOLVED_CONDITIONAL_CAPACITY")) return review("OTHER_PARSER_DIAGNOSTICS");
  const capacities = [...original.capacities].sort((a, b) => a.start - b.start);
  if (normalizedText.slice(0, capacities[0].start).trim()) return review("SHARED_PREFIX_CONDITION");
  const allowedEngines = new Set(explicitEngineCodes.map(normalizeEngineCode).filter(Boolean));
  const branches: ConditionalFluidCapacity[] = [];
  for (let index = 0; index < capacities.length; index += 1) {
    const token = capacities[index];
    const end = capacities[index + 1]?.start ?? normalizedText.length;
    const sourceSegment = normalizedText.slice(token.start, end);
    const suffix = normalizedText.slice(token.end, end).trim().replace(/(?:\s+или|[;,])\s*$/iu, "").trim();
    const qualifier = suffix.replace(/^-\s*/u, "").replace(/^(?:сервисный|общий)\s+объ[её]м\s+/iu, "");
    let condition: FluidCapacityCondition;
    const transmission = qualifier.match(/^(?:(?:для\s+моделей\s+)?[сc]|для)\s+(АКПП|МКПП|CVT)$/iu);
    const drive = qualifier.match(/^для\s+(2WD|4WD|AWD|FWD|RWD)$/iu);
    const engine = qualifier.match(/^для\s+([A-Z0-9][A-Z0-9-]{2,20})$/iu);
    const labeledEngine = qualifier.match(/^для ([0-9]\.[0-9] [DT][2-6]) \(([BD][0-9]{3,4}[TS][0-9]*)\)$/u);
    const compound = qualifier.match(/^для\s+([A-Z0-9][A-Z0-9-]{2,20})\s+с\s+(МКПП|АКПП|РКПП|CVT)$/iu);
    const rearAir = qualifier.match(/^для моделей (без заднего кондиционера|с задним кондиционером)$/u);
    if (rearAir) condition = {kind:"rearAirConditioning",value:rearAir[1].startsWith("без")?"absent":"present"};
    else if (compound && /\d/.test(compound[1]) && allowedEngines.has(normalizeEngineCode(compound[1]))) {
      const engineCode = normalizeEngineCode(compound[1])!;
      if (/^(?:2WD|4WD|AWD|FWD|RWD|4X4|4X2)$/.test(engineCode)) return review("DRIVE_LABEL_IS_NOT_ENGINE");
      const transmissionType = ({МКПП:"manual",АКПП:"automatic",РКПП:"robot",CVT:"cvt"} as const)[compound[2].toUpperCase() as "МКПП"|"АКПП"|"РКПП"|"CVT"];
      condition = {kind:"engineTransmission",value:`${engineCode}:${transmissionType}`,engineCode,transmissionType};
    } else if (transmission) condition = { kind: "transmission", value: transmission[1].toUpperCase() === "АКПП" ? "automatic" : transmission[1].toUpperCase() === "CVT" ? "cvt" : "manual" };
    else if (drive) condition = { kind: "drive", value: drive[1].toUpperCase() as "2WD" | "4WD" | "AWD" | "FWD" | "RWD" };
    else if (labeledEngine && allowedEngines.has(normalizeEngineCode(labeledEngine[2]))) {
      // Complete source label and explicit code are required; never accept a
      // prefix while dropping gearbox, date, hybrid or other suffix clauses.
      if (labeledEngine[1].includes(" D") !== labeledEngine[2].startsWith("D")) return review("CONFLICTING_ENGINE_LABEL");
      condition = { kind: "engine", value: normalizeEngineCode(labeledEngine[2])! };
    } else if (engine && /\d/.test(engine[1]) && allowedEngines.has(normalizeEngineCode(engine[1]))) {
      const code = normalizeEngineCode(engine[1])!;
      if (/^(?:2WD|4WD|AWD|FWD|RWD|4X4|4X2)$/.test(code)) return review("DRIVE_LABEL_IS_NOT_ENGINE");
      condition = { kind: "engine", value: code };
    } else return review("UNSUPPORTED_OR_SHARED_CONDITION");
    const parsed = parseFluidCapacities(sourceSegment, systemCode);
    if (parsed.needsReview || parsed.rejected.length || parsed.capacities.length !== 1) return review("BRANCH_PARSER_DIAGNOSTICS");
    const engineScoped = (kind: FluidCapacityCondition["kind"]) => kind === "engine" || kind === "engineTransmission";
    if (branches.some(b => b.condition.kind !== condition.kind && !(engineScoped(b.condition.kind) && engineScoped(condition.kind)))) return review("MIXED_CONDITION_DIMENSIONS");
    // A general engine branch must not overlap a gearbox-specific branch.
    if (branches.some(b => b.condition.kind === "engine" && condition.kind === "engineTransmission" && b.condition.value === condition.engineCode
      || b.condition.kind === "engineTransmission" && condition.kind === "engine" && b.condition.engineCode === condition.value)) return review("OVERLAPPING_ENGINE_CONDITIONS");
    if (branches.some(b => b.condition.value === condition.value)) return review("DUPLICATE_CONDITION");
    branches.push({ condition, capacity: parsed.capacities[0], sourceSegment, start: token.start, end });
  }
  return { status: "structured" as const, reason: null, sourceText, normalizedText, branches, publicationAllowed: false as const };
}

export function selectConditionalFluidCapacity(branches: ConditionalFluidCapacity[], context: { transmissionType?: string; engineCode?: string; driveMode?: string; rearAirConditioning?: boolean }) {
  const matches = branches.filter(branch => branch.condition.kind === "rearAirConditioning"
    ? typeof context.rearAirConditioning === "boolean" && (branch.condition.value === "present") === context.rearAirConditioning
    : branch.condition.kind === "engineTransmission"
    ? branch.condition.engineCode === normalizeEngineCode(context.engineCode) && branch.condition.transmissionType === context.transmissionType
    : branch.condition.kind === "transmission"
    ? branch.condition.value === context.transmissionType
    : branch.condition.kind === "drive"
    ? branch.condition.value === context.driveMode?.trim().toUpperCase()
    : Boolean(context.engineCode) && branch.condition.value === normalizeEngineCode(context.engineCode));
  return matches.length === 1 ? matches[0] : null;
}
