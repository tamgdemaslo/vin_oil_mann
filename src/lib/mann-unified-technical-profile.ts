import { prisma } from "@/lib/db";
import { readMannCapacityBranches } from "@/lib/mann-capacity-branches";
import { selectConditionalFluidCapacity } from "@/lib/fluid-capacity-conditions";
import { mannTransmissionComponent, mannExplicitTransmissionTypeCount } from "@/lib/mann-transmission-component";
import { explicitMannTransmissionModels, explicitMannCvtModels, explicitMannAlphanumericModels, explicitMannTransmissionModelYears } from "@/lib/mann-transmission-model-list";
import { mannTechnicalScopeMatches, type MannTechnicalVehicleContext } from "@/lib/mann-technical-applicability";
import { readMannEquipmentScope, mannExactEquipmentModel, mannEquipmentComponentDrives, MANN_EQUIPMENT_COMPONENT_DRIVE_POLICY, MANN_EXACT_EQUIPMENT_MODEL_POLICY, type MannEquipmentConfirmation } from "@/lib/mann-equipment-scope";

const PRIMARY_SOURCE_VERIFIED = "PRIMARY_SOURCE_VERIFIED";
const PRIMARY_SOURCE_VERIFIED_FIELDS = "PRIMARY_SOURCE_VERIFIED_FIELDS";
const UNVERIFIED = "UNVERIFIED";
const CATALOG_PREVIEW_POLICY = "MANN_V9_CONSERVATIVE_MATCHER";
const SCOPED_CATALOG_PREVIEW_POLICY = "MANN_ENGINE_DATE_SCOPED_PREVIEW_V1";
const CONDITIONAL_CAPACITY_POLICY = "MANN_CONDITIONAL_CAPACITY_PREVIEW_V1";
const CONDITIONAL_TRANSMISSION_POLICY = "USER_CONFIRMED_TRANSMISSION_V1";
const CONDITIONAL_EQUIPMENT_POLICY = "USER_CONFIRMED_EQUIPMENT_V1";
const TRANSMISSION_REVIEW_BLOCKER = "MANN variant не подтверждает тип или модель коробки";

export const MANN_TRANSMISSION_TYPES = ["automatic", "manual", "cvt", "robot"] as const;
export type MannTransmissionType = typeof MANN_TRANSMISSION_TYPES[number];

const TRANSMISSION_SYSTEMS: Record<MannTransmissionType, string> = {
  automatic: "AUTOMATIC_TRANSMISSION",
  manual: "MANUAL_TRANSMISSION",
  cvt: "CVT_TRANSMISSION",
  robot: "ROBOT_TRANSMISSION",
};

const TRANSMISSION_LABELS: Record<MannTransmissionType, string> = {
  automatic: "АКПП",
  manual: "МКПП",
  cvt: "Вариатор",
  robot: "Робот",
};

const SYSTEM_LABELS: Record<string, string> = {
  ENGINE_OIL: "Моторное масло",
  AUTOMATIC_TRANSMISSION: "Автоматическая коробка передач",
  MANUAL_TRANSMISSION: "Механическая коробка передач",
  CVT_TRANSMISSION: "Вариатор",
  ROBOT_TRANSMISSION: "Роботизированная коробка передач",
  TRANSFER_CASE: "Раздаточная коробка",
  FRONT_DIFFERENTIAL: "Передний редуктор",
  REAR_DIFFERENTIAL: "Задний редуктор",
  DIFFERENTIAL_GENERIC: "Редуктор",
  AWD_COUPLING: "Муфта полного привода",
  POWER_STEERING: "Гидроусилитель руля",
  BRAKE_FLUID: "Тормозная жидкость",
  ENGINE_COOLANT: "Охлаждающая жидкость",
  INVERTER_COOLANT: "Охлаждение инвертора",
  INTERCOOLER_COOLANT: "Охлаждение интеркулера",
  AC_REFRIGERANT: "Хладагент кондиционера",
  FUEL_TANK: "Топливный бак",
  ADBLUE: "AdBlue",
  BATTERY: "Аккумулятор",
  SPARK_PLUG: "Свечи зажигания",
  TIRES_WHEELS: "Шины и колёса",
};

const CAPACITY_CONTEXT_LABELS: Record<string, string> = {
  SERVICE: "сервисная замена",
  TOTAL: "полная ёмкость",
  PARTIAL: "частичная замена",
  WITH_FILTER: "с фильтром",
  WITHOUT_FILTER: "без фильтра",
  DRY_FILL: "сухая заправка",
  REFILL: "перезаправка",
  SYSTEM_CAPACITY: "ёмкость системы",
  UNKNOWN: "объём",
};

export type MannTechnicalProfileStatus = "active" | "staged_preview" | "catalog_preview" | "none";

export type MannTechnicalEvidence = {
  publisher?: string;
  title?: string;
  url?: string;
  pdfPage?: number;
  printedPage?: number;
};

export type MannTechnicalCapacity = {
  nominalLiters?: number;
  minLiters?: number;
  maxLiters?: number;
  toleranceLiters?: number;
  serviceContext?: string;
  serviceContextLabel?: string;
};

export type MannTechnicalProfileItem = {
  revisionId: string;
  systemCode: string;
  systemLabel: string;
  componentModel?: string;
  capacity?: MannTechnicalCapacity;
  capacities: MannTechnicalCapacity[];
  specifications: string[];
  viscosityGrades: string[];
  recommendation?: string;
  replacementInterval?: string;
  evidence: MannTechnicalEvidence[];
  sourceStatus: "primary_source" | "catalog_preview";
  requiresReview: boolean;
  transmissionType?: MannTransmissionType;
  userConfirmedTransmission: boolean;
  automaticSelectionEligible: boolean;
  userConfirmedTransmissionModel?: boolean;
  userConfirmedEquipment?: MannEquipmentConfirmation;
};

export type MannTechnicalTransmissionOption = {
  type: MannTransmissionType;
  label: string;
  systemCode: string;
};

export type MannUnifiedTechnicalProfile = {
  status: MannTechnicalProfileStatus;
  items: MannTechnicalProfileItem[];
  transmissionOptions: MannTechnicalTransmissionOption[];
  selectedTransmissionType?: MannTransmissionType;
  containsCatalogPreview: boolean;
  notice?: string;
  transmissionComponentOptions?: string[];
  transmissionGearCountOptions?: number[];
  transmissionConditionsToReview?: string[];
  equipmentOptions?: (MannEquipmentConfirmation & {systemCode: string; label: string})[];
};

type TechnicalRevisionRow = {
  id: string;
  sourceRequirementId: string;
  systemCode: string;
  componentModel: string | null;
  applicabilityJson: unknown;
  technicalDataJson: unknown;
  verifiedFieldsJson: unknown;
  fieldConfidenceJson: unknown;
  evidenceJson: unknown;
  provenanceJson: unknown;
  state: string;
  verificationStatus: string;
  matchClass: string;
  matchScore: number;
  applyEligible: boolean;
  createdAt: Date;
  reviewConfirmed: boolean;
  run: {
    status: string;
    mode: string;
    independentHumanSignoff: boolean;
    productionApplyAuthorized: boolean;
    gatesJson: unknown;
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    if (typeof item === "string") return item.trim() ? [item.trim()] : [];
    const itemRecord = record(item);
    const text = [itemRecord.value, itemRecord.name, itemRecord.text]
      .find((candidate) => typeof candidate === "string" && candidate.trim());
    return typeof text === "string" ? [text.trim()] : [];
  }))];
}

function finitePositive(value: unknown, allowZero = false): number | undefined {
  if (value == null || (typeof value === "string" && !value.trim())) return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return undefined;
  if (allowZero ? number < 0 : number <= 0) return undefined;
  return number;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fieldIsVerified(row: TechnicalRevisionRow, ...names: string[]): boolean {
  const verifiedFields = new Set(strings(row.verifiedFieldsJson));
  const confidence = record(row.fieldConfidenceJson);
  return names.some((name) => verifiedFields.has(name) && confidence[name] === PRIMARY_SOURCE_VERIFIED);
}

function fieldHasCatalogConfidence(row: TechnicalRevisionRow, ...names: string[]): boolean {
  const confidence = record(row.fieldConfidenceJson);
  return names.some((name) => {
    const value = confidence[name];
    return typeof value === "string" && value.startsWith("SECONDARY_SOURCE_");
  });
}

function safeEvidence(value: unknown): MannTechnicalEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    const publisher = text(item.publisher);
    const title = text(item.title);
    const url = text(item.url);
    if (!publisher && !title && !url) return [];
    return [{
      publisher,
      title,
      url: url && /^https:\/\//i.test(url) ? url : undefined,
      pdfPage: finitePositive(item.pdfPage, true),
      printedPage: finitePositive(item.printedPage, true),
    }];
  });
}

function normalizeCapacity(value: unknown): MannTechnicalCapacity | undefined {
  const capacity = record(value);
  const nominalLiters = finitePositive(capacity.nominalLiters);
  const minLiters = finitePositive(capacity.minLiters);
  const maxLiters = finitePositive(capacity.maxLiters);
  const toleranceLiters = finitePositive(capacity.toleranceLiters, true);
  if (nominalLiters == null && minLiters == null && maxLiters == null) return undefined;
  const serviceContext = [capacity.serviceContext, capacity.filterContext, capacity.kind]
    .map((candidate) => text(candidate)?.toUpperCase())
    .find((candidate) => candidate && candidate !== "UNKNOWN");
  return {
    nominalLiters,
    minLiters,
    maxLiters,
    toleranceLiters,
    serviceContext,
    serviceContextLabel: serviceContext ? CAPACITY_CONTEXT_LABELS[serviceContext] : undefined,
  };
}

function safeCapacities(row: TechnicalRevisionRow, data: Record<string, unknown>, catalogPreview: boolean, userConfirmedTransmission: boolean, selectedTransmissionType?: MannTransmissionType, vehicleContext?: MannTechnicalVehicleContext, userConfirmedEquipment = false): MannTechnicalCapacity[] {
  if (!catalogPreview) {
    if (!fieldIsVerified(row, "technical.capacity")) return [];
    const capacity = normalizeCapacity(data.capacity);
    return capacity ? [capacity] : [];
  }
  if ((!userConfirmedTransmission && !userConfirmedEquipment && row.state !== "STAGED") || !fieldHasCatalogConfidence(row, "technical.capacity")) return [];
  if ("capacityBranches" in data) {
    const branches = readMannCapacityBranches(data, row.applicabilityJson, row.systemCode);
    if (!branches) return [];
    const applicable = branches.filter(branch => mannTechnicalScopeMatches(branch.applicabilityJson, vehicleContext));
    const selected = selectConditionalFluidCapacity(applicable, { transmissionType: selectedTransmissionType, engineCode: vehicleContext?.engineCode });
    const capacity = selected ? normalizeCapacity(selected.capacity) : null;
    return capacity ? [capacity] : [];
  }
  if (!Array.isArray(data.capacities)) return [];
  return data.capacities.flatMap((capacity) => {
    const source = record(capacity);
    if (source.confidence === "LOW") return [];
    const normalized = normalizeCapacity(source);
    return normalized ? [normalized] : [];
  });
}

function safeTextField(row: TechnicalRevisionRow, data: Record<string, unknown>, fieldNames: string[], dataNames: string[], catalogPreview: boolean): string | undefined {
  if (catalogPreview ? !fieldHasCatalogConfidence(row, ...fieldNames) : !fieldIsVerified(row, ...fieldNames)) return undefined;
  for (const dataName of dataNames) {
    const value = text(data[dataName]);
    if (value) return value;
  }
  return undefined;
}

function specificationStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const structured = value.flatMap((entry) => {
    const item = record(entry);
    const type = text(item.type)?.toUpperCase();
    const valueText = text(item.value) ?? text(item.name) ?? text(item.text);
    if (!valueText || type === "RAW" || type === "SAE") return [];
    return [valueText];
  });
  return [...new Set(structured.length ? structured : strings(value))];
}

function safeStringList(row: TechnicalRevisionRow, data: Record<string, unknown>, fieldNames: string[], dataNames: string[], catalogPreview: boolean, specifications = false): string[] {
  if (catalogPreview ? !fieldHasCatalogConfidence(row, ...fieldNames) : !fieldIsVerified(row, ...fieldNames)) return [];
  for (const dataName of dataNames) {
    const values = specifications ? specificationStrings(data[dataName]) : strings(data[dataName]);
    if (values.length) return values;
  }
  return [];
}

function isActive(row: TechnicalRevisionRow): boolean {
  return row.state === "ACTIVE"
    && row.applyEligible
    && row.verificationStatus === PRIMARY_SOURCE_VERIFIED_FIELDS
    && row.run.status === "COMPLETED"
    && row.run.mode === "MATERIALIZED"
    && row.run.independentHumanSignoff
    && row.run.productionApplyAuthorized;
}

function isStagedPreview(row: TechnicalRevisionRow): boolean {
  return row.state === "STAGED"
    && !row.applyEligible
    && row.verificationStatus === PRIMARY_SOURCE_VERIFIED_FIELDS
    && row.run.status === "COMPLETED"
    && row.run.mode === "STAGING"
    && row.reviewConfirmed;
}

function isCatalogPreview(row: TechnicalRevisionRow): boolean {
  const provenance = record(row.provenanceJson);
  const validation = record(provenance.independentValidation);
  const gates = record(row.run.gatesJson);
  const policy = provenance.catalogPreviewPolicy;
  const applicability = record(row.applicabilityJson);
  const acceptedPolicy = policy === CATALOG_PREVIEW_POLICY
    || ((policy === SCOPED_CATALOG_PREVIEW_POLICY || policy === CONDITIONAL_CAPACITY_POLICY)
      && "window" in applicability
      && "matchedEngineScope" in applicability
      && provenance.sourceTechnicalReviewRequired === true
      && (policy !== CONDITIONAL_CAPACITY_POLICY || readMannCapacityBranches(row.technicalDataJson, row.applicabilityJson, row.systemCode) !== null));
  return ["STAGED", "REVIEW"].includes(row.state)
    && !row.applyEligible
    && row.verificationStatus === UNVERIFIED
    && ["CONFIRMED_SINGLE", "CONFIRMED_MULTI_APPLICABILITY"].includes(row.matchClass)
    && row.run.status === "COMPLETED"
    && row.run.mode === "STAGING"
    && !row.run.independentHumanSignoff
    && !row.run.productionApplyAuthorized
    && acceptedPolicy
    && gates.catalogPreviewPolicy === policy
    && gates.automaticProductSelection === false
    && provenance.catalogPreviewEligible === true
    && validation.independentlyValidated === true
    && Array.isArray(validation.hardConflicts)
    && validation.hardConflicts.length === 0
    && Array.isArray(validation.reviewBlockers)
    && validation.reviewBlockers.length === 0;
}

function transmissionTypeFor(row: TechnicalRevisionRow): MannTransmissionType | undefined {
  const value = text(record(row.applicabilityJson).transmissionType)?.toLowerCase();
  return MANN_TRANSMISSION_TYPES.find((candidate) => candidate === value);
}

// Opt-in only: old ambiguous source rows must not become eligible simply
// because their text happens to resemble a list after a parser update.
function conditionalTransmissionTypeCount(row: TechnicalRevisionRow): boolean {
  const parsed=mannExplicitTransmissionTypeCount(row.componentModel);
  if(!parsed)return false;
  const scope=record(row.applicabilityJson),provenance=record(row.provenanceJson),gates=record(row.run.gatesJson);
  const evidence=record(provenance.explicitTransmissionTypeCount),source=record(provenance.sourceTransmissionContext);
  const sourceLabel=record(source.evidence).systemName;
  if(typeof sourceLabel!=='string')return false;
  const label=sourceLabel.trim().toUpperCase().replace(/\s+/g,' ').replace(/^(?:МАСЛО|ЖИДКОСТЬ) (?:В|ДЛЯ) /,'').match(/^(АКПП|МКПП|РОБОТ|РКПП|DCT|DSG)[ -](\d{1,2})$/);
  if(!label||Number(label[2])!==parsed.gearCount||(label[1]==='АКПП'?'automatic':label[1]==='МКПП'?'manual':'robot')!==parsed.type)return false;
  return gates.transmissionTypeCountPolicy==='EXPLICIT_SOURCE_TYPE_COUNT_V1'
    && evidence.policy===gates.transmissionTypeCountPolicy
    && evidence.sourceComponentModel===row.componentModel
    && record(source.evidence).componentModel===row.componentModel
    && JSON.stringify(evidence.typeCount)===JSON.stringify(parsed)
    && scope.componentModel===row.componentModel && scope.transmissionType===parsed.type
    && scope.transmissionGearCount===parsed.gearCount
    && source.destinationSystemCode===row.systemCode && source.transmissionType===parsed.type
    && source.transmissionGearCount===parsed.gearCount && source.hasAdditionalLabelConditions===false
    && Array.isArray(source.issues) && source.issues.length===0
    && !!scope.sourceVehicleScope && !!scope.window
    && Array.isArray(scope.matchedEngineScope) && scope.matchedEngineScope.length>0;
}

function conditionalTransmissionModels(row: TechnicalRevisionRow): string[] | null {
  const provenance = record(row.provenanceJson), gates = record(row.run.gatesJson);
  const evidence = record(provenance.explicitTransmissionModelList);
  const scope = record(row.applicabilityJson);
  const cvt = gates.transmissionModelListPolicy === "EXPLICIT_CVT_SOURCE_MODEL_LIST_V1";
  const alphanumeric = gates.transmissionModelListPolicy === "EXPLICIT_ALPHANUMERIC_SOURCE_MODEL_LIST_V1";
  const dated = gates.transmissionModelListPolicy === "EXPLICIT_SOURCE_MODEL_YEAR_RANGE_V1";
  const datedModel = dated ? explicitMannTransmissionModelYears(row.componentModel) : null;
  if (dated) {
    const interval = record(record(scope.window).intersection);
    if (!datedModel || JSON.stringify(evidence.modelYearRange) !== JSON.stringify(datedModel)
      || typeof interval.from !== 'string' || typeof interval.to !== 'string'
      || !/^\d{4}-(0[1-9]|1[0-2])$/.test(interval.from) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(interval.to)
      || interval.from > interval.to || interval.from < `${datedModel.yearFrom}-01` || interval.to > `${datedModel.yearTo}-12`) return null;
  }
  if (cvt || ((alphanumeric || dated) && row.systemCode === 'CVT_TRANSMISSION')) {
    if (row.systemCode !== "CVT_TRANSMISSION" || scope.transmissionType !== "cvt"
      || "transmissionGearCount" in scope) return null;
  } else if ((!alphanumeric && !dated && gates.transmissionModelListPolicy !== "EXPLICIT_DECIMAL_MODEL_LIST_V1")
    || !Number.isInteger(scope.transmissionGearCount)) return null;
  const models = datedModel ? [datedModel.model] : alphanumeric ? explicitMannAlphanumericModels(row.componentModel) : cvt ? explicitMannCvtModels(row.componentModel) : explicitMannTransmissionModels(row.componentModel);
  if (!models || evidence.policy !== gates.transmissionModelListPolicy
    || evidence.sourceComponentModel !== row.componentModel
    || JSON.stringify(evidence.models) !== JSON.stringify(models)
    || scope.componentModel !== row.componentModel
    || !scope.sourceVehicleScope || !scope.window
    || !Array.isArray(scope.matchedEngineScope) || scope.matchedEngineScope.length === 0) return null;
  return models;
}

function isConditionalTransmissionPreview(row: TechnicalRevisionRow): boolean {
  const transmissionType = transmissionTypeFor(row);
  if (!transmissionType || TRANSMISSION_SYSTEMS[transmissionType] !== row.systemCode) return false;

  const provenance = record(row.provenanceJson);
  const validation = record(provenance.independentValidation);
  const gates = record(row.run.gatesJson);
  const reviewBlockers = strings(validation.reviewBlockers);
  return row.state === "REVIEW"
    && !row.applyEligible
    && row.verificationStatus === UNVERIFIED
    && row.matchClass === "CONDITIONAL_TRANSMISSION"
    && row.matchScore >= 80
    && row.run.status === "COMPLETED"
    && row.run.mode === "STAGING"
    && !row.run.independentHumanSignoff
    && !row.run.productionApplyAuthorized
    && gates.conditionalTransmissionPolicy === CONDITIONAL_TRANSMISSION_POLICY
    && gates.automaticProductSelection === false
    && provenance.conditionalTransmissionPolicy === CONDITIONAL_TRANSMISSION_POLICY
    && provenance.conditionalTransmissionEligible === true
    && validation.vehicleIdentityIndependentlyValidated === true
    && Array.isArray(validation.hardConflicts)
    && validation.hardConflicts.length === 0
    && reviewBlockers.length === 1
    && reviewBlockers[0] === TRANSMISSION_REVIEW_BLOCKER;
}

function isConditionalEquipmentPreview(row: TechnicalRevisionRow): boolean {
  const scope = record(row.applicabilityJson), equipment = readMannEquipmentScope(scope.requiredEquipment);
  if (!equipment || equipment.systemCode !== row.systemCode || !scope.sourceVehicleScope || !scope.window || !scope.matchedEngineScope) return false;
  const provenance = record(row.provenanceJson), validation = record(provenance.independentValidation), gates = record(row.run.gatesJson);
  const blocker = row.systemCode === "POWER_STEERING"
    ? "MANN variant не подтверждает наличие этой гидравлической системы"
    : "MANN variant не подтверждает привод или модель агрегата";
  // This policy handles explicitly scoped circuits, not unparsed named models,
  // multi-capacity branches or residual source conditions.
  const source = record(provenance.sourceAggregateContext);
  const modelEvidence = record(provenance.explicitEquipmentModel);
  const driveEvidence = record(provenance.explicitComponentDriveCondition);
  const sourceDrives = mannEquipmentComponentDrives(row.componentModel);
  const driveConditionAllowed = equipment.componentModel === undefined && equipment.drive !== undefined
    && gates.equipmentComponentDrivePolicy === MANN_EQUIPMENT_COMPONENT_DRIVE_POLICY
    && driveEvidence.policy === MANN_EQUIPMENT_COMPONENT_DRIVE_POLICY
    && driveEvidence.sourceComponentModel === row.componentModel
    && scope.componentModel === row.componentModel && source.componentRaw === row.componentModel
    && sourceDrives !== null && sourceDrives.includes(equipment.drive)
    && JSON.stringify(driveEvidence.drives) === JSON.stringify(sourceDrives)
    && (source.requiredDrive == null || source.requiredDrive === equipment.drive);
  const modelAllowed = equipment.componentModel === undefined
    ? /^(?:-|—)?$/.test((row.componentModel ?? "").trim())
    : gates.equipmentModelPolicy === MANN_EXACT_EQUIPMENT_MODEL_POLICY
      && modelEvidence.policy === MANN_EXACT_EQUIPMENT_MODEL_POLICY
      && modelEvidence.sourceComponentModel === row.componentModel
      && modelEvidence.model === equipment.componentModel
      && mannExactEquipmentModel(row.componentModel) === equipment.componentModel
      && scope.componentModel === row.componentModel;
  return row.state === "REVIEW" && !row.applyEligible && row.verificationStatus === UNVERIFIED
    && row.matchClass === "CONDITIONAL_EQUIPMENT" && row.matchScore >= 80
    && row.run.status === "COMPLETED" && row.run.mode === "STAGING"
    && !row.run.independentHumanSignoff && !row.run.productionApplyAuthorized
    && gates.automaticProductSelection === false && gates.conditionalEquipmentPolicy === CONDITIONAL_EQUIPMENT_POLICY
    && provenance.conditionalEquipmentPolicy === CONDITIONAL_EQUIPMENT_POLICY && provenance.conditionalEquipmentEligible === true
    && provenance.sourceTechnicalReviewRequired === true && validation.vehicleIdentityIndependentlyValidated === true
    && Array.isArray(validation.hardConflicts) && validation.hardConflicts.length === 0
    && Array.isArray(validation.reviewBlockers) && validation.reviewBlockers.every(b => b === blocker)
    && source.systemCode === equipment.systemCode && source.circuit === equipment.circuit && source.fluidRequired === true
    && ((source.requiredDrive ?? undefined) === equipment.drive || driveConditionAllowed)
    && (source.attachedTransmissionType ?? undefined) === equipment.attachedTransmissionType
    && Array.isArray(source.issues) && source.issues.every(issue => ((equipment.componentModel !== undefined && modelAllowed) || driveConditionAllowed) && issue === 'COMPONENT_OR_CONDITIONS_REQUIRE_REVIEW')
    && (modelAllowed || driveConditionAllowed)
    && !("capacityBranches" in record(row.technicalDataJson));
}

function toProfileItem(row: TechnicalRevisionRow, catalogPreview: boolean, userConfirmedTransmission = false, selectedTransmissionType?: MannTransmissionType, vehicleContext?: MannTechnicalVehicleContext, userConfirmedEquipment = false): MannTechnicalProfileItem | null {
  const data = record(row.technicalDataJson);
  const capacities = safeCapacities(row, data, catalogPreview, userConfirmedTransmission, selectedTransmissionType, vehicleContext, userConfirmedEquipment);
  const specifications = safeStringList(
    row,
    data,
    ["technical.specifications", "technical.specification"],
    ["specifications", "specification"],
    catalogPreview,
    true,
  );
  const viscosityGrades = safeStringList(
    row,
    data,
    ["technical.viscosityGrades", "technical.viscosities"],
    ["viscosityGrades", "viscosities"],
    catalogPreview,
  );
  const recommendation = safeTextField(
    row,
    data,
    ["technical.recommendation"],
    ["recommendation", "recommendationText"],
    catalogPreview,
  );
  const replacementInterval = safeTextField(
    row,
    data,
    ["technical.replacementInterval"],
    ["replacementInterval", "replacementIntervalText"],
    catalogPreview,
  );
  const evidence = safeEvidence(row.evidenceJson);

  if (!evidence.length || (!capacities.length && !specifications.length && !viscosityGrades.length && !recommendation && !replacementInterval)) {
    return null;
  }

  return {
    revisionId: row.id,
    systemCode: row.systemCode,
    systemLabel: SYSTEM_LABELS[row.systemCode] ?? row.systemCode.replace(/_/g, " "),
    componentModel: row.componentModel ?? undefined,
    capacity: capacities[0],
    capacities,
    specifications,
    viscosityGrades,
    recommendation,
    replacementInterval,
    evidence,
    sourceStatus: catalogPreview ? "catalog_preview" : "primary_source",
    requiresReview: catalogPreview && row.state === "REVIEW" && !userConfirmedTransmission && !userConfirmedEquipment,
    transmissionType: userConfirmedTransmission ? transmissionTypeFor(row) : undefined,
    userConfirmedTransmission,
    automaticSelectionEligible: isActive(row),
  };
}

function itemFingerprint(item: MannTechnicalProfileItem): string {
  return JSON.stringify({
    systemCode: item.systemCode,
    componentModel: item.componentModel,
    capacities: item.capacities,
    specifications: item.specifications,
    viscosityGrades: item.viscosityGrades,
    recommendation: item.recommendation,
    replacementInterval: item.replacementInterval,
  });
}

/**
 * Converts revision rows into the only public technical profile shape.
 * ACTIVE data always wins. STAGED data is returned solely as a labelled test
 * preview and must never be used for automatic product selection.
 */
export function buildMannUnifiedTechnicalProfile(rows: TechnicalRevisionRow[], selectedTransmissionType?: MannTransmissionType, vehicleContext?: MannTechnicalVehicleContext): MannUnifiedTechnicalProfile {
  // Only the explicit selection parameter supplies gearbox-type confirmation.
  // An unrelated context object must not silently make this choice for the user.
  vehicleContext = {...vehicleContext, confirmedTransmissionType: selectedTransmissionType};
  // Discover vehicle-level gearbox conditions on any fluid, without making a
  // selection. Only publication-eligible rows and the full remaining scope count.
  const vehicleTransmissionChoices = rows.flatMap(row => {
    if (!isActive(row) && !isStagedPreview(row) && !isCatalogPreview(row)) return [];
    const condition = record(record(row.applicabilityJson).requiredTransmission);
    const type = MANN_TRANSMISSION_TYPES.find(value => value === condition.type);
    if (!type) return [];
    const gearCount = typeof condition.gearCount === "number" ? condition.gearCount : undefined;
    if (!mannTechnicalScopeMatches(row.applicabilityJson, {...vehicleContext,
      confirmedTransmissionType: type, transmissionGearCount: gearCount})) return [];
    return [{type, gearCount}];
  });
  const equipmentChoiceRows = rows.filter(row => {
    if (!isConditionalEquipmentPreview(row)) return false;
    const { requiredEquipment, ...rest } = record(row.applicabilityJson);
    const equipment = readMannEquipmentScope(requiredEquipment)!;
    return mannTechnicalScopeMatches(rest, vehicleContext)
      && (!selectedTransmissionType || !equipment.attachedTransmissionType || selectedTransmissionType === equipment.attachedTransmissionType);
  });
  // Choice discovery may omit only the gear-count gate, never vehicle identity,
  // engine, dates or publication policy. Actual items below use the full scope.
  const gearChoiceRows = rows.filter(row => {
    if (!isConditionalTransmissionPreview(row)) return false;
    const { transmissionGearCount, ...rest } = record(row.applicabilityJson);
    return typeof transmissionGearCount === "number" && Number.isInteger(transmissionGearCount)
      && transmissionGearCount >= 3 && transmissionGearCount <= 18
      && mannTechnicalScopeMatches(rest, vehicleContext);
  });
  rows = rows.filter(row => mannTechnicalScopeMatches(row.applicabilityJson, vehicleContext));
  const activeRows = rows.filter(isActive);
  const stagedRows = rows.filter(isStagedPreview);
  const catalogRows = rows.filter(isCatalogPreview);
  const conditionalTransmissionRows = [...new Set([...rows.filter(isConditionalTransmissionPreview), ...gearChoiceRows])];
  const transmissionOptions = MANN_TRANSMISSION_TYPES.flatMap((type) => (
    (conditionalTransmissionRows.some((row) => transmissionTypeFor(row) === type)
      || vehicleTransmissionChoices.some(choice => choice.type === type)
      || catalogRows.some(row => readMannCapacityBranches(row.technicalDataJson, row.applicabilityJson, row.systemCode)?.some(branch => branch.condition.kind === "transmission" && branch.condition.value === type && mannTechnicalScopeMatches(branch.applicabilityJson, vehicleContext))))
      ? [{ type, label: TRANSMISSION_LABELS[type], systemCode: TRANSMISSION_SYSTEMS[type] }]
      : []
  ));
  // Prefer verified data per system, not across the entire vehicle. An engine
  // oil revision must not hide brake fluid or coolant from another tier.
  const activeSystems = new Set(activeRows.filter(row => toProfileItem(row, false)).map(row => row.systemCode));
  const visibleStaged = stagedRows.filter(row => !activeSystems.has(row.systemCode));
  const primarySystems = new Set([...activeSystems, ...visibleStaged.filter(row => toProfileItem(row, false)).map(row => row.systemCode)]);
  const eligibleRows = [...activeRows, ...visibleStaged, ...catalogRows.filter(row => !primarySystems.has(row.systemCode))];
  const selectedConditionalRows = selectedTransmissionType
    ? conditionalTransmissionRows.filter((row) => transmissionTypeFor(row) === selectedTransmissionType && !primarySystems.has(row.systemCode))
    : [];
  const transmissionComponentOptions = [...new Set(selectedConditionalRows.flatMap(row => {
    const count = record(row.applicabilityJson).transmissionGearCount;
    if (vehicleContext?.transmissionGearCount != null && count != null && count !== vehicleContext.transmissionGearCount) return [];
    const component = mannTransmissionComponent(row.componentModel);
    return component.kind === "model" ? [component.model] : conditionalTransmissionModels(row) ?? [];
  }))].sort();
  const transmissionConditionsToReview = [...new Set(selectedConditionalRows.flatMap(row => {
    const component = mannTransmissionComponent(row.componentModel);
    return component.kind === "conditions" && !conditionalTransmissionModels(row) && !conditionalTransmissionTypeCount(row) ? [component.text] : [];
  }))];
  const transmissionGearCountOptions = [...new Set([...selectedConditionalRows.flatMap(row => {
    const count = record(row.applicabilityJson).transmissionGearCount;
    return typeof count === "number" ? [count] : [];
  }), ...vehicleTransmissionChoices.flatMap(choice => choice.type === selectedTransmissionType && choice.gearCount != null ? [choice.gearCount] : [])])].sort((a, b) => a - b);
  const selectionDetails = {
    ...(equipmentChoiceRows.some(row => !primarySystems.has(row.systemCode)) ? {
      equipmentOptions: [...new Map(equipmentChoiceRows.filter(row => !primarySystems.has(row.systemCode)).map(row => {
        const equipment = readMannEquipmentScope(record(row.applicabilityJson).requiredEquipment)!;
        return [JSON.stringify(equipment), {...equipment, label: equipment.circuit === "ANGLE_GEAR" ? "Угловой редуктор" : SYSTEM_LABELS[equipment.systemCode]}];
      })).values()],
    } : {}),
    ...(transmissionGearCountOptions.length ? { transmissionGearCountOptions } : {}),
    ...(transmissionComponentOptions.length ? { transmissionComponentOptions } : {}),
    ...(transmissionConditionsToReview.length ? { transmissionConditionsToReview } : {}),
  };
  const selectedModel = mannTransmissionComponent(vehicleContext?.transmissionModel);
  eligibleRows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id));
  selectedConditionalRows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id));

  const items = new Map<string, MannTechnicalProfileItem>();
  for (const row of equipmentChoiceRows) {
    if (primarySystems.has(row.systemCode) || !mannTechnicalScopeMatches(row.applicabilityJson, vehicleContext)) continue;
    const item = toProfileItem(row, true, false, selectedTransmissionType, vehicleContext, true);
    if (!item) continue;
    const {systemCode, ...equipment} = readMannEquipmentScope(record(row.applicabilityJson).requiredEquipment)!;
    item.userConfirmedEquipment = equipment;
    if (equipment.circuit === "ANGLE_GEAR") item.systemLabel = "Угловой редуктор";
    item.componentModel = equipment.componentModel;
    const fingerprint = itemFingerprint(item);
    if (!items.has(fingerprint)) items.set(fingerprint, item);
  }
  for (const row of eligibleRows) {
    const item = toProfileItem(row, isCatalogPreview(row), false, selectedTransmissionType, vehicleContext);
    if (!item) continue;
    const fingerprint = itemFingerprint(item);
    if (!items.has(fingerprint)) items.set(fingerprint, item);
  }
  for (const row of selectedConditionalRows) {
    if (!mannTechnicalScopeMatches(row.applicabilityJson, vehicleContext)) continue;
    const component = mannTransmissionComponent(row.componentModel);
    const modelList = conditionalTransmissionModels(row);
    if (component.kind === "conditions" && !conditionalTransmissionTypeCount(row) && (!modelList || selectedModel.kind !== "model" || !modelList.includes(selectedModel.model))) continue;
    if (component.kind === "model" && (selectedModel.kind !== "model" || component.model !== selectedModel.model)) continue;
    const item = toProfileItem(row, true, true);
    if (!item) continue;
    if (component.kind === "model" || modelList) item.userConfirmedTransmissionModel = true;
    const fingerprint = itemFingerprint(item);
    if (!items.has(fingerprint)) items.set(fingerprint, item);
  }

  const resultItems = [...items.values()].sort((left, right) => left.systemLabel.localeCompare(right.systemLabel, "ru"));
  const status: MannTechnicalProfileStatus = resultItems.some(item => item.automaticSelectionEligible) ? "active"
    : resultItems.some(item => item.sourceStatus === "primary_source") ? "staged_preview"
    : resultItems.length ? "catalog_preview" : "none";
  const containsCatalogPreview = resultItems.some((item) => item.sourceStatus === "catalog_preview");
  if (!resultItems.length) {
    return {
      status: "none",
      items: [],
      transmissionOptions,
      selectedTransmissionType,
      containsCatalogPreview: false,
      ...selectionDetails,
    };
  }
  return {
    status,
    items: resultItems,
    transmissionOptions,
    selectedTransmissionType,
    containsCatalogPreview,
    ...selectionDetails,
    notice: status === "active" && resultItems.some(item => !item.automaticSelectionEligible)
      ? "Профиль содержит предварительные справочные данные. Для автоматического подбора разрешены только отдельно утверждённые записи."
      : status === "staged_preview"
      ? containsCatalogPreview
        ? "Профиль содержит данные первичных источников и предварительные данные каталога. До утверждения они доступны только как справка и не участвуют в автоматическом подборе товаров."
        : "Проверено по первичному источнику, но ещё не утверждено для автоматического подбора товаров. Используйте только как справку."
      : status === "catalog_preview" || containsCatalogPreview
        ? "Предварительные данные из технического каталога прошли автоматическое сопоставление с MANN, но не подтверждены производителем. Они не участвуют в автоматическом подборе товаров."
      : undefined,
  };
}

export async function getMannUnifiedTechnicalProfile(variantKeys: string[], selectedTransmissionType?: MannTransmissionType, vehicleContext?: MannTechnicalVehicleContext): Promise<MannUnifiedTechnicalProfile> {
  const keys = [...new Set(variantKeys.map((key) => key.trim()).filter(Boolean))].slice(0, 20);
  if (!keys.length) return { status: "none", items: [], transmissionOptions: [], containsCatalogPreview: false };

  try {
    const revisions = await prisma.mannTechnicalAssociationRevision.findMany({
      where: {
        vehicleVariantKey: { in: keys },
        verificationStatus: { in: [PRIMARY_SOURCE_VERIFIED_FIELDS, UNVERIFIED] },
        state: { in: ["ACTIVE", "STAGED", "REVIEW"] },
      },
      select: {
        id: true,
        sourceRequirementId: true,
        systemCode: true,
        componentModel: true,
        applicabilityJson: true,
        technicalDataJson: true,
        verifiedFieldsJson: true,
        fieldConfidenceJson: true,
        evidenceJson: true,
        provenanceJson: true,
        state: true,
        verificationStatus: true,
        matchClass: true,
        matchScore: true,
        applyEligible: true,
        createdAt: true,
        run: {
          select: {
            status: true,
            mode: true,
            independentHumanSignoff: true,
            productionApplyAuthorized: true,
            gatesJson: true,
          },
        },
        reviewDecisions: {
          where: { decision: "CONFIRM" },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 1_000,
    });

    return buildMannUnifiedTechnicalProfile(revisions.map((revision) => ({
      ...revision,
      reviewConfirmed: revision.reviewDecisions.length > 0,
    })), selectedTransmissionType, vehicleContext);
  } catch (error) {
    // Environments that have not received the expand migration retain the
    // existing filter lookup instead of failing the whole vehicle workflow.
    console.warn("[mann-technical-profile] unavailable", error instanceof Error ? error.message : String(error));
    return { status: "none", items: [], transmissionOptions: [], containsCatalogPreview: false };
  }
}
