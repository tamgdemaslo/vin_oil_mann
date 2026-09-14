import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const hash=b=>createHash('sha256').update(b).digest('hex');
const pdfPath='tmp/pdfs/solaris-manual-evidence-2026-09-14/solaris-2011-2014.pdf';
const pdfHash=hash(await readFile(resolve(root,pdfPath)));
assert.equal(pdfHash,'acb60017daf5f68cc62c112c9975bade30c59d89b4b3afc8eb2635012835d14f');
const reviewBytes=await readFile(resolve(dir,'solaris-four-fluid-scope-review-v1.json'));
const review=JSON.parse(reviewBytes);
const planBytes=await readFile(resolve(dir,'plan.json'));
assert.equal(hash(planBytes),review.planHash);
const plan=JSON.parse(planBytes);
const findings=review.findings.map(f=>{
  const s=f.originalSource;
  assert.equal(s.replacementIntervalText,f.sourceRow.replacement_interval);
  assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===s.id));
  const brake=s.systemCode==='BRAKE_FLUID';
  assert.ok(brake||s.systemCode==='ENGINE_COOLANT');
  assert.equal(s.replacementIntervalText,brake?'45 тыс. км или 3 года':'Первая замена через 210 000 км или 10 лет Далее каждые 30 000 км или 2 года');
  assert.equal(s.replacementMonths,brake?36:120);
  assert.equal(s.replacementKmMin,brake?45000:null);
  assert.equal(s.replacementKmMax,brake?45000:null);
  return {sourceRequirementId:s.id,systemCode:s.systemCode,originalIntervalText:s.replacementIntervalText,
    originalScalars:{kmMin:s.replacementKmMin,kmMax:s.replacementKmMax,months:s.replacementMonths},
    evidenceStatus:brake?'FIXED_REPLACEMENT_NOT_SUBSTANTIATED_BY_REVIEWED_MANUAL':'RAW_TWO_STAGE_INTERVAL_CORROBORATED_IN_THIS_MANUAL',
    manualPdfPage:brake?367:371,
    operation:brake?'CHECK_LEVEL_AND_ACT_IF_NEEDED':'REPLACE',
    reviewedSchedule:brake?{checkpointKm:45000,checkpointMonths:36,recurrenceNotInferred:true}:{first:{km:210000,months:120},subsequent:{km:30000,months:24}},
    scalarCaution:brake?'Do not present the source fixed replacement interval as verified by this manual.':'Legacy scalars omit both kilometre thresholds and subsequent 24-month interval. Preserve the complete two-stage text; 120 months alone is not the repeat interval.',
    remainingApplicabilityGates:f.remainingGates,publicationAllowed:false};
});
assert.equal(findings.length,4);
const report={kind:'SOLARIS_SERVICE_INTERVAL_VISUAL_REVIEW',pdfPath,pdfSha256:pdfHash,sourceReviewSha256:hash(reviewBytes),planSha256:hash(planBytes),
  visualReview:{pdfPages:[365,367,371],printedPages:['7-9','7-11','7-15'],method:'Whole rendered pages individually visually inspected by assistant, including headings and footnotes; script only validates source integrity.'},
  conditions:['Normal operating conditions only.','Mileage or elapsed time, whichever comes first.','Footnote 3 permits earlier replacement for wear, repair or other maintenance.','Footnote 6 specifies deionized or soft water for coolant addition, not hard water.','Check includes replacement, cleaning, lubrication or adjustment if needed; it is not unconditional scheduled replacement.'],
  provenanceLimitations:['Third-party AVIS mirror, not authenticated manufacturer-hosted copy.','Internal layout dated 17.07.2014; does not establish all 2011-2017 variants.','No conclusion about other manuals, severe conditions or an independently documented brake replacement policy.'],
  findings,canonicalChanged:false,productionApplyAllowed:false};
await writeFile(resolve(dir,'solaris-service-interval-review-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({checked:findings.length,brakeReplacementNotSubstantiated:2,coolantTwoStageCorroborated:2,canonicalChanged:false}));
