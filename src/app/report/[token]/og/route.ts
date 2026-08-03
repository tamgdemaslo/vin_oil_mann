import { NextRequest } from "next/server";
import { pluralRu } from "@/lib/diagnostic-report-message";
import { getDiagnosticReportMeta } from "@/lib/diagnostic-report-meta";

export const runtime = "nodejs";

function escapeXml(value: string) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function originFromRequest(request: NextRequest) {
  const envOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim();
  if (envOrigin) return envOrigin.replace(/\/$/u, "");
  return new URL(request.url).origin;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const meta = await getDiagnosticReportMeta(token, originFromRequest(request));
  if (!meta) return new Response("Not found", { status: 404 });
  const recommendationLabel = `${meta.recommendationCount} ${pluralRu(meta.recommendationCount, "рекомендация", "рекомендации", "рекомендаций")}`;
  const criticalLabel = `${meta.criticalCount} критично`;
  const checkedLabel = `Проверено ${meta.checkedCount} ${pluralRu(meta.checkedCount, "пункт", "пункта", "пунктов")}`;
  const vehicle = meta.vehiclePlate ? `${meta.vehicleTitle} · ${meta.vehiclePlate}` : meta.vehicleTitle;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#F7F2EA"/>
  <rect x="56" y="52" width="1088" height="526" rx="32" fill="#111827"/>
  <rect x="86" y="82" width="1028" height="466" rx="24" fill="#FDFBF7"/>
  <text x="116" y="154" fill="#B45309" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700">Там где масло</text>
  <text x="116" y="244" fill="#111827" font-family="Arial, Helvetica, sans-serif" font-size="64" font-weight="800">Автомобиль проверен</text>
  <text x="116" y="326" fill="#374151" font-family="Arial, Helvetica, sans-serif" font-size="46" font-weight="700">${escapeXml(vehicle)}</text>
  <rect x="116" y="390" width="286" height="70" rx="18" fill="#ECFDF5"/>
  <text x="146" y="435" fill="#047857" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700">${escapeXml(checkedLabel)}</text>
  <rect x="424" y="390" width="292" height="70" rx="18" fill="#FFFBEB"/>
  <text x="454" y="435" fill="#B45309" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700">${escapeXml(recommendationLabel)}</text>
  <rect x="738" y="390" width="228" height="70" rx="18" fill="#FEF2F2"/>
  <text x="768" y="435" fill="#B91C1C" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700">${escapeXml(criticalLabel)}</text>
  <text x="116" y="512" fill="#6B7280" font-family="Arial, Helvetica, sans-serif" font-size="26">Публичный отчёт диагностики</text>
</svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
