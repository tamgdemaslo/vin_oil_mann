import { NextRequest, NextResponse } from "next/server";
import { ALL_NODES, tagLabelsForNode } from "@/data/diagnostic-catalog";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { ensureDefaultCrmStages, getCrmStageBySortOrder } from "@/lib/crm";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";

type ReminderBody = {
  positionIds?: unknown;
  dueDays?: unknown;
};

function parsePositionIds(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return ids.length > 0 ? new Set(ids) : null;
}

function parseDueDays(value: unknown): number {
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw)) return 30;
  return Math.min(365, Math.max(1, Math.round(raw)));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nodeTitle(node: string): string {
  return ALL_NODES.find((item) => item.node === node)?.title ?? node;
}

function vehicleLabel(diagnostic: { brand: string | null; model: string | null; year: number | null; licensePlate: string | null }) {
  return [diagnostic.brand, diagnostic.model, diagnostic.year ? String(diagnostic.year) : "", diagnostic.licensePlate]
    .filter(Boolean)
    .join(" · ") || null;
}

function defaultRecommendation(node: string, tags: string[]): string {
  if (node === "survey_cabin_filter") return "Проверить салонный фильтр на следующем визите";
  if (node === "survey_air_filter") return "Проверить воздушный фильтр на следующем визите";
  if (node === "survey_sparks") return "Уточнить регламент свечей и предложить контроль";
  const labels = tagLabelsForNode(node, tags);
  return labels.length > 0 ? `Контроль: ${labels.join(", ")}` : `Контроль: ${nodeTitle(node)}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithCashShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: ReminderBody = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const selectedIds = parsePositionIds(body.positionIds);
  const dueDays = parseDueDays(body.dueDays);

  const diagnostic = await prisma.diagnostic.findUnique({
    where: { id },
    include: {
      positions: {
        where: { status: "YELLOW" },
        include: { photos: true },
        orderBy: [{ block: "asc" }, { node: "asc" }],
      },
    },
  });

  if (!diagnostic) return NextResponse.json({ error: "Диагностика не найдена" }, { status: 404 });

  const positions = diagnostic.positions.filter((position) => !selectedIds || selectedIds.has(position.id));
  if (positions.length === 0) {
    return NextResponse.json({ created: [], existing: [], positionIds: [], message: "Нет жёлтых пунктов для CRM" });
  }

  await ensureDefaultCrmStages();
  const stage =
    (await getCrmStageBySortOrder(10)) ??
    (await prisma.crmStage.findFirst({ orderBy: { sortOrder: "asc" } }));

  if (!stage) return NextResponse.json({ error: "Не найдены стадии CRM" }, { status: 500 });

  const linkedDemand = diagnostic.shipmentDraftId
    ? await prisma.localDemand.findUnique({ where: { id: diagnostic.shipmentDraftId }, include: { counterparty: true } })
    : null;
  const counterparty = linkedDemand?.counterparty ?? null;

  const deadline = addDays(new Date(), dueDays);
  const created: { id: string; positionId: string }[] = [];
  const existing: { id: string; positionId: string }[] = [];
  const vehicle = vehicleLabel(diagnostic);

  for (const position of positions) {
    const marker = `diagnostic:${diagnostic.id}:position:${position.id}`;
    const duplicate = await prisma.crmDeal.findFirst({
      where: {
        status: "open",
        source: "diagnostic",
        notes: { contains: marker },
      },
      select: { id: true },
    });

    if (duplicate) {
      existing.push({ id: duplicate.id, positionId: position.id });
      continue;
    }

    const recommendation = position.recommendation?.trim() || defaultRecommendation(position.node, position.tags);
    const tagLabels = tagLabelsForNode(position.node, position.tags);
    const notes = [
      `Жёлтая зона диагностики: ${nodeTitle(position.node)}`,
      `Рекомендация: ${recommendation}`,
      tagLabels.length > 0 ? `Теги: ${tagLabels.join(", ")}` : "",
      position.notes?.trim() ? `Комментарий мастера: ${position.notes.trim()}` : "",
      position.photos.length > 0 ? `Фото: ${position.photos.length}` : "Фото: нет",
      `Связь с диагностикой: ${marker}`,
    ]
      .filter(Boolean)
      .join("\n");

    const deal = await prisma.crmDeal.create({
      data: {
        title: `Следующий визит: ${nodeTitle(position.node)}`,
        customerName: counterparty?.name ?? null,
        phoneNormalized: counterparty?.normalizedPhone ?? normalizePhoneKey(counterparty?.phone),
        vehicle,
        source: "diagnostic",
        clientType: counterparty ? "regular" : "unlinked",
        nextAction: "Связаться и предложить запись на следующий визит",
        stageId: stage.id,
        responsibleLogin: gate.session.user.login,
        shipmentId: diagnostic.shipmentDraftId,
        diagnosticId: diagnostic.id,
        caseStatus: "calculation_needed",
        caseType: "diagnostic",
        caseKey: marker,
        nextActionAt: deadline,
        nextContactAt: deadline,
        notes,
        createdByLogin: gate.session.user.login,
      },
    });

    created.push({ id: deal.id, positionId: position.id });
  }

  return NextResponse.json({
    created,
    existing,
    positionIds: [...created, ...existing].map((item) => item.positionId),
    createdCount: created.length,
    existingCount: existing.length,
    deadline: deadline.toISOString(),
  });
}
