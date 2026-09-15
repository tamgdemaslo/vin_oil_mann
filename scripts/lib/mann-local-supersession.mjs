import assert from 'node:assert/strict';
const q=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const guard=`DO $$ BEGIN IF current_database()<>'mann_fixture' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL FIXTURE ONLY'; END IF; END $$;`;
export function localSupersession(payload,expectedCount=307){
 const actions=payload.existingActions.filter(a=>a.action==='REPLACE_WITH_PREVIEW');
 assert.ok(Number.isInteger(expectedCount)&&expectedCount>0);assert.equal(actions.length,expectedCount);assert.equal(new Set(actions.map(a=>a.successorId)).size,actions.length);
 assert.equal(new Set(actions.map(a=>a.revisionId)).size,actions.length);
 assert.ok(actions.every(a=>a.revisionId!==a.successorId));
 for(const a of actions)assert.ok(payload.revisions.some(r=>r.originalRevision.id===a.successorId));
 const apply=`BEGIN;
 ${guard}
 LOCK TABLE mann_technical_association_revisions,mann_technical_review_decisions IN EXCLUSIVE MODE;
 CREATE TEMP TABLE replacements ON COMMIT DROP AS SELECT * FROM jsonb_to_recordset(${q(actions)}) AS a("revisionId" text,"successorId" text,"expectedState" text,"expectedSemanticFingerprint" text);
 DO $$ BEGIN IF EXISTS (
 SELECT 1 FROM replacements a
 LEFT JOIN mann_technical_association_revisions old ON old.id=a."revisionId"
 LEFT JOIN mann_technical_association_revisions new ON new.id=a."successorId"
 WHERE old.id IS NULL OR new.id IS NULL
 OR old.state IS DISTINCT FROM a."expectedState" OR old.semantic_fingerprint IS DISTINCT FROM a."expectedSemanticFingerprint"
 OR old.verification_status<>'UNVERIFIED' OR old.apply_eligible OR new.verification_status<>'UNVERIFIED' OR new.apply_eligible
 OR new.supersedes_revision_id IS NOT NULL OR old.source_requirement_id<>new.source_requirement_id OR old.vehicle_variant_key<>new.vehicle_variant_key OR old.system_code<>new.system_code
 OR EXISTS(SELECT 1 FROM mann_technical_review_decisions d WHERE d.revision_id IN(old.id,new.id) AND d.decision='CONFIRM')
 ) THEN RAISE EXCEPTION 'Supersession precondition/protected review mismatch'; END IF; END $$;
 CREATE TABLE mann_local_supersession_journal(id text PRIMARY KEY,before_image jsonb NOT NULL,after_image jsonb);
 INSERT INTO mann_local_supersession_journal SELECT r.id,to_jsonb(r),NULL FROM mann_technical_association_revisions r WHERE r.id IN (SELECT "revisionId" FROM replacements UNION SELECT "successorId" FROM replacements);
 UPDATE mann_technical_association_revisions r SET state='SUPERSEDED' FROM replacements a WHERE r.id=a."revisionId";
 UPDATE mann_technical_association_revisions r SET supersedes_revision_id=a."revisionId" FROM replacements a WHERE r.id=a."successorId";
 UPDATE mann_local_supersession_journal j SET after_image=to_jsonb(r) FROM mann_technical_association_revisions r WHERE r.id=j.id;
 COMMIT;`;
 const rollback=`BEGIN;
 ${guard}
 LOCK TABLE mann_technical_association_revisions,mann_technical_review_decisions IN EXCLUSIVE MODE;
 DO $$ BEGIN IF EXISTS(SELECT 1 FROM mann_local_supersession_journal j LEFT JOIN mann_technical_association_revisions r ON r.id=j.id WHERE to_jsonb(r) IS DISTINCT FROM j.after_image) OR EXISTS(SELECT 1 FROM mann_technical_review_decisions d JOIN mann_local_supersession_journal j ON j.id=d.revision_id WHERE d.decision='CONFIRM') THEN RAISE EXCEPTION 'Supersession rollback refused: row changed or confirmed'; END IF; END $$;
 UPDATE mann_technical_association_revisions r SET state=j.before_image->>'state',supersedes_revision_id=j.before_image->>'supersedes_revision_id' FROM mann_local_supersession_journal j WHERE r.id=j.id;
 DROP TABLE mann_local_supersession_journal;
 COMMIT;`;
 return {apply,rollback,count:actions.length};
}
