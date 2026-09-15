/** Snapshot-bound exclusions of demonstrably impossible legacy date imports.
 * Does not infer fluid compatibility or change primary/manual verification.
 */
export function hasContradictoryLegacySourceDate(row: {
  sourceRequirementId: string;
  applicabilityJson: unknown;
  provenanceJson: unknown;
}): boolean {
  const scope = row.applicabilityJson as Record<string, unknown> | null;
  const provenance = row.provenanceJson as Record<string, unknown> | null;
  if (!scope || !provenance) return false;
  // Archived raw row explicitly says "до 08. 07. 2019"; imported2020–2020
  // has no overlap under any inclusive/exclusive reading of that day.
  return row.sourceRequirementId === '0756ecd0fe3a60affcf0e645406e378dfa70684041dead3415d5c827a98c64ce'
    && provenance.sourceRowId === 'defc3f93a50f7007f86a634f20c6c58496b7be14f45c55eb38da14fd1efca918'
    && provenance.sourceBatchHash === 'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae'
    && provenance.sourcePageHash === 'd948bffcc353d8ee6bb5b3b393556cd0916986c49f4eec32ba0ed7853407b45a'
    && provenance.sourceAssociationFingerprint === 'ec0d9fbf1c65867a122634ba2ab00c74ac6429d045d198df47a88e1daba9f5f3'
    && scope.yearFrom === 2020 && scope.yearTo === 2020;
}
