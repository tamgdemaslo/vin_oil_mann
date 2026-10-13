import { NextResponse } from "next/server";
import { runWithBranchApiContext } from "@/lib/branch-api";
import { canManageBranchIntegrationSecrets } from "@/lib/integration-access";
import { canEditAvito } from "@/lib/avito-autoload/access";
import { avitoApiError, readAvitoRequest, requireAvitoApi } from "@/lib/avito-autoload/api-access";
import { AvitoAutoloadError, avitoApiActionSchema, avitoExportSchema, avitoListingSaveSchema, avitoSelectionSchema, avitoSettingsSaveSchema } from "@/lib/avito-autoload/schemas";
import { generateAvitoExport, getAvitoWorkspace, performAvitoApiAction, saveAvitoListing, saveAvitoSettings, selectAvitoProducts } from "@/lib/avito-autoload/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireAvitoApi();
  if (!access.ok) return access.response;
  try {
    const params = new URL(request.url).searchParams;
    const data = await runWithBranchApiContext(access.context, () => getAvitoWorkspace({
      branchName: access.context.branch!.shortName || access.context.branch!.name,
      address: access.context.branch!.address ?? "", phone: access.context.branch!.phone ?? "",
      canEdit: canEditAvito(access.context), canEditSecrets: canManageBranchIntegrationSecrets(access.context),
      search: (params.get("search") ?? "").slice(0, 200), offset: Math.max(0, Math.min(50_000, Number(params.get("offset")) || 0)),
      type: params.get("type") ?? "all", view: params.get("view") ?? "all",
    }));
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return avitoApiError(error); }
}

export async function POST(request: Request) {
  const access = await requireAvitoApi(true);
  if (!access.ok) return access.response;
  try {
    const body = await readAvitoRequest(request);
    const { operation, ...input } = body;
    const result = await runWithBranchApiContext(access.context, async () => {
      switch (operation) {
        case "settings": {
          const parsed = avitoSettingsSaveSchema.parse(input);
          if ((parsed.clientId || parsed.clientSecret || parsed.rotateFeedToken) && !canManageBranchIntegrationSecrets(access.context)) throw new AvitoAutoloadError("Менять ключи и ссылку подключения может только владелец бизнес-группы", 403);
          await saveAvitoSettings(parsed);
          return { message: "Настройки сохранены" };
        }
        case "listing": await saveAvitoListing(avitoListingSaveSchema.parse(input)); return { message: "Объявление сохранено" };
        case "selection": await selectAvitoProducts(avitoSelectionSchema.parse(input)); return { message: "Выбор товаров сохранён" };
        case "generate": return generateAvitoExport(avitoExportSchema.parse(input).allowEmpty);
        case "api": return performAvitoApiAction(avitoApiActionSchema.parse(input).action);
        default: throw new AvitoAutoloadError("Неизвестное действие", 400);
      }
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return avitoApiError(error); }
}
