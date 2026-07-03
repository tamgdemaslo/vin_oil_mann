import { NextRequest, NextResponse } from "next/server";
import { startContactConversation } from "@/lib/messenger/messenger-contact-actions";
import { contactActionError, readContactBody, requireMessengerSession } from "../../contact/_shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireMessengerSession();
  if ("response" in auth) return auth.response;
  const body = await readContactBody(request);
  if (typeof body.phone !== "string" || !body.phone.trim()) {
    return NextResponse.json({ ok: false, error: "Укажите телефон", code: "phone_missing" }, { status: 400 });
  }
  try {
    const result = await startContactConversation({ ...body, preferredChannel: "telegram" }, auth.session.user);
    return NextResponse.json(result);
  } catch (error) {
    return contactActionError(error);
  }
}
