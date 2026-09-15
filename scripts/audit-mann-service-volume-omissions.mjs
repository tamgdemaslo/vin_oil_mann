import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const raw=readFileSync('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(raw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const oldSource=execFileSync('git',['show','HEAD:src/lib/fluid-capacity-parser.ts'],{encoding:'utf8'}),exports={};
runInNewContext(ts.transpileModule(oldSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});assert.equal(exports.FLUID_CAPACITY_PARSER_VERSION,'capacity-parser-v5');
const j=createJiti(import.meta.url),{parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts');
const findings=[],sources=parseCopy(raw,'vehicle_fluid_requirements');
for(const s of sources){const before=exports.parseFluidCapacities(s.fillVolumeText,s.systemCode),after=parse(s.fillVolumeText,s.systemCode);assert.equal(JSON.stringify(after.capacities),JSON.stringify(before.capacities),s.id);assert.equal(JSON.stringify(after.rejected),JSON.stringify(before.rejected),s.id);const added=after.suspicious.filter(d=>d.code==='MISSING_SERVICE_VOLUME_UNIT');assert.equal(JSON.stringify(after.suspicious.filter(d=>d.code!=='MISSING_SERVICE_VOLUME_UNIT')),JSON.stringify(before.suspicious),s.id);if(added.length)findings.push({sourceId:s.id,make:s.make,model:s.model,system:s.systemCode,raw:s.fillVolumeText,previouslyNeedsReview:before.needsReview,needsReview:after.needsReview,omittedClauses:added,parsedCapacities:after.capacities});}
const output=`outputs/mann-live-audit-1789469257907/service-volume-omissions-${Date.now()}.json`;const report={kind:'CAPACITY_V6_FULL_CORPUS_DIFFERENTIAL',sourceHash:sha(raw),oldParserHash:sha(oldSource),newParserHash:sha(readFileSync('src/lib/fluid-capacity-parser.ts','utf8')),rows:sources.length,capacitiesAndRejectionsUnchanged:true,otherDiagnosticsUnchanged:true,affected:findings.length,newlyRequireReview:findings.filter(f=>!f.previouslyNeedsReview).length,findings,productionChanged:false};writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined,output}));
