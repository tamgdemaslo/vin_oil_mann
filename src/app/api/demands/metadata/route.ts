import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import {
  anonymousRetailCounterpartyApiModel,
  ensureAnonymousRetailCounterparty,
} from "@/lib/anonymous-retail-counterparty";
import { ensureDemandAttributeMetadata } from "@/lib/demand-attributes";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branchAccess.ok) return branchAccess.response;

  return runWithBranchApiContext(branchAccess.context, async () => {
    const metaRes = await ensureDemandAttributeMetadata();
    if (!metaRes.ok) return NextResponse.json({ error: metaRes.error }, { status: 502 });

    const attributes = metaRes.attributes.map((m) => ({
      id: m.id,
      name: m.name,
      type: m.type,
      meta: m.meta,
      value: null as string | null,
    }));

    const anonymousRetailCounterparty = await ensureAnonymousRetailCounterparty(branchAccess.context.branchId!);

    return NextResponse.json({
      attributes,
      anonymousRetailCounterparty: anonymousRetailCounterpartyApiModel(anonymousRetailCounterparty),
    });
  });
}
