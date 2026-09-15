import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const j=createJiti(import.meta.url),{parseConditionalFluidCapacities:parse,selectConditionalFluidCapacity:select}=await j.import('../src/lib/fluid-capacity-conditions.ts');
const cases=[['8.9 л. для 2.0 D3 (D5204T3) 9.2 л. для 2.0 D4 (D4204T5)',['D5204T3','D4204T5'],[8.9,9.2],'ENGINE_COOLANT'],['5.5 л. для 2.0 T5 (B5204T9) 5.4 л. для 2.0 T5 (B5204T11)',['B5204T9','B5204T11'],[5.5,5.4],'ENGINE_OIL']];
for(const [text,codes,volumes,system]of cases){
 const parsed=parse(text,system,codes);assert.equal(parsed.status,'structured',parsed.reason);assert.equal(parsed.branches.length,2);
 for(let i=0;i<2;i++){assert.equal(select(parsed.branches,{engineCode:codes[i]}).capacity.nominalLiters,volumes[i]);assert.ok(parsed.branches[i].sourceSegment.includes(codes[i]));}
 for(const engineCode of [undefined,'WRONG'])assert.equal(select(parsed.branches,{engineCode}),null);
 assert.equal(parse(text,system,[]).status,'review');
 for(const bad of [text+' с АКПП',text+' Hybrid',text+' для России',text.replace('2.0 ','2.0MT '),text.replace(codes[1],codes[0])])assert.equal(parse(bad,system,codes).status,'review');
}
assert.equal(parse(cases[0][0].replace('2.0 D4','2.0 T5'),'ENGINE_COOLANT',cases[0][1]).status,'review');
console.log('PASS labeled engine capacities: exact membership/selection, preserved source, missing engine and unsupported suffix rejection');
