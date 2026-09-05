import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getMannUnifiedTechnicalProfile, MANN_TRANSMISSION_TYPES } from "@/lib/mann-unified-technical-profile";

const bodySchema = z.object({
  variantKeys: z.array(z.string().trim().min(1).max(160)).min(1).max(20),
  transmissionType: z.enum(MANN_TRANSMISSION_TYPES).optional(),
});

export async function POST(request: NextRequest) {
  const branch = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!branch.ok) return branch.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Передайте выбранную MANN-модификацию" }, { status: 400 });
  }

  try {
    const profile = await runWithBranchApiContext(branch.context, () =>
      getMannUnifiedTechnicalProfile(parsed.data.variantKeys, parsed.data.transmissionType)
    );
    return NextResponse.json(profile);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить технический профиль" },
      { status: 500 },
    );
  }
}
