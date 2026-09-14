// Offline recovery of explicit source branches only; no hybrid/power inference.
export function nissanXtrailEngineBranches(text) {
  const match = /^- (MR20-RM31) Hybrid \/ (\d{4})-(\d{4}) - (MR20DD) \/ (\d{3}) л\.с\. \/ (\d{4})-(\d{4})$/.exec(text);
  if (!match) return null;
  const [, hybrid, hybridFrom, hybridTo, engine, power, from, to] = match;
  if (+hybridFrom > +hybridTo || +from > +to || +power <= 0) return null;
  return [
    {engineCode: hybrid, powerHp: null, hybrid: true, yearFrom: +hybridFrom, yearTo: +hybridTo, sourcePhrase: `- ${hybrid} Hybrid / ${hybridFrom}-${hybridTo}`},
    {engineCode: engine, powerHp: +power, hybrid: false, yearFrom: +from, yearTo: +to, sourcePhrase: `- ${engine} / ${power} л.с. / ${from}-${to}`},
  ];
}
