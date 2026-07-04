import { prisma } from "@/lib/db";
import { diagnosticPreviewDescription, nonNegativeCount } from "@/lib/diagnostic-report-message";

type DiagnosticReportMeta = {
  token: string;
  title: string;
  description: string;
  url: string;
  imageUrl: string;
  vehicleTitle: string;
  vehiclePlate: string;
  checkedCount: number;
  recommendationCount: number;
  criticalCount: number;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function absoluteUrl(origin: string, path: string) {
  const cleanOrigin = origin.replace(/\/$/u, "");
  return cleanOrigin ? `${cleanOrigin}${path}` : path;
}

function vehicleParts(input: { brand?: string | null; model?: string | null; licensePlate?: string | null; vin?: string | null }) {
  const title = [input.brand, input.model].map(cleanText).filter(Boolean).join(" ") || "автомобиля";
  const plate = cleanText(input.licensePlate) || cleanText(input.vin);
  return { title, plate };
}

function buildMeta(input: {
  token: string;
  origin: string;
  brand?: string | null;
  model?: string | null;
  licensePlate?: string | null;
  vin?: string | null;
  checkedCount?: number | null;
  recommendationCount?: number | null;
  criticalCount?: number | null;
}): DiagnosticReportMeta {
  const vehicle = vehicleParts(input);
  const checkedCount = nonNegativeCount(input.checkedCount);
  const recommendationCount = nonNegativeCount(input.recommendationCount);
  const criticalCount = nonNegativeCount(input.criticalCount);
  const vehicleLabel = vehicle.plate ? `${vehicle.title} · ${vehicle.plate}` : vehicle.title;
  return {
    token: input.token,
    title: `Отчёт диагностики ${vehicleLabel}`,
    description: diagnosticPreviewDescription({ checkedCount, recommendationCount, criticalCount }),
    url: absoluteUrl(input.origin, `/report/${encodeURIComponent(input.token)}`),
    imageUrl: absoluteUrl(input.origin, `/report/${encodeURIComponent(input.token)}/og`),
    vehicleTitle: vehicle.title,
    vehiclePlate: vehicle.plate,
    checkedCount,
    recommendationCount,
    criticalCount,
  };
}

export async function getDiagnosticReportMeta(token: string, origin = ""): Promise<DiagnosticReportMeta | null> {
  const map = await prisma.diagnosticMapSession.findUnique({
    where: { publicToken: token },
    select: {
      publicToken: true,
      brand: true,
      model: true,
      licensePlate: true,
      vin: true,
      totalCount: true,
      attentionCount: true,
      replaceCount: true,
      noAccessCount: true,
      byMileageCount: true,
      byClientCount: true,
    },
  });
  if (map) {
    return buildMeta({
      token,
      origin,
      brand: map.brand,
      model: map.model,
      licensePlate: map.licensePlate,
      vin: map.vin,
      checkedCount: map.totalCount,
      recommendationCount: map.attentionCount + map.noAccessCount + map.byMileageCount + map.byClientCount,
      criticalCount: map.replaceCount,
    });
  }

  const legacy = await prisma.diagnostic.findUnique({
    where: { clientReportToken: token },
    select: {
      clientReportToken: true,
      brand: true,
      model: true,
      licensePlate: true,
      vin: true,
      summaryGreen: true,
      summaryYellow: true,
      summaryRed: true,
    },
  });
  if (!legacy) return null;
  return buildMeta({
    token,
    origin,
    brand: legacy.brand,
    model: legacy.model,
    licensePlate: legacy.licensePlate,
    vin: legacy.vin,
    checkedCount: legacy.summaryGreen + legacy.summaryYellow + legacy.summaryRed,
    recommendationCount: legacy.summaryYellow,
    criticalCount: legacy.summaryRed,
  });
}
