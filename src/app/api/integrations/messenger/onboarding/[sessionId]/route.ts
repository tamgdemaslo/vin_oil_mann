import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getIntegrationOnboardingSession } from "@/lib/messenger/messenger-integrations";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const { sessionId } = await params;
  const onboarding = await getIntegrationOnboardingSession(sessionId, session.user);
  if (!onboarding) return NextResponse.json({ error: "Onboarding session не найдена" }, { status: 404 });
  return NextResponse.json({ session: onboarding });
}
