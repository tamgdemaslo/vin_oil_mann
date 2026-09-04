import { prisma } from "@/lib/db";

const PRIMARY_SOURCE_VERIFIED = "PRIMARY_SOURCE_VERIFIED";
const PRIMARY_SOURCE_VERIFIED_FIELDS = "PRIMARY_SOURCE_VERIFIED_FIELDS";

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

export type MannTechnicalProfileStatus = "active" | "staged_preview" | "none";

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
  specifications: string[];
  viscosityGrades: string[];
  recommendation?: string;
  replacementInterval?: string;
  evidence: MannTechnicalEvidence[];
};

export type MannUnifiedTechnicalProfile = {
  status: MannTechnicalProfileStatus;
  items: MannTechnicalProfileItem[];
  notice?: string;
};

type TechnicalRevisionRow = {
  id: string;
  systemCode: string;
  componentModel: string | null;
  technicalDataJson: unknown;
  verifiedFieldsJson: unknown;
  fieldConfidenceJson: unknown;
  evidenceJson: unknown;
  state: string;
  verificationStatus: string;
  applyEligible: boolean;
  createdAt: Date;
  reviewConfirmed: boolean;
  run: {
    status: string;
    mode: string;
    independentHumanSignoff: boolean;
    productionApplyAuthorized: boolean;
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

function safeCapacity(row: TechnicalRevisionRow, data: Record<string, unknown>): MannTechnicalCapacity | undefined {
  if (!fieldIsVerified(row, "technical.capacity")) return undefined;
  const capacity = record(data.capacity);
  const nominalLiters = finitePositive(capacity.nominalLiters);
  const minLiters = finitePositive(capacity.minLiters);
  const maxLiters = finitePositive(capacity.maxLiters);
  const toleranceLiters = finitePositive(capacity.toleranceLiters, true);
  if (nominalLiters == null && minLiters == null && maxLiters == null) return undefined;
  const serviceContext = text(capacity.serviceContext)?.toUpperCase();
  return {
    nominalLiters,
    minLiters,
    maxLiters,
    toleranceLiters,
    serviceContext,
    serviceContextLabel: serviceContext ? CAPACITY_CONTEXT_LABELS[serviceContext] : undefined,
  };
}

function safeTextField(row: TechnicalRevisionRow, data: Record<string, unknown>, fieldNames: string[], dataNames: string[]): string | undefined {
  if (!fieldIsVerified(row, ...fieldNames)) return undefined;
  for (const dataName of dataNames) {
    const value = text(data[dataName]);
    if (value) return value;
  }
  return undefined;
}

function safeStringList(row: TechnicalRevisionRow, data: Record<string, unknown>, fieldNames: string[], dataNames: string[]): string[] {
  if (!fieldIsVerified(row, ...fieldNames)) return [];
  for (const dataName of dataNames) {
    const values = strings(data[dataName]);
    if (values.length) return values;
  }
  return [];
}

function isActive(row: TechnicalRevisionRow): boolean {
  return row.state === "ACTIVE"
    && row.applyEligible
    && row.verificationStatus === PRIMARY_SOURCE_VERIFIED_FIELDS
    && row.run.status === "COMPLETED"
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

function toProfileItem(row: TechnicalRevisionRow): MannTechnicalProfileItem | null {
  const data = record(row.technicalDataJson);
  const capacity = safeCapacity(row, data);
  const specifications = safeStringList(
    row,
    data,
    ["technical.specifications", "technical.specification"],
    ["specifications", "specification"],
  );
  const viscosityGrades = safeStringList(
    row,
    data,
    ["technical.viscosityGrades", "technical.viscosities"],
    ["viscosityGrades", "viscosities"],
  );
  const recommendation = safeTextField(
    row,
    data,
    ["technical.recommendation"],
    ["recommendation", "recommendationText"],
  );
  const replacementInterval = safeTextField(
    row,
    data,
    ["technical.replacementInterval"],
    ["replacementInterval", "replacementIntervalText"],
  );
  const evidence = safeEvidence(row.evidenceJson);

  if (!evidence.length || (!capacity && !specifications.length && !viscosityGrades.length && !recommendation && !replacementInterval)) {
    return null;
  }

  return {
    revisionId: row.id,
    systemCode: row.systemCode,
    systemLabel: SYSTEM_LABELS[row.systemCode] ?? row.systemCode.replace(/_/g, " "),
    componentModel: row.componentModel ?? undefined,
    capacity,
    specifications,
    viscosityGrades,
    recommendation,
    replacementInterval,
    evidence,
  };
}

function itemFingerprint(item: MannTechnicalProfileItem): string {
  return JSON.stringify({
    systemCode: item.systemCode,
    componentModel: item.componentModel,
    capacity: item.capacity,
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
  const status: MannTechnicalProfileStatus = activeRows.length
    ? "active"
    : rows.some(isStagedPreview)
      ? "staged_preview"
      : "none";
  const eligibleRows = status === "active" ? activeRows : status === "staged_preview" ? rows.filter(isStagedPreview) : [];
  eligibleRows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || left.id.localeCompare(right.id));

  const items = new Map<string, MannTechnicalProfileItem>();
  for (const row of eligibleRows) {
    const item = toProfileItem(row);
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
        verificationStatus: PRIMARY_SOURCE_VERIFIED_FIELDS,
        state: { in: ["ACTIVE", "STAGED"] },
      },
      select: {
        id: true,
        systemCode: true,
        componentModel: true,
        technicalDataJson: true,
        verifiedFieldsJson: true,
        fieldConfidenceJson: true,
        evidenceJson: true,
        state: true,
        verificationStatus: true,
        applyEligible: true,
        createdAt: true,
        run: {
          select: {
            status: true,
            mode: true,
            independentHumanSignoff: true,
            productionApplyAuthorized: true,
          },
        },
        reviewDecisions: {
          where: { decision: "CONFIRM" },
          select: { id: true },
          take: 1,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 200,
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
