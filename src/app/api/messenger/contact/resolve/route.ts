import { NextRequest, NextResponse } from "next/server";
import { getContactStatus, startContactConversation } from "@/lib/messenger/messenger-contact-actions";
import { contactActionError, readContactBody, requireMessengerSession } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireMessengerSession();
  if ("response" in auth) return auth.response;
  const body = await readContactBody(request);
  try {
    const result = await startContactConversation(body, auth.session.user);
    return NextResponse.json(result);
  } catch (error) {
    return contactActionError(error);
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireMessengerSession();
  if ("response" in auth) return auth.response;
  try {
    const status = await getContactStatus({
      entityType: request.nextUrl.searchParams.get("entityType") ?? "counterparty",
      entityId: request.nextUrl.searchParams.get("entityId"),
      counterpartyId: request.nextUrl.searchParams.get("counterpartyId"),
      clientId: request.nextUrl.searchParams.get("clientId"),
      supplierId: request.nextUrl.searchParams.get("supplierId"),
      phone: request.nextUrl.searchParams.get("phone"),
      displayName: request.nextUrl.searchParams.get("displayName"),
      preferredChannel: "telegram",
    });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return contactActionError(error);
  }
}
