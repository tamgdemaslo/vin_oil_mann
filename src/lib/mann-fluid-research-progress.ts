import type { MannFluidResearchResult } from "./mann-fluid-research";
import { MANN_FLUID_GROUP_IDS, MANN_FLUID_GROUPS, type MannFluidGroup } from "./mann-fluid-systems";

/** Two bounded requests at a time. Each response has already been persisted. */
export async function runFluidResearchGroups(options: {
  request: (group: MannFluidGroup) => Promise<MannFluidResearchResult>;
  signal: AbortSignal;
  onProgress: (result: MannFluidResearchResult) => void;
  initial?: MannFluidResearchResult;
}) {
  const groups: NonNullable<MannFluidResearchResult["groups"]> = {};
  const results = new Map<MannFluidGroup, MannFluidResearchResult>();
  let serviceFailure: string | undefined;
  for (const group of MANN_FLUID_GROUP_IDS) {
    const scope = MANN_FLUID_GROUPS[group].systems;
    const prior = options.initial;
    if (prior) results.set(group, { ...prior, items: prior.items.filter(i => scope.includes(i.systemCode)), systems: prior.systems?.filter(i => scope.includes(i.systemCode)), unresolved: [] });
    groups[group] = prior?.groups?.[group]?.status === "done" ? prior.groups[group] : { status: "queued", message: "Ожидает поиска" };
  }
  const publish = () => {
    if (options.signal.aborted) return;
    const states = Object.values(groups);
    const done = states.filter(g => g.status === "done").length;
    const failed = states.filter(g => g.status === "failed").length;
    const searching = states.some(g => g.status === "queued" || g.status === "searching");
    const values = [...results.values()];
    options.onProgress({
      status: searching ? "searching" : done ? "saved" : "unavailable",
      items: values.flatMap(r => r.items), systems: values.flatMap(r => r.systems ?? []),
      unresolved: [...new Set(values.flatMap(r => r.unresolved ?? []))],
      groups: structuredClone(groups),
      message: searching ? `Завершено групп: ${done} из ${states.length}. Найденное сохраняется сразу.` : serviceFailure ?? (failed ? `Завершено групп: ${done} из ${states.length}. ${done ? "Повторите незавершённые; сохранённые данные не потеряны." : "Поиск не завершён, новых данных нет."}` : "Все группы проверены. Найденное сохранено; пропуски отмечены отдельно."),
    });
  };
  publish();
  const queue = MANN_FLUID_GROUP_IDS.filter(group => groups[group]?.status !== "done");
  const worker = async () => {
    while (queue.length && !options.signal.aborted) {
      const group = queue.shift()!;
      groups[group] = { status: "searching", message: "Идёт поиск" }; publish();
      try {
        let result = await options.request(group);
        // Another tab may own the DB claim; poll only that group, with a bound.
        for (let attempt = 0; result.status === "searching" && attempt < 40 && !options.signal.aborted; attempt++) {
          await new Promise<void>(resolve => {
            const stop = () => { clearTimeout(timer); options.signal.removeEventListener("abort", stop); resolve(); };
            const timer = setTimeout(stop, 3000);
            options.signal.addEventListener("abort", stop, { once: true });
            if (options.signal.aborted) stop();
          });
          if (!options.signal.aborted) result = await options.request(group);
        }
        if (options.signal.aborted) return;
        if (["network", "access", "quota", "rate_limit"].includes(result.errorCode ?? "")) {
          serviceFailure = result.message;
          // Do not spend another wave of requests on a service-wide failure.
          for (const waiting of queue.splice(0)) groups[waiting] = { status: "failed", message: result.message };
        }
        if (result.status === "saved" || result.status === "complete") {
          const scope = MANN_FLUID_GROUPS[group].systems;
          results.set(group, { ...result, items: result.items.filter(i => scope.includes(i.systemCode)), systems: result.systems?.filter(i => scope.includes(i.systemCode)) });
          groups[group] = { status: "done", message: result.message };
        } else groups[group] = { status: "failed", message: result.message };
      } catch {
        if (options.signal.aborted) return;
        groups[group] = { status: "failed", message: "Запрос группы прерван. Сохранённые группы доступны." };
      }
      publish();
    }
  };
  await Promise.all([worker(), worker()]);
}
