import { NextRequest } from "next/server";
import { getPublicOilById } from "@/lib/public-oil";
import { publicJson, publicOptions, rejectDisallowedPublicOrigin } from "@/lib/public-api";

export async function OPTIONS(request: NextRequest) {
  return publicOptions(request);
}
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const originError = rejectDisallowedPublicOrigin(request);
  if (originError) return originError;
  try {
    const { id } = await params;
    const oil = await getPublicOilById(id);
    if (!oil) {
      return publicJson(request, { error: "Масло не найдено" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return publicJson(request, oil, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[public/oils/id]", error);
    return publicJson(request, { error: "Карточка масла временно недоступна" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
