import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { type ReopenDemandBody, reopenLocalDemand } from "@/lib/local-demand-write";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: ReopenDemandBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const result = await reopenLocalDemand(id, body, session.user);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.notFound ? 404 : result.conflict ? 409 : 400 }
    );
  }
  return NextResponse.json(result);
}
