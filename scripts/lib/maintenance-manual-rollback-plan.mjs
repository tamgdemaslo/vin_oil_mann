import {createHash} from 'node:crypto';
const canonical=value=>value instanceof Date?value.toISOString():Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export const rollbackHash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const METHOD='MANUAL_SELECTED_MANN_RESEARCH_V1';
export function manualRollbackTargets(audits){
 const target={evidence:[],requirements:[],links:[],sources:[]},owner=new Map();
 for(const audit of audits){if(audit.kind!=='MANUAL_MAINTENANCE_SOURCE_IMPORT_V1'||audit.mode!=='apply')throw new Error('Applied manual import audit required');
 for(const r of audit.results??[]){if(r.status!=='IMPORTED_REVIEW_REQUIRED')continue;if(!r.after||!r.before)throw new Error('Missing before/after receipt');
 for(const [kind,field]of [['requirements','requirementIds'],['links','linkIds'],['sources','sourceIds']])for(const id of r.after[field]??[]){if((r.before[field]??[]).includes(id))continue;target[kind].push(id);owner.set(id,{evidenceId:r.evidenceId,organizationId:r.organizationId,branchId:r.branchId,variantKeys:r.variantKeys,acceptedItems:r.acceptedItems});}
 if(!r.before.evidence){target.evidence.push(r.evidenceId);owner.set(r.evidenceId,{evidenceId:r.evidenceId,organizationId:r.organizationId,branchId:r.branchId,variantKeys:r.variantKeys,acceptedItems:r.acceptedItems});}
 }}for(const k of Object.keys(target))target[k]=[...new Set(target[k])].sort();return {target,owner};
}
export function buildManualRollbackPlan(audits,snapshot){
 const {target,owner}=manualRollbackTargets(audits),blocks=[],guards={},tableRows={links:snapshot.links,requirements:snapshot.requirements,sources:snapshot.sources,evidence:snapshot.evidence};
 const check=(ok,id,reason)=>{if(!ok)blocks.push({id,reason});};
 for(const kind of ['links','requirements','sources','evidence']){
 guards[kind]=[];for(const id of target[kind]){const row=(tableRows[kind]??[]).find(x=>x.id===id),o=owner.get(id);if(!row){blocks.push({id,reason:'ROW_MISSING'});continue;}
 if(kind==='evidence'){check(row.organizationId===o.organizationId&&row.branchId===o.branchId,id,'EVIDENCE_TENANT_MISMATCH');check(row.factType==='MANUAL_VIN_FLUID_SOURCE_REVIEW_V1'&&row.status==='pending_review'&&!row.invalidatedAt,id,'EVIDENCE_STATUS_CHANGED');check(row.facts?.sourceKind==='manual_source_review'&&row.facts?.reviewRequired===true,id,'EVIDENCE_PROVENANCE_CHANGED');check(same(row.facts?.items,o.acceptedItems),id,'EVIDENCE_ITEMS_CHANGED');}
 else {const p=kind==='links'?row.evidenceJson:kind==='requirements'?row.rawRequirementJson:row.parsedRowJson;check(p?.method===METHOD&&p?.sourceKind==='manual_source_review'&&p?.organizationId===o.organizationId&&p?.evidenceId===o.evidenceId,id,'PROVENANCE_MISMATCH');check(same(p?.variantKeys,[...o.variantKeys].sort()),id,'VARIANT_SCOPE_CHANGED');check(o.acceptedItems.some(i=>same(i,p?.item)),id,'SOURCE_ITEM_CHANGED');
 if(kind==='links')check(row.matchMethod===METHOD&&row.status==='review_required'&&row.confidence==='manual_source_review'&&!row.confirmedAt&&!row.confirmedById,id,'LINK_APPROVED_OR_CHANGED');
 if(kind==='requirements')check(row.sourceTableKey===METHOD&&row.contextConfidence==='manual_source_review'&&row.sourceUrl===p?.item?.sourceUrl&&row.specificationText===(p?.item?.specification||null)&&row.fillVolumeText===(p?.item?.volumeText||null),id,'REQUIREMENT_FIELDS_CHANGED');
 if(kind==='sources')check(row.tableKind==='manual_source_review'&&row.sourceUrl===p?.item?.sourceUrl&&row.pageTitle===p?.item?.sourceTitle&&same(row.rawCellsJson,[p?.item?.specification,p?.item?.volumeText,p?.item?.excerpt]),id,'SOURCE_FIELDS_CHANGED');}
 if(row.updatedAt&&row.createdAt)check(new Date(row.updatedAt).getTime()===new Date(row.createdAt).getTime(),id,'ROW_UPDATED_AFTER_CREATION');
 guards[kind].push({id,organizationId:o.organizationId,evidenceId:o.evidenceId,expectedCurrentHash:rollbackHash(row),expectedCurrentRow:row});
 }}
 for(const ref of snapshot.externalReferences??[])blocks.push({id:ref.id,reason:'EXTERNAL_REFERENCE',reference:ref});
 // Old receipts contain IDs only, so current hashes cannot prove historical immutability.
 const historicalHashAssurance=audits.every(a=>a.results.filter(r=>r.status==='IMPORTED_REVIEW_REQUIRED').every(r=>r.after?.rowHashes));
 if(!historicalHashAssurance)blocks.push({id:null,reason:'IMPORT_TIME_ROW_HASHES_NOT_RECORDED',detail:'Current exact row images are captured for a future drift guard; they are not import-time evidence.'});
 return {kind:'MANUAL_MAINTENANCE_ROLLBACK_PLAN_V1',generatedAt:new Date().toISOString(),databaseReadOnly:snapshot.readOnly===true,applySupported:false,readyForAutomaticDeletion:false,sourceAuditHashes:audits.map(rollbackHash),targetCounts:Object.fromEntries(Object.entries(target).map(([k,v])=>[k,v.length])),deleteOrder:['links','requirements','sources','evidence'],guards,blocks,historicalHashAssurance,executionRequirements:['Separate explicit execution approval; this script has no apply mode.','Re-read in one transaction and compare every full current-row hash before deletion; recheck references and acquire tenant/evidence advisory lock.','Delete exact inserted IDs only, with org+method+evidence guards, links first. Never delete preexisting receipt IDs or invalidate evidence as a substitute for unlinking.']};
}
