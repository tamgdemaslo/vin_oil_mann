#!/usr/bin/env node
import assert from "node:assert/strict";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { resolve } from "node:path";
import { createJiti } from "jiti";
import { applicabilityWindow, parseCopy, sha, YEAR_BLOCKER, originalAssociationFingerprint } from "./lib/mann-offline-scope.mjs";
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';

const root = resolve(import.meta.dirname, "..");
const arg = (name, fallback) => process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3) ?? fallback;
if (process.argv.some(x=>/^--(?:apply|write-db|production|activate)(?:=|$)/.test(x))) throw new Error("Offline preview only");
const settings = isMainThread ? {
  mann:arg("mann-sql", "/tmp/mann_filter_applications.sql"),
  fluids:arg("fluid-sql", "/tmp/vehicle_fluid_requirements.sql"),
  output:resolve(root,arg("output-dir","outputs/mann-scoped-full-2026-09-13")),
  workers:Number(arg("workers","3")),
  identityCorrections:arg('identity-corrections',null),
  oldDecisions:resolve(root,arg("old-decisions","outputs/mann-technical-catalog-v9-timeweb-backup-20260823-190344/mann-technical-requirement-decisions.ndjson")),
} : workerData.settings;
const confirmed = decision => ["CONFIRMED_SINGLE","CONFIRMED_MULTI_APPLICABILITY"].includes(decision.status);
async function emit(stream, record) { if (!stream.write(JSON.stringify(record)+"\n")) await once(stream,"drain"); }
async function* records(file) { for await (const line of createInterface({input:createReadStream(file),crlfDelay:Infinity})) if (line.trim()) yield JSON.parse(line); }

if (!isMainThread) {
  const jiti = createJiti(import.meta.url,{alias:{"@":resolve(root,"src")}});
  const {matchFluidRequirementToMann, normalizeFluidRequirementVehicle, MANN_FLUID_MATCHER_VERSION} = await jiti.import("../src/lib/mann-fluid-matcher-v2.ts");
  const {parseFluidCapacities} = await jiti.import("../src/lib/fluid-capacity-parser.ts");
  const {mannMakeFormsForTest} = await jiti.import("../src/lib/mann-vehicle-resolver.ts");
  const {normalizeMannText} = await jiti.import("../src/lib/mann-catalog.ts");
  const {normalizeEngineCode} = await jiti.import("../src/lib/vehicle-normalization.ts");
  const mann = parseCopy(await readFile(settings.mann,"utf8"),"mann_filter_applications");
  const overlay = await loadIdentityOverlay(root,await readFile(settings.fluids,'utf8'),settings.identityCorrections,settings.identityCorrectionHash);
  const requirements = overlay.requirements;
  const denylist = JSON.parse(await readFile(resolve(root,"data/mann-technical-association-denylist-v1.json"),"utf8"));
  const rejected = new Set(denylist.rejectedAssociationFingerprints);
  const byVariant = Map.groupBy(mann,r=>r.vehicleVariantKey);
  const makeCache = new Map();
  const rowsFor = r => {
    const make = normalizeFluidRequirementVehicle(r)?.canonicalMake ?? "";
    if (!makeCache.has(make)) { const forms=new Set(mannMakeFormsForTest(make)); makeCache.set(make,mann.filter(row=>forms.has(normalizeMannText(row.makeNormalized || row.make)))); }
    return makeCache.get(make);
  };
  function windowFor(r, key) {
    const windows = (byVariant.get(key) ?? []).map(row=>applicabilityWindow(r,row));
    if (!windows.length || windows.some(w=>!w)) return null;
    if (new Set(windows.map(w=>JSON.stringify(w))).size !== 1) return null;
    return windows[0];
  }
  const stream = createWriteStream(resolve(settings.output,`part-${workerData.index}.ndjson`),{flags:"wx"});
  let completed=0;
  for (let i=workerData.index;i<requirements.length;i+=settings.workers) {
    const r=requirements[i], catalog=rowsFor(r), match=matchFluidRequirementToMann(r,catalog);
    const capacity=parseFluidCapacities(r.fillVolumeText,r.systemCode);
    const blockers=[], proposals=new Map(), attempts=new Map();
    if (capacity.needsReview) blockers.push("CAPACITY_REQUIRES_REVIEW");
    if (!r.specificationText?.trim() && !(r.specificationsJson ?? []).length) blockers.push("MISSING_SPECIFICATION");
    const sourceEngines=[...new Set([r.engineCodeNormalized,...(r.engineCodesJson ?? [])].filter(Boolean))];
    // Month windows are proposals only, never directly published by this tool.
    const retain = (decision, expectedKeys = null, matchedEngineScope = null) => {
      if (!confirmed(decision)) return;
      for (const target of decision.targets) {
        if (expectedKeys && !expectedKeys.has(target.vehicleVariantKey)) continue;
        if (!target.independentlyValidated || target.hardConflicts.length || target.reviewBlockers.length) continue;
        if (sourceEngines.length && !target.matchedFields.includes("точный код двигателя")) { blockers.push("EXACT_SOURCE_ENGINE_REQUIRED"); continue; }
        const window=windowFor(r,target.vehicleVariantKey);
        if (!window) {blockers.push("MONTH_RANGE_UNKNOWN_OR_INCONSISTENT");continue;}
        const fingerprint=originalAssociationFingerprint(target.vehicleVariantKey,overlay.originalById.get(r.id),capacity);
        if (rejected.has(fingerprint)) {blockers.push("PREVIOUSLY_REJECTED_ASSOCIATION");continue;}
        const proposal={
          requirementId:r.id, vehicleVariantKey:target.vehicleVariantKey,
          originalAssociationFingerprint:fingerprint,
          sourceIdentityCorrection:overlay.changes.has(r.id) ? {artifactSha256:overlay.metadata.sha256,requirementId:r.id,fields:overlay.changes.get(r.id).after} : null,
          originalApplicability:{yearFrom:r.yearFrom,yearTo:r.yearTo,engineCodes:sourceEngines,transmissionType:r.transmissionType,driveType:r.driveType,componentModel:r.componentModel},
          matchedEngineScope,
          window, validation:{matcherVersion:MANN_FLUID_MATCHER_VERSION,matchStatus:decision.status,target,capacityNeedsReview:false},
          sourceUrl:r.sourceUrl, systemCode:r.systemCode,
          unresolvedSourceConditionsPreserved:true,
          publicationAllowed:false, requiresSourceTechnicalReview:true,
        };
        if(!proposals.has(target.vehicleVariantKey))proposals.set(target.vehicleVariantKey,proposal);
      }
    };
    if (!blockers.length) {
      retain(match);
      if (!confirmed(match)) {
        for (const candidate of match.topCandidates) {
          if (candidate.hardConflicts.length || candidate.reviewBlockers.length!==1 || candidate.reviewBlockers[0]!==YEAR_BLOCKER) continue;
          if (sourceEngines.length && !candidate.matchedFields.includes("точный код двигателя")) continue;
          for (const key of candidate.variantIds) {
            const window=windowFor(r,key);
            if (!window || !window.restricted) continue;
            const cacheKey=JSON.stringify(window.narrowedYears);
            if (!attempts.has(cacheKey)) attempts.set(cacheKey,matchFluidRequirementToMann({...r,...window.narrowedYears},catalog));
            retain(attempts.get(cacheKey),new Set([key]));
          }
        }
        // A source may cover several explicitly listed engines with different
        // production intervals. Recheck each engine independently against the
        // entire make catalogue, retaining only the intended variant. Never
        // relax any aggregate/condition blocker or the large engine-list gate.
        const exactCodes=normalizeFluidRequirementVehicle(r)?.sourceExactEngineCodes??[];
        if(exactCodes.length>1 && exactCodes.length<5){
          for(const candidate of match.topCandidates){
            if(candidate.hardConflicts.length || candidate.reviewBlockers.some(b=>b!==YEAR_BLOCKER))continue;
            for(const key of candidate.variantIds){
              const window=windowFor(r,key);if(!window)continue;
              const variantRows=byVariant.get(key)??[];
              const codes=exactCodes.filter(code=>variantRows.every(row=>String(row.engineCode??'').split(/[;,/|]+/).map(normalizeEngineCode).includes(code)));
              for(const code of codes){
                const cacheKey=JSON.stringify({years:window.narrowedYears,engine:code});
                if(!attempts.has(cacheKey))attempts.set(cacheKey,matchFluidRequirementToMann({...r,...window.narrowedYears,engineCodeNormalized:code,engineCodesJson:[code]},catalog));
                retain(attempts.get(cacheKey),new Set([key]),[code]);
              }
            }
          }
        }
      }
    }
    const list=[...proposals.values()];
    const deferred=["MANN_CATALOG_GAP","NO_MATCH","INSUFFICIENT_SOURCE_CONTEXT"].includes(match.status);
    const disposition=list.length ? (list.some(p=>p.window.restricted)?"DATE_SCOPED_PREVIEW":"MATCHED_PREVIEW") : deferred?"DEFERRED":"REVIEW";
    await emit(stream,{
      requirementId:r.id,sourceUrl:r.sourceUrl,
      sourceIdentityCorrection:overlay.changes.has(r.id) ? {artifactSha256:overlay.metadata.sha256,...overlay.changes.get(r.id)} : null,
      vehicle:{make:r.make,model:r.model,generation:r.generation,years:[r.yearFrom,r.yearTo],engineCode:r.engineCodeNormalized,engineCodes:sourceEngines,engineVolumeCc:r.engineVolumeCc,powerHp:r.powerHp,powerKw:r.powerKw,fuelType:r.fuelType},
      systemCode:r.systemCode,componentModel:r.componentModel,transmissionType:r.transmissionType,driveType:r.driveType,
      technical:{fillVolumeText:r.fillVolumeText,specificationText:r.specificationText,viscosityGrades:r.viscosityGradesJson,replacementIntervalText:r.replacementIntervalText},
      match,capacity,disposition,blockers:[...new Set(blockers)],scopedAttempts:attempts.size,proposals:list,
    });
    completed++;
    if (completed%100===0) parentPort.postMessage({processed:completed});
  }
  stream.end();await once(stream,"finish");parentPort.postMessage({processed:completed,done:true});
} else {
  assert.ok(Number.isInteger(settings.workers)&&settings.workers>=1&&settings.workers<=4);
  // Fail instead of overwriting an earlier run or a user's edited queue.
  await mkdir(settings.output,{recursive:false});
  const [mannRaw,fluidRaw]=await Promise.all([readFile(settings.mann,"utf8"),readFile(settings.fluids,"utf8")]);
  const requirements=parseCopy(fluidRaw,"vehicle_fluid_requirements");
  const overlay=await loadIdentityOverlay(root,fluidRaw,settings.identityCorrections);
  if(overlay.metadata){
    const correctionRaw=await readFile(overlay.metadata.path,'utf8');
    settings.identityCorrections=resolve(settings.output,'source-identity-corrections.json');
    settings.identityCorrectionHash=overlay.metadata.sha256;
    await writeFile(settings.identityCorrections,correctionRaw,{flag:'wx'});
  }
  const ids=new Set(requirements.map(r=>r.id));assert.equal(ids.size,requirements.length);
  const previous=new Map();for await (const row of records(settings.oldDecisions)) previous.set(row.requirementId,row.match.status);
  assert.equal(previous.size,ids.size);for(const id of ids) assert.ok(previous.has(id));
  const progress=Array(settings.workers).fill(0);
  await Promise.all(progress.map((_,index)=>new Promise((accept,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{settings,index}});
    worker.on("message",message=>{progress[index]=message.processed;console.log(JSON.stringify({progress:progress.reduce((a,b)=>a+b,0),total:requirements.length,worker:index}));});
    worker.on("error",reject);worker.on("exit",code=>code===0?accept():reject(new Error(`Worker ${index} exited ${code}`)));
  })));
  const counts={},statuses={},transitions={},seen=new Set(),queue=[],contexts=new Map();
  const all=createWriteStream(resolve(settings.output,"decisions.ndjson"),{flags:"wx"});
  const links=createWriteStream(resolve(settings.output,"scoped-proposals.ndjson"),{flags:"wx"});
  let proposalCount=0;
  for(let i=0;i<settings.workers;i++)for await(const row of records(resolve(settings.output,`part-${i}.ndjson`))){
    assert.ok(ids.has(row.requirementId)&&!seen.has(row.requirementId));seen.add(row.requirementId);
    counts[row.disposition]=(counts[row.disposition]??0)+1;statuses[row.match.status]=(statuses[row.match.status]??0)+1;
    const transition=`${previous.get(row.requirementId)} -> ${row.match.status}`;transitions[transition]=(transitions[transition]??0)+1;
    await emit(all,row);
    for(const proposal of row.proposals){assert.equal(proposal.publicationAllowed,false);await emit(links,proposal);proposalCount++;}
    const compact={...row,match:undefined,capacity:undefined,proposals:row.proposals.map(p=>({vehicleVariantKey:p.vehicleVariantKey,matchedEngineScope:p.matchedEngineScope,window:p.window})),matchStatus:row.match.status,reviewReasons:[...new Set([...row.blockers,...row.match.reviewReasons,...(row.match.topCandidates[0]?.hardConflicts??[]),...(row.match.topCandidates[0]?.reviewBlockers??[])])]};
    queue.push(compact);
    if(row.disposition==="REVIEW"){
      const key=sha({sourceUrl:row.sourceUrl,vehicle:row.vehicle});
      const c=contexts.get(key)??{id:key,sourceUrl:row.sourceUrl,vehicle:row.vehicle,requirementIds:[],systems:[],reasons:[]};
      c.requirementIds.push(row.requirementId);c.systems=[...new Set([...c.systems,row.systemCode])];c.reasons=[...new Set([...c.reasons,...compact.reviewReasons])];contexts.set(key,c);
    }
  }
  all.end();links.end();await Promise.all([once(all,"finish"),once(links,"finish")]);assert.equal(seen.size,ids.size);
  const batches=[...Map.groupBy([...contexts.values()],c=>c.sourceUrl)].map(([sourceUrl,cs])=>({sourceUrl,contextIds:cs.map(c=>c.id),requirements:cs.reduce((sum,c)=>sum+c.requirementIds.length,0)})).sort((a,b)=>b.requirements-a.requirements);
  const sourceFiles=["src/lib/mann-fluid-matcher-v2.ts","src/lib/mann-vehicle-resolver.ts","src/lib/vehicle-normalization.ts","src/lib/fluid-catalog.ts","scripts/lib/mann-source-identity-overlay.mjs","scripts/lib/mann-offline-scope.mjs","scripts/recalculate-mann-scoped-queue.mjs"];
  const codeHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async p=>[p,sha(await readFile(resolve(root,p),"utf8"))])));
  const summary={artifactKind:"MANN_FULL_SCOPED_OFFLINE_QUEUE",writeMode:"DRY_RUN_ONLY",productionApplyAllowed:false,generatedAt:new Date().toISOString(),sourceHashes:{mann:sha(mannRaw),fluids:sha(fluidRaw)},codeHashes,requirements:seen.size,counts,matchStatuses:statuses,transitions,proposals:proposalCount,reviewContexts:contexts.size,reviewBatches:batches.length,notes:["Preview only: technical source conditions and OEM validation remain required","Scope precision is month; source years retained","Counts partition requirements, not vehicles or source pages","Old second-pass links are not grandfathered"]};
  summary.identityCorrections=overlay.metadata ? {...overlay.metadata,path:settings.identityCorrections} : null;
  await writeFile(resolve(settings.output,"summary.json"),JSON.stringify(summary,null,2)+"\n");
  await writeFile(resolve(settings.output,"queue.json"),JSON.stringify({summary,requirements:queue,reviewContexts:[...contexts.values()],reviewBatches:batches},null,2)+"\n");
  console.log(JSON.stringify(summary,null,2));
}
