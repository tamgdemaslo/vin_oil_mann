/** Offline explicit source branches only. No expansion of engine families or power rounding. */
export function nissanEnginePowerBranches(model, productionYears) {
  if (typeof model !== 'string' || typeof productionYears !== 'string') return null;
  const years=/^([0-9]{4}) *- *([0-9]{4})$/.exec(productionYears);
  if (!years || +years[1]>+years[2]) return null;
  const code='[A-Z]{2}[0-9]{2}[A-Z]{2}',power='[0-9]{2,3}(?:, *[0-9]{2,3})*';
  if (!new RegExp(`^- ${code} / ${power} л\\.с\\.(?: - ${code} / ${power} л\\.с\\.)*$`).test(model)) return null;
  const branches=[];
  for (const phrase of model.split(' - ')) {
    const sourcePhrase=phrase.startsWith('- ')?phrase:`- ${phrase}`;
    const parts=sourcePhrase.slice(2).split(' / '),engineCode=parts[0];
    for (const powerHp of parts[1].replace(' л.с.','').split(',').map(Number)) {
      if (!Number.isInteger(powerHp)||powerHp<=0) return null;
      branches.push({engineCode,powerHp,yearFrom:+years[1],yearTo:+years[2],sourcePhrase});
    }
  }
  if (new Set(branches.map(b=>`${b.engineCode}:${b.powerHp}`)).size!==branches.length) return null;
  return branches;
}
