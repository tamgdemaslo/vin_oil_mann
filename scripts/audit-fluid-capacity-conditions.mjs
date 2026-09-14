import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { parseCopy, sha } from './lib/mann-offline-scope.mjs';
const root = resolve(import.meta.dirname, '..');
const sourceRaw = await readFile('/tmp/vehicle_fluid_requirements.sql', 'utf8');
const jiti = createJiti(import.meta.url);
const { parseConditionalFluidCapacities: parse, selectConditionalFluidCapacity: select } = await jiti.import('../src/lib/fluid-capacity-conditions.ts');
const { parseFluidCapacities } = await jiti.import('../src/lib/fluid-capacity-parser.ts');
const sources = parseCopy(sourceRaw, 'vehicle_fluid_requirements');
const structured = [], review = [], counts = {};
let conditionalWarnings = 0;
for (const source of sources) {
  const original = parseFluidCapacities(source.fillVolumeText, source.systemCode);
  const hasWarning = original.suspicious.some(d => d.code === 'UNRESOLVED_CONDITIONAL_CAPACITY');
  if (hasWarning) conditionalWarnings++;
  const parsed = parse(source.fillVolumeText, source.systemCode, [source.engineCodeNormalized, ...(source.engineCodesJson ?? [])].filter(Boolean));
  if (parsed.status === 'structured') {
    assert.equal(parsed.publicationAllowed, false);
    assert.equal(parsed.branches.map(b => b.sourceSegment).join(''), parsed.normalizedText);
    assert.equal(select(parsed.branches, {}), null);
    for (const branch of parsed.branches) {
      assert.equal(parsed.normalizedText.slice(branch.start, branch.end), branch.sourceSegment);
      const context = branch.condition.kind === 'engine' ? { engineCode: branch.condition.value } : branch.condition.kind === 'drive' ? { driveMode: branch.condition.value } : { transmissionType: branch.condition.value };
      assert.equal(select(parsed.branches, context), branch);
    }
    const kind = parsed.branches[0].condition.kind;
    counts[kind] = (counts[kind] ?? 0) + 1;
    structured.push({ requirementId: source.id, systemCode: source.systemCode, sourceUrl: source.sourceUrl,
      vehicle: { make: source.make, model: source.model, generation: source.generation, engineCodes: source.engineCodesJson, engineCode: source.engineCodeNormalized, yearFrom: source.yearFrom, yearTo: source.yearTo },
      hadConditionalWarning: hasWarning, requiresVehicleMatch: true, requiresTechnicalSourceReview: true, ...parsed });
  } else if (hasWarning) review.push({ requirementId: source.id, systemCode: source.systemCode, sourceUrl: source.sourceUrl, sourceText: parsed.sourceText, reason: parsed.reason });
}
assert.equal(new Set(structured.map(r => r.requirementId)).size, structured.length);
assert.equal(structured.filter(r => r.hadConditionalWarning).length + review.length, conditionalWarnings);
const files = ['src/lib/fluid-capacity-conditions.ts', 'src/lib/fluid-capacity-parser.ts', 'src/lib/vehicle-normalization.ts', 'scripts/audit-fluid-capacity-conditions.mjs'];
const codeHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(resolve(root, file), 'utf8'))])));
const report = { kind: 'FULL_SOURCE_CONDITIONAL_CAPACITY_AUDIT', sourceSha256: sha(sourceRaw), codeHashes,
  totalRequirements: sources.length, conditionalWarnings, structuredRequirements: structured.length, counts,
  remainingConditionalReview: review.length, productionApplyAllowed: false,
  limitation: 'Parsing evidence only: does not validate applicability or technical values, alter the source parser, or publish branches.', structured, review };
await writeFile(resolve(root, 'outputs/mann-parentheses-scoped-2026-09-13', process.argv[2] || 'conditional-capacity-audit.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...report, structured: undefined, review: undefined }, null, 2));
