import { normalizeEngineCode } from '@/lib/vehicle-normalization';

/** Literal evidence only: never assign an unlabelled power alternative to a code. */
export function extractFluidEngineLineContext(application: string, engineCode: string) {
  const code = normalizeEngineCode(engineCode);
  let section = 'model';
  const modelLines: string[] = [], powerLines: string[] = [];
  for (const raw of application.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^Модель\s*:/i.test(line)) section = 'model';
    else if (/^Мощность\s*:/i.test(line)) section = 'power';
    else if (/^(?:Тип топлива|Объ[её]м двигателя|Годы выпуска)\s*:/i.test(line)) section = 'other';
    if (!/^[-–—]\s+/.test(line)) continue;
    if (section === 'model') modelLines.push(line);
    if (section === 'power') powerLines.push(line);
  }
  const literalCodes = (line: string) => line.toUpperCase().match(/[A-ZА-ЯЁ0-9]+(?:[-.][A-ZА-ЯЁ0-9]+)*/g)?.map(normalizeEngineCode) ?? [];
  const matching = code ? modelLines.filter(line => literalCodes(line).includes(code)) : [];
  const parse = (line: string) => ({
    line,
    powerHp: [...line.matchAll(/(\d+(?:[.,]\d+)?)\s*л\.?\s*с\.?/gi)].map(m => Number(m[1].replace(',', '.'))),
    powerKw: [...line.matchAll(/(\d+(?:[.,]\d+)?)\s*кВт/gi)].map(m => Number(m[1].replace(',', '.'))),
    yearRanges: [...line.matchAll(/((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})/g)].map(m => ({from: Number(m[1]), to: Number(m[2])})),
    // Preserve exact text: 2WD must not be converted to front/rear drive.
    driveEvidence: [...line.matchAll(/\b(?:2WD|4WD|AWD|FWD|RWD)\b|(?:передний|задний)(?:\s+и\s+4WD)?\s+привод/gi)].map(m => m[0]),
    marketEvidence: [...line.matchAll(/Россия|Европа|США|Япония|Китай/gi)].map(m => m[0]),
  });
  const reasons: string[] = [];
  if (!code) reasons.push('INVALID_ENGINE_CODE');
  if (modelLines.length && !matching.length) reasons.push('MODEL_LINE_ENGINE_NOT_RESOLVED');
  if (matching.length > 1) reasons.push('MULTIPLE_MODEL_LINES_FOR_ENGINE');
  if (powerLines.length) reasons.push('UNASSIGNED_POWER_ALTERNATIVES');
  return {modelLineCount: modelLines.length, matchingLines: matching.map(parse),
    unassignedPowerAlternatives: powerLines.map(parse), reasons, publicationAllowed: false as const};
}

/** Intersect one literal line with an already traced engine anchor; never broaden. */
export function narrowFluidEngineLineScope(scope: Record<string, unknown>, context: ReturnType<typeof extractFluidEngineLineContext>) {
  const reasons = [...context.reasons];
  const result = {...scope};
  for (const line of context.matchingLines) {
    if (line.driveEvidence.length) reasons.push('DRIVE_CONDITION_NOT_SUPPORTED_BY_ENGINE_SCOPE');
    if (line.marketEvidence.length) reasons.push('MARKET_CONDITION_NOT_SUPPORTED_BY_ENGINE_SCOPE');
    for (const field of ['powerHp', 'powerKw'] as const) {
      const values = [...new Set(line[field])];
      if (values.length > 1) reasons.push(`AMBIGUOUS_${field}`);
      if (values.length === 1) {
        if (scope[field] != null && scope[field] !== values[0]) reasons.push(`CONFLICT_${field}`);
        else result[field] = values[0];
      }
    }
    if (line.yearRanges.length > 1) reasons.push('AMBIGUOUS_LINE_YEARS');
    if (line.yearRanges.length === 1) {
      const range = line.yearRanges[0];
      const start = scope.yearFrom == null ? range.from : Math.max(Number(scope.yearFrom), range.from);
      const end = scope.yearTo == null ? range.to : Math.min(Number(scope.yearTo), range.to);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) reasons.push('CONFLICT_LINE_YEARS');
      else { result.yearFrom = start; result.yearTo = end; }
    }
  }
  return {scope: reasons.length ? null : result, reasons: [...new Set(reasons)], publicationAllowed: false as const};
}
