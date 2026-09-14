/** Conservative full-month scope. Boundary-day applicability is never guessed. */
export function extractFluidSourceDateCondition(label: string) {
  const match = label.match(/^ОХЛАЖДАЮЩАЯ\s+ЖИДКОСТЬ\s+Модели:\s*(до|после|[сc])\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\s*$/iu);
  if (!match) return null;
  const [,operatorText,dayText,monthText,yearText] = match;
  const operator = operatorText.toLowerCase();
  const day = Number(dayText), month = Number(monthText), year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1886 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return {status:'INVALID_DATE' as const, label};
  const formatMonth = (index: number) => `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2,'0')}`;
  const index = year * 12 + month - 1, boundaryMonth = formatMonth(index);
  const since = /^[сc]$/iu.test(operator);
  return {status:'FULL_MONTH_SCOPE' as const, label, operator,
    sourceDate:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,
    from:operator === 'до' ? null : formatMonth(index + (since && day === 1 ? 0 : 1)),
    to:operator === 'до' ? formatMonth(index - 1) : null,
    unresolvedBoundaryMonth:since && day === 1 ? null : boundaryMonth,
    boundaryPolicy:'DO_NOT_INFER_DAY_FROM_PRODUCTION_MONTH' as const};
}
