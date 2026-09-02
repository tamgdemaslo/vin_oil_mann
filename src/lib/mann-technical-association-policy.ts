export const MANN_TECHNICAL_ASSOCIATION_DENYLIST_VERSION = "mann-technical-association-denylist-v1" as const;

export type MannTechnicalAssociationDenylist = {
  version: typeof MANN_TECHNICAL_ASSOCIATION_DENYLIST_VERSION;
  reviewedAt: string;
  reviewerType: "CODEX_TECHNICAL_AUDIT";
  independentHumanSignoff: false;
  effect: "EXCLUDE_FROM_DRY_RUN_AUTO_MATERIALIZATION";
  rejectedAssociationFingerprints: string[];
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function parseMannTechnicalAssociationDenylist(value: unknown): MannTechnicalAssociationDenylist {
  if (!value || typeof value !== "object") throw new Error("MANN technical association denylist must be an object");
  const candidate = value as Partial<MannTechnicalAssociationDenylist>;
  if (candidate.version !== MANN_TECHNICAL_ASSOCIATION_DENYLIST_VERSION) {
    throw new Error(`Unsupported MANN technical association denylist version: ${String(candidate.version)}`);
  }
  if (candidate.reviewerType !== "CODEX_TECHNICAL_AUDIT") throw new Error("Unexpected denylist reviewerType");
  if (candidate.independentHumanSignoff !== false) throw new Error("Denylist must not claim independent human sign-off");
  if (candidate.effect !== "EXCLUDE_FROM_DRY_RUN_AUTO_MATERIALIZATION") throw new Error("Unexpected denylist effect");
  if (!candidate.reviewedAt || Number.isNaN(Date.parse(candidate.reviewedAt))) throw new Error("Denylist reviewedAt must be an ISO-8601 date");
  if (!Array.isArray(candidate.rejectedAssociationFingerprints)) throw new Error("Denylist fingerprints must be an array");
  if (!candidate.rejectedAssociationFingerprints.every((fingerprint) => SHA256_PATTERN.test(fingerprint))) {
    throw new Error("Denylist contains an invalid association fingerprint");
  }
  if (new Set(candidate.rejectedAssociationFingerprints).size !== candidate.rejectedAssociationFingerprints.length) {
    throw new Error("Denylist contains duplicate association fingerprints");
  }
  return candidate as MannTechnicalAssociationDenylist;
}

export function partitionMannTechnicalAssociations<T extends { associationFingerprint: string }>(
  associations: T[],
  denylist: MannTechnicalAssociationDenylist,
): { eligible: T[]; rejected: T[] } {
  const rejectedFingerprints = new Set(denylist.rejectedAssociationFingerprints);
  const eligible: T[] = [];
  const rejected: T[] = [];
  for (const association of associations) {
    (rejectedFingerprints.has(association.associationFingerprint) ? rejected : eligible).push(association);
  }
  return { eligible, rejected };
}
