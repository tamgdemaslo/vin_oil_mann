// Recover a prefix only when the SAME source phrase spells it out and repeats
// the exact three-digit family. Never derive it from the target catalog/fuel.
export function mercedesSourceEngineEvidence(model) {
  if(typeof model!=='string')return [];
  return [...model.matchAll(/\b(\d{3}\.\d{3})\s*\((OM|M)\s+(\d{3})\b[^)]*\)/g)]
    .filter(m=>m[1].slice(0,3)===m[3])
    .map(m=>({code:`${m[2]}${m[1]}`,sourcePhrase:m[0],offset:m.index}));
}
