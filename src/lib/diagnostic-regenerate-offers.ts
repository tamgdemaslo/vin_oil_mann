import { prisma } from "@/lib/db";
import type { DiagnosticPositionStatus } from "@prisma/client";
import {
  RED_NODE_OFFERS,
  SURVEY_NEXT_VISIT_OFFERS,
} from "@/data/diagnostic-catalog";

export type VariantJson = {
  label: string;
  priceRub: number;
  productId?: string;
};

async function buildVariantsForTemplate(
  template: { variants: { label: string; defaultPriceRub: number; catalogSearchHints?: string[] }[] }
): Promise<VariantJson[]> {
  const out: VariantJson[] = [];
  for (const v of template.variants) {
    const hints = (v.catalogSearchHints ?? []).map((hint) => hint.trim()).filter(Boolean);
    const product = hints.length
      ? await prisma.localProduct.findFirst({
          where: {
            archived: false,
            OR: hints.map((hint) => ({ name: { contains: hint, mode: "insensitive" as const } })),
          },
          select: { id: true, salePriceCents: true },
          orderBy: { updatedAt: "desc" },
        })
      : null;
    out.push({
      label: v.label,
      priceRub: product ? product.salePriceCents / 100 : v.defaultPriceRub,
      productId: product?.id,
    });
  }
  return out;
}

/** Пересоздаёт офферы по текущим позициям (🔴 и опрос «на следующий визит»). */
export async function regenerateOffersForDiagnostic(diagnosticId: string): Promise<void> {
  await prisma.diagnosticOffer.deleteMany({ where: { diagnosticId } });

  const positions = await prisma.diagnosticPosition.findMany({
    where: { diagnosticId },
  });

  const toCreate: {
    relatedPositionId: string | null;
    offerKey: string;
    title: string;
    variants: VariantJson[];
    nextVisitOnly: boolean;
  }[] = [];

  for (const p of positions) {
    const st = p.status as DiagnosticPositionStatus;
    if (st === "RED") {
      const tpl = RED_NODE_OFFERS[p.node];
      if (tpl) {
        const variants = await buildVariantsForTemplate(tpl);
        toCreate.push({
          relatedPositionId: p.id,
          offerKey: tpl.offerKey,
          title: tpl.title,
          variants,
          nextVisitOnly: false,
        });
      }
    }

    if (p.node === "survey_cabin_filter" && p.tags.includes("cabin_old_year")) {
      const tpl = SURVEY_NEXT_VISIT_OFFERS.survey_cabin_filter;
      if (tpl) {
        const variants = await buildVariantsForTemplate(tpl);
        toCreate.push({
          relatedPositionId: p.id,
          offerKey: tpl.offerKey,
          title: tpl.title,
          variants,
          nextVisitOnly: true,
        });
      }
    }
  }

  if (toCreate.length === 0) return;

  await prisma.diagnosticOffer.createMany({
    data: toCreate.map((row) => ({
      diagnosticId,
      relatedPositionId: row.relatedPositionId,
      offerKey: row.offerKey,
      title: row.title,
      variants: row.variants as object[],
      nextVisitOnly: row.nextVisitOnly,
    })),
  });
}

export async function updateDiagnosticSummaryCounts(diagnosticId: string): Promise<void> {
  const positions = await prisma.diagnosticPosition.findMany({
    where: { diagnosticId },
    select: { status: true },
  });
  let summaryGreen = 0,
    summaryYellow = 0,
    summaryRed = 0;
  for (const p of positions) {
    if (p.status === "GREEN") summaryGreen++;
    else if (p.status === "YELLOW") summaryYellow++;
    else if (p.status === "RED") summaryRed++;
  }
  await prisma.diagnostic.update({
    where: { id: diagnosticId },
    data: { summaryGreen, summaryYellow, summaryRed },
  });
}
