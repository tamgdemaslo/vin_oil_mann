import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { canManageBranchIntegrationSecrets, canViewBranchIntegrationSettings } from "@/lib/integration-access";
import { canEditAvito } from "@/lib/avito-autoload/access";
import { avitoApiError, readAvitoRequest } from "@/lib/avito-autoload/api-access";
import { AvitoAutoloadError, avitoApiActionSchema, avitoCredentialsSaveSchema, avitoSettingsSaveSchema } from "@/lib/avito-autoload/schemas";
import { getAvitoIntegration, performAvitoApiAction, saveAvitoCredentials, saveAvitoSettings } from "@/lib/avito-autoload/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

async function integrationAccess() {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access;
  if (!canViewBranchIntegrationSettings(access.context)) return { ok: false as const, response: NextResponse.json({ error: "Нет доступа к настройкам интеграций Авито" }, { status: 403, headers }) };
  return access;
}

export async function GET() {
  const access = await integrationAccess();
  if (!access.ok) return access.response;
  try {
    const result = await runWithBranchApiContext(access.context, () => getAvitoIntegration({
      branchName: access.context.branch!.shortName || access.context.branch!.name,
      address: access.context.branch!.address ?? "", phone: access.context.branch!.phone ?? "",
      canEdit: canEditAvito(access.context), canEditSecrets: canManageBranchIntegrationSecrets(access.context),
    }));
    return NextResponse.json(result, { headers });
  } catch (error) { return avitoApiError(error); }
}

export async function POST(request: Request) {
  const access = await integrationAccess();
  if (!access.ok) return access.response;
  try {
    if (!canEditAvito(access.context)) throw new AvitoAutoloadError("Нет прав на изменение подключения Авито", 403);
    const { operation, ...input } = await readAvitoRequest(request);
    const result = await runWithBranchApiContext(access.context, async () => {
      switch (operation) {
        case "credentials": {
          if (!canManageBranchIntegrationSecrets(access.context)) throw new AvitoAutoloadError("Сохранять ключи API может только владелец бизнес-группы", 403);
          await saveAvitoCredentials(avitoCredentialsSaveSchema.parse(input), {
            branchName: access.context.branch!.shortName || access.context.branch!.name,
            address: access.context.branch!.address ?? "", phone: access.context.branch!.phone ?? "",
          });
          return { message: "Ключи API Авито сохранены" };
        }
        case "settings": {
          const parsed = avitoSettingsSaveSchema.parse(input);
          if ((parsed.clientId || parsed.clientSecret || parsed.rotateFeedToken) && !canManageBranchIntegrationSecrets(access.context)) throw new AvitoAutoloadError("Менять ключи и ссылку подключения может только владелец бизнес-группы", 403);
          await saveAvitoSettings(parsed);
          return { message: "Настройки выгрузки сохранены" };
        }
        case "api": return performAvitoApiAction(avitoApiActionSchema.parse(input).action);
        default: throw new AvitoAutoloadError("Неизвестное действие подключения Авито", 400);
      }
    });
    return NextResponse.json(result, { headers });
  } catch (error) { return avitoApiError(error); }
}
