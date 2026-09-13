import { NextResponse } from "next/server";
import sharp from "sharp";
import { getSelectedPublicStorefrontImage } from "@/lib/public-storefront-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseBody(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

const STOREFRONT_IMAGE_WIDTHS = new Set([480, 1200]);

function requestedImageWidth(request: Request) {
  const width = Number.parseInt(new URL(request.url).searchParams.get("width") ?? "", 10);
  return STOREFRONT_IMAGE_WIDTHS.has(width) ? width : null;
}

function optimizedFileName(fileName: string | null | undefined, width: number) {
  const stem = (fileName || "product-photo").replace(/\.[^.]+$/u, "");
  return `${stem}-${width}w.webp`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { id, photoId } = await params;
  const photo = await getSelectedPublicStorefrontImage(id.trim(), photoId.trim());
  if (!photo) {
    return NextResponse.json({ error: "Фото не найдено" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const width = requestedImageWidth(request);
  let data: Buffer<ArrayBufferLike> = Buffer.from(photo.data);
  let contentType = photo.contentType;
  let fileName = photo.fileName || "product-photo";

  if (width) {
    try {
      data = await sharp(data)
        .rotate()
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 84, effort: 4 })
        .toBuffer();
      contentType = "image/webp";
      fileName = optimizedFileName(photo.fileName, width);
    } catch (error) {
      console.error("storefront image optimization failed", { photoId, width, error });
    }
  }

  return new NextResponse(responseBody(data), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
      "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      "CDN-Cache-Control": "public, max-age=31536000, immutable",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
