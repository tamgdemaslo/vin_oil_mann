import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";

type CashoutRow = {
  id: string;
  name: string;
  moment: string;
  sum: number;
  applicable: boolean;
  paymentPurpose?: string;
  description?: string;
  meta: { href: string; type: string; mediaType: string };
  agent?: { name?: string };
  expenseItem?: { name?: string };
  organization?: { name?: string };
};

type CashoutListResponse = {
  meta?: { size?: number; limit?: number; offset?: number };
  rows?: CashoutRow[];
};

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);

  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  params.set("order", "moment,desc");
  params.set("expand", "agent,expenseItem,organization");
  if (search.trim()) params.set("search", search.trim());

  const result = await moyskladFetch<CashoutListResponse>(`/entity/cashout?${params.toString()}`, {
    cache: "no-store",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    meta: {
      size: result.data.meta?.size ?? 0,
      limit: result.data.meta?.limit ?? limit,
      offset: result.data.meta?.offset ?? offset,
    },
    cashouts: (result.data.rows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      moment: row.moment,
      sum: row.sum,
      applicable: row.applicable,
      paymentPurpose: row.paymentPurpose ?? "",
      description: row.description ?? "",
      agentName: row.agent?.name ?? "",
      expenseItemName: row.expenseItem?.name ?? "",
      organizationName: row.organization?.name ?? "",
      meta: row.meta,
    })),
  });
}
