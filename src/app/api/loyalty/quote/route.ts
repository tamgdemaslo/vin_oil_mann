import { z } from "zod";
import { quoteLocalDemand } from "@/lib/local-demand-write";
import { LoyaltyError, loyaltyScope } from "@/lib/loyalty/accounts";
import { entityId, loyaltyApi, loyaltyBody } from "@/lib/loyalty/http";
import type { CreateDemandBody } from "@/lib/demand-create-payload";

const meta = z.object({ href: z.string().max(500), type: z.string().max(80), mediaType: z.string().max(80) });
const schema = z.object({
  branchId: entityId.optional(), counterpartyId: entityId, points: z.number().int().nonnegative().max(2_147_483_647),
  positions: z.array(z.object({
    assortment: z.object({ meta }).optional(), quantity: z.number().nonnegative(), price: z.number().nonnegative(),
    discount: z.number().min(0).max(100).optional(), lineKind: z.enum(["catalog", "one_off_service", "nonstock_product"]).optional(),
    oneOffProduct: z.record(z.string(), z.unknown()).optional(), oneOffService: z.record(z.string(), z.unknown()).optional(),
  })).max(1000),
});

export function POST(request: Request) {
  return loyaltyApi("employee", async (context) => {
    const input = await loyaltyBody(request, schema);
    if (input.branchId && input.branchId !== context.branchId) throw new LoyaltyError("Активный филиал изменился. Обновите страницу.");
    return quoteLocalDemand(loyaltyScope(context), input.counterpartyId, input.positions as CreateDemandBody["positions"], input.points);
  });
}
