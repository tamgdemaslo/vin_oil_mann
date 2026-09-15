import assert from 'node:assert/strict';
import {sha} from './mann-offline-scope.mjs';
import {importSnapshotGuard} from './mann-import-snapshot-guard.mjs';
import {persistInsertedReceiptSql} from './mann-durable-import-receipt.mjs';

// SQL builder only: caller must verify provider, backup, deployed runtime and
// explicit authorization before execution. No fixture guard is removed/reused.
export function currentPreviewImport({payload,parents,snapshot,metadata}) {
 assert.equal(payload.productionApplyAllowed,false);assert.equal(payload.writeMode,'DRY_RUN_ONLY');
 assert.equal(parents.planHash,payload.planHash);assert.equal(parents.productionApplyAllowed,false);
 assert.match(metadata.gitCommit,/^[a-f0-9]{40}$/);assert.match(metadata.capacityParserVersion,/^sha256:[a-f0-9]{64}$/);
 assert.equal(metadata.matcherVersion,'mann-fluid-matcher-v11');assert.ok(Number.isSafeInteger(metadata.backupId)&&metadata.backupId>0);
 assert.equal(metadata.databaseName,snapshot.databaseName);
 const q=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`,s=v=>`'${String(v).replaceAll("'","''")}'`;
 const snake=k=>k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
 const fields=['id','sourceRequirementId','vehicleVariantKey','systemCode','componentModel','applicabilityJson','technicalDataJson','verifiedFieldsJson','fieldConfidenceJson','evidenceJson','provenanceJson','matchClass','matchScore','semanticFingerprint','state','verificationStatus','applyEligible'];
 const revisions=payload.revisions.map(item=>{const r=item.originalRevision;assert.equal(sha(r),item.originalRevisionHash);assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.deepEqual(r.verifiedFieldsJson,[]);assert.ok(['STAGED','REVIEW'].includes(r.state));return Object.fromEntries([...fields.map(k=>[snake(k),r[k]]),['run_id',item.runId],['supersedes_revision_id',null]]);});
 const runs=payload.runs.map(r=>{assert.equal(r.status,'PLANNED');assert.equal(r.independentHumanSignoff,false);assert.equal(r.productionApplyAuthorized,false);return {id:r.id,status:'RUNNING',mode:'STAGING',matcher_version:metadata.matcherVersion,capacity_parser_version:metadata.capacityParserVersion,git_commit:metadata.gitCommit,gates_json:r.gatesJson,source_snapshot_json:{planHash:payload.planHash,mannHash:payload.mannHash,sourceHash:payload.sourceHash,reviewedSnapshotHash:sha(snapshot)},approval_json:{reference:metadata.authorizationRef,scope:'CATALOG_PREVIEW_ONLY',backupId:metadata.backupId},independent_human_signoff:false,production_apply_authorized:false};});
 const vehicles=parents.drafts.map(d=>Object.fromEntries(Object.entries({...d.data,canonicalPayloadHash:d.canonicalPayloadHash}).map(([k,v])=>[snake(k),v])));
 const actions=payload.existingActions.filter(a=>a.action==='REPLACE_WITH_PREVIEW');
 assert.deepEqual([vehicles.length,runs.length,revisions.length,actions.length],[221,11,2049,319]);
 assert.equal(new Set(actions.map(a=>a.revisionId)).size,319);assert.equal(new Set(actions.map(a=>a.successorId)).size,319);
 for(const a of actions){assert.notEqual(a.revisionId,a.successorId);assert.ok(revisions.some(r=>r.id===a.successorId));}
 const specs=[['vehicles','mann_vehicle_variants','variant_key',vehicles],['runs','mann_technical_materialization_runs','id',runs],['revisions','mann_technical_association_revisions','id',revisions]];
 let sql=`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';
${importSnapshotGuard(snapshot)}
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='20260915130000_mann_technical_import_receipts' AND checksum='0f8113fffd7ccc75e1ed7b058337141e2e2c792ace6506e9a1d4ba8d0ad7bc56' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN RAISE EXCEPTION 'receipt migration not verified'; END IF; END $$;
CREATE TEMP TABLE _mann_inserted(kind text NOT NULL,id text NOT NULL,PRIMARY KEY(kind,id)) ON COMMIT DROP;
`;
 for(const [kind,table,id,rows] of specs){
  assert.equal(new Set(rows.map(r=>r[id])).size,rows.length);
  const columns=Object.keys(rows[0]);for(const row of rows)assert.deepEqual(Object.keys(row),columns);
  const extra=kind==='vehicles'?['first_seen_at','last_seen_at']:kind==='runs'?['started_at']:[];
  sql+=`CREATE TEMP TABLE _mann_expected_${kind} ON COMMIT DROP AS SELECT ${columns.join(',')} FROM ${table} WHERE FALSE;
INSERT INTO _mann_expected_${kind} SELECT ${columns.join(',')} FROM jsonb_populate_recordset(NULL::${table},${q(rows)});
WITH added AS (INSERT INTO ${table}(${[...columns,...extra].join(',')}) SELECT ${[...columns,...extra.map(()=>'CURRENT_TIMESTAMP')].join(',')} FROM _mann_expected_${kind} RETURNING ${id}) INSERT INTO _mann_inserted SELECT ${s(kind)},${id} FROM added;
`;
 }
 sql+=`CREATE TEMP TABLE _mann_replacements ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(${q(actions)}) AS a("revisionId" text,"successorId" text,"expectedState" text,"expectedSemanticFingerprint" text);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM _mann_replacements a
LEFT JOIN mann_technical_association_revisions old ON old.id=a."revisionId"
LEFT JOIN mann_technical_association_revisions new ON new.id=a."successorId"
WHERE old.id IS NULL OR new.id IS NULL OR old.state IS DISTINCT FROM a."expectedState" OR old.semantic_fingerprint IS DISTINCT FROM a."expectedSemanticFingerprint"
OR old.verification_status<>'UNVERIFIED' OR old.apply_eligible OR new.verification_status<>'UNVERIFIED' OR new.apply_eligible
OR new.supersedes_revision_id IS NOT NULL OR old.source_requirement_id<>new.source_requirement_id OR old.vehicle_variant_key<>new.vehicle_variant_key OR old.system_code<>new.system_code
OR EXISTS(SELECT 1 FROM mann_technical_review_decisions d WHERE d.revision_id IN(old.id,new.id))) THEN RAISE EXCEPTION 'replacement preconditions/reviews changed'; END IF; END $$;
CREATE TEMP TABLE _mann_changes(id text PRIMARY KEY,before_image jsonb NOT NULL,after_image jsonb) ON COMMIT DROP;
INSERT INTO _mann_changes SELECT id,to_jsonb(r),NULL FROM mann_technical_association_revisions r WHERE id IN(SELECT "revisionId" FROM _mann_replacements UNION SELECT "successorId" FROM _mann_replacements);
UPDATE mann_technical_association_revisions r SET state='SUPERSEDED' FROM _mann_replacements a WHERE r.id=a."revisionId";
UPDATE mann_technical_association_revisions r SET supersedes_revision_id=a."revisionId" FROM _mann_replacements a WHERE r.id=a."successorId";
UPDATE _mann_expected_revisions r SET supersedes_revision_id=a."revisionId" FROM _mann_replacements a WHERE r.id=a."successorId";
UPDATE _mann_changes j SET after_image=to_jsonb(r) FROM mann_technical_association_revisions r WHERE r.id=j.id;
UPDATE mann_technical_materialization_runs SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP WHERE id IN(SELECT id FROM _mann_inserted WHERE kind='runs');
UPDATE _mann_expected_runs SET status='COMPLETED';
`;
 for(const [kind,table,id,rows] of specs){
  const projection=alias=>`jsonb_build_array(${Object.keys(rows[0]).map(k=>`${alias}.${k}`).join(',')})`;
  sql+=`DO $$ BEGIN IF (SELECT count(*) FROM _mann_inserted WHERE kind=${s(kind)})<>${rows.length} OR EXISTS(SELECT 1 FROM _mann_expected_${kind} e LEFT JOIN ${table} r ON r.${id}=e.${id} WHERE ${projection('r')} IS DISTINCT FROM ${projection('e')}) THEN RAISE EXCEPTION 'persisted ${kind} mismatch'; END IF; END $$;\n`;
 }
 sql+=`DO $$ BEGIN IF (SELECT count(*) FROM _mann_changes)<>638 THEN RAISE EXCEPTION 'replacement journal count mismatch'; END IF; END $$;
CREATE TEMP TABLE _mann_current_receipt ON COMMIT DROP AS SELECT jsonb_build_object('kind','INSERTED_ROWS_WITH_REVISION_CHANGES','planSha256',${s(payload.planHash)},
${specs.map(([kind,table,id])=>`${s(kind)},(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.${id}) FROM ${table} r JOIN _mann_inserted i ON i.kind=${s(kind)} AND i.id=r.${id})`).join(',')},
'revisionChanges',(SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM _mann_changes j)) AS journal;
${persistInsertedReceiptSql({batchId:metadata.batchId,planHash:payload.planHash,authorizationRef:metadata.authorizationRef,receiptRelation:'_mann_current_receipt'})}
COMMIT;`;
 return {sql,counts:[vehicles.length,runs.length,revisions.length],replacementCount:319};
}
