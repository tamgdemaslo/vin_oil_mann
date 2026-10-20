/** Read-only management conclusions. No return queue, message drafts or service reminders. */
export type ManagementInsight = {
  id: string;
  title: string;
  evidence: string;
  recommendation: string;
  limitation: string;
  tone: "neutral" | "warning" | "good";
  actions: { label: string; clientKeys: string[] }[];
};
export type ManagementDocument = {
  clientKey: string;
  date: string;
  revenueCents: number;
  profitCents: number | null;
};
export type ManagementCase = { clientKey: string; nextContactDate: string | null; status: string };
const DAY = 86_400_000;
const time = (ymd: string) => Date.parse(`${ymd}T12:00:00Z`);
const valid = (ymd: string) => /^\d{4}-\d{2}-\d{2}$/.test(ymd) && Number.isFinite(time(ymd)) && new Date(time(ymd)).toISOString().slice(0, 10) === ymd;
const shift = (ymd: string, days: number) => new Date(time(ymd) + days * DAY).toISOString().slice(0, 10);
const money = (cents: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(cents / 100)} ₽`;
const date = (ymd: string) => ymd.split("-").reverse().join(".");
const keys = (documents: ManagementDocument[]) => [...new Set(documents.map(d => d.clientKey))];
const sum = (documents: ManagementDocument[]) => documents.reduce((total, d) => total + d.revenueCents, 0);

export function buildCustomerManagementInsights(input: {
  today: string;
  dateFrom: string | null;
  dateTo: string | null;
  documents: ManagementDocument[];
  cases: ManagementCase[];
  clientKeys: string[];
}): ManagementInsight[] {
  if (!valid(input.today)) return [];
  const end = input.dateTo && valid(input.dateTo) ? (input.dateTo < input.today ? input.dateTo : input.today) : input.today;
  const start = input.dateFrom && valid(input.dateFrom) ? input.dateFrom : null;
  if (start && start > end) return [];
  const documents = input.documents.filter(d => valid(d.date) && d.date <= end && Number.isSafeInteger(d.revenueCents));
  const inRange = (from: string, to: string) => documents.filter(d => d.date >= from && d.date <= to);
  const current = documents.filter(d => !start || d.date >= start);
  const insights: ManagementInsight[] = [];
  const history = new Map<string, string[]>();
  for (const d of documents) {
    const dates = history.get(d.clientKey);
    if (dates) dates.push(d.date);
    else history.set(d.clientKey, [d.date]);
  }
  for (const [key, dates] of history) history.set(key, [...new Set(dates)].sort());

  // Every member has a full, equally long 365-day observation window.
  const cohortEnd = shift(end, -365);
  const cohortStart = shift(start ?? shift(end, -29), -365);
  const cohort = [...history].filter(([, dates]) => dates[0] >= cohortStart && dates[0] <= cohortEnd);
  if (cohort.length) {
    const returned = cohort.filter(([, dates]) => dates.some(d => d > dates[0] && d <= shift(dates[0], 365)));
    const returnedKeys = new Set(returned.map(([key]) => key));
    const noRepeat = cohort.filter(([key]) => !returnedKeys.has(key)).map(([key]) => key);
    insights.push({
      id: "first-return", title: "Возврат после первого посещения",
      evidence: `Первое посещение ${date(cohortStart)}–${date(cohortEnd)}: ${cohort.length} чел. Повторно приехали в течение 365 дней: ${returned.length} (${Math.round(returned.length / cohort.length * 100)}%). Без повторного визита за этот срок: ${noRepeat.length}.`,
      recommendation: noRepeat.length ? "Разберите первые обслуживания клиентов без повторного визита: какие работы выполняли и был ли повод вернуться. Проверьте качество первого контакта и объяснение следующего обслуживания." : "Изучите обслуживание вернувшихся клиентов и используйте удачные приёмы при работе с новыми.",
      limitation: `${cohort.length < 10 ? "Малая выборка; обобщать результат рано. " : ""}365 дней — окно наблюдения, а не регламент ТО. Первое посещение определяется по доступной истории${input.dateFrom ? "; группа сдвинута на 365 дней относительно периода обзора" : "; группа — 30 дней год назад"}.`,
      tone: "neutral", actions: [
        { label: "Без повторного визита за год", clientKeys: noRepeat },
        { label: "Вернулись за год", clientKeys: returned.map(([key]) => key) },
      ].filter(a => a.clientKeys.length),
    });
  } else {
    insights.push({id: "first-return", title: "Возврат новых клиентов пока не оценить", evidence: `В доступной истории нет клиентов с первым посещением ${date(cohortStart)}–${date(cohortEnd)}.`, recommendation: "Для оценки возврата нужна история первых и повторных посещений с полным годом наблюдения. Проверьте полноту загруженных отгрузок.", limitation: "Отсутствие данных не означает, что клиенты не возвращаются.", tone: "neutral", actions: []});
  }

  if (start) {
    const days = Math.round((time(end) - time(start)) / DAY) + 1;
    const previousEnd = shift(start, -1), previousStart = shift(start, -days);
    const previous = inRange(previousStart, previousEnd);
    const revenue = sum(current), previousRevenue = sum(previous);
    const priorClients = new Set(previous.map(d => d.clientKey));
    const currentClients = new Set(current.map(d => d.clientKey));
    const absent = [...priorClients].filter(key => !currentClients.has(key));
    const first = (d: ManagementDocument) => history.get(d.clientKey)?.[0] === d.date;
    const newRevenue = (docs: ManagementDocument[]) => sum(docs.filter(first));
    if (previousRevenue > 0) {
      const delta = Math.round((revenue / previousRevenue - 1) * 100);
      const currentAvg = current.length ? Math.round(revenue / current.length) : 0;
      const previousAvg = Math.round(previousRevenue / previous.length);
      insights.push({id: "revenue-change", title: `Выручка ${delta > 0 ? "выросла" : delta < 0 ? "снизилась" : "на уровне прошлого периода"}${delta ? ` на ${Math.abs(delta)}%` : ""}`,
        evidence: `${money(revenue)} против ${money(previousRevenue)} за ${date(previousStart)}–${date(previousEnd)} (${days} дн.). Отгрузок: ${current.length} против ${previous.length}; средний чек: ${money(currentAvg)} против ${money(previousAvg)}. Выручка первых посещений: ${money(newRevenue(current))} против ${money(newRevenue(previous))}; остальных — ${money(revenue - newRevenue(current))} против ${money(previousRevenue - newRevenue(previous))}.`,
        recommendation: delta < 0 ? "Сопоставьте число обслуживаний и чек. Если сократилось число отгрузок — разберите посещаемость; если чек — состав работ и материалов. Начните с клиентов прошлого периода без визита в текущем." : "Проверьте, за счёт каких клиентов и работ получен результат. Оцените отдельно первые посещения и обслуживание знакомых клиентов.",
        limitation: "Равные по длине периоды; сезонность не учтена. Пауза между визитами не доказывает потерю клиента. Визит для чека = отгрузка; первые посещения объединяют документы одного дня.",
        tone: delta < 0 ? "warning" : delta > 0 ? "good" : "neutral",
        actions: [{label: "Клиенты текущего периода", clientKeys: keys(current)}, {label: "Были в прошлом, не были в текущем", clientKeys: absent}].filter(a => a.clientKeys.length),
      });
    } else {
      insights.push({id: "revenue-change", title: "Для динамики выручки нет базы сравнения", evidence: `За ${date(previousStart)}–${date(previousEnd)} нет положительной выручки по клиентам. В текущем периоде — ${money(revenue)}.`, recommendation: "Выберите более длинный период или проверьте полноту истории. По одной сумме нельзя определить рост или снижение.", limitation: "Сравниваются соседние периоды одинаковой длины.", tone: "neutral", actions: current.length ? [{label: "Клиенты текущего периода", clientKeys: keys(current)}] : []});
    }
  }

  const revenueByClient = new Map<string, number>();
  for (const d of current) revenueByClient.set(d.clientKey, (revenueByClient.get(d.clientKey) ?? 0) + d.revenueCents);
  const ranked = [...revenueByClient].filter(([, revenue]) => revenue > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = sum(current), top = ranked.slice(0, 5);
  if (total > 0 && top.length) {
    const share = Math.round(top.reduce((s, [, value]) => s + value, 0) / total * 100);
    insights.push({id: "concentration", title: ranked.length <= 5 ? "Выручку формирует небольшая группа клиентов" : `Пять клиентов дают ${share}% выручки`,
      evidence: `В выбранном периоде ${ranked.length} клиентов с положительной выручкой. На первых ${top.length} приходится ${money(top.reduce((s, [, v]) => s + v, 0))} из ${money(total)}.`,
      recommendation: ranked.length <= 5 ? "Расширьте период, чтобы оценить зависимость от крупнейших клиентов на большей выборке." : share >= 50 ? "Проверьте качество обслуживания крупнейших клиентов и развивайте следующую группу по выручке: какие услуги им нужны и что мешает обслуживаться у вас чаще." : "Выручка распределена между клиентами. Изучите потребности следующей группы по выручке и возможности развития обслуживания.",
      limitation: "Рейтинг по выручке, без оценки прибыльности. Высокий чек сам по себе не повод давать скидку.", tone: ranked.length > 5 && share >= 50 ? "warning" : "neutral",
      actions: [{label: "Крупнейшие клиенты", clientKeys: top.map(([key]) => key)}, {label: "Следующие по выручке", clientKeys: ranked.slice(5, 15).map(([key]) => key)}].filter(a => a.clientKeys.length),
    });
  }

  // CRM is a current operational signal, independent of historical reporting dates.
  const knownClients = new Set(input.clientKeys);
  const overdue = input.cases.filter(c => c.status === "open" && c.nextContactDate && valid(c.nextContactDate) && c.nextContactDate < input.today && knownClients.has(c.clientKey));
  if (overdue.length) {
    const clientKeys = [...new Set(overdue.map(c => c.clientKey))];
    insights.push({id: "overdue-cases", title: "Есть просроченные контакты с клиентами", evidence: `Открытых CRM-дел с датой следующего контакта раньше ${date(input.today)}: ${overdue.length}. Клиентов — ${clientKeys.length}.`, recommendation: "Откройте сводку клиента и связанное CRM-дело. Проверьте обещанный следующий шаг, свяжитесь с клиентом и зафиксируйте результат и новую дату.", limitation: "По состоянию на сегодня, независимо от периода обзора. Причина задержки и ожидание расходников автоматически не определяются.", tone: "warning", actions: [{label: "Клиенты с просроченным контактом", clientKeys}]});
  }
  const incomplete = current.filter(d => d.profitCents == null);
  if (incomplete.length) insights.push({id: "incomplete-profit", title: "Прибыль по части клиентов не подтверждена", evidence: `Отгрузок без полной себестоимости за выбранный период: ${incomplete.length}. Клиентов: ${keys(incomplete).length}.`, recommendation: "Проверьте позиции и закупочные цены в документах этих клиентов перед решениями о скидках и выгодности обслуживания.", limitation: "Неполная себестоимость не означает нулевую прибыль или убыток.", tone: "warning", actions: [{label: "Клиенты с неполной себестоимостью", clientKeys: keys(incomplete)}]});
  return insights;
}
