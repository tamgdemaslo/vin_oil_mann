import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { ContactActionError, type ContactActionInput } from "@/lib/messenger/messenger-contact-actions";

export async function requireMessengerSession() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  return { session };
}

export function contactActionError(error: unknown) {
  if (error instanceof ContactActionError) {
    return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Не удалось выполнить действие Messenger";
  if (message.includes("does not exist") || message.includes("relation") || message.includes("column")) {
    return NextResponse.json({ ok: false, error: "Миграция Messenger Gateway ещё не применена к базе данных", detail: message }, { status: 500 });
  }
  return NextResponse.json({ ok: false, error: message }, { status: 500 });
}

export async function readContactBody(request: NextRequest): Promise<ContactActionInput & Record<string, unknown>> {
  const body = (await request.json().catch(() => ({}))) as ContactActionInput & Record<string, unknown>;
  return body && typeof body === "object" ? body : {};
}

export function contactInputFromSearch(request: NextRequest, extra?: Partial<ContactActionInput>): ContactActionInput {
  const params = request.nextUrl.searchParams;
  return {
    entityType: params.get("entityType") ?? extra?.entityType ?? null,
    entityId: params.get("entityId") ?? extra?.entityId ?? null,
    counterpartyId: params.get("counterpartyId") ?? extra?.counterpartyId ?? null,
    clientId: params.get("clientId") ?? extra?.clientId ?? null,
    supplierId: params.get("supplierId") ?? extra?.supplierId ?? null,
    phone: params.get("phone") ?? extra?.phone ?? null,
    displayName: params.get("displayName") ?? extra?.displayName ?? null,
    preferredChannel: params.get("preferredChannel") ?? extra?.preferredChannel ?? "telegram",
    context: extra?.context ?? null,
  };
}
