import { NextRequest } from "next/server";
import { handleAnalyticsProduct } from "../../_shared";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleAnalyticsProduct(request, id);
}
