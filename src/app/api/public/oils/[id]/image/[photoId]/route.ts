import { NextResponse } from "next/server";
import { getSelectedPublicStorefrontImage } from "@/lib/public-storefront-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseBody(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { id, photoId } = await params;
  const photo = await getSelectedPublicStorefrontImage(id.trim(), photoId.trim());
  if (!photo) {
    return NextResponse.json({ error: "Фото не найдено" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  return new NextResponse(responseBody(Buffer.from(photo.data)), {
    headers: {
      "Content-Type": photo.contentType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(photo.fileName || "product-photo")}"`,
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
