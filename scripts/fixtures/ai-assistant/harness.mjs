import { resolve } from 'node:path';
import { createJiti } from 'jiti';
const root=process.cwd(), fixture=name=>resolve(root,'scripts/fixtures/ai-assistant',name);
const aliases={'@':resolve(root,'src'),'@/lib/db':fixture('db.mjs'),'@/lib/openai-client':fixture(process.env.TGM_AI_LIVE_SMOKE === '1' ? 'openai-live.mjs' : 'openai.mjs')};
for(const path of ['ai-agent/settings','rossko','mann-vehicle-resolver','mann-unified-technical-profile','vehicle-identity']) aliases[`@/lib/${path}`]=fixture('integrations.mjs');
const jiti=createJiti(import.meta.url,{alias:aliases,moduleCache:true});
if (process.env.TGM_AI_LIVE_SMOKE !== '1') process.env.OPENAI_API_KEY='frozen-test-never-sent';
// Network is forbidden in replay, including an accidentally unmocked provider.
if (process.env.TGM_AI_LIVE_SMOKE !== '1') globalThis.fetch=()=>{throw new Error('NETWORK_FORBIDDEN_IN_REPLAY');};
const {runWithRequestTenant}=await jiti.import(resolve(root,'src/lib/request-tenant-store.ts'));
const {runAssistantThread}=await jiti.import(resolve(root,'src/lib/ai-assistant/runner.ts'));
const {executeAssistantTool}=await jiti.import(resolve(root,'src/lib/ai-assistant/tools.ts'));
const {withAssistantExecution,withinAssistantDeadline}=await jiti.import(resolve(root,'src/lib/ai-assistant/execution.ts'));
const {parseAssistantToolArguments}=await jiti.import(resolve(root,'src/lib/ai-assistant/tool-arguments.ts'));
const {assistantIntent}=await jiti.import(resolve(root,'src/lib/ai-assistant/intent.ts'));
const actor={id:'employee',name:'Сотрудник',role:'admin'};
const tenant={mode:'branch',branchId:'branch-a',organizationId:'org-a',allowedBranchIds:['branch-a'],userId:actor.id,permissions:['owner'],businessGroupId:'test'};
function product(id='oil',overrides={}) {return {id,branchId:'branch-a',entityType:'product',archived:false,name:'Valvoline SynPower 5W-30, 5 л',article:'OIL-5',brand:'Valvoline',salePriceCents:300000,uomName:'шт',packageVolume:'5 л',markingMode:'NOT_MARKED',oem:'TEST-SPEC 123',sae:'5W-30',atf:'TEST-SPEC 123',oemAtf:null,searchText:'test-spec 123',stockBalances:[{available:20}],...overrides};}
function reset() {globalThis.__tgmReplay={ids:0,dbCalls:[],modelCalls:[],responses:[],connectionProbes:0,providerCalls:0,mannCalls:0,vehicleCalls:0,vehicle:{makeCanonical:'TEST',modelCanonical:'CAR',year:2020,engineCode:'E1'},tables:{branch:[{id:'branch-a',slug:'location-a',legacyOrganizationId:'org-a',status:'active'}],aIAssistantThread:[{id:'thread',branchId:'branch-a',organizationId:'org-a',status:'active',title:'Replay',lastResponseId:null}],localProduct:[product()],aIAssistantLaborPricingRule:[{id:'rule-engine',branchId:'branch-a',organizationId:'org-a',locationId:'location-a',serviceFamily:'engine_oil',procedureType:'oil_change',active:true,effectiveFrom:new Date(0),effectiveTo:null,materialsOwner:'service',laborPriceCents:0,name:'Масло сервиса',requiresHumanConfirmation:false},{id:'rule-trans',branchId:'branch-a',organizationId:'org-a',locationId:'location-a',serviceFamily:'transmission_fluid',procedureType:'partial',active:true,effectiveFrom:new Date(0),effectiveTo:null,materialsOwner:'service',laborPriceCents:400000,name:'Частичная замена',requiresHumanConfirmation:false}]}};return globalThis.__tgmReplay;}
const input=(overrides={})=>({locationId:'attacker-location',vehicle:{displayName:'TEST CAR 2020',snapshot:{make:'TEST',model:'CAR',year:2020,engineCode:'E1'}},service:{type:'engine_oil',name:'Замена масла двигателя',requiredFluidSpec:'TEST-SPEC 123',standardTechnicalQuantityLiters:5,filterAccess:'none',materialsOwner:'service'},selectedProducts:[{productId:'oil',quantity:1,role:'fluid'}],localCatalogChecked:true,...overrides});
const call=(name,args)=>({id:`response-${Math.random()}`,output:[{type:'function_call',name,arguments:JSON.stringify(args),call_id:'call-1'}],usage:{input_tokens:100,output_tokens:100}});
const final=text=>({id:'final',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:10,output_tokens:10}});
const run=message=>runWithRequestTenant(tenant,()=>runAssistantThread({threadId:'thread',organizationId:'org-a',actor,message}));
const artifact=f=>f.tables.aIAssistantMessage.findLast(row=>row.attachmentsJson?.quoteAndTechCard)?.attachmentsJson.quoteAndTechCard;
const ctx={organizationId:'org-a',actorId:'employee',actorName:'Сотрудник',actorRole:'admin'};

export { reset, input, product, call, final, run, artifact, actor, tenant, ctx, runWithRequestTenant, runAssistantThread, executeAssistantTool, withAssistantExecution, withinAssistantDeadline, parseAssistantToolArguments, assistantIntent, jiti };
