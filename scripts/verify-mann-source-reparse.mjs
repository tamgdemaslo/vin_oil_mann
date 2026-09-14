import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy, sha} from './lib/mann-offline-scope.mjs';
const root = resolve(import.meta.dirname, '..');
const report = JSON.parse(await readFile(resolve(root, 'outputs/mann-combined-preview-plan-2026-09-13/source-reparse-identity-v4.json'), 'utf8'));
const raw = await readFile(resolve(root, '../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'), 'utf8');
const sql = await readFile('/tmp/vehicle_fluid_requirements.sql', 'utf8');
assert.equal(sha(raw), report.hashes.snapshot);
assert.equal(sha(sql), report.hashes.source);
assert.equal(sha(await readFile(resolve(root, 'src/lib/fluid-catalog.ts'), 'utf8')), report.hashes.parser);
const rows = new Map(raw.trim().split('\n').map(JSON.parse).map(r => [r.row_id, r]));
const sources = new Map(parseCopy(sql, 'vehicle_fluid_requirements').map(r => [r.id, r]));
assert.equal(sources.size, report.requirements);
assert.deepEqual(report.unrelatedChanges, []);
const romans = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'];
const seen = new Set();
for (const change of report.changes) {
  assert.ok(!seen.has(change.requirementId)); seen.add(change.requirementId);
  const source = sources.get(change.requirementId), row = rows.get(change.sourceRowId);
  assert.ok(source && row);
  assert.equal(source.sourceRowId, row.row_id);
  assert.equal(source.sourceUrl, change.sourceUrl);
  assert.equal(sha(JSON.stringify(row)), change.evidence.sourceRowHash);
  assert.equal(row.page_sha256, change.evidence.pageHash);
  assert.equal(row.generation_slug, change.evidence.generationSlug);
  assert.equal(row.page_title, change.evidence.pageTitle);
  assert.deepEqual(change.before, {generation: source.generation, bodyCodesJson: source.bodyCodesJson});
  assert.deepEqual(change.after.bodyCodesJson, source.bodyCodesJson.filter(code => !/^(?:\d{1,2}GEN|GEN\d{1,2})$/.test(code)));
  if (change.sourceIdentity?.reviewRequired) {
    assert.equal(change.after.generation, null);
    assert.notEqual(change.sourceIdentity.slugGeneration, change.sourceIdentity.titleGeneration);
  } else if (change.before.generation !== change.after.generation) {
    const slug = row.generation_slug.match(/^(?:gen(\d+)|(\d+)gen)$/i);
    if (row.brand_slug === 'opel') {
      const labels = {zafira_b: ['B','Зафира Б'],zafira_c: ['C','Зафира С'],astra_h: ['H','Астра H'],astra_j: ['J','Астра J'],corsa_d: ['D','Корса Д']};
      const expected = labels[row.generation_slug];
      assert.ok(expected, 'Unreviewed Opel source label');
      assert.equal(change.after.generation, expected[0]);
      assert.ok(row.page_title.includes(expected[1]));
    } else if (slug) assert.equal(change.after.generation, romans[Number(slug[1] || slug[2])]);
    else {
      // Explicit exceptional source format: facelift slug is not generation 5.
      assert.equal(row.generation_slug, '8.5gen');
      assert.ok(row.page_title.includes('8 поколение'));
      assert.equal(change.after.generation, 'VIII');
    }
  }
  assert.equal(change.productionApplyAllowed, false);
}
assert.equal(seen.size, report.changedRequirements);
console.log(JSON.stringify({kind: 'SOURCE_REPARSE_EVIDENCE_VERIFICATION', checkedChanges: seen.size, issueCount: 0, productionApplyAllowed: false}));
