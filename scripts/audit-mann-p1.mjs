#!/usr/bin/env node
// Offline diagnosis and narrowly scoped replay; no database client or writes.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const root = resolve(import.meta.dirname, "..");
const arg = (name, fallback) => process.argv.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const planPath = resolve(root, arg("plan", "outputs/01a091c2-2b80-7f01-a8bb-bebe0a236e74/mann-technical-second-pass-plan-v1.json"));
const output = resolve(root, arg("output-dir", "outputs/mann-p1-audit-2026-09-13"));
const plan = JSON.parse(await readFile(planPath, "utf8"));
assert.equal(plan.writeMode, "DRY_RUN_ONLY");
const decisions = (await readFile(plan.source.decisionsPath, "utf8")).trim().split("\n").map(JSON.parse);
const batches = plan.reviewBatches.filter(b => b.priority === "P1");
const batchIds = new Set(batches.map(b => b.batchId));
const contexts = plan.reviewContexts.filter(c => batchIds.has(c.batchId));
const p1ids = new Set(contexts.flatMap(c => c.requirementIds));
const rows = decisions.filter(d => p1ids.has(d.requirementId));
assert.equal(rows.length, p1ids.size);
const distribution = (items, select) => Object.fromEntries(Object.entries(items.reduce((counts, item) => {
  for (const key of new Set(select(item))) counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {})).sort((a, b) => b[1] - a[1]));

function copy(sql, table) {
  const header = sql.match(new RegExp(`COPY public\\.${table} \\(([^)]+)\\) FROM stdin;\\n`));
  assert.ok(header, `COPY header: ${table}`);
  const start = header.index + header[0].length;
  const end = sql.indexOf("\n\\.\n", start);
  assert.ok(end > start);
  const columns = header[1].split(", ");
  const numeric = new Set(["yearFrom", "yearTo", "vehicleYearFrom", "vehicleYearTo", "engineVolumeCc", "powerKw", "powerHp", "generationNumber"]);
  return sql.slice(start, end).split("\n").map(line => Object.fromEntries(line.split("\t").map((raw, i) => {
    const key = columns[i].replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    let value = raw === "\\N" ? null : raw.replace(/\\([btnrfv\\])/g, (_, c) => ({ b:"\b",t:"\t",n:"\n",r:"\r",f:"\f",v:"\v","\\":"\\" })[c]);
    if (value !== null && key.endsWith("Json")) value = JSON.parse(value);
    if (value !== null && numeric.has(key)) value = Number(value);
    return [key, value];
  })));
}
const [mannSql, fluidSql] = await Promise.all([
  readFile(arg("mann-sql", "/tmp/mann_filter_applications.sql"), "utf8"),
  readFile(arg("fluid-sql", "/tmp/vehicle_fluid_requirements.sql"), "utf8"),
]);
const mann = copy(mannSql, "mann_filter_applications");
const requirements = copy(fluidSql, "vehicle_fluid_requirements");
const byId = new Map(requirements.map(r => [r.id, r]));
const codeRoot = resolve(arg("code-root", root));
const jiti = createJiti(import.meta.url, { alias: {
  "@/lib/mann-vehicle-resolver": resolve(codeRoot, "src/lib/mann-vehicle-resolver.ts"),
  "@/lib/vehicle-normalization": resolve(codeRoot, "src/lib/vehicle-normalization.ts"),
  "@": resolve(root, "src"),
} });
const { matchFluidRequirementToMann, MANN_FLUID_MATCHER_VERSION } = await jiti.import(resolve(codeRoot, "src/lib/mann-fluid-matcher-v2.ts"));
const replay = [];
const scope = arg("scope", "initial-models");
assert.ok(["initial-models", "p1-next"].includes(scope));
const selected = decisions.filter(d => scope === "p1-next"
  ? p1ids.has(d.requirementId) && ((d.match.normalizedVehicle?.bodyCodes ?? []).some(c => /^\d+GEN$/.test(c))
    || (d.match.topCandidates[0]?.hardConflicts.includes("год") && !d.match.topCandidates[0]?.hardConflicts.includes("диапазон годов не пересекается")))
  : (d.requirement.make.toLowerCase() === "nissan" && /^x[ -]trail$/i.test(d.requirement.model))
    || (d.requirement.make.toLowerCase() === "volvo" && /^(s60|v60)$/i.test(d.requirement.model)));
for (const before of selected) {
  const requirement = byId.get(before.requirementId);
  assert.ok(requirement);
  const after = matchFluidRequirementToMann(requirement, mann);
  const top = after.topCandidates[0];
  replay.push({
    requirementId: before.requirementId, inP1: p1ids.has(before.requirementId),
    sourceUrl: before.source.sourceUrl, model: requirement.model, system: requirement.systemCode,
    before: { status: before.match.status, vehicle: before.match.normalizedVehicle, conflicts: before.match.topCandidates[0]?.hardConflicts },
    after: { status: after.status, vehicle: after.normalizedVehicle, conflicts: top?.hardConflicts, blockers: top?.reviewBlockers, targetIds: after.targets.map(t => t.vehicleVariantKey), topModel: top?.model, topYears: top?.vehicleYears },
    capacityNeedsReview: before.capacity.needsReview,
  });
}
const findings = {
  X_TRAIL_NAME_PARSED_AS_GENERATION: rows.filter(d => /^x[ -]trail$/i.test(d.requirement.model) && d.match.normalizedVehicle?.generation === "X"),
  COMBINED_MODEL_GENERATION_REQUIRES_SCOPING: rows.filter(d => d.requirement.model === "v60" && /^S60 II\/V60/.test(d.match.topCandidates[0]?.model ?? "") && d.match.topCandidates[0].hardConflicts.includes("поколение")),
  YEAR_MIDPOINT_CONFLICT_WITHOUT_DISJOINT_RANGE: rows.filter(d => { const c=d.match.topCandidates[0]; return c?.hardConflicts.includes("год") && !c.hardConflicts.includes("диапазон годов не пересекается"); }),
  SOURCE_PLACEHOLDER_BODY_CODE: rows.filter(d => (d.match.normalizedVehicle?.bodyCodes ?? []).some(c => /^\d+GEN$/.test(c)) && d.match.topCandidates[0]?.hardConflicts.includes("код кузова")),
};
const report = {
  artifactKind: "MANN_P1_OFFLINE_AUDIT", generatedAt: new Date().toISOString(), writeMode: "DRY_RUN_ONLY", productionApplyAllowed: false, codeRoot, scope, matcherVersion: MANN_FLUID_MATCHER_VERSION,
  sourceHashes: { mann: createHash("sha256").update(mannSql).digest("hex"), fluids: createHash("sha256").update(fluidSql).digest("hex") },
  counts: { batches: batches.length, contexts: contexts.length, requirements: rows.length },
  conflictCounts: distribution(rows, d => d.match.topCandidates[0]?.hardConflicts ?? []),
  blockerCounts: distribution(rows, d => d.match.topCandidates[0]?.reviewBlockers ?? []),
  findings: Object.fromEntries(Object.entries(findings).map(([key, ds]) => [key, { count: ds.length, requirementIds: ds.map(d=>d.requirementId), sourcePages: [...new Set(ds.map(d=>d.source.sourceUrl))] }])),
  replaySummary: { requirements: replay.length, p1: replay.filter(r=>r.inP1).length, before: distribution(replay,r=>[r.before.status]), after: distribution(replay,r=>[r.after.status]), transitions: distribution(replay,r=>[`${r.before.status} -> ${r.after.status}`]), byModel: Object.fromEntries([...Map.groupBy(replay,r=>r.model)].map(([model,items])=>[model,distribution(items,r=>[`${r.before.status} -> ${r.after.status}`])])) },
  replay,
};
await mkdir(output, {recursive:true});
await writeFile(resolve(output, "audit.json"), JSON.stringify(report,null,2)+"\n");
await writeFile(resolve(output, "README.md"), `# Разбор P1 — 13 сентября 2026\n\nПроверено ${rows.length} требований, ${contexts.length} автоконтекстов, ${batches.length} пакетов. Счётчики причин пересекаются.\n\n## Найденные причины\n\n${Object.entries(report.findings).map(([k,v])=>`- ${k}: ${v.count} требований, ${v.sourcePages.length} страниц.`).join("\n")}\n\n## Локальные исправления\n\nСохранено название X-Trail; X больше не становится поколением. В составных заголовках поколение берётся только из части соответствующей модели: S60 II не задаёт поколение V60. Неизвестное поколение остаётся неизвестным. Повторно рассчитано ${replay.length} требований X-Trail, S60 и V60 по полному офлайн-каталогу MANN.\n\n${Object.entries(report.replaySummary.byModel).map(([model,counts])=>`### ${model}\n\n${Object.entries(counts).map(([k,v])=>`- ${k}: ${v}`).join("\n")}`).join("\n\n")}\n\nЭто результат matcher, а не разрешение на перенос допусков: проверка объёмов, условий и общего плана выполняется отдельно. Старый план и Excel не перезаписаны. Другие причины — диагностические кандидаты; конфликты не сняты.\n`);
if (scope === "p1-next") await writeFile(resolve(output, "README.md"), `# Разбор годов и кодов кузова\n\nРежим: ${scope}. Версия: ${MANN_FLUID_MATCHER_VERSION}. Повторно рассчитано ${replay.length} требований P1.\n\nИсходные статусы в audit.json взяты из старого плана. Для оценки эффекта именно текущих изменений сравнивайте after двух отчётов baseline/audit.json и after/audit.json по requirementId.\n\nДиапазоны годов требуют отдельного ограничения применяемости при частичном покрытии. Новых записей в БД нет.\n`);
console.log(JSON.stringify({ ...report, replay: undefined, findings: Object.fromEntries(Object.entries(report.findings).map(([k,v])=>[k,{count:v.count,pages:v.sourcePages.length}])) },null,2));
