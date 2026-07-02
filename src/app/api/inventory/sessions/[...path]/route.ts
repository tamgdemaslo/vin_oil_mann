import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  addInventoryProduct,
  approveInventorySession,
  cancelInventorySession,
  completeInventoryCounting,
  executeInventoryImport,
  countInventoryLine,
  getInventoryReconciliation,
  getInventorySession,
  listInventoryLines,
  movementsDuringInventory,
  postInventorySession,
  previewInventoryScope,
  reverseInventorySession,
  scanInventoryBarcode,
  setInventoryCountingPaused,
  startInventorySession,
  submitInventoryReview,
  updateInventoryLineResolution,
  updateInventorySession,
  validateInventoryImport,
} from "@/lib/warehouse-inventory";

type RouteContext = { params: Promise<{ path: string[] }> };

async function readBody(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function apiError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

function apiResult(result: { ok: true; data: unknown } | { ok: false; error: string; status?: number }) {
  if (!result.ok) return apiError(result.error, result.status ?? 400);
  return NextResponse.json(result.data);
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function htmlEscape(value: unknown) {
  return value == null
    ? ""
    : String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function rub(cents: number | null | undefined) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format((cents ?? 0) / 100);
}

function quantity(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value);
}

function inventoryReportHtml(data: NonNullable<Awaited<ReturnType<typeof getInventoryReconciliation>>>) {
  const rows = data.lines.map((line) => `
    <tr>
      <td>${htmlEscape(line.name)}<div class="muted">${htmlEscape(line.article || line.ean || "")}</div></td>
      <td>${htmlEscape(line.category)}</td>
      <td>${htmlEscape(line.cellId || "без ячейки")}</td>
      <td class="num">${quantity(line.expectedQuantityAtCount)}</td>
      <td class="num">${quantity(line.finalQuantity)}</td>
      <td class="num">${quantity(line.differenceQuantity)}</td>
      <td class="num">${rub(line.differenceCostCents)}</td>
      <td>${htmlEscape(line.finalAction || line.proposedAction || "NO_ACTION")}</td>
      <td>${htmlEscape(line.reasonCode)}</td>
    </tr>
  `).join("");
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(data.session.number)} · Инвентаризация</title>
  <style>
    body { font-family: Arial, sans-serif; color: #18181b; margin: 32px; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    .muted { color: #71717a; font-size: 12px; margin-top: 3px; }
    .meta, .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 18px 0; }
    .box { border: 1px solid #d4d4d8; border-radius: 6px; padding: 10px; }
    .label { color: #71717a; font-size: 11px; text-transform: uppercase; }
    .value { font-weight: 700; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #d4d4d8; padding: 7px; vertical-align: top; }
    th { background: #f4f4f5; text-align: left; }
    .num { text-align: right; white-space: nowrap; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 32px; }
    .line { border-bottom: 1px solid #18181b; height: 32px; }
    @media print { body { margin: 12mm; } .no-print { display: none; } }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()">Печать</button>
  <h1>Инвентаризационная ведомость ${htmlEscape(data.session.number)}</h1>
  <div class="muted">${htmlEscape(data.session.organizationName)} · ${htmlEscape(data.session.warehouseName)}</div>
  <section class="meta">
    <div class="box"><div class="label">Статус</div><div class="value">${htmlEscape(data.session.status)}</div></div>
    <div class="box"><div class="label">Режим подсчёта</div><div class="value">${htmlEscape(data.session.countMode)}</div></div>
    <div class="box"><div class="label">Начало</div><div class="value">${htmlEscape(data.session.startedAt ?? "—")}</div></div>
    <div class="box"><div class="label">Ответственный</div><div class="value">${htmlEscape(data.session.responsibleId || "—")}</div></div>
  </section>
  <section class="kpis">
    <div class="box"><div class="label">Позиций</div><div class="value">${data.session.totalLines}</div></div>
    <div class="box"><div class="label">Совпало</div><div class="value">${data.session.matchingLines}</div></div>
    <div class="box"><div class="label">Недостача</div><div class="value">${data.session.shortageLines} · ${rub(data.session.totalShortageCostCents)}</div></div>
    <div class="box"><div class="label">Излишек</div><div class="value">${data.session.surplusLines} · ${rub(data.session.totalSurplusCostCents)}</div></div>
  </section>
  <table>
    <thead><tr><th>Товар</th><th>Категория</th><th>Ячейка</th><th>Учёт</th><th>Факт</th><th>Разница</th><th>Сумма</th><th>Действие</th><th>Причина</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <section class="signatures">
    <div><div class="label">Считал</div><div class="line"></div></div>
    <div><div class="label">Проверил</div><div class="line"></div></div>
    <div><div class="label">Утвердил</div><div class="line"></div></div>
  </section>
</body>
</html>`;
}

async function exportCountSheet(sessionId: string) {
  const reconciliation = await getInventoryReconciliation(sessionId);
  if (!reconciliation) return apiError("Инвентаризация не найдена", 404);
  const blind = reconciliation.session.countMode === "BLIND";
  const header = [
    "internal product ID",
    "название",
    "артикул",
    "EAN",
    "категория",
    "бренд",
    "ячейка",
    "единица",
    ...(blind ? [] : ["учётный остаток"]),
    "Фактически",
    "комментарий",
  ];
  const rows = reconciliation.lines.map((line) => [
    line.productId,
    line.name,
    line.article,
    line.ean,
    line.category,
    line.brand,
    line.cellId,
    line.unitId,
    ...(blind ? [] : [line.expectedQuantityAtCount]),
    "",
    "",
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventory-${reconciliation.session.number}.csv"`,
    },
  });
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return apiError("Необходима авторизация", 401);

  const path = (await params).path;
  const [sessionId, action] = path;
  if (!sessionId) return apiError("Не выбрана инвентаризация", 400);

  if (path.length === 1) {
    const row = await getInventorySession(sessionId);
    return row ? NextResponse.json({ session: row }) : apiError("Инвентаризация не найдена", 404);
  }

  if (action === "lines") {
    const sp = request.nextUrl.searchParams;
    return NextResponse.json(await listInventoryLines(sessionId, {
      search: sp.get("search") ?? undefined,
      status: sp.get("status") ?? undefined,
      cell: sp.get("cell") ?? undefined,
      limit: Number(sp.get("limit") ?? 100),
      offset: Number(sp.get("offset") ?? 0),
    }));
  }

  if (action === "reconciliation") {
    const data = await getInventoryReconciliation(sessionId);
    return data ? NextResponse.json(data) : apiError("Инвентаризация не найдена", 404);
  }

  if (action === "report") {
    const data = await getInventoryReconciliation(sessionId);
    if (!data) return apiError("Инвентаризация не найдена", 404);
    if (request.nextUrl.searchParams.get("format") === "html") {
      return new NextResponse(inventoryReportHtml(data), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return NextResponse.json(data);
  }

  if (action === "movements-during-count") {
    const data = await movementsDuringInventory(sessionId);
    return data ? NextResponse.json(data) : apiError("Инвентаризация не найдена", 404);
  }

  if (action === "export-count-sheet") return exportCountSheet(sessionId);

  return apiError("Неизвестный endpoint", 404);
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return apiError("Необходима авторизация", 401);

  const path = (await params).path;
  const [sessionId, action, lineId, leaf] = path;
  const body = await readBody(request);

  if (path.length === 1) return apiResult(await updateInventorySession(sessionId, body as Parameters<typeof updateInventorySession>[1], session.user));
  if (action === "lines" && lineId && leaf === "resolution") {
    return apiResult(await updateInventoryLineResolution(sessionId, lineId, body as Parameters<typeof updateInventoryLineResolution>[2], session.user));
  }

  return apiError("Неизвестный endpoint", 404);
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) return apiError("Необходима авторизация", 401);

  const path = (await params).path;
  const [sessionId, action, lineId, leaf, subleaf] = path;
  const body = await readBody(request);
  if (!sessionId) return apiError("Не выбрана инвентаризация", 400);

  if (action === "preview-scope") return apiResult(await previewInventoryScope(sessionId));
  if (action === "start") return apiResult(await startInventorySession(sessionId, session.user));
  if (action === "pause") return apiResult(await setInventoryCountingPaused(sessionId, true, session.user));
  if (action === "resume") return apiResult(await setInventoryCountingPaused(sessionId, false, session.user));
  if (action === "complete-counting") return apiResult(await completeInventoryCounting(sessionId, session.user));
  if (action === "submit-review") return apiResult(await submitInventoryReview(sessionId, session.user));
  if (action === "approve") return apiResult(await approveInventorySession(sessionId, session.user));
  if (action === "post") return apiResult(await postInventorySession(sessionId, body as Parameters<typeof postInventorySession>[1], session.user));
  if (action === "reverse") return apiResult(await reverseInventorySession(sessionId, body as Parameters<typeof reverseInventorySession>[1], session.user));
  if (action === "cancel") return apiResult(await cancelInventorySession(sessionId, body as Parameters<typeof cancelInventorySession>[1], session.user));
  if (action === "add-product") return apiResult(await addInventoryProduct(sessionId, body as Parameters<typeof addInventoryProduct>[1], session.user));
  if (action === "scan") return apiResult(await scanInventoryBarcode(sessionId, body as Parameters<typeof scanInventoryBarcode>[1], session.user));
  if (action === "lines" && lineId && (leaf === "count" || leaf === "recount")) {
    return apiResult(await countInventoryLine(sessionId, lineId, body as Parameters<typeof countInventoryLine>[2], session.user));
  }
  if (action === "import" && lineId === "validate") return NextResponse.json(await validateInventoryImport(sessionId, body));
  if (action === "import" && lineId === "execute") {
    return apiResult(await executeInventoryImport(sessionId, body, session.user));
  }
  if (action === "import" && lineId === "validate" && leaf === "dry-run") return NextResponse.json(await validateInventoryImport(sessionId, body));
  if (action === "lines" && lineId && leaf === "import" && subleaf === "execute") {
    return apiError("Используйте /api/inventory/sessions/:id/import/execute", 400);
  }

  return apiError("Неизвестный endpoint", 404);
}
