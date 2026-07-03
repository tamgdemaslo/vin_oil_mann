import { NextRequest, NextResponse } from "next/server";
import { getContactStatus } from "@/lib/messenger/messenger-contact-actions";
import { contactActionError, contactInputFromSearch, requireMessengerSession } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ counterpartyId: string }> }
) {
  const auth = await requireMessengerSession();
  if ("response" in auth) return auth.response;
  const { counterpartyId } = await params;
  try {
    const status = await getContactStatus(contactInputFromSearch(request, { counterpartyId, entityType: "counterparty" }));
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    return contactActionError(error);
  }
}
