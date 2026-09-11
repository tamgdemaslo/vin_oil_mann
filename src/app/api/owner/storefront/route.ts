import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  getStorefrontConfiguration,
  saveStorefrontConfiguration,
  StorefrontConfigurationError,
} from "@/lib/storefront-configuration";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof StorefrontConfigurationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("storefront configuration failed", error);
  return NextResponse.json({ error: "Не удалось обновить настройки витрины." }, { status: 500 });
}

export async function GET() {
  const access = await requireBranchApi({ allowAll: true, requireActive: false });
  if (!access.ok) return access.response;
  try {
    const result = await runWithBranchApiContext(access.context, () => getStorefrontConfiguration(access.context));
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true, requireActive: false });
  if (!access.ok) return access.response;
  try {
    const body = await request.json();
    const result = await runWithBranchApiContext(access.context, () => saveStorefrontConfiguration(access.context, body ?? {}));
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
