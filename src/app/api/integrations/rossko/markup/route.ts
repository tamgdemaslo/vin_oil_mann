import { NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { canViewBranchIntegrationSettings } from "@/lib/integration-access";
import { saveRosskoMarkupRules } from "@/lib/rossko-integration";

export const runtime = "nodejs";

const schema = z.object({
  rules: z.array(z.object({
    fromCents: z.number().int().min(0).max(100_000_000),
    toCents: z.number().int().min(0).max(100_000_000).nullable(),
    marginPercent: z.number().min(0).max(300),
    category: z.string().trim().min(1).max(100).nullable().optional(),
  })).min(1).max(20),
}).superRefine(({ rules }, context) => {
  const ordered = [...rules].sort((a, b) => a.fromCents - b.fromCents);
  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index];
    if (row.toCents != null && row.toCents <= row.fromCents) context.addIssue({ code: "custom", message: "Верхняя граница должна быть больше нижней" });
    if (index > 0 && ordered[index - 1].toCents != null && ordered[index - 1].toCents! > row.fromCents) context.addIssue({ code: "custom", message: "Диапазоны наценки не должны пересекаться" });
  }
});

export async function PATCH(request: Request) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  if (!canViewBranchIntegrationSettings(access.context)) {
    return NextResponse.json({ error: "Правила наценки ROSSKO недоступны для этой роли" }, { status: 403 });
  }
  try {
    const { rules } = schema.parse(await request.json());
    return NextResponse.json(await runWithBranchApiContext(access.context, () => saveRosskoMarkupRules(rules, access.context.userId)));
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Проверьте диапазоны и проценты наценки" }, { status: 422 });
    return NextResponse.json({ error: "Правила наценки ROSSKO не сохранены" }, { status: 500 });
  }
}
