import { NextRequest, NextResponse } from "next/server";
import { sendContactMessage } from "@/lib/messenger/messenger-contact-actions";
import { contactActionError, readContactBody, requireMessengerSession } from "../../contact/_shared";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireMessengerSession();
  if ("response" in auth) return auth.response;
  const body = await readContactBody(request);
  const templateKey = typeof body.templateKey === "string" ? body.templateKey : "";
  if (!templateKey) return NextResponse.json({ ok: false, error: "Укажите templateKey", code: "template_missing" }, { status: 400 });
  try {
    const result = await sendContactMessage(
      {
        ...body,
        conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
        templateKey,
        templateVars: body.templateVars && typeof body.templateVars === "object" ? (body.templateVars as Record<string, unknown>) : null,
      },
      auth.session.user
    );
    return NextResponse.json(result);
  } catch (error) {
    return contactActionError(error);
  }
}
