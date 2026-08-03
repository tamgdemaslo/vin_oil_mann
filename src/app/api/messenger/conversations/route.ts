import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listConversations } from "@/lib/messenger/messenger-gateway";
import type { MessengerChannel, MessengerListParams } from "@/lib/messenger/messenger-types";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const params: MessengerListParams = {
    search: request.nextUrl.searchParams.get("search") ?? "",
    filter: (request.nextUrl.searchParams.get("filter") as MessengerListParams["filter"]) ?? "all",
    channel: (request.nextUrl.searchParams.get("channel") as MessengerChannel | "all" | null) ?? "all",
    clientId: request.nextUrl.searchParams.get("clientId") ?? undefined,
    assignedTo: request.nextUrl.searchParams.get("assignedTo") ?? undefined,
    limit: Number(request.nextUrl.searchParams.get("limit") ?? 50),
    offset: Number(request.nextUrl.searchParams.get("offset") ?? 0),
  };
  const conversations = await listConversations(params);
  return NextResponse.json({ conversations, total: conversations.length });
}
