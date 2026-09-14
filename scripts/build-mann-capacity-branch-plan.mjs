import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCopy, sha } from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
assert.ok(process.argv.length<=3 && !process.argv[2]?.startsWith('--'));
const root = resolve(import.meta.dirname, '..'), dir = resolve(root, process.argv[2]??'outputs/mann-parentheses-scoped-2026-09-13');
const raw = await readFile(resolve(dir, 'capacity-branch-matches.json'), 'utf8');
const verification = JSON.parse(await readFile(resolve(dir, 'capacity-branch-verification.json'), 'utf8'));
assert.equal(verification.reportSha256, sha(raw)); assert.equal(verification.issueCount, 0);
const report = JSON.parse(raw), sourceRaw = await readFile('/tmp/vehicle_fluid_requirements.sql', 'utf8');
assert.equal(sha(sourceRaw), report.sourceHashes.source);
const overlay=await loadIdentityOverlay(root,sourceRaw,report.identityCorrections?.path,report.identityCorrections?.sha256);
const sources = new Map(overlay.requirements.map(r => [r.id, r]));
const links = report.results.flatMap(r => r.proposals.map(p => ({ result: r, proposal: p })));
const policy = 'MANN_CONDITIONAL_CAPACITY_PREVIEW_V1';
const revisions = [...Map.groupBy(links, l => `${l.result.requirementId}:${l.proposal.vehicleVariantKey}`)].map(([key, group]) => {
  const source = sources.get(group[0].result.requirementId); assert.ok(source);
  assert.notEqual(source.rawRequirementJson?.sourceIdentity?.reviewRequired,true);
  const sourceVehicleScope={make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})};
  assert.equal(new Set(group.map(l => sha(l.proposal.window))).size, 1);
  const capacityBranches = group.map(({ result, proposal }) => ({
    condition: result.branch.condition, sourceSegment: result.branch.sourceSegment,
    applicabilityJson: { sourceVehicleScope,matchedEngineScope: proposal.matchedEngineScope.length ? proposal.matchedEngineScope : null, window: proposal.window },
    validation: proposal.validation, originalAssociationFingerprint: proposal.originalAssociationFingerprint,
  }));
  const engineCodes = [...new Set(group.flatMap(l => l.proposal.matchedEngineScope))];
  const applicabilityJson = { sourceVehicleScope,yearFrom: source.yearFrom, yearTo: source.yearTo,
    engineCodes: [source.engineCodeNormalized, ...(source.engineCodesJson ?? [])].filter(Boolean),
    matchedEngineScope: engineCodes.length ? engineCodes : null, window: group[0].proposal.window,
    transmissionType: source.transmissionType, driveType: source.driveType, componentModel: source.componentModel };
  const technicalDataJson = { fillVolumeText: source.fillVolumeText, capacityBranches,
    specifications: source.specificationsJson, specificationText: source.specificationText, viscosityGrades: source.viscosityGradesJson,
    recommendationText: source.recommendationText, replacementIntervalText: source.replacementIntervalText };
  const fingerprint = sha({ key, policy, applicabilityJson, technicalDataJson });
  return { id: `mtar_${fingerprint.slice(0,24)}`, sourceRequirementId: source.id, vehicleVariantKey: group[0].proposal.vehicleVariantKey,
    systemCode: source.systemCode, componentModel: source.componentModel, applicabilityJson, technicalDataJson,
    verifiedFieldsJson: [], fieldConfidenceJson: { 'technical.capacity': 'SECONDARY_SOURCE_PARSED_MEDIUM', 'technical.specifications': 'SECONDARY_SOURCE_PARSED_MEDIUM', 'technical.viscosityGrades': 'SECONDARY_SOURCE_PARSED_MEDIUM' },
    evidenceJson: [{ publisher: 'podbormasla.ru', title: 'Каталог технических жидкостей', url: source.sourceUrl }],
    provenanceJson: { catalogPreviewPolicy: policy, catalogPreviewEligible: true, sourceTechnicalReviewRequired: true,
      sourceBranchReportHash: sha(raw), sourceIdentityCorrection:group[0].proposal.sourceIdentityCorrection??null,
      independentValidation: { independentlyValidated: true, hardConflicts: [], reviewBlockers: [] } },
    state: 'STAGED', verificationStatus: 'UNVERIFIED', matchClass: 'CONFIRMED_MULTI_APPLICABILITY',
    matchScore: Math.min(...group.map(l => l.proposal.validation.score)), semanticFingerprint: fingerprint, applyEligible: false };
});
assert.equal(revisions.reduce((n, r) => n + r.technicalDataJson.capacityBranches.length, 0), report.proposals);
const plan = { kind: 'CONDITIONAL_CAPACITY_GROUPED_REVISION_PLAN', productionApplyAllowed: false, policy,
  sourceReportHash: sha(raw), identityCorrections:overlay.metadata,summary: { revisions: revisions.length, branches: report.proposals, sourceRequirements: report.requirementsWithProposals },
  limitation: 'Candidate revisions only. Merge collisions, protected decisions, SQL, backup and deployment are not resolved here.', revisions };
await writeFile(resolve(dir, 'capacity-branch-plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(plan.summary));
