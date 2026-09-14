// Isolated browser test of the real component; no database or external requests.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {createJiti} from 'jiti';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jiti=createJiti(import.meta.url,{alias:{'@':path.join(root,'src')}});
const {buildMannUnifiedTechnicalProfile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1';
const identityFixtures=[['Toyota','Allion','II','2ZR-FAE','TEST-ALLION'],['Toyota','Premio','II','2ZR-FAE','TEST-PREMIO'],
  ['Opel','Zafira','B','A16XER','TEST-ZAFIRA-B'],['Opel','Zafira','C','A16XER','TEST-ZAFIRA-C']].map(([make,model,generation,engine,spec])=>({
    id:spec,sourceRequirementId:spec,systemCode:'ENGINE_OIL',componentModel:null,
    applicabilityJson:{sourceVehicleScope:{make,model,generation},matchedEngineScope:[engine],window:{intersection:{from:'2010-01',to:'2015-12'}}},
    technicalDataJson:{capacities:[],specifications:[{type:'TEST',value:spec}],viscosityGrades:[]},
    fieldConfidenceJson:{'technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH'},verifiedFieldsJson:[],evidenceJson:[{publisher:'UI test fixture',title:'Синтетические данные — не допуск автомобиля'}],
    provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,
      independentValidation:{independentlyValidated:true,hardConflicts:[],reviewBlockers:[]}},
    state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:'CONFIRMED_SINGLE',matchScore:100,applyEligible:false,reviewConfirmed:false,createdAt:new Date(),
    run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:policy,automaticProductSelection:false}},
  }));
for(const fixture of identityFixtures){
  const context={...fixture.applicabilityJson.sourceVehicleScope,engineCode:fixture.applicabilityJson.matchedEngineScope[0],year:2013};
  assert.deepEqual(buildMannUnifiedTechnicalProfile(identityFixtures,undefined,context).items.map(item=>item.revisionId),[fixture.id]);
}
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const gearPolicy='USER_CONFIRMED_TRANSMISSION_V1';
const gearFixtures=[4,6].map(count=>({...identityFixtures[0],id:`TEST-GEAR-${count}`,sourceRequirementId:`TEST-GEAR-${count}`,
  systemCode:'AUTOMATIC_TRANSMISSION',componentModel:count===6?'A6GF1':null,
  fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_HIGH','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH'},
  applicabilityJson:{sourceVehicleScope:{make:'Kia',model:'Rio',generation:'III'},matchedEngineScope:['G4FA'],
    window:{intersection:{from:'2012-01',to:'2015-12'}},transmissionType:'automatic',transmissionGearCount:count},
  // Synthetic liters solely to assert capacity isolation, not real vehicle data.
  technicalDataJson:{capacities:[{nominalLiters:count,minLiters:count,maxLiters:count,confidence:'HIGH',serviceContext:'UNKNOWN'}],specifications:[{type:'TEST',value:`TEST-GEAR-${count}`}],viscosityGrades:[]},
  state:'REVIEW',matchClass:'CONDITIONAL_TRANSMISSION',
  provenanceJson:{conditionalTransmissionPolicy:gearPolicy,conditionalTransmissionEligible:true,
    independentValidation:{vehicleIdentityIndependentlyValidated:true,hardConflicts:[],reviewBlockers:['MANN variant не подтверждает тип или модель коробки']}},
  run:{...identityFixtures[0].run,gatesJson:{conditionalTransmissionPolicy:gearPolicy,automaticProductSelection:false}},
}));
gearFixtures.push({...gearFixtures[0],id:'TEST-MANUAL',sourceRequirementId:'TEST-MANUAL',systemCode:'MANUAL_TRANSMISSION',
  applicabilityJson:{...gearFixtures[0].applicabilityJson,transmissionType:'manual',transmissionGearCount:5},
  technicalDataJson:{capacities:[],specifications:[{type:'TEST',value:'TEST-MANUAL'}],viscosityGrades:[]}});
const modules = new Map();
// Synthetic values: these test display semantics, not a vehicle's actual fluids.
const capacityFixtures = [
  {qualifier:'APPROXIMATE',nominalLiters:8},
  {qualifier:'UP_TO',maxLiters:4},
  {qualifier:'RANGE',minLiters:4,maxLiters:5},
  {qualifier:'TOLERANCE',nominalLiters:4,toleranceLiters:0.1},
  {qualifier:'EXACT',nominalLiters:8.365,serviceContextLabel:'полная ёмкость'},
];
const equipmentPlan=JSON.parse(readFileSync(path.join(root,'outputs/mann-identity-scoped-2026-09-14/conditional-equipment-plan-v1.json'),'utf8'));
const equipmentFixtures=[['POWER_STEERING','HYDRAULIC_STEERING',undefined],['REAR_DIFFERENTIAL','REAR_DIFFERENTIAL','4WD'],['REAR_DIFFERENTIAL','REAR_DIFFERENTIAL','2WD']].map(([system,circuit,drive])=>{
  const row=equipmentPlan.revisions.find(r=>r.systemCode===system),id=`TEST-EQUIPMENT-${circuit}-${drive??'NONE'}`;
  return {...row,id,sourceRequirementId:id,createdAt:new Date(),reviewConfirmed:false,
    evidenceJson:[{publisher:'UI test fixture',title:'Синтетические данные — не допуск автомобиля'}],
    applicabilityJson:{...gearFixtures[0].applicabilityJson,transmissionType:undefined,transmissionGearCount:undefined,
      requiredEquipment:{systemCode:system,circuit,...(drive?{drive}:{})}},
    technicalDataJson:{capacities:drive?[{nominalLiters:drive==='4WD'?4:2,confidence:'HIGH'}]:[],specifications:[{type:'TEST',value:id}],viscosityGrades:[]},
    provenanceJson:{...row.provenanceJson,sourceAggregateContext:{...row.provenanceJson.sourceAggregateContext,requiredDrive:drive??null}},
    run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalEquipmentPolicy:equipmentPlan.policy,automaticProductSelection:false}}};
});
// Undefined keys are absent in real JSON records; remove the gearbox-only gate.
for(const fixture of equipmentFixtures){delete fixture.applicabilityJson.transmissionType;delete fixture.applicabilityJson.transmissionGearCount;}
for(const model of ['TY21C','ATX90A']){
 const base=equipmentFixtures[1],policy='EXACT_SOURCE_EQUIPMENT_MODEL_V1';
 equipmentFixtures.push({...base,id:`TEST-MODEL-${model}`,sourceRequirementId:`TEST-MODEL-${model}`,systemCode:'TRANSFER_CASE',componentModel:`- ${model}`,
  applicabilityJson:{...base.applicabilityJson,componentModel:`- ${model}`,requiredEquipment:{systemCode:'TRANSFER_CASE',circuit:'TRANSFER_CASE',drive:'4WD',componentModel:model}},
  technicalDataJson:{capacities:[],specifications:[{type:'TEST',value:`TEST-MODEL-${model}`}],viscosityGrades:[]},
  provenanceJson:{...base.provenanceJson,sourceAggregateContext:{...base.provenanceJson.sourceAggregateContext,systemCode:'TRANSFER_CASE',circuit:'TRANSFER_CASE'},explicitEquipmentModel:{policy,sourceComponentModel:`- ${model}`,model}},
  run:{...base.run,gatesJson:{...base.run.gatesJson,equipmentModelPolicy:policy}}});
}
function bundle(file, source) {
  if (modules.has(file)) return file;
  modules.set(file, '');
  let code = source ?? readFileSync(file, 'utf8');
  if (/\.tsx?$/.test(file)) code = ts.transpileModule(code, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
  } }).outputText;
  code = code.replace(/require\(["']([^"']+)["']\)/g, (_, name) => {
    const resolved = name.startsWith('@/') ? path.join(root,'src',name.slice(2)+'.ts') : createRequire(file).resolve(name);
    bundle(resolved);
    return `require(${JSON.stringify(resolved)})`;
  });
  modules.set(file, code);
  return file;
}
const entry = path.join(root, 'src/components/shipment/VehicleLookupPanel.tsx');
bundle(entry);
const react = bundle(require.resolve('react'));
const reactDom = bundle(require.resolve('react-dom/client'));
const script = `const process={env:{NODE_ENV:'development'}};const modules={${[...modules].map(([id, code]) => `${JSON.stringify(id)}:function(module,exports,require){${code}\n}`).join(',')}};const cache={};function require(id){if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,require);return m.exports;}require(${JSON.stringify(reactDom)}).createRoot(document.getElementById('root')).render(require(${JSON.stringify(react)}).createElement(require(${JSON.stringify(entry)}).VehicleLookupPanel,{onUseVehicle(){},onConfirmMannCandidate(){},onLookupStart(){},onManualMode(){}}));`;
const server = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(script); }
  else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(readFileSync(path.join(root, 'src/app/globals.css'))); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="ru"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body class="eco-shipment-new-page" style="margin:0;padding:0;box-sizing:border-box;width:100%"><main style="box-sizing:border-box;width:100%;max-width:960px;margin:24px auto;padding:12px"><div id="root"></div></main><script src="/bundle.js"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  // The app stylesheet contains remote font imports; keep this fixture offline.
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const requests = [];
  let failNext = false;
  let realProfileMode = false;
  let gearProfileMode = false;
  let vehicle = { makeRaw: 'Volkswagen', modelRaw: 'Golf', generationRaw:'VI', year: 2013, engineCode: 'CAXA', sourceMethods: ['manual'] };
  await page.route('**/api/**', async route => {
    const body = route.request().postDataJSON();
    const url = route.request().url();
    if (url.endsWith('/vin')) return route.fulfill({ json: { status: 'found', vehicle, candidates: [] } });
    if (url.endsWith('/resolve-decoded-vehicle')) return route.fulfill({ json: { status: 'resolved', selectedApplication: { variantIds: ['test-variant'] } } });
    assert.ok(url.endsWith('/technical-profile'), `Unexpected API: ${url}`);
    requests.push(body);
    if(gearProfileMode)return route.fulfill({json:buildMannUnifiedTechnicalProfile([...gearFixtures,...equipmentFixtures],body.transmissionType,body.vehicleContext)});
    if(realProfileMode)return route.fulfill({json:buildMannUnifiedTechnicalProfile(identityFixtures,body.transmissionType,body.vehicleContext)});
    if (failNext) { failNext = false; return route.fulfill({ status: 503, json: { error: 'Тест: профиль недоступен' } }); }
    const model = body.vehicleContext.transmissionModel;
    return route.fulfill({ json: {
      status: 'catalog_preview', selectedTransmissionType: body.transmissionType,
      transmissionOptions: [{ type: 'automatic', label: 'АКПП' }, { type: 'manual', label: 'МКПП' }],
      transmissionComponentOptions: body.transmissionType === 'automatic' ? ['09G', 'DQ200'] : [],
      transmissionConditionsToReview: body.transmissionType === 'automatic' ? ['Для особых условий нужна проверка'] : [],
      items: model ? [{ revisionId: 'fixture', systemLabel: 'Масло АКПП', componentModel: model, capacities: capacityFixtures, specifications: ['TEST-SPEC'], viscosityGrades: [], evidence: [], userConfirmedTransmissionModel: true, automaticSelectionEligible: false }] : [],
    } });
  });
  const ready = () => page.waitForFunction(() => document.querySelector('.eco-vehicle-lookup__profile')?.getAttribute('aria-busy') === 'false');
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByLabel('VIN или номер кузова').fill('WVWZZZ1KZDW000001');
  await ready();
  assert.deepEqual(requests.at(-1).vehicleContext, {make:'Volkswagen',model:'Golf',generation:'VI', engineCode: 'CAXA', year: 2013 });
  await page.getByRole('button', { name: 'АКПП', exact: true }).click(); await ready();
  const model = page.getByLabel('Установленный агрегат');
  assert.equal(await model.inputValue(), '');
  await model.selectOption('09G'); await ready();
  assert.equal(requests.at(-1).vehicleContext.transmissionModel, '09G');
  for(const label of ['примерно 8 л','до 4 л','4–5 л','4 л ± 0,1 л','8,365 л · полная ёмкость'])assert.equal(await page.getByText(label,{exact:true}).count(),1);
  assert.equal(await page.getByText('Модель коробки указана вручную. Данные остаются предварительными.').count(), 1);
  await model.selectOption(''); await ready();
  assert.equal(requests.at(-1).vehicleContext.transmissionModel, undefined);
  assert.equal(await page.getByText('TEST-SPEC', { exact: false }).count(), 0);
  await model.selectOption('09G'); await ready();
  await page.getByText('Уточнить месяц выпуска', { exact: true }).click();
  const month = page.getByLabel('Месяц и год выпуска');
  await month.fill('2014-05');
  const beforeInvalid = requests.length;
  await page.getByRole('button', { name: 'Применить дату' }).click();
  assert.equal(await month.evaluate(el => el.validity.valid), false);
  assert.equal(requests.length, beforeInvalid);
  await month.fill('2013-05');
  await page.getByRole('button', { name: 'Применить дату' }).click(); await ready();
  assert.equal(requests.at(-1).vehicleContext.productionMonth, '2013-05');
  assert.equal(await model.inputValue(), '');
  await model.selectOption('09G'); await ready();
  assert.equal(requests.at(-1).vehicleContext.productionMonth, '2013-05');
  const out = path.resolve(root, process.env.MANN_UI_TEST_OUTPUT || 'outputs/mann-profile-ui-test'); mkdirSync(out, { recursive: true });
  await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
  const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right, width: getComputedStyle(el).width, minWidth: getComputedStyle(el).minWidth, margin: getComputedStyle(el).margin, padding: getComputedStyle(el).padding, boxSizing: getComputedStyle(el).boxSizing, parentWidth: el.parentElement.getBoundingClientRect().width })));
  assert.deepEqual(overflow, [], 'Mobile horizontal overflow');
  await page.getByRole('button', { name: 'МКПП', exact: true }).click(); await ready();
  assert.equal(requests.at(-1).vehicleContext.transmissionModel, undefined);
  assert.equal(requests.at(-1).vehicleContext.productionMonth, '2013-05');
  await month.fill(''); await page.getByRole('button', { name: 'Применить дату' }).click(); await ready();
  assert.equal(requests.at(-1).vehicleContext.productionMonth, undefined);
  failNext = true;
  await page.getByRole('button', { name: 'АКПП', exact: true }).click(); await ready();
  assert.equal(await page.getByText('Тест: профиль недоступен').count(), 1);
  assert.equal(await page.getByText('TEST-SPEC', { exact: false }).count(), 0);
  await page.getByLabel('Другие действия с автомобилем').click();
  await page.getByRole('button', { name: 'Выбрать другой автомобиль' }).click();
  vehicle={makeCanonical:'Toyota',modelCanonical:'Premio',generationCanonical:'II',year:2013,engineCode:'2ZR-FAE',sourceMethods:['manual']};
  await page.getByLabel('VIN или номер кузова').fill('WVWZZZ1KZDW000002'); await ready();
  assert.deepEqual(requests.at(-1).vehicleContext, {make:'Toyota',model:'Premio',generation:'II',engineCode: '2ZR-FAE', year: 2013 });
  assert.equal(requests.at(-1).transmissionType, undefined);
  realProfileMode=true;
  gearProfileMode=true;
  await page.getByLabel('Другие действия с автомобилем').click();
  await page.getByRole('button',{name:'Выбрать другой автомобиль'}).click();
  vehicle={makeRaw:'Kia',modelRaw:'Rio',generationRaw:'III',year:2013,engineCode:'G4FA',sourceMethods:['manual']};
  await page.getByLabel('VIN или номер кузова').fill('WVWZZZ1KZDW000009');await ready();
  await page.getByRole('button',{name:'АКПП',exact:true}).click();await ready();
  const gears=page.getByLabel('Передач в установленной коробке');
  assert.equal(await gears.inputValue(),'');
  assert.equal(await page.getByText('TEST-GEAR-',{exact:false}).count(),0);
  assert.equal(await page.locator('.eco-vehicle-lookup__profile-capacities').count(),0);
  await gears.selectOption('4');await ready();
  assert.equal(requests.at(-1).vehicleContext.transmissionGearCount,4);
  assert.equal(await page.getByText('TEST-GEAR-4',{exact:false}).count(),1);
  assert.equal(await page.getByText('TEST-GEAR-6',{exact:false}).count(),0);
  assert.equal(await page.locator('.eco-vehicle-lookup__profile-capacities').innerText(),'4 л');
  await gears.selectOption('6');await ready();
  assert.equal(await page.getByText('TEST-GEAR-',{exact:false}).count(),0,'Named box still requires its model');
  assert.equal(await page.locator('.eco-vehicle-lookup__profile-capacities').count(),0);
  await model.selectOption('A6GF1');await ready();
  assert.equal(requests.at(-1).vehicleContext.transmissionGearCount,6);
  assert.equal(requests.at(-1).vehicleContext.transmissionModel,'A6GF1');
  assert.equal(await page.getByText('TEST-GEAR-6',{exact:false}).count(),1);
  assert.equal(await page.locator('.eco-vehicle-lookup__profile-capacities').innerText(),'6 л');
  await page.screenshot({path:path.join(out,'gear-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Gear selector mobile overflow');
  await page.setViewportSize({width:1100,height:1000});
  await page.screenshot({path:path.join(out,'gear-desktop.png'),fullPage:true});
  await gears.selectOption('4');await ready();
  assert.equal(requests.at(-1).vehicleContext.transmissionModel,undefined,'Gear change resets named model');
  assert.equal(await page.getByText('TEST-GEAR-4',{exact:false}).count(),1);
  await gears.selectOption('');await ready();
  assert.equal(requests.at(-1).vehicleContext.transmissionGearCount,undefined);
  assert.equal(await page.getByText('TEST-GEAR-',{exact:false}).count(),0);
  await gears.selectOption('6');await ready();await model.selectOption('A6GF1');await ready();
  await page.getByText('Уточнить месяц выпуска',{exact:true}).click();
  await month.fill('2013-05');await page.getByRole('button',{name:'Применить дату'}).click();await ready();
  assert.equal(requests.at(-1).vehicleContext.transmissionGearCount,undefined,'Date change resets count');
  assert.equal(requests.at(-1).vehicleContext.transmissionModel,undefined);
  assert.equal(await gears.inputValue(),'');
  await gears.selectOption('4');await ready();
  assert.equal(requests.at(-1).vehicleContext.productionMonth,'2013-05');
  await page.getByRole('button',{name:'МКПП',exact:true}).click();await ready();
  assert.equal(requests.at(-1).vehicleContext.transmissionGearCount,undefined,'Type change resets count');
  assert.equal(await gears.inputValue(),'');
  assert.equal(await page.getByText('TEST-GEAR-',{exact:false}).count(),0);
  assert.equal(await page.getByText('TEST-MANUAL',{exact:false}).count(),0,'Single option is not auto-selected');
  await gears.selectOption('5');await ready();
  assert.equal(await page.getByText('TEST-MANUAL',{exact:false}).count(),1);
  const steering=page.getByLabel('Подтвердить: Гидроусилитель руля'),rear=page.getByLabel('Подтвердить: Задний редуктор');
  assert.equal(await steering.inputValue(),'');assert.equal(await rear.inputValue(),'');
  assert.equal(await page.getByText('TEST-EQUIPMENT-',{exact:false}).count(),0);
  await steering.selectOption('HYDRAULIC_STEERING::');await ready();
  assert.deepEqual(requests.at(-1).vehicleContext.confirmedEquipment,[{circuit:'HYDRAULIC_STEERING'}]);
  assert.equal(await page.getByText('Объём в источнике не указан.',{exact:true}).count(),1);
  assert.equal(await page.getByText('TEST-EQUIPMENT-REAR',{exact:false}).count(),0);
  const transfer=page.getByLabel('Подтвердить: Раздаточная коробка');
  for(const model of ['TY21C','ATX90A']){
    await transfer.selectOption(`TRANSFER_CASE:4WD::${model}`);await ready();
    assert.deepEqual(requests.at(-1).vehicleContext.confirmedEquipment.find(c=>c.circuit==='TRANSFER_CASE'),{circuit:'TRANSFER_CASE',drive:'4WD',componentModel:model});
    assert.equal(await page.getByText(`TEST-MODEL-${model}`,{exact:false}).count(),1);
    assert.equal(await page.getByText(`TEST-MODEL-${model==='TY21C'?'ATX90A':'TY21C'}`,{exact:false}).count(),0);
  }
  await transfer.selectOption('');await ready();
  assert.equal(await page.getByText('TEST-MODEL-',{exact:false}).count(),0);
  await rear.selectOption('REAR_DIFFERENTIAL:4WD:');await ready();
  assert.equal(requests.at(-1).vehicleContext.confirmedEquipment.length,2);
  assert.equal(await page.getByText('TEST-EQUIPMENT-REAR_DIFFERENTIAL-4WD',{exact:false}).count(),1);
  assert.equal(await page.getByText('TEST-EQUIPMENT-REAR_DIFFERENTIAL-2WD',{exact:false}).count(),0);
  await rear.selectOption('REAR_DIFFERENTIAL:2WD:');await ready();
  assert.equal(requests.at(-1).vehicleContext.confirmedEquipment.length,2,'Replace circuit, do not append contradictory choice');
  assert.equal(await page.getByText('TEST-EQUIPMENT-REAR_DIFFERENTIAL-4WD',{exact:false}).count(),0);
  assert.equal(await page.getByText('TEST-EQUIPMENT-REAR_DIFFERENTIAL-2WD',{exact:false}).count(),1);
  await page.screenshot({path:path.join(out,'equipment-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(out,'equipment-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Equipment controls overflow');
  await steering.selectOption('');await ready();
  assert.equal(await page.getByText('TEST-EQUIPMENT-HYDRAULIC',{exact:false}).count(),0);
  assert.equal(await page.getByText('TEST-EQUIPMENT-REAR_DIFFERENTIAL-2WD',{exact:false}).count(),1);
  await page.getByRole('button',{name:'АКПП',exact:true}).click();await ready();
  assert.equal(requests.at(-1).vehicleContext.confirmedEquipment,undefined,'Type change resets equipment');
  assert.equal(await rear.inputValue(),'');
  await steering.selectOption('HYDRAULIC_STEERING::');await ready();
  await month.fill('2013-06');await page.getByRole('button',{name:'Применить дату'}).click();await ready();
  assert.equal(requests.at(-1).vehicleContext.confirmedEquipment,undefined,'Date change resets equipment');
  await steering.selectOption('HYDRAULIC_STEERING::');await ready();
  gearProfileMode=false;
  await page.setViewportSize({width:390,height:844});
  for(const [index,[modelName,generation,make,engine,expected]] of [
    ['Allion','II','Toyota','2ZR-FAE','TEST-ALLION'],['Premio','II','Toyota','2ZR-FAE','TEST-PREMIO'],
    ['Zafira','B','Opel','A16XER','TEST-ZAFIRA-B'],['Zafira','C','Opel','A16XER','TEST-ZAFIRA-C'],
    ['Zafira',undefined,'Opel','A16XER',null],
  ].entries()){
    await page.getByLabel('Другие действия с автомобилем').click();
    await page.getByRole('button',{name:'Выбрать другой автомобиль'}).click();
    vehicle={makeRaw:make,modelRaw:modelName,generationRaw:generation,year:2013,engineCode:engine,sourceMethods:['manual']};
    await page.getByLabel('VIN или номер кузова').fill(`WVWZZZ1KZDW00000${index+3}`);await ready();
    assert.equal(requests.at(-1).vehicleContext.model,modelName);
    assert.equal(requests.at(-1).vehicleContext.transmissionGearCount,undefined,'Vehicle change resets gear');
    assert.equal(requests.at(-1).vehicleContext.confirmedEquipment,undefined,'Vehicle change resets equipment');
    assert.equal(requests.at(-1).vehicleContext.generation,generation);
    for(const fixture of identityFixtures)assert.equal(await page.getByText(fixture.id,{exact:false}).count(),fixture.id===expected?1:0,`${modelName} ${generation}: ${fixture.id}`);
    if(index===0)await page.screenshot({path:path.join(out,'identity-mobile.png'),fullPage:true});
  }
  assert.deepEqual(errors, []);
  console.log('PASS: real component and profile builder; gear count and named model gates; gear/model/date/type/vehicle resets; no automatic single-option choice; identity isolation; errors; desktop/mobile. Synthetic data and mock HTTP, no DB.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
