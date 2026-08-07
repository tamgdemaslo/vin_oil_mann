import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getTBankIntegrationStatus, saveTBankIntegrationSettings } from "@/lib/tbank";

export async function GET() {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  return runWithBranchApiContext(access.context, async () =>
    NextResponse.json(await getTBankIntegrationStatus())
  );
}

export async function PATCH(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  return runWithBranchApiContext(access.context, async () => {
    const result = await saveTBankIntegrationSettings(
      body as Parameters<typeof saveTBankIntegrationSettings>[0],
      access.context.user
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.integration);
  });
}
