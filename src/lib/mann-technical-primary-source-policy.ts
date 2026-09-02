export const MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_VERSION =
  "mann-technical-primary-source-verification-v1" as const;

export const MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_SCOPE = [
  "vehicleContext.make",
  "vehicleContext.model",
  "vehicleContext.engineCode",
  "systemCode",
  "technical.capacity",
] as const;

const ALLOWED_DOCUMENT_HOSTS = new Set(["cdn.perxis.ru", "haval.ru", "public-servicebox.opel.com"]);
const ALLOWED_SYSTEM_CODES = new Set(["ENGINE_COOLANT", "ENGINE_OIL"]);
const ALLOWED_SERVICE_CONTEXTS = new Set(["SYSTEM_CAPACITY", "WITH_FILTER"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

type VerifiedDocument = {
  id: string;
  publisher: string;
  title: string;
  officialIndexUrl: string;
  url: string;
  sha256: string;
};

type VerifiedAssociation = {
  associationFingerprint: string;
  requirementId: string;
  systemCode: "ENGINE_COOLANT" | "ENGINE_OIL";
  vehicle: {
    make: string;
    model: string;
    engineCode: string;
  };
  capacity: {
    nominalLiters: number;
    toleranceLiters: number;
    serviceContext: "SYSTEM_CAPACITY" | "WITH_FILTER";
  };
  evidence: {
    documentId: string;
    pdfPage: number;
    printedPage: number;
    summary: string;
  };
};

export type MannTechnicalPrimarySourceVerification = {
  version: typeof MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_VERSION;
  createdAt: string;
  reviewerType: "CODEX_PRIMARY_SOURCE_AUDIT";
  effect: "VERIFIED_SUBSET_PREVIEW_ONLY";
  independentHumanSignoff: false;
  productionApplyAuthorized: false;
  verificationScope: string[];
  sourcePreview: {
    artifactKind: "MANN_TECHNICAL_MATERIALIZATION_DRY_RUN";
    writeMode: "DRY_RUN_ONLY";
    commit: string;
    matcher: string;
    capacityParser: string;
    backupSha256: string;
  };
  documents: VerifiedDocument[];
  associations: VerifiedAssociation[];
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const asString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
};

const asPositiveInteger = (value: unknown, label: string): number => {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number(value);
};

const asNonNegativeNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return value;
};

const asSha256 = (value: unknown, label: string): string => {
  const hash = asString(value, label);
  if (!SHA256_PATTERN.test(hash)) throw new Error(`${label} must be a lowercase SHA-256 hash`);
  return hash;
};

const asGitCommit = (value: unknown, label: string): string => {
  const commit = asString(value, label);
  if (!GIT_COMMIT_PATTERN.test(commit)) throw new Error(`${label} must be a full lowercase Git commit`);
  return commit;
};

const asOfficialUrl = (value: unknown, label: string): string => {
  const raw = asString(value, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:" || !ALLOWED_DOCUMENT_HOSTS.has(url.hostname)) {
    throw new Error(`${label} must use HTTPS on an approved primary-source host`);
  }
  return url.toString();
};

export function parseMannTechnicalPrimarySourceVerification(
  value: unknown,
): MannTechnicalPrimarySourceVerification {
  const root = asRecord(value, "verification set");
  if (root.version !== MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_VERSION) {
    throw new Error(`verification set version must be ${MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_VERSION}`);
  }
  if (root.reviewerType !== "CODEX_PRIMARY_SOURCE_AUDIT") {
    throw new Error("verification set must identify the automated reviewer type");
  }
  if (root.effect !== "VERIFIED_SUBSET_PREVIEW_ONLY") {
    throw new Error("verification set effect must remain preview-only");
  }
  if (root.independentHumanSignoff !== false) {
    throw new Error("verification set must not claim independent human sign-off");
  }
  if (root.productionApplyAuthorized !== false) {
    throw new Error("verification set must not authorize a production apply");
  }

  if (!Array.isArray(root.verificationScope)) throw new Error("verificationScope must be an array");
  const verificationScope = root.verificationScope.map((entry, index) => asString(entry, `verificationScope[${index}]`));
  if (
    verificationScope.length !== MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_SCOPE.length
    || MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_SCOPE.some((field, index) => verificationScope[index] !== field)
  ) {
    throw new Error("verificationScope must match the field-level primary-source scope");
  }

  const sourcePreviewRaw = asRecord(root.sourcePreview, "sourcePreview");
  if (sourcePreviewRaw.artifactKind !== "MANN_TECHNICAL_MATERIALIZATION_DRY_RUN") {
    throw new Error("sourcePreview.artifactKind must identify the dry-run artifact");
  }
  if (sourcePreviewRaw.writeMode !== "DRY_RUN_ONLY") {
    throw new Error("sourcePreview.writeMode must remain DRY_RUN_ONLY");
  }
  const sourcePreview = {
    artifactKind: sourcePreviewRaw.artifactKind,
    writeMode: sourcePreviewRaw.writeMode,
    commit: asGitCommit(sourcePreviewRaw.commit, "sourcePreview.commit"),
    matcher: asString(sourcePreviewRaw.matcher, "sourcePreview.matcher"),
    capacityParser: asString(sourcePreviewRaw.capacityParser, "sourcePreview.capacityParser"),
    backupSha256: asSha256(sourcePreviewRaw.backupSha256, "sourcePreview.backupSha256"),
  } satisfies MannTechnicalPrimarySourceVerification["sourcePreview"];

  if (!Array.isArray(root.documents) || root.documents.length === 0) {
    throw new Error("documents must contain at least one primary source");
  }
  const documentIds = new Set<string>();
  const documents = root.documents.map((entry, index): VerifiedDocument => {
    const document = asRecord(entry, `documents[${index}]`);
    const id = asString(document.id, `documents[${index}].id`);
    if (documentIds.has(id)) throw new Error(`duplicate primary-source document id: ${id}`);
    documentIds.add(id);
    return {
      id,
      publisher: asString(document.publisher, `documents[${index}].publisher`),
      title: asString(document.title, `documents[${index}].title`),
      officialIndexUrl: asOfficialUrl(document.officialIndexUrl, `documents[${index}].officialIndexUrl`),
      url: asOfficialUrl(document.url, `documents[${index}].url`),
      sha256: asSha256(document.sha256, `documents[${index}].sha256`),
    };
  });

  if (!Array.isArray(root.associations) || root.associations.length === 0) {
    throw new Error("associations must contain at least one verified association");
  }
  const fingerprints = new Set<string>();
  const requirementIds = new Set<string>();
  const associations = root.associations.map((entry, index): VerifiedAssociation => {
    const association = asRecord(entry, `associations[${index}]`);
    const associationFingerprint = asSha256(
      association.associationFingerprint,
      `associations[${index}].associationFingerprint`,
    );
    const requirementId = asSha256(association.requirementId, `associations[${index}].requirementId`);
    if (fingerprints.has(associationFingerprint)) throw new Error(`duplicate association fingerprint: ${associationFingerprint}`);
    if (requirementIds.has(requirementId)) throw new Error(`duplicate requirement id: ${requirementId}`);
    fingerprints.add(associationFingerprint);
    requirementIds.add(requirementId);

    const systemCode = asString(association.systemCode, `associations[${index}].systemCode`);
    if (!ALLOWED_SYSTEM_CODES.has(systemCode)) throw new Error(`unsupported verified system code: ${systemCode}`);
    const vehicle = asRecord(association.vehicle, `associations[${index}].vehicle`);
    const capacity = asRecord(association.capacity, `associations[${index}].capacity`);
    const evidence = asRecord(association.evidence, `associations[${index}].evidence`);
    const documentId = asString(evidence.documentId, `associations[${index}].evidence.documentId`);
    if (!documentIds.has(documentId)) throw new Error(`unknown primary-source document id: ${documentId}`);
    const serviceContext = asString(capacity.serviceContext, `associations[${index}].capacity.serviceContext`);
    if (!ALLOWED_SERVICE_CONTEXTS.has(serviceContext)) {
      throw new Error(`unsupported verified service context: ${serviceContext}`);
    }

    return {
      associationFingerprint,
      requirementId,
      systemCode: systemCode as VerifiedAssociation["systemCode"],
      vehicle: {
        make: asString(vehicle.make, `associations[${index}].vehicle.make`).toLowerCase(),
        model: asString(vehicle.model, `associations[${index}].vehicle.model`).toLowerCase(),
        engineCode: asString(vehicle.engineCode, `associations[${index}].vehicle.engineCode`).toUpperCase(),
      },
      capacity: {
        nominalLiters: asNonNegativeNumber(capacity.nominalLiters, `associations[${index}].capacity.nominalLiters`),
        toleranceLiters: asNonNegativeNumber(capacity.toleranceLiters, `associations[${index}].capacity.toleranceLiters`),
        serviceContext: serviceContext as VerifiedAssociation["capacity"]["serviceContext"],
      },
      evidence: {
        documentId,
        pdfPage: asPositiveInteger(evidence.pdfPage, `associations[${index}].evidence.pdfPage`),
        printedPage: asPositiveInteger(evidence.printedPage, `associations[${index}].evidence.printedPage`),
        summary: asString(evidence.summary, `associations[${index}].evidence.summary`),
      },
    };
  });

  return {
    version: MANN_TECHNICAL_PRIMARY_SOURCE_VERIFICATION_VERSION,
    createdAt: asString(root.createdAt, "createdAt"),
    reviewerType: "CODEX_PRIMARY_SOURCE_AUDIT",
    effect: "VERIFIED_SUBSET_PREVIEW_ONLY",
    independentHumanSignoff: false,
    productionApplyAuthorized: false,
    verificationScope,
    sourcePreview,
    documents,
    associations,
  };
}
