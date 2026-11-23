import { z } from "zod";
import { prisma } from "@/lib/db";
import { loyaltyScope, LoyaltyError } from "@/lib/loyalty/accounts";
import { entityId, loyaltyApi, loyaltyBody, reasonText, requestId } from "@/lib/loyalty/http";
import { fiscalReturnChoices, saleReturn } from "@/lib/loyalty/sales";

const schema = z.object({
  requestKey: requestId, branchId: entityId, preview: z.boolean(),
  token: z.string().length(64).optional(),
  receipt: z.string().trim().max(250), reason: z.string().trim().max(500),
  lines: z.array(z.object({ id: entityId, quantityMilli: z.number().int().positive().safe(), unitKeys: z.array(z.string().length(64)).max(1000).optional() })).min(1).max(1000),
}).refine(({ lines }) => new Set(lines.map((line) => line.id)).size === lines.length);

export function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return loyaltyApi("manager", async (context) => {
    const { id } = await params;
    return { units: await fiscalReturnChoices(prisma, loyaltyScope(context), id) };
  });
}

export function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return loyaltyApi("manager", async (context) => {
    const { id } = await params;
    const input = await loyaltyBody(request, schema);
    if (input.branchId !== context.branchId) throw new LoyaltyError("Активный филиал изменился. Обновите страницу.");
    if (!input.preview && (!reasonText.safeParse(input.reason).success || !input.receipt)) {
      throw new LoyaltyError("Укажите номер чека возврата и основание", 400);
    }
    return prisma.$transaction((tx) => saleReturn(tx, loyaltyScope(context), id, input, input.preview));
  });
}
