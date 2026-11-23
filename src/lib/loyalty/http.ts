import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import type { BranchContext } from "@/lib/branch-context";
import { LoyaltyError, loyaltyPermissions } from "./accounts";

export const requestId = z.string().uuid();
export const pointsAmount = z.number().int().min(1).max(1_000_000);
export const reasonText = z.string().trim().min(1).max(500);
export const expiryDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
export const entityId = z.string().min(1).max(240);

export async function loyaltyBody<T>(request: Request, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) throw new LoyaltyError("Проверьте введённые данные", 400);
  return parsed.data;
}

export function loyaltyJson(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export async function loyaltyApi(
  permission: keyof ReturnType<typeof loyaltyPermissions>,
  operation: (context: BranchContext) => Promise<unknown>,
  options: { allowAll?: boolean; requireActive?: boolean } = {},
) {
  const access = await requireBranchApi(options);
  if (!access.ok) return access.response;
  if (!loyaltyPermissions(access.context)[permission]) return loyaltyJson({ error: "Недостаточно прав" }, 403);
  try {
    return await runWithBranchApiContext(access.context, async () => loyaltyJson(await operation(access.context)));
  } catch (error) {
    if (error instanceof LoyaltyError) return loyaltyJson({ error: error.message }, error.status);
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    if (code === "P2021" || code === "P2022") return loyaltyJson({ error: "Хранилище лояльности ещё не подготовлено" }, 503);
    console.error("[loyalty]", error);
    return loyaltyJson({ error: "Бонусный счёт недоступен. Повторите попытку." }, 503);
  }
}
