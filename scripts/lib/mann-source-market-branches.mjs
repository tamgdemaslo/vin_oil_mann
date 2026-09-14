/** Offline triage only: consume the entire source phrase, never infer missing markets. */
export function sourceMarketBranches(model, productionYears) {
  const dates = text => {
    const monthly = /^(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{4})(?:\s*г\.)?$/.exec(text);
    if (monthly) {
      if ([+monthly[1],+monthly[3]].some(m=>m<1||m>12)) return null;
      const from=`${monthly[2]}-${monthly[1]}`,to=`${monthly[4]}-${monthly[3]}`;
      return from<=to ? {from,to} : null;
    }
    const m = /^(\d{4})\s*-\s*(\d{4}|н\.в\.)(?:\s*г\.)?$/.exec(text);
    if (!m || (m[2] !== 'н.в.' && +m[1] > +m[2])) return null;
    return {from: `${m[1]}-01`, to: m[2] === 'н.в.' ? null : `${m[2]}-12`};
  };
  if (typeof model !== 'string' || !model.startsWith('- ')) return null;
  const markets = {'Россия':'RU','Япония':'JP','Европа':'EU','Ю. Корея':'KR','Ю-В Азия':'SOUTHEAST_ASIA','США':'US','ОАЭ':'AE'};
  const branches = [];
  for (const phrase of model.slice(2).split(/\s+-\s+(?=[A-Z0-9-]*[A-Z])/)) {
    const parts = phrase.split(/\s*\/\s*/);
    if (parts.length < 3 || parts.length > 4) return null;
    const engine = /^([A-Z0-9]+(?:-[A-Z0-9]+)?(?:,\s*[A-Z0-9]+(?:-[A-Z0-9]+)?)*)(?: (Diesel|Turbo|Hybrid))?$/.exec(parts[0]);
    const powers = /^(\d{2,3}(?:,\s*\d{2,3})*)\s*(?:л\.с\.|лс)$/.exec(parts[1]);
    if (!engine || !powers) return null;
    const codes=engine[1].split(/,\s*/);
    if(codes.some(c=>!/[A-Z]/.test(c))||new Set(codes).size!==codes.length) return null;
    const tail = parts.slice(2), marketParts = tail.filter(p => Object.hasOwn(markets,p));
    if (marketParts.length !== 1) return null;
    const dateParts = tail.filter(p => p !== marketParts[0]);
    const window = dates(dateParts.length ? dateParts[0] : productionYears);
    if (!window) return null;
    const powerHp = powers[1].split(',').map(Number);
    if (new Set(powerHp).size !== powerHp.length || powerHp.some(p => p <= 0)) return null;
    for(const engineCode of codes) branches.push({engineCode,powerHp,market:markets[marketParts[0]],window,sourceQualifier:engine[2]??null,sourcePhrase:phrase});
  }
  return branches;
}
