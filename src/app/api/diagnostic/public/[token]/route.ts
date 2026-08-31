import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import {
  buildDiagnosticReportItemText,
  diagnosticReportTagLabels,
  DIAGNOSTIC_REPORT_COPY,
} from "@/data/diagnostic-report-copy";
import { prisma } from "@/lib/db";
import { buildDiagnosticReportUrl } from "@/lib/diagnostic-report-link";
import { resolveBranchPrintContext } from "@/lib/branch-print-context";

type PublicOffer = {
  title: string;
  nextVisitOnly: boolean;
  variants: { label: string; priceRub: number | null }[];
};

/** Публичный отчёт без авторизации (без служебных полей мастера). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "token не указан" }, { status: 400 });

  const diag = await prisma.diagnostic.findUnique({
    where: { clientReportToken: token },
    include: {
      positions: {
        include: { photos: { select: { id: true, caption: true, createdAt: true } } },
        orderBy: [{ block: "asc" }, { node: "asc" }],
      },
      offers: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!diag) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const branchPrint = await resolveBranchPrintContext(diag.branchId);

  const publicUrl = buildDiagnosticReportUrl(request, token);
  const qrDataUrl = await QRCode.toDataURL(publicUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
    color: { dark: "#0A0A0A", light: "#F5F2ED" },
  });
  const offersByPosition = new Map<string, PublicOffer[]>();
  for (const offer of diag.offers) {
    if (!offer.relatedPositionId) continue;
    const publicOffer: PublicOffer = {
      title: offer.title,
      nextVisitOnly: offer.nextVisitOnly,
      variants: Array.isArray(offer.variants)
        ? offer.variants
            .map((variant) => {
              if (!variant || typeof variant !== "object") return null;
              const row = variant as { label?: unknown; priceRub?: unknown };
              return {
                label: typeof row.label === "string" ? row.label : offer.title,
                priceRub: typeof row.priceRub === "number" ? row.priceRub : null,
              };
            })
            .filter((variant): variant is { label: string; priceRub: number | null } => Boolean(variant))
        : [],
    };
    offersByPosition.set(offer.relatedPositionId, [...(offersByPosition.get(offer.relatedPositionId) ?? []), publicOffer]);
  }

  const positions = diag.positions
    .filter((p) => p.status === "YELLOW" || p.status === "RED")
    .map((p, index) => {
      const offers = offersByPosition.get(p.id) ?? [];
      return {
        key: `${p.node}-${index}`,
        block: p.block,
        node: p.node,
        status: p.status,
        tags: diagnosticReportTagLabels(p.node, p.tags),
        measurementValue: p.measurementValue == null ? null : Number(p.measurementValue.toString()),
        measurementUnit: p.measurementUnit,
        itemText: buildDiagnosticReportItemText(p, diag, { offer: offers[0] ?? null }),
        offers,
        photos: p.photos.map((ph) => ({
          id: ph.id,
          caption: ph.caption,
          url: `/api/diagnostic/public/${token}/photo/${ph.id}`,
        })),
      };
    });
  const normalPositions = diag.positions
    .filter((p) => p.status === "GREEN")
    .map((p, index) => ({
      key: `${p.node}-${index}`,
      block: p.block,
      node: p.node,
      title: DIAGNOSTIC_REPORT_COPY[p.node]?.clientTitle ?? p.node,
    }));
  const skippedPositions = diag.positions
    .filter((p) => p.status === "SKIPPED")
    .map((p, index) => ({
      key: `${p.node}-${index}`,
      block: p.block,
      node: p.node,
      itemText: buildDiagnosticReportItemText(p, diag),
    }));

  return NextResponse.json({
    publicUrl,
    publicPhone: branchPrint?.phone || null,
    publicAddress: branchPrint?.address || null,
    publicTelegramUsername: branchPrint?.telegram || null,
    qrDataUrl,
    header: {
      brand: diag.brand,
      model: diag.model,
      year: diag.year,
      licensePlate: diag.licensePlate,
      mileage: diag.mileage,
      vin: diag.vin,
      startedAt: diag.startedAt,
      completedAt: diag.completedAt,
      summaryGreen: diag.summaryGreen,
      summaryYellow: diag.summaryYellow,
      summaryRed: diag.summaryRed,
      mechanicLogin: diag.mechanicLogin ? maskLogin(diag.mechanicLogin) : null,
      reportCode: shortReportCode(token),
    },
    clientWantsReminder: diag.clientWantsReminder,
    positions,
    normalPositions,
    skippedPositions,
  });
}

function shortReportCode(token: string): string {
  return token.replace(/-/g, "").slice(0, 8).toUpperCase();
}

function maskLogin(login: string): string {
  const s = login.trim();
  if (s.length <= 2) return s;
  return `${s[0]}${"•".repeat(Math.min(4, s.length - 2))}${s[s.length - 1]}`;
}
