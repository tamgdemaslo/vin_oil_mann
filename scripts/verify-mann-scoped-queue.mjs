#!/usr/bin/env node
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {createInterface} from "node:readline";
import {resolve} from "node:path";
import {parseCopy,sha,originalAssociationFingerprint} from "./lib/mann-offline-scope.mjs";
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,"..");
const output=resolve(root,process.argv[2]??"outputs/mann-scoped-full-2026-09-13");
const summary=JSON.parse(await readFile(resolve(output,"summary.json"),"utf8"));
const [mannRaw,fluidRaw]=await Promise.all([readFile("/tmp/mann_filter_applications.sql","utf8"),readFile("/tmp/vehicle_fluid_requirements.sql","utf8")]);
assert.deepEqual(summary.sourceHashes,{mann:sha(mannRaw),fluids:sha(fluidRaw)});
for(const [file,hash] of Object.entries(summary.codeHashes))assert.equal(sha(await readFile(resolve(root,file),"utf8")),hash,`code changed: ${file}`);
const overlay=await loadIdentityOverlay(root,fluidRaw,summary.identityCorrections?.path,summary.identityCorrections?.sha256);
const requirements=new Map(overlay.requirements.map(r=>[r.id,r]));
const variants=Map.groupBy(parseCopy(mannRaw,"mann_filter_applications"),r=>r.vehicleVariantKey);
const deny=new Set(JSON.parse(await readFile(resolve(root,"data/mann-technical-association-denylist-v1.json"),"utf8")).rejectedAssociationFingerprints);
const seen=new Set(), links=new Set(), linkHashes=new Map(), reviewExpected=new Set(), counts={};let scoped=0;
const compactProposals = new Map();
const monthNumber=s=>{assert.match(s,/^\d{4}-(0[1-9]|1[0-2])$/);const [y,m]=s.split("-").map(Number);return y*12+m;};
for await(const line of createInterface({input:createReadStream(resolve(output,"decisions.ndjson")),crlfDelay:Infinity})){
  if(!line.trim())continue;const row=JSON.parse(line),r=requirements.get(row.requirementId);
  assert.ok(r&&!seen.has(r.id));seen.add(r.id);counts[row.disposition]=(counts[row.disposition]??0)+1;
  compactProposals.set(r.id, row.proposals.map(p=>({vehicleVariantKey:p.vehicleVariantKey,matchedEngineScope:p.matchedEngineScope,window:p.window})));
  if(row.disposition==="REVIEW")reviewExpected.add(r.id);
  assert.deepEqual(row.vehicle.years,[r.yearFrom,r.yearTo]);
  assert.equal(row.vehicle.generation,r.generation);
  assert.deepEqual(row.sourceIdentityCorrection ?? null,overlay.changes.has(r.id) ? {artifactSha256:overlay.metadata.sha256,...overlay.changes.get(r.id)} : null);
  if(r.rawRequirementJson?.sourceIdentity?.reviewRequired)assert.equal(row.proposals.length,0);
  assert.equal(row.technical.fillVolumeText,r.fillVolumeText);assert.equal(row.technical.specificationText,r.specificationText);
  if(row.proposals.length)assert.equal(row.capacity.needsReview,false);
  for(const p of row.proposals){
    const key=`${r.id}:${p.vehicleVariantKey}`;assert.ok(!links.has(key));links.add(key);
    linkHashes.set(key,sha(p));
    assert.ok(variants.has(p.vehicleVariantKey));assert.equal(p.requirementId,r.id);
    assert.equal(p.publicationAllowed,false);assert.equal(p.requiresSourceTechnicalReview,true);
    const t=p.validation.target;assert.equal(t.vehicleVariantKey,p.vehicleVariantKey);
    assert.equal(t.independentlyValidated,true);assert.deepEqual(t.hardConflicts,[]);assert.deepEqual(t.reviewBlockers,[]);
    assert.equal(p.originalApplicability.yearFrom,r.yearFrom);assert.equal(p.originalApplicability.yearTo,r.yearTo);
    assert.equal(p.originalApplicability.componentModel,r.componentModel);
    const fingerprint=originalAssociationFingerprint(p.vehicleVariantKey,overlay.originalById.get(r.id),row.capacity);
    assert.deepEqual(p.sourceIdentityCorrection ?? null,overlay.changes.has(r.id) ? {artifactSha256:overlay.metadata.sha256,requirementId:r.id,fields:overlay.changes.get(r.id).after} : null);
    assert.equal(p.originalAssociationFingerprint,fingerprint);assert.ok(!deny.has(fingerprint));
    const w=p.window;
    const sourceFrom=r.yearFrom==null?-Infinity:r.yearFrom*12+1,sourceTo=r.yearTo==null?Infinity:r.yearTo*12+12;
    const mannFrom=w.mann.from==null?-Infinity:monthNumber(w.mann.from),mannTo=w.mann.to==null?Infinity:monthNumber(w.mann.to);
    const lower=Math.max(sourceFrom,mannFrom),upper=Math.min(sourceTo,mannTo);
    assert.ok(lower<=upper);
    assert.equal(w.intersection.from==null?-Infinity:monthNumber(w.intersection.from),lower);
    assert.equal(w.intersection.to==null?Infinity:monthNumber(w.intersection.to),upper);
    assert.equal(w.restricted,lower!==sourceFrom||upper!==sourceTo);
    if(w.restricted)scoped++;
    // Verify the month text against the catalogue, independently of source bounds.
    for(const catalogRow of variants.get(p.vehicleVariantKey)){
      assert.equal(w.mann.raw,catalogRow.vehicleYears.trim());
      const tokens=[...catalogRow.vehicleYears.matchAll(/(\d{1,2})\/(\d{2}|\d{4})/g)];
      if(catalogRow.vehicleYearFrom!=null){assert.equal(w.mann.from,`${catalogRow.vehicleYearFrom}-${tokens[0][1].padStart(2,"0")}`);}
      if(catalogRow.vehicleYearTo!=null){assert.equal(w.mann.to,`${catalogRow.vehicleYearTo}-${tokens.at(-1)[1].padStart(2,"0")}`);}
    }
  }
  assert.equal(["MATCHED_PREVIEW","DATE_SCOPED_PREVIEW"].includes(row.disposition),row.proposals.length>0);
  if(row.disposition==="MATCHED_PREVIEW")assert.ok(row.proposals.every(p=>!p.window.restricted));
}
assert.equal(seen.size,requirements.size);assert.equal(seen.size,summary.requirements);assert.equal(links.size,summary.proposals);assert.deepEqual(counts,summary.counts);
const exportedLinks=new Set();
for await(const line of createInterface({input:createReadStream(resolve(output,"scoped-proposals.ndjson")),crlfDelay:Infinity})){
  if(!line.trim())continue;const p=JSON.parse(line),key=`${p.requirementId}:${p.vehicleVariantKey}`;
  assert.ok(!exportedLinks.has(key));exportedLinks.add(key);assert.equal(sha(p),linkHashes.get(key));
}
assert.deepEqual(exportedLinks,links);
const queue=JSON.parse(await readFile(resolve(output,"queue.json"),"utf8"));
assert.equal(queue.requirements.length,seen.size);assert.deepEqual(new Set(queue.requirements.map(r=>r.requirementId)),seen);
for (const row of queue.requirements) assert.deepEqual(row.proposals, compactProposals.get(row.requirementId), `Compact scope loss: ${row.requirementId}`);
const reviewIds=queue.reviewContexts.flatMap(c=>c.requirementIds);
assert.equal(new Set(reviewIds).size,reviewIds.length);assert.equal(reviewIds.length,counts.REVIEW);
assert.deepEqual(new Set(reviewIds),reviewExpected);
assert.equal(queue.reviewBatches.reduce((n,b)=>n+b.requirements,0),counts.REVIEW);
const report={result:"PASS_FOR_OFFLINE_REVIEW_ONLY",requirements:seen.size,proposals:links.size,dateScopedProposals:scoped,partition:counts,issueCount:0,productionApplyAllowed:false,generatedAt:new Date().toISOString()};
await writeFile(resolve(output,"verification.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
