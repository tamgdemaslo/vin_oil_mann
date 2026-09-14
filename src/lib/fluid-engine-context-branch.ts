import { normalizeEngineCode } from '@/lib/vehicle-normalization';

/** Narrow a source requirement by one proven same-table engine row. No writes. */
export function narrowFluidEngineContext(source: Record<string, unknown>, sourceRow: Record<string, unknown>, anchor: Record<string, unknown>, anchorRow: Record<string, unknown>, engine: string) {
  const reasons: string[] = [];
  const code = normalizeEngineCode(engine);
  const codes = (r: Record<string, unknown>) => [r.engineCodeNormalized, ...(Array.isArray(r.engineCodesJson) ? r.engineCodesJson : [])]
    .filter((v): v is string => typeof v === 'string').map(normalizeEngineCode);
  if (!code || /^(?:2WD|4WD|AWD|FWD|RWD|4X4|4X2)$/.test(code) || !codes(source).includes(code) || !codes(anchor).includes(code)) reasons.push('ENGINE_NOT_IN_BOTH_SOURCE_CONTEXTS');
  if (source.sourceRowId !== sourceRow.row_id || anchor.sourceRowId !== anchorRow.row_id ||
      source.sourceUrl !== sourceRow.source_url || anchor.sourceUrl !== anchorRow.source_url ||
      sourceRow.source_url !== anchorRow.source_url || sourceRow.table_index !== anchorRow.table_index ||
      !Number.isInteger(sourceRow.table_index)) reasons.push('ENGINE_ANCHOR_NOT_SAME_SOURCE_TABLE');
  if (anchor.systemCode !== 'ENGINE_OIL' || anchor.contextConfidence !== 'row_engine') reasons.push('ANCHOR_NOT_EXPLICIT_ENGINE_ROW');
  if (source.systemCode === 'ENGINE_OIL' && source.sourceRowId !== anchor.sourceRowId) reasons.push('ENGINE_OIL_REQUIRES_OWN_ROW');
  const year = (value: unknown, fallback: number) => value == null ? fallback :
    typeof value === 'number' && Number.isInteger(value) && value >= 1886 && value <= 2100 ? value : NaN;
  const start = Math.max(year(source.yearFrom, -Infinity), year(anchor.yearFrom, -Infinity));
  const end = Math.min(year(source.yearTo, Infinity), year(anchor.yearTo, Infinity));
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) reasons.push('ENGINE_YEAR_SCOPE_CONFLICT');
  const narrowed: Record<string, unknown> = {...source, engineCodeNormalized: code, engineCodesJson: [code],
    yearFrom: start === -Infinity ? null : start, yearTo: end === Infinity ? null : end};
  for (const field of ['engineVolumeCc', 'powerHp', 'powerKw', 'fuelType']) {
    const original = source[field], specific = anchor[field];
    if (specific != null && (field === 'fuelType' ? typeof specific !== 'string' || !specific : typeof specific !== 'number' || !Number.isFinite(specific) || specific <= 0)) reasons.push(`INVALID_ANCHOR_${field}`);
    if (original != null && specific != null && original !== specific) reasons.push(`SOURCE_ANCHOR_CONFLICT_${field}`);
    narrowed[field] = specific ?? original ?? null;
  }
  return {requirement: reasons.length ? null : narrowed, reasons};
}
