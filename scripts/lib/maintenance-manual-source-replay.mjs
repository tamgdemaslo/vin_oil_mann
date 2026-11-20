/** Read-only duplicate guard. Legacy unscoped evidence is never promoted to v4. */
export async function findManualSourceReplay(tx, input) {
  const where = id => ({id, organizationId:input.organizationId});
  const previous = await tx.aIAgentTechnicalEvidence.findFirst({where:where(input.evidenceId)});
  if(previous) return {status:'ALREADY_IMPORTED', previous};
  if(!input.hasSpecificConditions){
    const legacy = await tx.aIAgentTechnicalEvidence.findFirst({where:where(input.legacyEvidenceId)});
    if(legacy) return {status:'LEGACY_SCOPE_REVIEW_REQUIRED', previous:legacy};
  }
  return null;
}
