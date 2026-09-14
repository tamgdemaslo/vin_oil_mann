import {extractFluidSourceDateCondition} from './fluid-source-date-condition';

export function extractRawProductionCondition(value: string) {
  const text=value.trim();
  if(!/^(?:до|после|[сc])\s/iu.test(text))return null;
  const yearMatch=text.match(/^(до|после|[сc])\s+((?:19|20)\d{2})(?:\s+года?)?\s*$/iu);
  if(yearMatch){
    const operator=yearMatch[1].toLowerCase(),year=Number(yearMatch[2]);
    return {status:'SCOPED' as const,evidence:text,precision:'YEAR' as const,
      from:operator==='до'?null:`${year+(operator==='после'?1:0)}-01`,
      to:operator==='до'?`${year-1}-12`:null,unresolvedBoundaryMonth:null,
      interpretation:'BEFORE_YEAR_EXCLUSIVE_SINCE_YEAR_INCLUSIVE' as const};
  }
  const date=extractFluidSourceDateCondition(`ОХЛАЖДАЮЩАЯ ЖИДКОСТЬ Модели: ${text}`);
  if(date?.status==='FULL_MONTH_SCOPE')return {status:'SCOPED' as const,evidence:text,precision:'DAY' as const,
    from:date.from,to:date.to,unresolvedBoundaryMonth:date.unresolvedBoundaryMonth,sourceDate:date.sourceDate,
    interpretation:date.boundaryPolicy};
  return {status:'REVIEW' as const,evidence:text,reason:'UNRECOGNIZED_OR_INVALID_PRODUCTION_CONDITION'};
}
