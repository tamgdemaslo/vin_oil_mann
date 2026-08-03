import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getLocalDemandReopenCheck } from "@/lib/local-demand-write";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const result = await getLocalDemandReopenCheck(id, session.user);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
  return NextResponse.json(result);
}
