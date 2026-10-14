import { runWithBranchApiContext } from "@/lib/branch-api";
import { avitoApiError, requireAvitoApi } from "@/lib/avito-autoload/api-access";
import { downloadAvitoExport } from "@/lib/avito-autoload/service";
import { AvitoAutoloadError } from "@/lib/avito-autoload/schemas";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const access = await requireAvitoApi();
  if (!access.ok) return access.response;
  try {
    const { exportId } = await params;
    const format = new URL(request.url).searchParams.get("format") ?? "csv";
    if (format !== "csv" && format !== "xml") throw new AvitoAutoloadError("Выберите формат XML или CSV", 400);
    const body = await runWithBranchApiContext(access.context, () => downloadAvitoExport(exportId, format));
    return new Response(new Uint8Array(body), { headers: { "Content-Type": `${format === "xml" ? "application/xml" : "text/csv"}; charset=utf-8`, "Content-Disposition": `attachment; filename="avito-${exportId}.${format}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return avitoApiError(error); }
}
