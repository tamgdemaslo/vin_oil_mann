import { NextRequest, NextResponse } from "next/server";
import { buildDiagnosticReportItemText } from "@/data/diagnostic-report-copy";
import { ensureDefaultCrmStages, getCrmStageBySortOrder } from "@/lib/crm";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function dueDateFromBody(term?: string, dateValue?: string | null): Date {
  if (term === "date" && dateValue) {
    const parsed = new Date(`${dateValue}T12:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (term === "3m") return addMonths(new Date(), 3);
  if (term === "10000km") return addMonths(new Date(), 6);
  return addMonths(new Date(), 6);
}

function vehicleLabel(diagnostic: { brand: string | null; model: string | null; year: number | null; licensePlate: string | null }) {
  return [diagnostic.brand, diagnostic.model, diagnostic.year ? String(diagnostic.year) : "", diagnostic.licensePlate]
    .filter(Boolean)
    .join(" · ") || null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "token не указан" }, { status: 400 });

  let body: {
    clientWantsReminder?: boolean;
    reminderTerm?: string;
    reminderDate?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело" }, { status: 400 });
  }

  const wants = Boolean(body.clientWantsReminder);

  const diagnostic = await prisma.diagnostic.findUnique({
    where: { clientReportToken: token },
    include: {
      positions: {
        where: { status: "YELLOW" },
        include: { photos: true },
        orderBy: [{ block: "asc" }, { node: "asc" }],
      },
    },
  });
  if (!diagnostic) return NextResponse.json({ error: "Отчёт не найден" }, { status: 404 });

  await prisma.diagnostic.update({
    where: { id: diagnostic.id },
    data: { clientWantsReminder: wants },
  });

  let createdCount = 0;
  let existingCount = 0;
  let deadline: Date | null = null;

  if (wants && diagnostic.positions.length > 0) {
    await ensureDefaultCrmStages();
    const stage =
      (await getCrmStageBySortOrder(90)) ??
      (await prisma.crmStage.findFirst({ orderBy: { sortOrder: "asc" } }));
    if (!stage) return NextResponse.json({ error: "Не найдены стадии CRM" }, { status: 500 });

    const counterparty = diagnostic.agentMoySkladId
      ? await prisma.localCounterparty.findFirst({
          where: {
            OR: [{ id: diagnostic.agentMoySkladId }, { moyskladId: diagnostic.agentMoySkladId }],
          },
        })
      : null;
    const vehicle = vehicleLabel(diagnostic);
    deadline = dueDateFromBody(body.reminderTerm, body.reminderDate);

    for (const position of diagnostic.positions) {
      const marker = `diagnostic:${diagnostic.id}:position:${position.id}:public-reminder`;
      const duplicate = await prisma.crmDeal.findFirst({
        where: {
          status: "open",
          source: "diagnostic",
          notes: { contains: marker },
        },
        select: { id: true },
      });
      if (duplicate) {
        existingCount += 1;
        continue;
      }

      const itemText = buildDiagnosticReportItemText(position, diagnostic);
      const notes = [
        `Клиент отметил напоминание из публичного отчёта.`,
        `Пункт: ${itemText.title}`,
        `Рекомендация: ${itemText.recommendation}`,
        `Когда: ${itemText.urgency}`,
        position.photos.length > 0 ? `Фото: ${position.photos.length}` : "Фото: нет",
        `Связь с диагностикой: ${marker}`,
      ].join("\n");

      await prisma.crmDeal.create({
        data: {
          title: `Напомнить: ${itemText.title}`,
          customerName: counterparty?.name ?? null,
          phoneNormalized: counterparty?.normalizedPhone ?? normalizePhoneKey(counterparty?.phone),
          vehicle,
          source: "diagnostic",
          clientType: counterparty ? "regular" : "unlinked",
          nextAction: "Связаться и предложить запись на следующий сервисный визит",
          stageId: stage.id,
          responsibleLogin: diagnostic.mechanicLogin,
          moyskladCounterpartyId: counterparty?.moyskladId ?? counterparty?.id ?? null,
          moyskladCounterpartyName: counterparty?.name ?? null,
          moyskladCounterpartyHref: counterparty?.moyskladHref ?? (counterparty ? `local://counterparty/${counterparty.id}` : null),
          moyskladDemandId: diagnostic.shipmentMoySkladId,
          nextContactAt: deadline,
          notes,
          createdByLogin: diagnostic.mechanicLogin ?? "client-report",
        },
      });
      createdCount += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    clientWantsReminder: wants,
    reminderTerm: body.reminderTerm ?? null,
    reminderDate: body.reminderDate ?? null,
    createdCount,
    existingCount,
    deadline: deadline?.toISOString() ?? null,
  });
}
