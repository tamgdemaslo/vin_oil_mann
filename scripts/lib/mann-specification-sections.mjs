// Source attribution only. The main section is not automatically OEM verified.
// Preserve exact source text and offsets; do not infer chemical equivalence.
export function splitSpecificationSections(specificationText, analogText) {
 const text=String(specificationText??''), analog=String(analogText??'');
 const markers=[...text.matchAll(/(?<![\p{L}\p{N}])Аналог(?:и)?\s*:/giu)];
 const norm=s=>s.normalize('NFKC').replace(/\s+/gu,' ').trim();
 if(markers.length!==1)return {status:markers.length?'AMBIGUOUS_MARKERS':'NO_EXPLICIT_MARKER',originalText:text,analogText:analog};
 const marker=markers[0],start=marker.index+marker[0].length;
 const suffix=text.slice(start),endMatch=/(?<![\p{L}\p{N}])(?:Периодичность\s+замены|Рекомендация|Контроль(?:\s+уровня)?)\s*:/iu.exec(suffix);
 const end=endMatch?start+endMatch.index:text.length;
 const extracted=text.slice(start,end);
 if(!norm(analog)||norm(extracted)!==norm(analog))return {status:'ANALOG_FIELD_MISMATCH',originalText:text,analogText:analog,extractedAnalog:extracted};
 return {status:'EXPLICIT_ANALOG_SEPARATED',originalText:text,analogText:analog,
  main:{start:0,end:marker.index,text:text.slice(0,marker.index)},
  marker:{start:marker.index,end:start,text:marker[0]},
  analog:{start,end,text:extracted},suffix:{start:end,end:text.length,text:text.slice(end)}};
}
