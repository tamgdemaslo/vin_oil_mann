import { runWithBranchApiContext } from "@/lib/branch-api";
import { avitoApiError, requireAvitoApi } from "@/lib/avito-autoload/api-access";
import { downloadAvitoExport } from "@/lib/avito-autoload/service";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const access = await requireAvitoApi();
  if (!access.ok) return access.response;
  try {
    const { exportId } = await params;
    const csv = await runWithBranchApiContext(access.context, () => downloadAvitoExport(exportId));
    return new Response(new Uint8Array(csv), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="avito-${exportId}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return avitoApiError(error); }
}
