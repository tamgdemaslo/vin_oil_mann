#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const [beforePath, afterPath, outputPath] = process.argv.slice(2);
assert.ok(beforePath && afterPath && outputPath, "Usage: before.json after.json comparison.json");
const [before, after] = await Promise.all([beforePath, afterPath].map(async p => JSON.parse(await readFile(p, "utf8"))));
assert.deepEqual(before.sourceHashes, after.sourceHashes);
const originals = new Map(before.replay.map(r => [r.requirementId, r]));
assert.equal(originals.size, before.replay.length);
assert.equal(new Set(after.replay.map(r=>r.requirementId)).size, after.replay.length);
assert.equal(originals.size, after.replay.length);
const transitions = {}, changed = [];
for (const row of after.replay) {
  const old = originals.get(row.requirementId);
  assert.ok(old);
  const key = `${old.after.status} -> ${row.after.status}`;
  transitions[key] = (transitions[key] ?? 0) + 1;
  if (old.after.status !== row.after.status) changed.push({ requirementId: row.requirementId, model: row.model, system: row.system, before: old.after, after: row.after });
}
const result = { artifactKind: "MANN_CONTROLLED_AUDIT_COMPARISON", writeMode: "DRY_RUN_ONLY", beforePath: resolve(beforePath), afterPath: resolve(afterPath), requirements: after.replay.length, transitions, changed };
await writeFile(outputPath, JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({requirements: result.requirements, transitions},null,2));
