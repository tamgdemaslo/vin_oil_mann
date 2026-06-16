import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Prisma } from "@prisma/client";
import { ensureDefaultCrmStages, getCrmStageBySortOrder } from "@/lib/crm";
import { prisma } from "@/lib/db";
import { loadLocalDemandDetailPayload } from "@/lib/local-demand-write";
import { normalizePhoneKey } from "@/lib/phone-normalize";
import {
  DIAGNOSTIC_COMMON_RECOMMENDATIONS,
  DIAGNOSTIC_MAP_BLOCKS,
  DIAGNOSTIC_MAP_STATUSES,
  allDiagnosticMapItems,
  statusMethod,
  type DiagnosticMapCheckMethod,
  type DiagnosticMapStatusCode,
} from "@/data/diagnostic-map";
import { buildDiagnosticReportText } from "@/data/diagnostic-report-text";

type SessionUser = {
  login: string;
  name?: string | null;
};

type VehicleInput = {
  vin?: string | null;
  brand?: string | null;
  model?: string | null;
  year?: string | number | null;
  licensePlate?: string | null;
  mileage?: string | number | null;
  vehicleHints?: Record<string, unknown> | null;
};

type CreateDiagnosticInput = VehicleInput & {
  shipmentId?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  clientPhone?: string | null;
};

type UpdateItemInput = {
  itemCode?: string;
  status?: DiagnosticMapStatusCode;
  checkMethod?: DiagnosticMapCheckMethod;
  value?: string | null;
  comment?: string | null;
  recommendation?: string | null;
  nextVisit?: boolean;
  showInReport?: boolean;
  selectedNotes?: string[];
  selectedRecommendations?: string[];
};

const DIAGNOSTIC_MAP_PHOTO_LIST_SELECT = {
  id: true,
  itemId: true,
  filePath: true,
  contentType: true,
  caption: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DiagnosticMapPhotoSelect;

type DiagnosticMapFullRow = Prisma.DiagnosticMapSessionGetPayload<{
  include: {
    items: {
      include: {
        photos: { select: typeof DIAGNOSTIC_MAP_PHOTO_LIST_SELECT };
        actions: true;
      };
    };
  };
}>;

type DiagnosticMapItemFullRow = Prisma.DiagnosticMapItemGetPayload<{
  include: {
    photos: { select: typeof DIAGNOSTIC_MAP_PHOTO_LIST_SELECT };
    actions: true;
  };
}>;

const STATUS_TO_DB: Record<DiagnosticMapStatusCode, string> = {
  unchecked: "UNCHECKED",
  good: "NORMAL",
  warn: "ATTENTION",
  crit: "REPLACE",
  "no-access": "NO_ACCESS",
  "by-mileage": "BY_MILEAGE",
  "by-client": "BY_CLIENT",
};

const STATUS_FROM_DB: Record<string, DiagnosticMapStatusCode> = {
  UNCHECKED: "unchecked",
  NORMAL: "good",
  ATTENTION: "warn",
  REPLACE: "crit",
  NO_ACCESS: "no-access",
  BY_MILEAGE: "by-mileage",
  BY_CLIENT: "by-client",
  SKIPPED: "unchecked",
  NOT_APPLICABLE: "unchecked",
};

const METHOD_TO_DB: Record<DiagnosticMapCheckMethod, string> = {
  inspection: "INSPECTION",
  client_words: "CLIENT_WORDS",
  mileage: "MILEAGE",
  no_access: "NO_ACCESS",
  skipped: "SKIPPED",
};

const METHOD_FROM_DB: Record<string, DiagnosticMapCheckMethod> = Object.fromEntries(
  Object.entries(METHOD_TO_DB).map(([key, value]) => [value, key])
) as Record<string, DiagnosticMapCheckMethod>;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const parsed = parseInt(asString(value).replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function vehicleHintBoolean(hints: Record<string, unknown> | null | undefined, key: string): boolean {
  return hints?.[key] === true;
}

function itemApplicable(
  item: ReturnType<typeof allDiagnosticMapItems>[number]["item"],
  hints: Record<string, unknown> | null | undefined
): boolean {
  const rules = item.applicability;
  if (!rules) return true;
  if (rules.automaticOnly && !vehicleHintBoolean(hints, "automatic")) return false;
  if (rules.manualOnly && !vehicleHintBoolean(hints, "manual")) return false;
  if (rules.awdOnly && !vehicleHintBoolean(hints, "awd")) return false;
  if (rules.combustionOnly && vehicleHintBoolean(hints, "electric")) return false;
  return true;
}

function archiveCatalogEntries() {
  return allDiagnosticMapItems();
}

function archiveCatalogItemCodes(): Set<string> {
  return new Set(archiveCatalogEntries().map(({ item }) => item.code));
}

function currentCatalogItem(itemCode: string) {
  return archiveCatalogEntries().find(({ item }) => item.code === itemCode)?.item ?? null;
}

function demandAttrValue(payload: Awaited<ReturnType<typeof loadLocalDemandDetailPayload>> | undefined, matcher: RegExp): string {
  if (!payload?.ok) return "";
  const attr = payload.data.attributes.find((item) => matcher.test(item.name));
  return asString(attr?.value);
}

function normalizeVehicle(input: VehicleInput, demandPayload?: Awaited<ReturnType<typeof loadLocalDemandDetailPayload>>): Required<VehicleInput> {
  const modelText = asString(input.model) || demandAttrValue(demandPayload, /модель авто|модель/i);
  const modelParts = modelText.split(/\s+/).filter(Boolean);
  const brand = asString(input.brand) || modelParts[0] || "";
  const model = asString(input.model) || modelParts.slice(1).join(" ");
  return {
    vin: asString(input.vin) || demandAttrValue(demandPayload, /vin/i),
    brand,
    model,
    year: asString(input.year) || demandAttrValue(demandPayload, /^год$/i),
    licensePlate: asString(input.licensePlate) || demandAttrValue(demandPayload, /гос|номер/i),
    mileage: asString(input.mileage) || demandAttrValue(demandPayload, /пробег/i),
    vehicleHints: input.vehicleHints ?? null,
  };
}

function photoRoot(): string {
  return process.env.DIAGNOSTIC_MAP_PHOTOS_PATH?.trim() || path.join(process.cwd(), ".data", "diagnostic-map-photos");
}

export function diagnosticMapPhotoMime(filePath: string, contentType?: string | null): string {
  if (contentType) return contentType;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function safeExtFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

function reportUrlFromRequest(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/report/${token}`;
}

async function resolveDemandIds(shipmentId: string | null | undefined): Promise<string[]> {
  const raw = asString(shipmentId);
  if (!raw) return [];
  const demand = await prisma.localDemand.findFirst({
    where: {
      OR: [{ id: raw }, { moyskladId: raw }, { name: raw }],
    },
    select: { id: true, moyskladId: true, name: true },
  });
  return [...new Set([raw, demand?.id, demand?.moyskladId, demand?.name].filter(Boolean) as string[])];
}

async function resolvePrimaryDemandId(shipmentId: string | null | undefined): Promise<string | null> {
  const raw = asString(shipmentId);
  if (!raw) return null;
  const demand = await prisma.localDemand.findFirst({
    where: {
      OR: [{ id: raw }, { moyskladId: raw }, { name: raw }],
    },
    select: { id: true },
  });
  return demand?.id ?? null;
}

export function requestOrigin(request: Request): string {
  const envOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (envOrigin) return envOrigin;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

async function updateSessionCounters(sessionId: string) {
  const catalogCodes = archiveCatalogItemCodes();
  const items = await prisma.diagnosticMapItem.findMany({
    where: { sessionId, itemCode: { in: [...catalogCodes] } },
    include: { photos: { select: { id: true } } },
  });
  const applicable = items.filter((item) => item.applicability === "APPLICABLE");
  const count = (status: string) => applicable.filter((item) => item.status === status).length;
  const indirectItems = applicable.filter((item) => ["NO_ACCESS", "BY_MILEAGE", "BY_CLIENT"].includes(item.status));
  const recommendationItems = applicable.filter((item) => {
    const hasText = Boolean(item.recommendation?.trim());
    return hasText || ["ATTENTION", "REPLACE", "BY_MILEAGE", "BY_CLIENT", "NO_ACCESS"].includes(item.status);
  });
  await prisma.diagnosticMapSession.update({
    where: { id: sessionId },
    data: {
      totalCount: applicable.length,
      normalCount: count("NORMAL"),
      attentionCount: count("ATTENTION"),
      replaceCount: count("REPLACE"),
      noAccessCount: count("NO_ACCESS"),
      byMileageCount: count("BY_MILEAGE"),
      byClientCount: count("BY_CLIENT"),
      indirectCount: indirectItems.length,
      withPhotoCount: applicable.filter((item) => item.photos.length > 0).length,
      withoutPhotoCount: applicable.filter((item) => item.photos.length === 0).length,
      nowRecommendationCount: recommendationItems.filter((item) => item.status === "REPLACE" && !item.nextVisit).length,
      nextVisitRecommendationCount: recommendationItems.filter((item) => item.status !== "REPLACE" || item.nextVisit).length,
    },
  });
}

async function ensureArchiveDiagnosticItems(sessionId: string) {
  const session = await prisma.diagnosticMapSession.findUnique({
    where: { id: sessionId },
    select: {
      vehicleHints: true,
      items: { select: { itemCode: true } },
    },
  });
  if (!session) return;
  const existing = new Set(session.items.map((item) => item.itemCode));
  const hints = (session.vehicleHints ?? {}) as Record<string, unknown>;
  const missing = archiveCatalogEntries().filter(({ item }) => !existing.has(item.code));
  if (missing.length === 0) return;
  await prisma.$transaction(
    missing.map(({ block, item, blockOrder, itemOrder }) => {
      const applicable = itemApplicable(item, hints);
      return prisma.diagnosticMapItem.create({
        data: {
          sessionId,
          blockCode: block.code,
          blockTitle: block.title,
          blockOrder,
          itemCode: item.code,
          itemTitle: item.title,
          itemOrder,
          catalogSnapshot: {
            block,
            item,
            commonRecommendations: DIAGNOSTIC_COMMON_RECOMMENDATIONS,
            source: "tgm-8/platform/data.jsx",
          } as Prisma.InputJsonValue,
          applicability: applicable ? "APPLICABLE" : "NOT_APPLICABLE",
          status: applicable ? "UNCHECKED" : "NOT_APPLICABLE",
          checkMethod: applicable ? "INSPECTION" : "SKIPPED",
          selectedNotes: [],
          selectedRecommendations: [],
          nextVisit: Boolean(item.defaultNextVisit),
        },
      });
    })
  );
  await updateSessionCounters(sessionId);
}

export async function createDiagnosticMapSession(input: CreateDiagnosticInput, user: SessionUser) {
  const demandId = await resolvePrimaryDemandId(input.shipmentId);
  if (asString(input.shipmentId) && !demandId) {
    console.error("[diagnostics] create failed: shipment not found", { shipmentId: input.shipmentId });
    throw new Error("Отгрузка для диагностики не найдена");
  }
  if (demandId) {
    const existing = await findDiagnosticMapForShipment(demandId);
    if (existing) {
      console.info("[diagnostics] create reused existing session", {
        shipmentId: input.shipmentId,
        demandId,
        diagnosticId: existing.id,
        status: existing.status,
      });
      return existing;
    }
  }

  const demandPayload = demandId ? await loadLocalDemandDetailPayload(demandId) : undefined;
  const vehicle = normalizeVehicle(input, demandPayload);
  const hints = (vehicle.vehicleHints ?? {}) as Record<string, unknown>;
  const demandData = demandPayload?.ok ? demandPayload.data : null;
  const demandClientName =
    demandData?.raw && typeof demandData.raw === "object"
      ? asString((demandData.raw as { agent?: { name?: unknown } }).agent?.name)
      : "";
  const clientName = asString(input.clientName) || demandClientName;
  const created = await prisma.$transaction(async (tx) => {
    const session = await tx.diagnosticMapSession.create({
      data: {
        demandId,
        clientId: input.clientId || null,
        clientName: clientName || asString(input.clientName) || null,
        clientPhone: asString(input.clientPhone) || null,
        vin: asString(vehicle.vin).replace(/\s/g, "").toUpperCase() || null,
        brand: asString(vehicle.brand) || null,
        model: asString(vehicle.model) || null,
        year: asInt(vehicle.year),
        licensePlate: asString(vehicle.licensePlate) || null,
        mileage: asInt(vehicle.mileage),
        vehicleHints: hints as Prisma.InputJsonValue,
        masterLogin: user.login,
        masterName: user.name || user.login,
        items: {
          create: allDiagnosticMapItems().map(({ block, item, blockOrder, itemOrder }) => {
            const applicable = itemApplicable(item, hints);
            return {
              blockCode: block.code,
              blockTitle: block.title,
              blockOrder,
              itemCode: item.code,
              itemTitle: item.title,
              itemOrder,
              catalogSnapshot: {
                block,
                item,
                commonRecommendations: DIAGNOSTIC_COMMON_RECOMMENDATIONS,
              } as Prisma.InputJsonValue,
              applicability: applicable ? "APPLICABLE" : "NOT_APPLICABLE",
              status: applicable ? "UNCHECKED" : "NOT_APPLICABLE",
              checkMethod: applicable ? "INSPECTION" : "SKIPPED",
              selectedNotes: [],
              selectedRecommendations: [],
              nextVisit: Boolean(item.defaultNextVisit),
            };
          }),
        },
      },
      select: { id: true },
    });
    return session;
  });
  await updateSessionCounters(created.id);
  console.info("[diagnostics] created session", {
    shipmentId: input.shipmentId,
    demandId,
    diagnosticId: created.id,
    itemCount: allDiagnosticMapItems().length,
  });
  return getDiagnosticMapSession(created.id);
}

export async function findDiagnosticMapForShipment(shipmentId: string) {
  const demandIds = await resolveDemandIds(shipmentId);
  const row = await prisma.diagnosticMapSession.findFirst({
    where: { demandId: { in: demandIds.length ? demandIds : [shipmentId] } },
    orderBy: { createdAt: "desc" },
  });
  console.info("[diagnostics] find for shipment", {
    shipmentId,
    demandIds,
    diagnosticId: row?.id ?? null,
    status: row?.status ?? null,
  });
  return row ? getDiagnosticMapSession(row.id) : null;
}

export async function getDiagnosticMapSession(id: string, origin = "") {
  await ensureArchiveDiagnosticItems(id);
  const row = await prisma.diagnosticMapSession.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          photos: { select: DIAGNOSTIC_MAP_PHOTO_LIST_SELECT, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
          actions: true,
        },
        orderBy: [{ blockOrder: "asc" }, { itemOrder: "asc" }],
      },
    },
  });
  if (!row) return null;
  return serializeDiagnosticMap(row, origin);
}

export async function getDiagnosticMapByToken(token: string, origin = "") {
  const session = await prisma.diagnosticMapSession.findUnique({ where: { publicToken: token }, select: { id: true } });
  if (session) await ensureArchiveDiagnosticItems(session.id);
  const row = await prisma.diagnosticMapSession.findUnique({
    where: { publicToken: token },
    include: {
      items: {
        include: {
          photos: { select: DIAGNOSTIC_MAP_PHOTO_LIST_SELECT, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
          actions: true,
        },
        orderBy: [{ blockOrder: "asc" }, { itemOrder: "asc" }],
      },
    },
  });
  if (!row) return null;
  return serializeDiagnosticMap(row, origin);
}

function itemMissingRecommendedPhoto(item: { status: string; photos: unknown[] }) {
  return ["ATTENTION", "REPLACE", "warn", "crit"].includes(item.status) && item.photos.length === 0;
}

function serializeDiagnosticMap(row: DiagnosticMapFullRow, origin = "") {
  const reportUrl = origin ? reportUrlFromRequest(origin, row.publicToken) : `/report/${row.publicToken}`;
  const blocks = DIAGNOSTIC_MAP_BLOCKS.map((block) => {
    return {
      code: block.code,
      title: block.title,
      short: block.short,
      items: block.items
        .map((catalogItem) => row.items.find((item) => item.blockCode === block.code && item.itemCode === catalogItem.code))
        .filter((item): item is DiagnosticMapItemFullRow => Boolean(item))
        .map((item) => serializeItem(row.id, item)),
    };
  });
  const items = blocks.flatMap((block) => block.items);
  const applicableItems = items.filter((item) => item.applicability === "applicable");
  const count = (status: DiagnosticMapStatusCode) => applicableItems.filter((item) => item.status === status).length;
  const computedCounts = {
    total: applicableItems.length,
    good: count("good"),
    warn: count("warn"),
    crit: count("crit"),
    unchecked: count("unchecked"),
    noAccess: count("no-access"),
    byMileage: count("by-mileage"),
    byClient: count("by-client"),
    indirect: applicableItems.filter((item) => ["no-access", "by-mileage", "by-client"].includes(item.status)).length,
    withPhoto: applicableItems.filter((item) => item.photos.length > 0).length,
    withoutPhoto: applicableItems.filter((item) => item.photos.length === 0).length,
  };
  const recommendationsNow = items.filter((item) => item.recommendation && item.status === "crit" && !item.nextVisit);
  const recommendationsNext = items.filter(
    (item) =>
      item.recommendation &&
      (item.nextVisit || item.status === "warn" || item.status === "by-mileage" || item.status === "by-client" || item.status === "no-access")
  );
  return {
    id: row.id,
    shipmentId: row.demandId,
    clientId: row.clientId,
    clientName: row.clientName,
    clientPhone: row.clientPhone,
    vehicle: {
      vin: row.vin,
      brand: row.brand,
      model: row.model,
      year: row.year,
      licensePlate: row.licensePlate,
      mileage: row.mileage,
      title: [row.brand, row.model, row.year ? String(row.year) : ""].filter(Boolean).join(" ") || "Автомобиль",
    },
    master: { login: row.masterLogin, name: row.masterName },
    status: row.status,
    publicToken: row.publicToken,
    reportUrl,
    printUrl: `${reportUrl}/print`,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    clientWantsReminder: row.clientWantsReminder,
    counts: {
      total: computedCounts.total,
      good: computedCounts.good,
      warn: computedCounts.warn,
      crit: computedCounts.crit,
      normal: computedCounts.good,
      attention: computedCounts.warn,
      replace: computedCounts.crit,
      indirect: computedCounts.indirect,
      noAccess: computedCounts.noAccess,
      byMileage: computedCounts.byMileage,
      byClient: computedCounts.byClient,
      withPhoto: computedCounts.withPhoto,
      withoutPhoto: computedCounts.withoutPhoto,
      recommendationsNow: recommendationsNow.length,
      recommendationsNext: recommendationsNext.length,
      unchecked: computedCounts.unchecked,
      missingRecommendedPhotos: items.filter(itemMissingRecommendedPhoto).length,
    },
    blocks,
    items,
    recommendationsNow,
    recommendationsNext,
    missingPhotoItems: items.filter(itemMissingRecommendedPhoto),
    statusLegend: DIAGNOSTIC_MAP_STATUSES,
  };
}

function serializeItem(sessionId: string, item: DiagnosticMapItemFullRow) {
  const status = STATUS_FROM_DB[item.status] ?? "unchecked";
  const catalog = item.catalogSnapshot as unknown as {
    item?: { notes?: string[]; recs?: string[]; norm?: string; measure?: string; unit?: string };
    commonRecommendations?: string[];
  };
  const currentCatalog = currentCatalogItem(item.itemCode);
  return {
    id: item.id,
    sessionId,
    blockCode: item.blockCode,
    blockTitle: item.blockTitle,
    code: item.itemCode,
    title: currentCatalog?.title ?? item.itemTitle,
    order: item.itemOrder,
    applicability: item.applicability === "APPLICABLE" ? "applicable" : item.applicability === "HIDDEN" ? "hidden" : "not_applicable",
    status,
    statusLabel: DIAGNOSTIC_MAP_STATUSES[status]?.label ?? "Не проверено",
    statusText: DIAGNOSTIC_MAP_STATUSES[status]?.clientText ?? "",
    checkMethod: METHOD_FROM_DB[item.checkMethod] ?? statusMethod(status),
    value: item.value ?? "",
    comment: item.comment ?? "",
    recommendation: item.recommendation ?? "",
    nextVisit: item.nextVisit,
    showInReport: item.showInReport,
    notes: currentCatalog?.notes ?? catalog.item?.notes ?? [],
    recs: [...(currentCatalog?.recs ?? catalog.item?.recs ?? []), ...(catalog.commonRecommendations ?? [])],
    norm: currentCatalog?.norm ?? catalog.item?.norm ?? "",
    measure: currentCatalog?.measure ?? catalog.item?.measure ?? "",
    unit: currentCatalog?.unit ?? catalog.item?.unit ?? "",
    selectedNotes: item.selectedNotes,
    selectedRecommendations: item.selectedRecommendations,
    photos: item.photos.map((photo) => ({
      id: photo.id,
      caption: photo.caption,
      url: `/api/diagnostics/${sessionId}/photos/${photo.id}`,
      thumbnailUrl: `/api/diagnostics/${sessionId}/photos/${photo.id}`,
      mimeType: diagnosticMapPhotoMime(photo.filePath, photo.contentType),
    })),
    reportText: buildDiagnosticReportText({
      code: item.itemCode,
      title: currentCatalog?.title ?? item.itemTitle,
      status,
      checkMethod: METHOD_FROM_DB[item.checkMethod] ?? statusMethod(status),
      value: item.value,
      comment: item.comment,
      recommendation: item.recommendation,
      photoCount: item.photos.length,
    }),
    actions: item.actions.map((action) => ({
      id: action.id,
      kind: action.kind,
      title: action.title,
      status: action.status,
      localDemandPositionId: action.localDemandPositionId,
      crmDealId: action.crmDealId,
    })),
  };
}

export async function updateDiagnosticMapItem(sessionId: string, input: UpdateItemInput) {
  const itemCode = asString(input.itemCode);
  if (!itemCode) throw new Error("itemCode не указан");
  const status = input.status ?? "unchecked";
  const item = await prisma.diagnosticMapItem.update({
    where: { sessionId_itemCode: { sessionId, itemCode } },
    data: {
      ...(input.status ? { status: STATUS_TO_DB[status] as never, checkMethod: METHOD_TO_DB[input.checkMethod ?? statusMethod(status)] as never } : {}),
      ...(input.checkMethod ? { checkMethod: METHOD_TO_DB[input.checkMethod] as never } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      ...(input.recommendation !== undefined ? { recommendation: input.recommendation } : {}),
      ...(input.nextVisit !== undefined ? { nextVisit: input.nextVisit } : {}),
      ...(input.showInReport !== undefined ? { showInReport: input.showInReport } : {}),
      ...(input.selectedNotes ? { selectedNotes: input.selectedNotes } : {}),
      ...(input.selectedRecommendations ? { selectedRecommendations: input.selectedRecommendations } : {}),
    },
  });
  await updateSessionCounters(sessionId);
  return getDiagnosticMapSession(sessionId).then((session) => session?.items.find((row) => row.id === item.id));
}

export async function saveDiagnosticMapPhoto(sessionId: string, itemCode: string, file: File, caption: string) {
  const item = await prisma.diagnosticMapItem.findUnique({
    where: { sessionId_itemCode: { sessionId, itemCode } },
    include: { _count: { select: { photos: true } } },
  });
  if (!item) throw new Error("Пункт диагностики не найден");
  const safeCaption = asString(caption);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > 12 * 1024 * 1024) throw new Error("Фото больше 12 МБ");
  const contentType = file.type || "image/jpeg";
  const ext = safeExtFromMime(contentType);
  const dir = path.join(photoRoot(), sessionId);
  const photo = await prisma.diagnosticMapPhoto.create({
    data: {
      itemId: item.id,
      filePath: "",
      contentType,
      sizeBytes: bytes.length,
      data: bytes,
      caption: safeCaption,
      sortOrder: item._count.photos,
    },
  });
  const filePath = path.join(dir, `${photo.id}.${ext}`);
  let updated = photo;
  try {
    fs.mkdirSync(dir, { recursive: true });
    await fsp.writeFile(filePath, bytes);
    updated = await prisma.diagnosticMapPhoto.update({ where: { id: photo.id }, data: { filePath } });
  } catch (error) {
    console.warn("[diagnostics] photo saved in DB, disk cache failed", {
      diagnosticId: sessionId,
      itemCode,
      photoId: photo.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  await updateSessionCounters(sessionId);
  return updated;
}

export async function getDiagnosticMapPhoto(sessionId: string, photoId: string) {
  return prisma.diagnosticMapPhoto.findFirst({
    where: { id: photoId, item: { sessionId } },
  });
}

export async function updateDiagnosticMapPhoto(sessionId: string, photoId: string, caption: string) {
  const photo = await prisma.diagnosticMapPhoto.findFirst({ where: { id: photoId, item: { sessionId } } });
  if (!photo) return null;
  return prisma.diagnosticMapPhoto.update({ where: { id: photo.id }, data: { caption: asString(caption) } });
}

export async function deleteDiagnosticMapPhoto(sessionId: string, photoId: string) {
  const photo = await prisma.diagnosticMapPhoto.findFirst({ where: { id: photoId, item: { sessionId } } });
  if (!photo) return false;
  await prisma.diagnosticMapPhoto.delete({ where: { id: photo.id } });
  try {
    fs.unlinkSync(photo.filePath);
  } catch {
    // File may already be gone; DB deletion is the source of truth.
  }
  await updateSessionCounters(sessionId);
  return true;
}

export async function completeDiagnosticMapSession(sessionId: string) {
  await updateSessionCounters(sessionId);
  await prisma.diagnosticMapSession.update({
    where: { id: sessionId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  const statuses = await prisma.diagnosticMapItem.groupBy({
    by: ["status"],
    where: { sessionId },
    _count: { status: true },
  });
  console.info("[diagnostics] completed session", {
    diagnosticId: sessionId,
    statuses: Object.fromEntries(statuses.map((row) => [row.status, row._count.status])),
  });
  return getDiagnosticMapSession(sessionId);
}

export async function addDiagnosticRecommendationToShipment(sessionId: string, itemCode: string) {
  const session = await prisma.diagnosticMapSession.findUnique({
    where: { id: sessionId },
    include: { items: true },
  });
  if (!session?.demandId) throw new Error("Диагностика не привязана к отгрузке");
  const item = session.items.find((row) => row.itemCode === itemCode);
  if (!item) throw new Error("Пункт диагностики не найден");
  const name = item.recommendation?.trim() || `Рекомендация диагностики: ${item.itemTitle}`;
  const position = await prisma.localDemandPosition.create({
    data: {
      demandId: session.demandId,
      assortmentType: "service",
      name,
      quantity: new Prisma.Decimal(1),
      priceCentsPerUnit: 0,
      discount: new Prisma.Decimal(0),
      vat: 0,
      vatEnabled: false,
      raw: {
        source: "diagnostic-map",
        sessionId,
        itemCode,
        itemTitle: item.itemTitle,
      } as Prisma.InputJsonValue,
    },
  });
  await prisma.diagnosticMapRecommendationAction.create({
    data: {
      itemId: item.id,
      kind: "ADD_TO_SHIPMENT",
      title: name,
      status: "done",
      localDemandPositionId: position.id,
    },
  });
  return position;
}

export async function createDiagnosticCrmTask(sessionId: string, itemCode: string, user: SessionUser) {
  const session = await prisma.diagnosticMapSession.findUnique({
    where: { id: sessionId },
    include: { items: true },
  });
  if (!session) throw new Error("Диагностика не найдена");
  const item = session.items.find((row) => row.itemCode === itemCode);
  if (!item) throw new Error("Пункт диагностики не найден");
  await ensureDefaultCrmStages();
  const stage =
    (await getCrmStageBySortOrder(90)) ??
    (await prisma.crmStage.findFirst({ orderBy: { sortOrder: "asc" } }));
  if (!stage) throw new Error("CRM-воронка не настроена");
  const title = item.recommendation?.trim() || `Диагностика: ${item.itemTitle}`;
  const vehicle = [session.brand, session.model, session.licensePlate].filter(Boolean).join(" · ");
  const deal = await prisma.crmDeal.create({
    data: {
      title,
      customerName: session.clientName,
      phoneNormalized: normalizePhoneKey(session.clientPhone),
      vehicle: vehicle || null,
      source: "diagnostic-map",
      nextAction: "Связаться по рекомендации диагностики",
      stageId: stage.id,
      responsibleLogin: user.login,
      notes: [
        session.demandId ? `Локальная отгрузка: ${session.demandId}` : "",
        `Пункт: ${item.itemTitle}`,
        item.comment ? `Комментарий: ${item.comment}` : "",
        item.recommendation ? `Рекомендация: ${item.recommendation}` : "",
      ].filter(Boolean).join("\n"),
      createdByLogin: user.login,
    },
  });
  await prisma.diagnosticMapRecommendationAction.create({
    data: {
      itemId: item.id,
      kind: "CREATE_CRM_TASK",
      title,
      status: "done",
      crmDealId: deal.id,
    },
  });
  return deal;
}

export async function savePublicDiagnosticReminder(token: string, clientWantsReminder: boolean) {
  const updated = await prisma.diagnosticMapSession.update({
    where: { publicToken: token },
    data: { clientWantsReminder },
    select: { id: true, clientWantsReminder: true },
  });
  return updated;
}
