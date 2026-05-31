import { Prisma } from "@prisma/client";
import { documentProfitFromComputedPositions } from "@/lib/customer-analytics-profit";
import { prisma } from "@/lib/db";
import { isMoySkladSyncEnabled, moyskladDisabledMessage } from "@/lib/moysklad-flags";
import { getMoySkladHeaders, moyskladFetchWithRetry } from "@/lib/moysklad";
import { extractMoyskladEntityId } from "@/lib/piecework-rules";
import { listRawPhonesFromCounterparty, pickNormalizedPhoneFromCounterparty } from "@/lib/phone-normalize";

const SYNC_STATE_ID = "default";
const PAGE_LIMIT = 500;
/** МойСклад: до 1000 позиций за запрос к `/entity/demand/{id}/positions`. */
const DEMAND_POSITIONS_PAGE_LIMIT = 1000;
const POSITION_CONCURRENCY = 8;
const INCREMENTAL_OVERLAP_MS = 10 * 60 * 1000;
const SYNC_HEARTBEAT_STALE_MS = 2 * 60 * 1000;
const STATUS_PERSIST_MIN_INTERVAL_MS = 1500;
const MOYSKLAD_LIST_FETCH_ATTEMPTS = 5;
const MOYSKLAD_POSITIONS_FETCH_ATTEMPTS = 4;
const PRISMA_DB_ATTEMPTS = 5;

export type CustomerAnalyticsSyncStatus = {
  isRunning: boolean;
  mode: "full" | "incremental" | "latest_test" | null;
  phase: "idle" | "scanning" | "syncing" | "done" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  processedDemands: number;
  totalDemands: number | null;
  scannedDemands: number;
  lastDemandId: string | null;
  lastDemandName: string | null;
  message: string | null;
  error: string | null;
};

function createDefaultSyncStatus(): CustomerAnalyticsSyncStatus {
  return {
    isRunning: false,
    mode: null,
    phase: "idle",
    startedAt: null,
    finishedAt: null,
    processedDemands: 0,
    totalDemands: null,
    scannedDemands: 0,
    lastDemandId: null,
    lastDemandName: null,
    message: null,
    error: null,
  };
}

let runtimeSyncStatus: CustomerAnalyticsSyncStatus = createDefaultSyncStatus();
let activeSyncPromise:
  | Promise<SyncCustomerAnalyticsResult | SyncCustomerAnalyticsError>
  | null = null;
let lastPersistedSyncStatusAt = 0;

function setRuntimeSyncStatus(patch: Partial<CustomerAnalyticsSyncStatus>) {
  runtimeSyncStatus = { ...runtimeSyncStatus, ...patch };
}

export function getCustomerAnalyticsSyncStatus(): CustomerAnalyticsSyncStatus {
  return { ...runtimeSyncStatus };
}

type SyncStateRow = Awaited<ReturnType<typeof prisma.moySkladAnalyticsSyncState.findUnique>>;

async function persistRuntimeSyncStatus(params?: {
  lastSyncedAt?: Date | null;
  lastError?: string | null;
  demandsSynced?: number;
}) {
  const heartbeatAt = new Date();
  await prismaWithRetry(() =>
    prisma.moySkladAnalyticsSyncState.upsert({
      where: { id: SYNC_STATE_ID },
      create: {
        id: SYNC_STATE_ID,
        lastSyncedAt: params?.lastSyncedAt ?? null,
        lastError: params?.lastError ?? null,
        demandsSynced: params?.demandsSynced ?? 0,
        syncRunning: runtimeSyncStatus.isRunning,
        syncMode: runtimeSyncStatus.mode,
        syncPhase: runtimeSyncStatus.phase,
        syncStartedAt: runtimeSyncStatus.startedAt ? new Date(runtimeSyncStatus.startedAt) : null,
        syncFinishedAt: runtimeSyncStatus.finishedAt ? new Date(runtimeSyncStatus.finishedAt) : null,
        syncHeartbeatAt: heartbeatAt,
        syncTotalDemands: runtimeSyncStatus.totalDemands,
        syncProcessedDemands: runtimeSyncStatus.processedDemands,
        syncScannedDemands: runtimeSyncStatus.scannedDemands,
        syncLastDemandId: runtimeSyncStatus.lastDemandId,
        syncLastDemandName: runtimeSyncStatus.lastDemandName,
        syncMessage: runtimeSyncStatus.message,
      },
      update: {
        lastSyncedAt: params?.lastSyncedAt,
        lastError: params?.lastError,
        demandsSynced: params?.demandsSynced,
        syncRunning: runtimeSyncStatus.isRunning,
        syncMode: runtimeSyncStatus.mode,
        syncPhase: runtimeSyncStatus.phase,
        syncStartedAt: runtimeSyncStatus.startedAt ? new Date(runtimeSyncStatus.startedAt) : null,
        syncFinishedAt: runtimeSyncStatus.finishedAt ? new Date(runtimeSyncStatus.finishedAt) : null,
        syncHeartbeatAt: heartbeatAt,
        syncTotalDemands: runtimeSyncStatus.totalDemands,
        syncProcessedDemands: runtimeSyncStatus.processedDemands,
        syncScannedDemands: runtimeSyncStatus.scannedDemands,
        syncLastDemandId: runtimeSyncStatus.lastDemandId,
        syncLastDemandName: runtimeSyncStatus.lastDemandName,
        syncMessage: runtimeSyncStatus.message,
      },
    })
  );
}

async function maybePersistRuntimeSyncStatus(force = false) {
  const now = Date.now();
  if (!force && now - lastPersistedSyncStatusAt < STATUS_PERSIST_MIN_INTERVAL_MS) return;
  lastPersistedSyncStatusAt = now;
  await persistRuntimeSyncStatus();
}

function mapRowToSyncStatus(row: SyncStateRow): CustomerAnalyticsSyncStatus {
  if (!row) return createDefaultSyncStatus();
  return {
    isRunning: row.syncRunning,
    mode:
      row.syncMode === "full" || row.syncMode === "incremental" || row.syncMode === "latest_test"
        ? row.syncMode
        : null,
    phase:
      row.syncPhase === "idle" ||
      row.syncPhase === "scanning" ||
      row.syncPhase === "syncing" ||
      row.syncPhase === "done" ||
      row.syncPhase === "error"
        ? row.syncPhase
        : "idle",
    startedAt: row.syncStartedAt?.toISOString() ?? null,
    finishedAt: row.syncFinishedAt?.toISOString() ?? null,
    processedDemands: row.syncProcessedDemands,
    totalDemands: row.syncTotalDemands,
    scannedDemands: row.syncScannedDemands,
    lastDemandId: row.syncLastDemandId,
    lastDemandName: row.syncLastDemandName,
    message: row.syncMessage,
    error: row.lastError,
  };
}

function isPersistedSyncStatusStale(row: SyncStateRow): boolean {
  if (!row?.syncRunning) return false;
  const heartbeat = row.syncHeartbeatAt?.getTime();
  if (!heartbeat) return true;
  return Date.now() - heartbeat > SYNC_HEARTBEAT_STALE_MS;
}

export async function getPersistedCustomerAnalyticsSyncStatus(): Promise<CustomerAnalyticsSyncStatus> {
  const row = await prismaWithRetry(() =>
    prisma.moySkladAnalyticsSyncState.findUnique({
      where: { id: SYNC_STATE_ID },
    })
  );
  if (!row) return activeSyncPromise ? getCustomerAnalyticsSyncStatus() : createDefaultSyncStatus();

  if (!activeSyncPromise && isPersistedSyncStatusStale(row)) {
    const interruptedMessage = "Синхронизация была прервана: сервер был перезапущен или задача остановилась.";
    const fixed = await prismaWithRetry(() =>
      prisma.moySkladAnalyticsSyncState.update({
        where: { id: SYNC_STATE_ID },
        data: {
          syncRunning: false,
          syncPhase: "error",
          syncFinishedAt: new Date(),
          syncMessage: interruptedMessage,
          lastError: interruptedMessage,
        },
      })
    );
    return mapRowToSyncStatus(fixed);
  }

  if (activeSyncPromise) {
    return getCustomerAnalyticsSyncStatus();
  }

  return mapRowToSyncStatus(row);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientPrismaErrorMessage(error: string): boolean {
  const lower = error.toLowerCase();
  return (
    lower.includes("can't reach database server") ||
    lower.includes("failed to connect") ||
    lower.includes("connection") ||
    lower.includes("closed") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("p1001") ||
    lower.includes("p1017")
  );
}

async function prismaWithRetry<T>(operation: () => Promise<T>, attempts = PRISMA_DB_ATTEMPTS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (e) {
      lastError = e;
      const message = e instanceof Error ? e.message : String(e);
      if (attempt >= attempts - 1 || !isTransientPrismaErrorMessage(message)) throw e;
      await sleep(1200 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) break;
      results[i] = await mapper(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

type Meta = { href: string; type: string; mediaType?: string };

type DemandListRow = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  /** Сумма документа в копейках (поле **sum** в API). */
  sum: number;
  updated?: string;
  agent?: {
    name?: string;
    phone?: string;
    phones?: Array<{ phone?: string } | string>;
    contactpersons?: { rows?: Array<{ phone?: string }> } | Array<{ phone?: string }>;
    meta?: Meta;
  } & Record<string, unknown>;
};

/**
 * Развёрнутый **assortment** в позиции отгрузки (product / variant / bundle / service).
 * По доке МойСклад для **product**: **buyPrice.value** — закупочная цена в копейках за единицу.
 */
type AssortmentExpand = {
  name?: string;
  meta?: Meta;
  buyPrice?: { value?: number };
} & Record<string, unknown>;

/**
 * Строка позиции отгрузки: **price** — в копейках за единицу;
 * для **service** на позиции может быть **cost** (себестоимость в копейках), если нет **buyPrice** в карточке.
 */
type PositionRow = {
  id: string;
  quantity: number;
  price: number;
  discount?: number;
  /** У услуг в позиции документа (demandposition): себестоимость в копейках. */
  cost?: number;
  assortment?: AssortmentExpand;
};

function parseMomentToParts(moment: string): { documentDate: string; momentAt: Date } {
  const documentDate = moment.slice(0, 10);
  const timePart = moment.length > 11 ? moment.slice(11, 19) : "00:00:00";
  const momentAt = new Date(`${documentDate}T${timePart}`);
  return { documentDate, momentAt };
}

function parseApiDateTime(value?: string | null): Date | null {
  if (!value?.trim()) return null;
  const normalized = value.includes(" ") ? value.replace(" ", "T") : value;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isDemandAfterCutoff(row: DemandListRow, cutoff: Date | null): boolean {
  if (!cutoff) return true;
  const updatedAt = parseApiDateTime(row.updated) ?? parseApiDateTime(row.moment);
  if (!updatedAt) return true;
  return updatedAt.getTime() > cutoff.getTime();
}

function isProductLikeType(type: string): boolean {
  return type === "product" || type === "variant" || type === "bundle";
}

function buildPositionSyncRows(rows: PositionRow[]) {
  const out: {
    id: string;
    assortmentType: string;
    assortmentId: string | null;
    name: string;
    quantity: number;
    priceCentsPerUnit: number;
    discount: number;
    buyPriceCentsPerUnit: number | null;
    lineIncompleteCost: boolean;
  }[] = [];

  let hasIncompleteCost = false;

  for (const p of rows) {
    const meta = p.assortment?.meta;
    const assortmentType = meta?.type ?? "";
    const assortmentId = meta?.href ? extractMoyskladEntityId(meta.href) : null;
    const qty = Number(p.quantity) || 0;
    const priceCentsPerUnit = Math.round(Number(p.price) || 0);
    const discount = typeof p.discount === "number" ? p.discount : 0;
    const name = p.assortment?.name?.trim() || "Позиция";

    const buyPriceObj = p.assortment?.buyPrice;
    const buyRaw = buyPriceObj?.value;
    const hasBuyField = buyPriceObj != null && buyRaw !== undefined && buyRaw !== null;
    let buyPriceCentsPerUnit: number | null = hasBuyField ? Math.round(Number(buyRaw)) : null;
    if (buyPriceCentsPerUnit == null && assortmentType === "service" && p.cost != null && p.cost !== undefined) {
      buyPriceCentsPerUnit = Math.round(Number(p.cost));
    }

    const productLike = isProductLikeType(assortmentType);
    const lineIncompleteCost =
      (productLike && !hasBuyField) || (assortmentType === "service" && buyPriceCentsPerUnit == null);
    if (lineIncompleteCost) hasIncompleteCost = true;

    out.push({
      id: p.id,
      assortmentType,
      assortmentId,
      name,
      quantity: qty,
      priceCentsPerUnit,
      discount,
      buyPriceCentsPerUnit,
      lineIncompleteCost,
    });
  }

  return { positions: out, hasIncompleteCost };
}

async function fetchDemandPositionsPage(
  demandId: string,
  offset: number
): Promise<{ rows: PositionRow[]; totalSize?: number } | null> {
  const qs = new URLSearchParams({
    expand: "assortment",
    limit: String(DEMAND_POSITIONS_PAGE_LIMIT),
    offset: String(offset),
  });
  const path = `/entity/demand/${demandId}/positions?${qs.toString()}`;
  const posRes = await moyskladFetchWithRetry<{ rows?: PositionRow[]; meta?: { size?: number } }>(
    path,
    { cache: "no-store" },
    MOYSKLAD_POSITIONS_FETCH_ATTEMPTS
  );
  if (posRes.ok) {
    return {
      rows: posRes.data.rows ?? [],
      totalSize: posRes.data.meta?.size,
    };
  }
  return null;
}

/** Все позиции отгрузки (несколько страниц, если > 1000 строк). */
async function fetchDemandPositions(demandId: string): Promise<PositionRow[]> {
  const all: PositionRow[] = [];
  let offset = 0;
  while (true) {
    const page = await fetchDemandPositionsPage(demandId, offset);
    if (!page) break;
    const { rows, totalSize } = page;
    all.push(...rows);
    if (rows.length < DEMAND_POSITIONS_PAGE_LIMIT) break;
    offset += rows.length;
    if (typeof totalSize === "number" && offset >= totalSize) break;
    if (rows.length === 0) break;
  }
  return all;
}

async function upsertDemandFromRow(row: DemandListRow): Promise<void> {
  const { documentDate, momentAt } = parseMomentToParts(row.moment);
  const normalizedPhone = pickNormalizedPhoneFromCounterparty(row.agent);
  const phoneCandidates = listRawPhonesFromCounterparty(row.agent);
  const positions = await fetchDemandPositions(row.id);
  const { positions: posRows, hasIncompleteCost } = buildPositionSyncRows(positions);

  const profitCents = documentProfitFromComputedPositions(
    posRows.map((p) => ({
      priceCentsPerUnit: p.priceCentsPerUnit,
      quantity: p.quantity,
      discount: p.discount,
      buyPriceCentsPerUnit: p.buyPriceCentsPerUnit,
    }))
  );

  const documentServices: { id: string; name: string }[] = [];
  const seenDocSvc = new Set<string>();
  for (const p of posRows) {
    if (p.assortmentType !== "service" || !p.assortmentId) continue;
    if (seenDocSvc.has(p.assortmentId)) continue;
    seenDocSvc.add(p.assortmentId);
    documentServices.push({ id: p.assortmentId, name: p.name });
  }

  const agentMetaHref = row.agent?.meta?.href ?? null;
  const agentName = row.agent?.name?.trim() ?? null;
  const phonesRaw =
    phoneCandidates.length > 0 || row.agent?.phones != null
      ? {
          candidates: phoneCandidates,
          phones: row.agent?.phones ?? null,
        }
      : null;

  const demandPayload = {
    documentDate,
    momentAt,
    applicable: row.applicable,
    sumCents: Math.round(row.sum ?? 0),
    name: row.name ?? "",
    agentMetaHref,
    agentNameSnapshot: agentName,
    phonesRaw: phonesRaw as object | undefined,
    normalizedPhone,
    hasIncompleteCost,
    positionCount: posRows.length,
    profitCents,
    documentServices,
    syncedAt: new Date(),
  };

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.moySkladDemandPositionSync.deleteMany({ where: { demandId: row.id } }),
    prisma.moySkladDemandSync.upsert({
      where: { id: row.id },
      create: { id: row.id, ...demandPayload },
      update: demandPayload,
    }),
  ];

  if (posRows.length > 0) {
    ops.push(
      prisma.moySkladDemandPositionSync.createMany({
        data: posRows.map((p) => ({
          id: p.id,
          demandId: row.id,
          assortmentType: p.assortmentType,
          assortmentId: p.assortmentId,
          name: p.name,
          quantity: p.quantity,
          priceCentsPerUnit: p.priceCentsPerUnit,
          discount: p.discount,
          buyPriceCentsPerUnit: p.buyPriceCentsPerUnit,
          lineIncompleteCost: p.lineIncompleteCost,
        })),
      })
    );
  }

  await prismaWithRetry(() => prisma.$transaction(ops));
}

export type SyncCustomerAnalyticsResult = {
  ok: true;
  demandsProcessed: number;
  lastError?: string;
};

export type SyncCustomerAnalyticsError = {
  ok: false;
  error: string;
};

/**
 * Синхронизация проведённых отгрузок (applicable=true) из МойСклад в локальную БД.
 * Первый запуск полный; повторные - инкрементальные по recent changes (updated) с overlap-окном.
 */
async function runCustomerAnalyticsSync(options?: {
  forceFull?: boolean;
  latestLimit?: number;
  replaceSnapshot?: boolean;
}): Promise<
  SyncCustomerAnalyticsResult | SyncCustomerAnalyticsError
> {
  if (!isMoySkladSyncEnabled()) {
    return { ok: false, error: moyskladDisabledMessage("sync") };
  }

  if (!getMoySkladHeaders()) {
    return { ok: false, error: "МойСклад не настроен" };
  }

  let totalProcessed = 0;
  let lastError: string | undefined;

  await prismaWithRetry(() =>
    prisma.moySkladAnalyticsSyncState.upsert({
      where: { id: SYNC_STATE_ID },
      create: { id: SYNC_STATE_ID, syncRunning: false },
      update: {},
    })
  );

  try {
    const syncState = await prismaWithRetry(() =>
      prisma.moySkladAnalyticsSyncState.findUnique({
        where: { id: SYNC_STATE_ID },
      })
    );
    const startedAt = new Date();
    const latestLimit = options?.latestLimit && options.latestLimit > 0 ? Math.floor(options.latestLimit) : null;
    const cutoff =
      latestLimit != null || options?.forceFull
        ? null
        : syncState?.lastSyncedAt != null
          ? new Date(syncState.lastSyncedAt.getTime() - INCREMENTAL_OVERLAP_MS)
          : null;
    const resumeFull =
      latestLimit == null &&
      options?.forceFull === true &&
      syncState?.syncMode === "full" &&
      (syncState.syncPhase === "error" || syncState.syncPhase === "syncing") &&
      (syncState.syncProcessedDemands ?? 0) > 0;
    const mode: "full" | "incremental" | "latest_test" =
      latestLimit != null ? "latest_test" : cutoff ? "incremental" : "full";
    const resumeOffset = resumeFull ? syncState?.syncProcessedDemands ?? 0 : 0;
    totalProcessed = resumeOffset;

    runtimeSyncStatus = {
      isRunning: true,
      mode,
      phase: mode === "full" ? "syncing" : "scanning",
      startedAt: startedAt.toISOString(),
      finishedAt: null,
      processedDemands: resumeOffset,
      totalDemands: null,
      scannedDemands: resumeOffset,
      lastDemandId: null,
      lastDemandName: null,
      message:
        mode === "latest_test"
          ? `Тестовая синхронизация последних ${latestLimit} отгрузок`
          : resumeFull
            ? `Возобновление полной синхронизации с ${resumeOffset + 1}-й отгрузки`
          : mode === "full"
          ? "Полная синхронизация всех проведённых отгрузок"
          : "Поиск изменённых отгрузок с прошлого запуска",
      error: null,
    };
    await persistRuntimeSyncStatus({ lastError: null });

    if (mode === "latest_test") {
      const qs = new URLSearchParams({
        filter: "applicable=true",
        limit: String(latestLimit),
        offset: "0",
        order: "moment,desc",
        expand: "agent,agent.contactpersons",
      });
      const listRes = await moyskladFetchWithRetry<{
        meta?: { size?: number };
        rows?: DemandListRow[];
      }>(`/entity/demand?${qs.toString()}`, { cache: "no-store" }, MOYSKLAD_LIST_FETCH_ATTEMPTS);

      if (!listRes.ok) {
        lastError = listRes.error;
        setRuntimeSyncStatus({
          isRunning: false,
          phase: "error",
          finishedAt: new Date().toISOString(),
          error: listRes.error,
          message: "Ошибка тестовой синхронизации последних отгрузок",
        });
        await persistRuntimeSyncStatus({ lastError: listRes.error });
        return { ok: false, error: listRes.error };
      }

      const latestRows = listRes.data.rows ?? [];
      setRuntimeSyncStatus({
        phase: "syncing",
        totalDemands: latestRows.length,
        scannedDemands: latestRows.length,
        message:
          latestRows.length > 0
            ? `Загружены последние ${latestRows.length} отгрузок для теста`
            : "Для теста не найдено ни одной отгрузки",
      });
      await maybePersistRuntimeSyncStatus(true);

      if (options?.replaceSnapshot) {
        await prismaWithRetry(() =>
          prisma.$transaction([
            prisma.moySkladDemandPositionSync.deleteMany({}),
            prisma.moySkladDemandSync.deleteMany({}),
          ])
        );
      }

      await mapWithConcurrency(latestRows, POSITION_CONCURRENCY, async (row) => {
        try {
          setRuntimeSyncStatus({
            lastDemandId: row.id,
            lastDemandName: row.name ?? row.id,
            message: `Тестовая обработка ${totalProcessed + 1} из ${latestRows.length}: ${row.name ?? row.id}`,
          });
          await maybePersistRuntimeSyncStatus();
          await upsertDemandFromRow(row);
          totalProcessed += 1;
          setRuntimeSyncStatus({
            processedDemands: totalProcessed,
          });
          await maybePersistRuntimeSyncStatus();
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      });
    } else if (mode === "incremental") {
      let offset = 0;
      let scannedDemands = 0;
      const changedRows: DemandListRow[] = [];

      while (true) {
        const qs = new URLSearchParams({
          filter: "applicable=true",
          limit: String(PAGE_LIMIT),
          offset: String(offset),
          order: "updated,desc",
          expand: "agent,agent.contactpersons",
        });
        const listRes = await moyskladFetchWithRetry<{
          meta?: { size?: number };
          rows?: DemandListRow[];
        }>(`/entity/demand?${qs.toString()}`, { cache: "no-store" }, MOYSKLAD_LIST_FETCH_ATTEMPTS);

        if (!listRes.ok) {
          lastError = listRes.error;
          setRuntimeSyncStatus({
            isRunning: false,
            phase: "error",
            finishedAt: new Date().toISOString(),
            error: listRes.error,
            message: "Ошибка поиска изменений",
          });
          await persistRuntimeSyncStatus({ lastError: listRes.error });
          return { ok: false, error: listRes.error };
        }

        const pageRows = listRes.data.rows ?? [];
        if (pageRows.length === 0) break;

        let pageChanged = 0;
        for (const row of pageRows) {
          if (isDemandAfterCutoff(row, cutoff)) {
            changedRows.push(row);
            pageChanged += 1;
          }
        }

        scannedDemands += pageRows.length;
        setRuntimeSyncStatus({
          scannedDemands,
          message: `Поиск изменений: просмотрено ${scannedDemands} отгрузок`,
        });
        await maybePersistRuntimeSyncStatus();

        offset += pageRows.length;
        const totalSize = listRes.data.meta?.size;
        if (pageRows.length < PAGE_LIMIT) break;
        if (pageChanged === 0) break;
        if (typeof totalSize === "number" && offset >= totalSize) break;
      }

      setRuntimeSyncStatus({
        phase: "syncing",
        totalDemands: changedRows.length,
        message:
          changedRows.length > 0
            ? `Найдено ${changedRows.length} изменённых отгрузок`
            : "Изменённых отгрузок не найдено",
      });
      await maybePersistRuntimeSyncStatus(true);

      await mapWithConcurrency(changedRows, POSITION_CONCURRENCY, async (row) => {
        try {
          setRuntimeSyncStatus({
            lastDemandId: row.id,
            lastDemandName: row.name ?? row.id,
            message: `Обработка ${totalProcessed + 1} из ${changedRows.length}: ${row.name ?? row.id}`,
          });
          await maybePersistRuntimeSyncStatus();
          await upsertDemandFromRow(row);
          totalProcessed += 1;
          setRuntimeSyncStatus({
            processedDemands: totalProcessed,
          });
          await maybePersistRuntimeSyncStatus();
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
        }
      });
    } else {
      let offset = resumeOffset;

      while (true) {
        const qs = new URLSearchParams({
          filter: "applicable=true",
          limit: String(PAGE_LIMIT),
          offset: String(offset),
          order: "moment,asc",
          expand: "agent,agent.contactpersons",
        });
        const listRes = await moyskladFetchWithRetry<{
          meta?: { size?: number };
          rows?: DemandListRow[];
        }>(`/entity/demand?${qs.toString()}`, { cache: "no-store" }, MOYSKLAD_LIST_FETCH_ATTEMPTS);

        if (!listRes.ok) {
          lastError = listRes.error;
          setRuntimeSyncStatus({
            isRunning: false,
            phase: "error",
            finishedAt: new Date().toISOString(),
            error: listRes.error,
            message: "Ошибка полной синхронизации",
          });
          await persistRuntimeSyncStatus({ lastError: listRes.error });
          return { ok: false, error: listRes.error };
        }

        const pageRows = listRes.data.rows ?? [];
        if (pageRows.length === 0) break;

        setRuntimeSyncStatus({
          totalDemands: listRes.data.meta?.size ?? null,
          scannedDemands: offset + pageRows.length,
        });
        await maybePersistRuntimeSyncStatus();

        await mapWithConcurrency(pageRows, POSITION_CONCURRENCY, async (row) => {
          if (!row.applicable) return;
          try {
            const totalLabel = listRes.data.meta?.size ?? "…";
            setRuntimeSyncStatus({
              lastDemandId: row.id,
              lastDemandName: row.name ?? row.id,
              message: `Обработка ${totalProcessed + 1} из ${totalLabel}: ${row.name ?? row.id}`,
            });
            await maybePersistRuntimeSyncStatus();
            await upsertDemandFromRow(row);
            totalProcessed += 1;
            setRuntimeSyncStatus({
              processedDemands: totalProcessed,
            });
            await maybePersistRuntimeSyncStatus();
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
          }
        });

        offset += pageRows.length;
        const totalSize = listRes.data.meta?.size;
        if (pageRows.length < PAGE_LIMIT) break;
        if (typeof totalSize === "number" && offset >= totalSize) break;
      }
    }

    setRuntimeSyncStatus({
      isRunning: false,
      phase: "done",
      finishedAt: new Date().toISOString(),
      processedDemands: totalProcessed,
      message:
        totalProcessed > 0
          ? `Синхронизация завершена, обработано ${totalProcessed} отгрузок`
          : "Синхронизация завершена, новых отгрузок не было",
      error: lastError ?? null,
    });
    await persistRuntimeSyncStatus({
      lastSyncedAt: new Date(),
      lastError: lastError ?? null,
      demandsSynced: totalProcessed,
    });

    return { ok: true, demandsProcessed: totalProcessed, lastError };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setRuntimeSyncStatus({
      isRunning: false,
      phase: "error",
      finishedAt: new Date().toISOString(),
      error: msg,
      message: "Синхронизация завершилась с ошибкой",
    });
    await persistRuntimeSyncStatus({ lastError: msg });
    return { ok: false, error: msg };
  }
}

export function startCustomerAnalyticsSync(options?: {
  forceFull?: boolean;
  latestLimit?: number;
  replaceSnapshot?: boolean;
}): {
  started: boolean;
  status: CustomerAnalyticsSyncStatus;
} {
  if (activeSyncPromise) {
    return { started: false, status: getCustomerAnalyticsSyncStatus() };
  }
  activeSyncPromise = runCustomerAnalyticsSync(options).finally(() => {
    activeSyncPromise = null;
  });
  return { started: true, status: getCustomerAnalyticsSyncStatus() };
}

export async function syncCustomerAnalyticsFromMoySklad(): Promise<
  SyncCustomerAnalyticsResult | SyncCustomerAnalyticsError
> {
  return runCustomerAnalyticsSync();
}

export async function syncLatestCustomerAnalyticsForTest(limit = 100): Promise<
  SyncCustomerAnalyticsResult | SyncCustomerAnalyticsError
> {
  return runCustomerAnalyticsSync({ latestLimit: limit, replaceSnapshot: true });
}
