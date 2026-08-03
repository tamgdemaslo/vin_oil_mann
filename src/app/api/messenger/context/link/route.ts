import { NextRequest, NextResponse } from "next/server";
import { linkContactContext } from "@/lib/messenger/messenger-contact-actions";
import { contactActionError, readContactBody, requireMessengerSession } from "../../contact/_shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireMessengerSession();
  if ("response" in auth) return auth.response;
  const body = await readContactBody(request);
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  if (!conversationId) return NextResponse.json({ ok: false, error: "Укажите conversationId", code: "conversation_missing" }, { status: 400 });
  try {
    const result = await linkContactContext({ ...body, conversationId }, auth.session.user);
    return NextResponse.json(result);
  } catch (error) {
    return contactActionError(error);
  }
}
