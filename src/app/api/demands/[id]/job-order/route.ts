import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadDemandDetailPayload } from "@/lib/demand-detail-load";
import { buildJobOrderXlsBuffer } from "@/lib/job-order-xls";
import { isLocalInventoryReadsEnabled } from "@/lib/local-inventory-read";
import { loadLocalDemandDetailPayload } from "@/lib/local-demand-write";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const loaded = isLocalInventoryReadsEnabled()
    ? await loadLocalDemandDetailPayload(id)
    : await loadDemandDetailPayload(id);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: 502 });

  let buffer: Buffer;
  try {
    buffer = await buildJobOrderXlsBuffer(loaded.data);
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
