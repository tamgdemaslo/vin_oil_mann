import assert from 'node:assert/strict';
import {sha} from './mann-offline-scope.mjs';

// Produces an additive proposal only. Manufacturer metadata remains in evidence,
// because the existing filter table has no dedicated columns for these IDs.
export function prepareOnlineMannRow(application,evidence,normalizers){
 const {mannCatalogVariantKey,normalizeMannText,normalizeMannSearchText,normalizeEngineCode,normalizeMannArticle}=normalizers;
 assert.equal(new URL(evidence.url).hostname,'www.mann-filter.com');assert.equal(new URL(evidence.url).protocol,'https:');assert.match(evidence.sha256,/^[a-f0-9]{64}$/);
 assert.ok(evidence.article);assert.equal(application.manufactureMonths.precision,'MONTH_FROM_RENDERED_TABLE');
 const window=application.manufactureMonths;assert.match(window.from,/^\d{4}-\d{2}$/);if(window.to)assert.match(window.to,/^\d{4}-\d{2}$/);
 assert.ok(!window.to||window.from<=window.to);assert.equal(application.binding.serialNumberRange,'','Serial restrictions need explicit applicability support');
 assert.ok(application.engineCode&&application.engineCode!=='-');assert.match(application.hp,/^\d+(?:\.\d+)?$/);assert.match(application.kw,/^\d+(?:\.\d+)?$/);
 const filterType={'Air Filter':'air','Oil Filter':'oil','Fuel Filter':'fuel','Cabin Air Filter':'cabin'}[application.filterType];assert.ok(filterType,'Unsupported filter type');
 const date=month=>month.slice(5,7)+'/'+month.slice(2,4),vehicleYears=window.to?`${date(window.from)}-${date(window.to)}`:`${date(window.from)} ->`;
 const row={make:application.make,makeNormalized:normalizeMannText(application.make),model:application.model,modelNormalized:normalizeMannSearchText(application.model),modelYears:null,
  vehicleText:application.vehicleText,effectiveVehicleText:application.vehicleText,detail:application.vehicleText,engineCode:application.engineCode,engineCodeNormalized:normalizeEngineCode(application.engineCode),kw:application.kw,hp:application.hp,
  vehicleYears,vehicleYearFrom:Number(window.from.slice(0,4)),vehicleYearTo:window.to?Number(window.to.slice(0,4)):null,condition:null,filterType,filterSubtype:null,
  mannArticle:evidence.article,mannArticleNormalized:normalizeMannArticle(evidence.article),filterNote:null,pdfPage:null,catalogPage:null,sourceFile:evidence.url,sourceHash:evidence.sha256,
  sourceRowHash:sha({htmlHash:evidence.sha256,application})};
 row.vehicleVariantKey=mannCatalogVariantKey({make:row.make,model:row.model,vehicle_text:row.vehicleText,effective_vehicle_text:row.effectiveVehicleText,engine_code:row.engineCode,kw:row.kw,hp:row.hp,vehicle_years:row.vehicleYears,condition:row.condition});
 return {row,evidence:{source:evidence,originalApplication:application,manufacturerTypeId:application.manufacturerTypeId,manufacturerMakeId:application.manufacturerMakeId,manufacturerModelId:application.manufacturerModelId,exactDisplacementCcm:application.ccm,manufactureMonths:window},
  operation:'PROPOSE_INSERT_ONLY',requiresManufacturerEvidencePersistence:true,productionApplyAllowed:false};
}
