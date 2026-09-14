// Offline counterfactual only: exact pre-compressed-parser tokenization.
export function splitMannEngineCodeList(value) {
  return String(value??'').split(/[;,/|]+/).map(part=>part.replace(/\b(?:AND ALWAYS|UND IMMER|FOR OUR COMPLETE).*$/i,'').trim());
}
