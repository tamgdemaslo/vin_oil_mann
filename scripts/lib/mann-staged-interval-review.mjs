// Offline lexical extraction. Never establishes OEM approval or applicability.
function threshold(raw) {
 const text=raw.trim().replace(/[.,]+$/u,'').trim();
 const number='(?:\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d+(?:[.,]\\d+)?)';
 const km=`(${number})\\s*(тыс\\.?\\s*)?км\\.?`;
 const time='(\\d+)\\s*(лет|года?|мес\\.?(?:яц(?:а|ев)?)?)';
 let m=text.match(new RegExp(`^${km}$`,'iu'));
 const distance=(value,thousands)=>Number(value.replace(/[ \u00a0]/gu,'').replace(',','.'))*(thousands?1000:1);
 if(m)return {km:distance(m[1],m[2]),months:null,relationship:'SINGLE_THRESHOLD'};
 m=text.match(new RegExp(`^${time}$`,'iu'));
 const months=(value,unit)=>Number(value)*(/^мес/iu.test(unit)?1:12);
 if(m)return {km:null,months:months(m[1],m[2]),relationship:'SINGLE_THRESHOLD'};
 m=text.match(new RegExp(`^${km}\\s+(или)\\s+${time}$`,'iu'));
 if(m)return {km:distance(m[1],m[2]),months:months(m[4],m[5]),relationship:'SOURCE_OR'};
 m=text.match(new RegExp(`^${time}\\s+(или)\\s+${km}$`,'iu'));
 if(m)return {km:distance(m[4],m[5]),months:months(m[1],m[2]),relationship:'SOURCE_OR'};
 m=text.match(new RegExp(`^${km}\\s*\\(${time}\\)$`,'iu'));
 if(m)return {km:distance(m[1],m[2]),months:months(m[3],m[4]),relationship:'PARENTHETICAL_TIME_NOT_INFERRED_OR'};
 return null;
}
export function reviewStagedInterval(raw) {
 const text=String(raw??'').trim();
 const parts=text.split(/\s*(?:далее|затем|последующие)\s*/iu);
 if(parts.length!==2)return {status:'REVIEW_REQUIRED',reason:'NOT_EXACTLY_TWO_STAGES'};
 const first=parts[0].replace(/^по регламенту:\s*/iu,'').trim();
 let firstBody;
 if(/^первая(?:\s|:)/iu.test(first))firstBody=first.replace(/^первая\s*(?:замена)?\s*[:\-]?\s*(?:через|на)?\s*/iu,'');
 else if(/\s+для первой заливки\s*$/iu.test(first))firstBody=first.replace(/\s+для первой заливки\s*$/iu,'');
 else return {status:'REVIEW_REQUIRED',reason:'FIRST_STAGE_NOT_EXPLICIT'};
 const nextBody=parts[1].replace(/^(?:замены)?\s*[:\-]?\s*(?:каждые|через)?\s*:?\s*/iu,'');
 const initial=threshold(firstBody),subsequent=threshold(nextBody);
 if(!initial||!subsequent)return {status:'REVIEW_REQUIRED',reason:'UNCONSUMED_CONDITIONS_OR_UNSUPPORTED_GRAMMAR'};
 return {status:'EXACT_TWO_STAGE_TEXT',initial,subsequent,raw:text,publicationAllowed:false};
}
