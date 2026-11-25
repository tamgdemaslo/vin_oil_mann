export type AnalyticsDocument = {
  id: string; branch: string; card: string | null; phone: string | null;
  date: string; booking: string | null; retail: boolean;
  services: string[]; source?: string | null; revenue: number; profit: number | null;
};
export type AnalyticsPeriod = { from: string; to: string };
type Visit = { branch: string; date: string; documents: AnalyticsDocument[] };
const day = (value: string) => Date.parse(value + "T00:00:00Z") / 86_400_000;
const within = (date: string, range: AnalyticsPeriod) => date >= range.from && date <= range.to;

export function calculateCustomerCohorts(input: {
  documents: AnalyticsDocument[]; periods: AnalyticsPeriod[]; asOf: string;
  scope: string; services: string[]; threshold: number; completeHistory: boolean;
  firstBranch?: string;
}) {
  const { documents, periods, asOf, scope, threshold, completeHistory } = input;
  const relevant = (doc: AnalyticsDocument) => !input.services.length || doc.services.some((id) => input.services.includes(id));
  const inScope = (branch: string) => scope === "network" || scope === branch;
  const clients = new Map<string, Map<string, Visit>>();
  for (const doc of documents) {
    if (!doc.card || doc.retail || doc.date > asOf) continue;
    const id = doc.phone ? `phone:${doc.phone}` : `card:${doc.branch}:${doc.card}`;
    const visits = clients.get(id) ?? new Map<string, Visit>();
    clients.set(id, visits);
    const key = doc.booking ? `${doc.branch}:booking:${doc.booking}` : `${doc.branch}:document:${doc.id}`;
    const visit = visits.get(key) ?? { branch: doc.branch, date: doc.date, documents: [] };
    visits.set(key, visit);
    if (doc.date < visit.date) visit.date = doc.date;
    visit.documents.push(doc);
  }
  const histories = [...clients.entries()].map(([id, visits]) => {
    const ordered = [...visits.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { ordered, noPhone: id.startsWith("card:") };
  });
  const comparisons = periods.map((period) => {
    const result = { unique: 0, newNetwork: 0, transfer: 0, repeat: 0, unknown: 0, regular: 0, noPhone: 0, knownFirst: 0 };
    const transfers: Record<string, number> = {};
    for (const { ordered, noPhone } of histories) {
      const local = ordered.filter((visit) => inScope(visit.branch));
      const eligible = local.filter((visit) => visit.date <= period.to && visit.documents.some(relevant));
      if (!eligible.some((visit) => within(visit.date, period))) continue;
      result.unique++;
      if (noPhone) result.noPhone++;
      if (eligible.length >= threshold) result.regular++;
      const first = ordered[0];
      const localFirst = local[0];
      const ambiguous = ordered.some((visit) => visit.date === first.date && visit.branch !== first.branch);
      const known = completeHistory && !noPhone && !ambiguous;
      if (localFirst.date < period.from) result.repeat++;
      else {
        result.knownFirst++;
        if (!known) result.unknown++;
        else if (first.date === localFirst.date) result.newNetwork++;
        else result.transfer++;
      }
      if (!known) continue;
      const destinations = new Set(ordered.map((visit) => visit.branch));
      destinations.delete(first.branch);
      for (const destination of destinations) {
        const arrival = ordered.find((visit) => visit.branch === destination)!;
        if (inScope(destination) && arrival.date > first.date && within(arrival.date, period) && arrival.documents.some(relevant)) {
          const direction = `${first.branch} → ${destination}`;
          transfers[direction] = (transfers[direction] ?? 0) + 1;
        }
      }
    }
    return {
      ...period, ...result, transfers, days: day(period.to) - day(period.from) + 1,
      anonymous: documents.filter((doc) => doc.retail && inScope(doc.branch) && within(doc.date, period) && relevant(doc)).length,
    };
  });

  const groups = new Map<string, typeof histories>();
  for (const history of histories) {
    const first = history.ordered[0];
    if (history.ordered.some((visit) => visit.date === first.date && visit.branch !== first.branch)) continue;
    if (input.firstBranch && first.branch !== input.firstBranch) continue;
    if (!first.documents.some(relevant)) continue;
    const channels = new Set(history.ordered.filter((visit) => visit.date === first.date)
      .flatMap((visit) => visit.documents.map((doc) => doc.source).filter(Boolean)));
    const channel = completeHistory && !history.noPhone && channels.size === 1 ? [...channels][0] : null;
    const monthBranch = `${first.date.slice(0, 7)}|${first.branch}`;
    for (const key of [monthBranch, `${monthBranch}|${channel ?? "Источник неизвестен"}`]) {
      const group = groups.get(key) ?? [];
      group.push(history);
      groups.set(key, group);
    }
  }
  const cohorts = [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).flatMap(([key, members]) => {
    const [month, branch, source] = key.split("|");
    return [90, 180, 365].map((window) => {
      let mature = 0, returned = 0, same = 0, other = 0, revenue = 0, profit = 0, withCost = 0, operations = 0;
      for (const { ordered } of members) {
        const start = day(ordered[0].date);
        if (day(asOf) - start < window) continue;
        mature++;
        const visits = ordered.filter((visit) => day(visit.date) - start <= window && visit.documents.some(relevant));
        const repeat = visits.filter((visit) => visit !== ordered[0]);
        if (repeat.length) returned++;
        if (repeat.some((visit) => visit.branch === branch)) same++;
        const firstReturn = repeat[0];
        if (firstReturn && firstReturn.branch !== branch &&
            !repeat.some((visit) => visit.date === firstReturn.date && visit.branch !== firstReturn.branch)) other++;
        for (const visit of visits) {
          for (const doc of visit.documents) {
            if (!relevant(doc)) continue;
            operations++;
            revenue += doc.revenue;
            if (doc.profit !== null) { profit += doc.profit; withCost++; }
          }
        }
      }
      return {
        month, branch, window, size: members.length, mature, returned, didNotReturn: mature - returned,
        immature: members.length - mature, same, other, withCost, operations,
        retention: mature ? returned / mature : null,
        revenueLtv: mature ? revenue / mature : null,
        profitLtv: mature && withCost === operations ? profit / mature : null,
        source: source ?? null,
      };
    });
  });
  const visits = histories.flatMap(({ ordered }) => ordered);
  return { comparisons, cohorts, linkedMultiDocumentVisits: visits.filter((v) => v.documents.length > 1).length, visitCount: visits.length };
}
