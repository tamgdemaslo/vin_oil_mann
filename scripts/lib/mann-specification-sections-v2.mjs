import {splitSpecificationSections as splitV1} from './mann-specification-sections.mjs';

export function splitSpecificationSections(text, analogText) {
 const prior=splitV1(text,analogText);
 if(prior.status!=='ANALOG_FIELD_MISMATCH')return prior;
 // An observed standalone replacement label is metadata, not an analog.
 // Retry using original offsets, never rewrite the source string to match.
 const original=String(text??''),marker=[...original.matchAll(/(?<![\p{L}\p{N}])Аналог(?:и)?\s*:/giu)][0];
 const start=marker.index+marker[0].length;
 const endMatch=/(?<![\p{L}\p{N}])(?:Периодичность\s+замены|Замена|Рекомендация|Контроль(?:\s+уровня)?)\s*:/iu.exec(original.slice(start));
 if(!endMatch)return prior;
 const end=start+endMatch.index,norm=s=>String(s??'').normalize('NFKC').replace(/\s+/gu,' ').trim();
 if(!norm(analogText)||norm(original.slice(start,end))!==norm(analogText))return prior;
 return {status:'EXPLICIT_ANALOG_SEPARATED',originalText:original,analogText:String(analogText),
  main:{start:0,end:marker.index,text:original.slice(0,marker.index)},
  marker:{start:marker.index,end:start,text:marker[0]},
  analog:{start,end,text:original.slice(start,end)},suffix:{start:end,end:original.length,text:original.slice(end)}};
}

export function specificationCautionSignals(value) {
 const text=String(value??'');
 // Review signals only: 'не ниже' is not a ban; no automatic removal.
 const patterns=[['UNCONFIRMED_EQUIVALENCE',/не\s+гарант[\p{L}]*/giu],
 ['PROHIBITION_OR_NONRECOMMENDATION',/(?:не\s+(?:допуска[\p{L}]*|рекоменду[\p{L}]*|применя[\p{L}]*|совмест[\p{L}]*)|несовмест[\p{L}]*|запрещ[\p{L}]*)/giu]];
 return patterns.flatMap(([kind,re])=>[...text.matchAll(re)].map(m=>({kind,start:m.index,end:m.index+m[0].length,text:m[0]})));
}
