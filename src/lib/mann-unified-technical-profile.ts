import { prisma } from "@/lib/db";

const PRIMARY_SOURCE_VERIFIED = "PRIMARY_SOURCE_VERIFIED";
const PRIMARY_SOURCE_VERIFIED_FIELDS = "PRIMARY_SOURCE_VERIFIED_FIELDS";
const UNVERIFIED = "UNVERIFIED";
const CATALOG_PREVIEW_POLICY = "MANN_V9_CONSERVATIVE_MATCHER";

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
};

export type MannUnifiedTechnicalProfile = {
  status: MannTechnicalProfileStatus;
  items: MannTechnicalProfileItem[];
  notice?: string;
};

type TechnicalRevisionRow = {
  id: string;
  sourceRequirementId: string;
  systemCode: string;
  componentModel: string | null;
  technicalDataJson: unknown;
  verifiedFieldsJson: unknown;
  fieldConfidenceJson: unknown;
  evidenceJson: unknown;
  provenanceJson: unknown;
  state: string;
  verificationStatus: string;
  matchClass: string;
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

function safeCapacities(row: TechnicalRevisionRow, data: Record<string, unknown>, catalogPreview: boolean): MannTechnicalCapacity[] {
  if (!catalogPreview) {
    if (!fieldIsVerified(row, "technical.capacity")) return [];
    const capacity = normalizeCapacity(data.capacity);
    return capacity ? [capacity] : [];
  }
  if (row.state !== "STAGED" || !fieldHasCatalogConfidence(row, "technical.capacity")) return [];
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
  return ["STAGED", "REVIEW"].includes(row.state)
    && !row.applyEligible
    && row.verificationStatus === UNVERIFIED
    && ["CONFIRMED_SINGLE", "CONFIRMED_MULTI_APPLICABILITY"].includes(row.matchClass)
    && row.run.status === "COMPLETED"
    && row.run.mode === "STAGING"
    && !row.run.independentHumanSignoff
    && !row.run.productionApplyAuthorized
    && gates.catalogPreviewPolicy === CATALOG_PREVIEW_POLICY
    && gates.automaticProductSelection === false
    && provenance.catalogPreviewPolicy === CATALOG_PREVIEW_POLICY
    && provenance.catalogPreviewEligible === true
    && validation.independentlyValidated === true
    && Array.isArray(validation.hardConflicts)
    && validation.hardConflicts.length === 0
    && Array.isArray(validation.reviewBlockers)
    && validation.reviewBlockers.length === 0;
}

function toProfileItem(row: TechnicalRevisionRow, catalogPreview: boolean): MannTechnicalProfileItem | null {
  const data = record(row.technicalDataJson);
  const capacities = safeCapacities(row, data, catalogPreview);
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
    requiresReview: catalogPreview && row.state === "REVIEW",
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
export function buildMannUnifiedTechnicalProfile(rows: TechnicalRevisionRow[]): MannUnifiedTechnicalProfile {
  const activeRows = rows.filter(isActive);
  const stagedRows = rows.filter(isStagedPreview);
  const catalogRows = rows.filter(isCatalogPreview);
  const status: MannTechnicalProfileStatus = activeRows.length
    ? "active"
    : stagedRows.length
      ? "staged_preview"
      : catalogRows.length
        ? "catalog_preview"
        : "none";
  const eligibleRows = status === "active" ? activeRows : status === "staged_preview" ? stagedRows : status === "catalog_preview" ? catalogRows : [];
  eligibleRows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id));

  const items = new Map<string, MannTechnicalProfileItem>();
  for (const row of eligibleRows) {
    const item = toProfileItem(row, status === "catalog_preview");
    if (!item) continue;
    const fingerprint = itemFingerprint(item);
    if (!items.has(fingerprint)) items.set(fingerprint, item);
  }

  const resultItems = [...items.values()].sort((left, right) => left.systemLabel.localeCompare(right.systemLabel, "ru"));
  if (!resultItems.length) return { status: "none", items: [] };
  return {
    status,
    items: resultItems,
    notice: status === "staged_preview"
      ? "Проверено по первичному источнику, но ещё не утверждено для автоматического подбора товаров. Используйте только как справку."
      : status === "catalog_preview"
        ? "Предварительные данные из технического каталога прошли автоматическое сопоставление с MANN, но не подтверждены производителем. Они не участвуют в автоматическом подборе товаров."
      : undefined,
  };
}

export async function getMannUnifiedTechnicalProfile(variantKeys: string[]): Promise<MannUnifiedTechnicalProfile> {
  const keys = [...new Set(variantKeys.map((key) => key.trim()).filter(Boolean))].slice(0, 20);
  if (!keys.length) return { status: "none", items: [] };

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
        technicalDataJson: true,
        verifiedFieldsJson: true,
        fieldConfidenceJson: true,
        evidenceJson: true,
        provenanceJson: true,
        state: true,
        verificationStatus: true,
        matchClass: true,
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
    })));
  } catch (error) {
    // Environments that have not received the expand migration retain the
    // existing filter lookup instead of failing the whole vehicle workflow.
    console.warn("[mann-technical-profile] unavailable", error instanceof Error ? error.message : String(error));
    return { status: "none", items: [] };
  }
}
