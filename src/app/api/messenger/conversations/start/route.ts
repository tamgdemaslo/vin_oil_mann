import { NextRequest, NextResponse } from "next/server";
import { startContactConversation } from "@/lib/messenger/messenger-contact-actions";
import { contactActionError, readContactBody, requireMessengerSession } from "../../contact/_shared";

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
