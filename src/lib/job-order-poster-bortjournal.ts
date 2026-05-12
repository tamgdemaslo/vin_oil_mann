import { pickJournalOilNoteFromRawRows } from "@/lib/job-order-poster-oil-note";
import { moyskladFetch } from "@/lib/moysklad";
import type { PosterHistoryRow } from "@/lib/job-order-poster-types";

type AttrRow = { id?: string; name?: string; value?: unknown };

type DemandListRow = {
  id: string;
  name?: string;
  moment: string;
  attributes?: AttrRow[];
};

type RawPos = {
  quantity?: number;
  discount?: number;
  assortment?: { name?: string; meta?: { type?: string; href?: string } };
};

function formatAttrValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "да" : "нет";
  return JSON.stringify(value);
}

function parseIntRu(s: string): number {
  const digits = s.replace(/\s/g, "").replace(/[^\d-]/g, "");
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

function formatDemandDateRu(momentStr: string): string {
  const normalized = momentStr.includes("T") ? momentStr : momentStr.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return momentStr;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function normalizeVin(v: string): string {
  return v.replace(/\s/g, "").toUpperCase();
}

function normalizePlateDisplay(s: string): string {
  return s.replace(/\s/g, "").toUpperCase();
}

function mileageFromAttrs(attrs: AttrRow[] | undefined): number | null {
  if (!attrs?.length) return null;
  for (const a of attrs) {
    const n = (a.name ?? "").toLowerCase();
    if (!/пробег|одометр|mileage/i.test(n)) continue;
    const km = parseIntRu(formatAttrValue(a.value));
    if (km > 0) return km;
  }
  return null;
}

function vinFromAttrs(attrs: AttrRow[] | undefined): string {
  if (!attrs?.length) return "";
  for (const a of attrs) {
    const n = (a.name ?? "").trim().toLowerCase();
    if (!/^vin|^вин\b|vin\s*номер/i.test(n)) continue;
    const v = formatAttrValue(a.value).trim();
    if (v) return v;
  }
  for (const a of attrs) {
    const n = (a.name ?? "").trim().toLowerCase();
    if (n === "vin" || n === "вин") {
      const v = formatAttrValue(a.value).trim();
      if (v) return v;
    }
  }
  return "";
}

function plateFromAttrs(attrs: AttrRow[] | undefined): string {
  if (!attrs?.length) return "";
  for (const a of attrs) {
    const label = (a.name ?? "").trim();
    if (!label || /vin|вин/i.test(label)) continue;
    if (/телефон|phone|контакт|email/i.test(label)) continue;
    if (/гос|государствен|регистрац|рег\s*знак|plate|номер\s*а\/м|номер\s*авто/i.test(label)) {
      const v = formatAttrValue(a.value).trim();
      if (v) return v;
    }
  }
  return "";
}

function sameVehicleRow(
  row: DemandListRow,
  currentVin: string,
  currentPlate: string
): boolean {
  const cv = currentVin.trim();
  const cp = currentPlate.trim();
  if (!cv || cv === "—") return true;

  const rowVin = vinFromAttrs(row.attributes);
  const rowPlate = plateFromAttrs(row.attributes);

  if (rowVin) return normalizeVin(rowVin) === normalizeVin(cv);

  if (cp && cp !== "—" && rowPlate)
    return normalizePlateDisplay(rowPlate) === normalizePlateDisplay(cp);

  /** Старые отгрузки без VIN/госномера в допполях остаются в цепочке. */
  if (!rowVin && !rowPlate) return true;

  /** Есть госномер в строке, в текущем документе не заполнен — не отсекаем. */
  if (!rowVin && rowPlate && (!cp || cp === "—")) return true;

  return false;
}

async function fetchOilForDemand(
  id: string,
  currentDemandId: string,
  currentRawRows: RawPos[]
): Promise<string> {
  if (id === currentDemandId) return pickJournalOilNoteFromRawRows(currentRawRows);
  const res = await moyskladFetch<{ rows?: RawPos[] }>(
    `/entity/demand/${encodeURIComponent(id)}/positions?expand=assortment&limit=50`,
    { cache: "no-store" }
  );
  if (!res.ok) return "";
  return pickJournalOilNoteFromRawRows(res.data.rows ?? []);
}

export type PosterBortJournalFromMs = {
  /** Строки для шкалы (последние `displayVisits` визитов, по времени слева направо). */
  rows: PosterHistoryRow[];
  /** Сколько отгрузок попало в выборку по контрагенту/авто (до лимита API). */
  totalMatching: number;
  /** Дата самого раннего визита в этой выборке — для «с DD.MM.YYYY». */
  sinceVisitRu: string;
};

/**
 * История визитов и пробегов из МойСклад (по контрагенту отгрузки), без зависимости от синка аналитики в БД.
 */
export async function fetchPosterBortJournalFromMoySklad(params: {
  agentHref: string;
  currentDemandId: string;
  currentVin: string;
  currentPlate: string;
  currentMileage: number;
  rawRows: RawPos[];
  /** Сколько последних визитов показать на постере (остальное только в счётчике). */
  displayVisits?: number;
}): Promise<PosterBortJournalFromMs | null> {
  const {
    agentHref,
    currentDemandId,
    currentVin,
    currentPlate,
    currentMileage,
    rawRows,
    displayVisits = 5,
  } = params;

  const qs = new URLSearchParams();
  qs.set("filter", `agent=${agentHref}`);
  qs.set("limit", "100");
  qs.set("order", "moment,desc");
  qs.set("expand", "attributes");

  const listRes = await moyskladFetch<{ rows?: DemandListRow[] }>(`/entity/demand?${qs.toString()}`, {
    cache: "no-store",
  });
  if (!listRes.ok) return null;

  let rows = listRes.data.rows ?? [];
  const filterByCar = currentVin.trim() && currentVin !== "—";
  if (filterByCar) {
    rows = rows.filter((r) => sameVehicleRow(r, currentVin, currentPlate));
  }

  const totalMatching = rows.length;
  if (totalMatching === 0) return null;

  const oldestMoment = rows.reduce<string>((earliest, r) => {
    return new Date(r.moment).getTime() < new Date(earliest).getTime() ? r.moment : earliest;
  }, rows[0]!.moment);
  const sinceVisitRu = formatDemandDateRu(oldestMoment);

  /** На постере — только последние displayVisits (самые новые), на шкале слева направо по времени. */
  const windowRows = rows.slice(0, displayVisits).reverse();

  const oilNotes = await Promise.all(
    windowRows.map((r) => fetchOilForDemand(r.id, currentDemandId, rawRows))
  );

  const posterRows = windowRows.map((r, i) => {
    let km = mileageFromAttrs(r.attributes);
    if ((km == null || km <= 0) && r.id === currentDemandId && currentMileage > 0) {
      km = currentMileage;
    }
    return {
      date: formatDemandDateRu(r.moment),
      km: km != null && km > 0 ? km : null,
      note: oilNotes[i] || "—",
    };
  });

  return { rows: posterRows, totalMatching, sinceVisitRu };
}
