import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy, sha} from './lib/mann-offline-scope.mjs';

const root = resolve(import.meta.dirname, '..');
const snapshot = resolve(root, '../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson');
const jiti = createJiti(import.meta.url, {alias: {'@': resolve(root, 'src')}});
const {prepareFluidCatalog} = await jiti.import('../src/lib/fluid-catalog.ts');
const raw = await readFile(snapshot, 'utf8');
const sql = await readFile('/tmp/vehicle_fluid_requirements.sql', 'utf8');
const originalRows = new Map(raw.trim().split('\n').map(JSON.parse).map(r => [r.row_id, r]));
const sources = parseCopy(sql, 'vehicle_fluid_requirements');
const prepared = prepareFluidCatalog({rowsNdjson: raw, mannFiltersCsv: ''});
const byId = new Map(prepared.requirements.map(r => [r.id, r]));
assert.equal(byId.size, prepared.requirements.length);
assert.equal(byId.size, sources.length, 'Source coverage differs: do not use correction overlay');
const changes = [], unrelatedChanges = [];
const identityFields = ['generation', 'bodyCodesJson'];
const unchangedFields = ['sourceRowId', 'sourceUrl', 'make', 'model', 'modelNormalized', 'yearFrom', 'yearTo',
  'engineCodeNormalized', 'engineCodesJson', 'engineVolumeCc', 'powerKw', 'powerHp', 'fuelType', 'driveType',
  'transmissionType', 'componentModel', 'systemCode', 'fillVolumeText', 'specificationText'];
for (const source of sources) {
  const reparsed = byId.get(source.id);
  assert.ok(reparsed, `Missing source ${source.id}`);
  const row = originalRows.get(source.sourceRowId);
  assert.ok(row && row.source_url === source.sourceUrl);
  const changedFields = identityFields.filter(field => JSON.stringify(source[field]) !== JSON.stringify(reparsed[field]));
  const unrelated = unchangedFields.filter(field => JSON.stringify(source[field]) !== JSON.stringify(reparsed[field]));
  if (unrelated.length) unrelatedChanges.push({requirementId: source.id, fields: unrelated});
  if (changedFields.length) changes.push({requirementId: source.id, sourceRowId: source.sourceRowId, sourceUrl: source.sourceUrl,
    changedFields, before: Object.fromEntries(identityFields.map(f => [f, source[f]])), after: Object.fromEntries(identityFields.map(f => [f, reparsed[f]])),
    sourceIdentity: reparsed.rawRequirementJson.sourceIdentity ?? null,
    evidence: {generationSlug: row.generation_slug, pageTitle: row.page_title, pageHash: row.page_sha256, sourceRowHash: sha(JSON.stringify(row))},
    technicalDataVerified: false, productionApplyAllowed: false});
}
const report = {kind: 'FULL_SOURCE_REPARSE_IDENTITY_AUDIT', productionApplyAllowed: false,
  limitation: 'Reconstructs explicit source metadata, not OEM truth. No database updates. Generation conflicts and unmatched catalogue labels still require review.',
  hashes: {snapshot: sha(raw), source: sha(sql), parser: sha(await readFile(resolve(root, 'src/lib/fluid-catalog.ts'), 'utf8'))},
  sourceRows: originalRows.size, requirements: sources.length, changedRequirements: changes.length,
  changedPages: new Set(changes.map(r => r.sourceUrl)).size, unrelatedChanges,
  groups: [...Map.groupBy(changes, r => r.sourceUrl)].map(([url, rows]) => ({url, requirements: rows.length,
    before: rows[0].before, after: rows[0].after, evidence: rows[0].evidence})), changes};
await writeFile(resolve(root, 'outputs/mann-combined-preview-plan-2026-09-13/source-reparse-identity-v4.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({...report, changes: undefined, groups: undefined}, null, 2));
console.log(JSON.stringify({missingRestored: changes.filter(r => r.before.generation == null && r.after.generation != null).length,
  generationConflicts: changes.filter(r => r.sourceIdentity?.reviewRequired).length,
  bodyCodesCleaned: changes.filter(r => r.changedFields.includes('bodyCodesJson')).length}, null, 2));
