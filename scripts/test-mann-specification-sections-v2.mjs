import assert from 'node:assert/strict';
import {splitSpecificationSections as split,specificationCautionSignals as cautions} from './lib/mann-specification-sections-v2.mjs';
for(const suffix of ['Замена: 40 тыс. км','Периодичность замены: 45 тыс. км']){
 const text=`Ford WSS-M6C65-A2 Аналог: DOT 4 ${suffix}`,r=split(text,'DOT 4');
 assert.equal(r.status,'EXPLICIT_ANALOG_SEPARATED');
 assert.equal(r.main.text+r.marker.text+r.analog.text+r.suffix.text,text);
 assert.equal(r.analog.text.trim(),'DOT 4');
 assert.equal(r.suffix.text,suffix);
}
assert.equal(split('A Аналоги: B Замена: 10',null).status,'ANALOG_FIELD_MISMATCH');
assert.equal(split('A Аналог: B ИЛИ C Аналог: D','B').status,'AMBIGUOUS_MARKERS');
assert.equal(cautions('API SN или выше, не ниже API SM').length,0);
assert.equal(cautions('Dexron VI не гарантирует полного соответствия').length,1);
assert.equal(cautions('Жидкости не допускаются').length,1);
console.log('Specification sections v2: PASS');
