import OpenAI from "openai";
import { prisma } from "@/lib/db";
import { getOilLineBaseName, parsePackVolumeLitersFromOilName } from "@/lib/oil-pack-volume";
import { normalizeSAE, normalizeOEM, normalizeACEA, normalizeAPI } from "@/lib/oil-normalizer";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import type {
  VinDecodeResponse,
  OilRequirements,
  OilProduct,
  OilRecommendationItem,
} from "@/types/oil";

const CACHE_DAYS = Math.min(30, Math.max(1, parseInt(process.env.OIL_CACHE_DAYS ?? "7", 10) || 7));
const CACHE_TTL_MS = CACHE_DAYS * 24 * 60 * 60 * 1000;
const cache = new Map<string, { requirements: OilRequirements; at: number }>();
const OIL_PRODUCTS_CACHE_TTL_MS = Math.max(
  60_000,
  parseInt(process.env.MOYSKLAD_LOOKUP_OIL_CACHE_MS ?? "1800000", 10) || 1_800_000
);
type BranchOilProductsCache = {
  snapshot: { at: number; products: OilProduct[] } | null;
  inFlight: Promise<OilProduct[]> | null;
};
const oilProductsCacheByBranch = new Map<string, BranchOilProductsCache>();
const oilCandidatesCache = new Map<string, { at: number; products: OilProduct[] }>();

function getBranchOilProductsCache(branchId = getScopedBranchId()): BranchOilProductsCache {
  const existing = oilProductsCacheByBranch.get(branchId);
  if (existing) return existing;
  const created = { snapshot: null, inFlight: null };
  oilProductsCacheByBranch.set(branchId, created);
  return created;
}

function getCacheKey(vin: string, market?: string): string {
  return `${vin.toUpperCase()}|${(market ?? "").trim()}`;
}

export function getCachedRequirements(vin: string, market?: string): OilRequirements | null {
  const key = getCacheKey(vin, market);
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.at > CACHE_TTL_MS) return null;
  return entry.requirements;
}

export function setCachedRequirements(vin: string, market: string | undefined, requirements: OilRequirements): void {
  cache.set(getCacheKey(vin, market), { requirements, at: Date.now() });
}

/** OpenAI: структурированный ответ по требованиям масла (SAE, OEM, ACEA, API, объём). */
export async function getOilRequirementsFromOpenAI(
  openai: OpenAI,
  decoded: VinDecodeResponse
): Promise<OilRequirements> {
  const vehicle = [
    decoded.vin && `VIN: ${decoded.vin}`,
    decoded.make && `Марка: ${decoded.make}`,
    decoded.model && `Модель: ${decoded.model}`,
    decoded.year && `Год: ${decoded.year}`,
    decoded.engine && `Двигатель: ${decoded.engine}`,
    decoded.trim && `Модификация: ${decoded.trim}`,
    decoded.series && `Серия/поколение: ${decoded.series}`,
    decoded.market && `Рынок: ${decoded.market}`,
    decoded.region && `Регион: ${decoded.region}`,
    ...(decoded.hints ?? []).map((hint) => `Подсказка: ${hint}`),
  ]
    .filter(Boolean)
    .join("\n");

  const model = process.env.OPENAI_OIL_MODEL?.trim() || "gpt-4o-mini";
  let completion: Awaited<ReturnType<typeof openai.chat.completions.create>>;
  try {
    completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: `Ты — эксперт по моторным маслам. По данным автомобиля верни JSON с требованиями к маслу.
Работай как извлекатель технических фактов, а не как продавец масла.
Используй конкретные поля двигателя, модификации, года, рынка и поколения. Не обобщай до всей модели, если указан двигатель.
Не объединяй допуски, которые относятся к разным двигателям, рынкам или условиям эксплуатации.
Для OEM-допусков ищи именно спецификации производителя: Ford WSS-M2C..., BMW LL-..., VW 50x.xx, MB 229.x, GM dexos и т.п.
Для Ford не ограничивайся API/ACEA, если по двигателю и году можно определить Ford WSS-спецификацию.
Если точный допуск или объём нельзя определить для указанного двигателя, верни пустой массив/null и понизь confidence.
Формат ответа (только валидный JSON, без markdown):
{
  "oil_capacity_liters": число или null,
  "oil_capacity_note": "с фильтром" или "без фильтра" или "",
  "sae_viscosities": ["5W-30"] или ["0W-20","5W-30"] — массив допустимых вязкостей SAE,
  "oem_approvals": ["VW 504 00","VW 507 00"] — допуски производителей,
  "acea": ["C3"],
  "api": ["SN"],
  "ilsac": ["GF-5","GF-6"] или [] — если ILSAC указано отдельно от API,
  "confidence": 0.0-1.0,
  "source_hint": "кратко на чём основано"
}
SAE всегда в формате XW-YY (например 5W-30). OEM — канонические обозначения (VW 504 00, MB 229.5, BMW LL-04, dexos2 и т.д.).`,
        },
        { role: "user", content: `Данные автомобиля:\n${vehicle || "(только VIN)"}\n\nВерни JSON с требованиями к моторному маслу.` },
      ],
response_format: { type: "json_object" },
    max_completion_tokens: 8192,
  });
  } catch (e) {
    const err = e as { message?: string; status?: number; code?: string; error?: { message?: string; code?: string } };
    console.error("[oil-recommendations] OpenAI API error:", err?.error?.message ?? err?.message, "model=" + model, err?.status != null ? "status=" + err.status : "", err?.error?.code ?? err?.code ?? "");
    throw e;
  }

  const text = completion.choices[0]?.message?.content?.trim() ?? "{}";
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const parsedIlsac = parsed["ilsac"];
    let oilCapacityLiters =
      typeof parsed.oil_capacity_liters === "number" && Number.isFinite(parsed.oil_capacity_liters)
        ? parsed.oil_capacity_liters
        : undefined;
    let oilCapacityNote = typeof parsed.oil_capacity_note === "string" ? parsed.oil_capacity_note : undefined;
    let sourceHint = typeof parsed.source_hint === "string" ? parsed.source_hint : undefined;

    if (oilCapacityLiters == null) {
      const volumeAttempt = await getOilCapacityFallbackFromOpenAI(openai, model, vehicle);
      if (volumeAttempt.oil_capacity_liters != null && volumeAttempt.oil_capacity_liters > 0) {
        oilCapacityLiters = volumeAttempt.oil_capacity_liters;
        oilCapacityNote = volumeAttempt.oil_capacity_note ?? oilCapacityNote;
        sourceHint = [sourceHint, volumeAttempt.source_hint].filter(Boolean).join(" | ");
      }
    }
    if (process.env.NODE_ENV === "development") {
      console.log("[oil-recommendations] OpenAI raw:", JSON.stringify({
        oil_capacity_liters: oilCapacityLiters,
        oem_approvals: parsed.oem_approvals,
        acea: parsed.acea,
        sae_viscosities: parsed.sae_viscosities,
        source_hint: sourceHint,
      }));
    }
                return {
                  oil_capacity_liters: oilCapacityLiters,
                  oil_capacity_note: oilCapacityNote,
                  sae_viscosities: Array.isArray(parsed.sae_viscosities)
                    ? (parsed.sae_viscosities as string[]).filter((s) => typeof s === "string")
                    : [],
                  oem_approvals: Array.isArray(parsed.oem_approvals)
                    ? (parsed.oem_approvals as string[]).filter((s) => typeof s === "string")
                    : [],
                  acea: Array.isArray(parsed.acea) ? (parsed.acea as string[]).filter((s) => typeof s === "string") : [],
                  api: Array.isArray(parsed.api) ? (parsed.api as string[]).filter((s) => typeof s === "string") : [],
                  ilsac: Array.isArray(parsedIlsac)
                    ? (parsedIlsac as string[]).filter((s) => typeof s === "string")
                    : undefined,
                  confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
                  source_hint: sourceHint,
                };
  } catch {
    return {
      sae_viscosities: [],
      oem_approvals: [],
      acea: [],
      api: [],
                  ilsac: undefined,
      confidence: 0,
      source_hint: "OpenAI ответ не распознан",
    };
  }
}

async function getOilCapacityFallbackFromOpenAI(
  openai: OpenAI,
  model: string,
  vehicle: string
): Promise<Pick<OilRequirements, "oil_capacity_liters" | "oil_capacity_note" | "source_hint">> {
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: `Ты определяешь только заправочный объём моторного масла.
Верни только JSON:
{
  "oil_capacity_liters": число или null,
  "oil_capacity_note": "с фильтром" или "без фильтра" или "",
  "source_hint": "кратко на чем основана оценка"
}
Если точный объем недоступен, но есть наиболее вероятный сервисный объем для этой модели/двигателя, верни его как best-effort оценку, а в source_hint явно напиши, что это оценка.`,
      },
      {
        role: "user",
        content: `Определи только заправочный объем моторного масла.\n\n${vehicle || "(нет данных)"}`,
      },
    ],
    response_format: { type: "json_object" },
    max_completion_tokens: 2048,
  });

  const text = completion.choices[0]?.message?.content?.trim() ?? "{}";
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const oilCapacityLiters =
      typeof parsed.oil_capacity_liters === "number" && Number.isFinite(parsed.oil_capacity_liters)
        ? parsed.oil_capacity_liters
        : undefined;
    return {
      oil_capacity_liters: oilCapacityLiters,
      oil_capacity_note: typeof parsed.oil_capacity_note === "string" ? parsed.oil_capacity_note : undefined,
      source_hint: typeof parsed.source_hint === "string" ? parsed.source_hint : undefined,
    };
  } catch {
    return {};
  }
}

function mergeUnique(values: string[][]): string[] {
  return [...new Set(values.flat().filter(Boolean))];
}

function decimalToNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    const n = value.toNumber();
    return typeof n === "number" && Number.isFinite(n) ? n : undefined;
  }
  const parsed = Number(value ?? NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function attributesSearchText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((attr) => {
      if (!attr || typeof attr !== "object") return "";
      const record = attr as Record<string, unknown>;
      const raw = record.value;
      if (raw && typeof raw === "object") {
        const nested = raw as Record<string, unknown>;
        return String(nested.name ?? nested.value ?? "");
      }
      return String(raw ?? "");
    })
    .filter(Boolean)
    .join(" ");
}

function enrichOilLineRequirements(oils: OilProduct[]): OilProduct[] {
  const byBase = new Map<string, OilProduct[]>();
  for (const oil of oils) {
    const base = getOilLineBaseName(oil.name, oil.volume_liters).toLowerCase();
    const list = byBase.get(base);
    if (list) list.push(oil);
    else byBase.set(base, [oil]);
  }

  for (const group of byBase.values()) {
    if (group.length < 2) continue;
    const merged = {
      sae: mergeUnique(group.map((oil) => oil.requirements_norm.sae)),
      oem: mergeUnique(group.map((oil) => oil.requirements_norm.oem)),
      acea: mergeUnique(group.map((oil) => oil.requirements_norm.acea)),
      api: mergeUnique(group.map((oil) => oil.requirements_norm.api)),
      ilsac: mergeUnique(group.map((oil) => oil.requirements_norm.ilsac)),
    };
    for (const oil of group) oil.requirements_norm = merged;
  }

  return oils;
}

function cloneOilProducts(products: OilProduct[]): OilProduct[] {
  return products.map((product) => ({
    ...product,
    meta: { ...product.meta },
    requirements_norm: {
      sae: [...product.requirements_norm.sae],
      oem: [...product.requirements_norm.oem],
      acea: [...product.requirements_norm.acea],
      api: [...product.requirements_norm.api],
      ilsac: [...product.requirements_norm.ilsac],
    },
  }));
}

function getCachedOilProductsSnapshot(): OilProduct[] | null {
  const snapshot = getBranchOilProductsCache().snapshot;
  if (!snapshot || Date.now() - snapshot.at > OIL_PRODUCTS_CACHE_TTL_MS) return null;
  return cloneOilProducts(snapshot.products);
}

export function warmOilProductsCache(): Promise<OilProduct[]> {
  return fetchOilProductsFromMoySklad(1000, { forceRefresh: true });
}

/** Совместимое имя: теперь загружает товары категории «масло» из локального каталога. */
export async function fetchOilProductsFromMoySklad(
  limit = 200,
  options?: { forceRefresh?: boolean }
): Promise<OilProduct[]> {
  const branchId = getScopedBranchId();
  const branchCache = getBranchOilProductsCache(branchId);
  const cached = options?.forceRefresh ? null : getCachedOilProductsSnapshot();
  if (cached) return cached;
  if (branchCache.inFlight) return cloneOilProducts(await branchCache.inFlight);

  branchCache.inFlight = loadOilProductsFromLocalDb(limit).finally(() => {
    getBranchOilProductsCache(branchId).inFlight = null;
  });
  const products = await branchCache.inFlight;
  branchCache.snapshot = { at: Date.now(), products: cloneOilProducts(products) };
  return cloneOilProducts(products);
}

async function loadOilProductsFromLocalDb(limit = 200): Promise<OilProduct[]> {
  const take = Math.min(1000, Math.max(1, limit));
  const rows = await prisma.localProduct.findMany({
    where: {
      archived: false,
      entityType: { not: "service" },
      OR: [
        { name: { contains: "масл", mode: "insensitive" } },
        { name: { contains: "oil", mode: "insensitive" } },
        { groupPath: { contains: "масл", mode: "insensitive" } },
        { groupPath: { contains: "oil", mode: "insensitive" } },
        { searchText: { contains: "масл", mode: "insensitive" } },
        { searchText: { contains: "oil", mode: "insensitive" } },
        { sae: { not: null } },
        { acea: { not: null } },
        { apiSpec: { not: null } },
        { ilsac: { not: null } },
        { oem: { not: null } },
        { oemParts: { not: null } },
      ],
    },
    orderBy: [{ name: "asc" }],
    take: Math.min(1000, Math.max(take * 5, 200)),
  });

  const oils: OilProduct[] = [];
  for (const row of rows) {
    const attributesText = attributesSearchText(row.attributes);
    const name = row.name ?? "";
    const requirementText = [
      name,
      row.searchText,
      row.sae,
      row.oem,
      row.oemParts,
      row.acea,
      row.aceaExtra,
      row.apiSpec,
      row.ilsac,
      row.params,
      attributesText,
    ].join(" ");
    const requirements_norm = {
      sae: mergeUnique([normalizeSAE(row.sae ?? ""), normalizeSAE(name), normalizeSAE(attributesText)]),
      oem: mergeUnique([normalizeOEM(row.oem ?? ""), normalizeOEM(row.oemParts ?? ""), normalizeOEM(name), normalizeOEM(attributesText)]),
      acea: mergeUnique([normalizeACEA(row.acea ?? ""), normalizeACEA(row.aceaExtra ?? ""), normalizeACEA(name), normalizeACEA(attributesText)]),
      api: mergeUnique([normalizeAPI(row.apiSpec ?? ""), normalizeAPI(name), normalizeAPI(attributesText)]),
      ilsac: mergeUnique([normalizeILSAC(row.ilsac ?? ""), normalizeILSAC(name), normalizeILSAC(attributesText)]),
    };

    const hasAnyRequirement =
      requirements_norm.sae.length +
        requirements_norm.oem.length +
        requirements_norm.acea.length +
        requirements_norm.api.length +
        requirements_norm.ilsac.length >
      0;
    const looksLikeOil = /масл|oil/i.test(requirementText);
    if (!looksLikeOil && !hasAnyRequirement) continue;

    let volume_liters = row.packageVolume ? parsePackVolumeLitersFromOilName(row.packageVolume) : undefined;
    if (volume_liters == null) volume_liters = parsePackVolumeLitersFromOilName(name);
    if (volume_liters == null) volume_liters = decimalToNumber(row.volume);

    oils.push({
      id: row.id,
      name,
      article: row.article ?? undefined,
      price: row.salePriceCents / 100,
      currency: row.currencyName ?? "руб.",
      meta: { href: row.moyskladHref ?? `local://product/${row.id}` },
      requirements_norm,
      volume_liters,
      imageHref: row.imageHref ?? undefined,
    });
  }

  return enrichOilLineRequirements(oils.slice(0, take));
}

/** Нормализация ILSAC (GF-5, GF-6 и т.д.) для поиска. */
function normalizeILSAC(value: string): string[] {
  if (!value || typeof value !== "string") return [];
  const parts = value.split(/[,;\/\s]+/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/GF-?(\d)/i);
    if (m) out.push(`GF-${m[1]}`);
    else if (p.length >= 2) out.push(p);
  }
  return [...new Set(out)];
}

/** Поиск масел в локальной БД только по допускам (OEM/SAE/ACEA/API/ILSAC) — без VIN/OpenAI. */
export async function fetchOilCandidatesByRequirements(requirements: OilRequirements): Promise<OilProduct[]> {
  const warmCatalog = getCachedOilProductsSnapshot();
  if (warmCatalog) return warmCatalog;

  const cacheKey = JSON.stringify({
    branchId: getScopedBranchId(),
    sae: requirements.sae_viscosities ?? [],
    oem: requirements.oem_approvals ?? [],
    acea: requirements.acea ?? [],
    api: requirements.api ?? [],
    ilsac: requirements.ilsac ?? [],
  });
  const cachedCandidates = oilCandidatesCache.get(cacheKey);
  if (cachedCandidates && Date.now() - cachedCandidates.at <= OIL_PRODUCTS_CACHE_TTL_MS) {
    return cloneOilProducts(cachedCandidates.products);
  }

  const oils = await fetchOilProductsFromMoySklad(1000);
  const enriched = enrichOilLineRequirements(oils);
  oilCandidatesCache.set(cacheKey, { at: Date.now(), products: cloneOilProducts(enriched) });
  return enriched;
}

const SCORE_OEM = 100;
const SCORE_ACEA = 30;
const SCORE_API = 10;
const SCORE_ILSAC = 10;
const SCORE_SAE = 20;

function intersection(a: string[], b: string[]): number {
  const set = new Set(b.map((s) => s.toUpperCase()));
  return a.filter((s) => set.has(s.toUpperCase())).length;
}

function toRecommendationItem(item: OilRecommendationItem & { saeMatch: number; oemMatch: number; aceaMatch: number; apiMatch: number }): OilRecommendationItem {
  return {
    product: item.product,
    score: item.score,
    why: item.why,
  };
}

/** Нормализовать входящие требования для сравнения с product.requirements_norm */
            function normReq(
              req: OilRequirements
            ): { sae: string[]; oem: string[]; acea: string[]; api: string[]; ilsac: string[] } {
  return {
    sae: (req.sae_viscosities ?? []).flatMap((s) => normalizeSAE(s)),
    oem: (req.oem_approvals ?? []).flatMap((s) => normalizeOEM(s)),
    acea: (req.acea ?? []).flatMap((s) => normalizeACEA(s)),
    api: (req.api ?? []).flatMap((s) => normalizeAPI(s)),
                ilsac: (req.ilsac ?? []).flatMap((s) => normalizeILSAC(s)),
  };
}

/** Скоринг и матчинг: recommended (топ N), alternatives (следующие altLimit), why. */
export function scoreAndMatch(
  requirements: OilRequirements,
  products: OilProduct[],
  topN = 10,
  altLimit = 10
): { recommended: OilRecommendationItem[]; alternatives: OilRecommendationItem[] } {
  const req = normReq(requirements);
  const needSae = req.sae.length > 0;
  const needOem = req.oem.length > 0;
  const needAcea = req.acea.length > 0;
  const needApi = req.api.length > 0;
  const needIlsac = req.ilsac.length > 0;

  type ScoredMatch = OilRecommendationItem & {
    saeMatch: number;
    oemMatch: number;
    aceaMatch: number;
    apiMatch: number;
    ilsacMatch: number;
  };

  const scoredAll: ScoredMatch[] = [];

  for (const product of products) {
    const p = product.requirements_norm;
    const saeMatch = intersection(p.sae, req.sae);
    const oemMatch = intersection(p.oem, req.oem);
    const aceaMatch = intersection(p.acea, req.acea);
    const apiMatch = intersection(p.api, req.api);
    const ilsacMatch = intersection(p.ilsac, req.ilsac);

    if (needOem) {
      if (oemMatch === 0) continue;
      if (needSae && saeMatch === 0) continue;
    } else {
      if (needSae && saeMatch === 0) continue;
      if (needAcea && aceaMatch === 0) continue;
      if (needApi && apiMatch === 0) continue;
      if (needIlsac && ilsacMatch === 0) continue;
    }

    let score = 0;
    const why: string[] = [];
    if (saeMatch > 0) {
      score += SCORE_SAE * saeMatch;
      why.push(`SAE: ${p.sae.filter((s) => req.sae.some((r) => r.toUpperCase() === s.toUpperCase())).join(", ")}`);
    }
    if (oemMatch > 0) {
      score += SCORE_OEM * oemMatch;
      why.push(`OEM: ${p.oem.filter((o) => req.oem.some((r) => r.toUpperCase() === o.toUpperCase())).join(", ")}`);
    }
    if (aceaMatch > 0) {
      score += SCORE_ACEA * aceaMatch;
      why.push(`ACEA: ${p.acea.filter((a) => req.acea.some((r) => r.toUpperCase() === a.toUpperCase())).join(", ")}`);
    }
    if (apiMatch > 0) {
      score += SCORE_API * apiMatch;
      why.push(`API: ${p.api.filter((a) => req.api.some((r) => r.toUpperCase() === a.toUpperCase())).join(", ")}`);
    }
    if (ilsacMatch > 0) {
      score += SCORE_ILSAC * ilsacMatch;
      why.push(`ILSAC: ${p.ilsac.filter((v) => req.ilsac.some((r) => r.toUpperCase() === v.toUpperCase())).join(", ")}`);
    }

    scoredAll.push({ product, score, why, saeMatch, oemMatch, aceaMatch, apiMatch, ilsacMatch });
  }

  scoredAll.sort((a, b) => b.score - a.score || a.product.price - b.product.price);
  const recommended = scoredAll.slice(0, topN).map(toRecommendationItem);
  const alternatives = scoredAll.slice(topN, topN + altLimit).map(toRecommendationItem);
  return { recommended, alternatives };
}
