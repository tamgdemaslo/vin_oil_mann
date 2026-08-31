import { NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";
import { resolveShipmentPrintAccess, runWithDocumentPrintAccess } from "@/lib/document-print-access";
import { buildJobOrderXlsBuffer } from "@/lib/job-order-xls";
import { loadLocalDemandDetailPayload } from "@/lib/local-demand-write";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const branchAccess = await requireBranchApi({ allowAll: true, requireActive: false });
  if (!branchAccess.ok) return branchAccess.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });
  const printAccess = await resolveShipmentPrintAccess(branchAccess.context, id);
  if (!printAccess) return NextResponse.json({ error: "Отгрузка не найдена или недоступна" }, { status: 404 });

  const loaded = await runWithDocumentPrintAccess(printAccess, () => loadLocalDemandDetailPayload(id, printAccess.branchId));
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 502 });

  let buffer: Buffer;
  try {
    buffer = await runWithDocumentPrintAccess(printAccess, () => buildJobOrderXlsBuffer(loaded.data));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка формирования Excel";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const asciiName = `zakaz-naryad-${loaded.data.header.id}.xls`;
  const utfName = encodeURIComponent(`заказ-наряд-${loaded.data.header.name}.xls`);

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.ms-excel",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${utfName}`,
    },
  });
}
