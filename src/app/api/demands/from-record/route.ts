import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createLocalDemandFromRecord, type CreateDemandFromRecordBody } from "@/lib/local-demand-write";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: CreateDemandFromRecordBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const result = await createLocalDemandFromRecord(body, { ecoUserName: session.user.name || session.user.login });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json(result);
}
