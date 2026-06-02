import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getDiagnosticMapByToken, requestOrigin } from "@/lib/diagnostic-map-service";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const diagnostic = await getDiagnosticMapByToken(token, requestOrigin(request));
  if (!diagnostic) return NextResponse.json({ error: "Диагностика не найдена" }, { status: 404 });
  const qrDataUrl = await QRCode.toDataURL(diagnostic.reportUrl, { margin: 1, width: 220 });
  return NextResponse.json({ diagnostic, qrDataUrl });
}
