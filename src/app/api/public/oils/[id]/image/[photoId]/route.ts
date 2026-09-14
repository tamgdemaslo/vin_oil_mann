import { NextResponse } from "next/server";
import sharp from "sharp";
import { getSelectedPublicStorefrontImage } from "@/lib/public-storefront-image";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CachedStorefrontImage = {
  data: Buffer<ArrayBufferLike>;
  contentType: string;
  fileName: string;
  etag: string;
};

type StorefrontImageCache = {
  entries: Map<string, CachedStorefrontImage>;
  totalBytes: number;
};

const STOREFRONT_IMAGE_CACHE_MAX_ENTRIES = 256;
const STOREFRONT_IMAGE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const storefrontImageCache = ((globalThis as typeof globalThis & {
  __storefrontImageCache?: StorefrontImageCache;
}).__storefrontImageCache ??= { entries: new Map(), totalBytes: 0 });

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

function storefrontImageCacheKey(storefrontProductId: string, photoId: string, width: number | null) {
  return `${storefrontProductId}:${photoId}:${width ?? "original"}`;
}

function getCachedStorefrontImage(key: string) {
  const cached = storefrontImageCache.entries.get(key);
  if (!cached) return null;
  storefrontImageCache.entries.delete(key);
  storefrontImageCache.entries.set(key, cached);
  return cached;
}

function setCachedStorefrontImage(key: string, cached: CachedStorefrontImage) {
  const previous = storefrontImageCache.entries.get(key);
  if (previous) storefrontImageCache.totalBytes -= previous.data.byteLength;
  storefrontImageCache.entries.delete(key);
  storefrontImageCache.entries.set(key, cached);
  storefrontImageCache.totalBytes += cached.data.byteLength;

  while (
    storefrontImageCache.entries.size > STOREFRONT_IMAGE_CACHE_MAX_ENTRIES ||
    storefrontImageCache.totalBytes > STOREFRONT_IMAGE_CACHE_MAX_BYTES
  ) {
    const oldestKey = storefrontImageCache.entries.keys().next().value;
    if (!oldestKey) break;
    const oldest = storefrontImageCache.entries.get(oldestKey);
    storefrontImageCache.entries.delete(oldestKey);
    storefrontImageCache.totalBytes -= oldest?.data.byteLength ?? 0;
  }
}

function storefrontImageHeaders(image: CachedStorefrontImage, cacheStatus: "HIT" | "MISS") {
  return {
    "Content-Type": image.contentType,
    "Content-Disposition": `inline; filename="${encodeURIComponent(image.fileName)}"`,
    "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
    "CDN-Cache-Control": "public, max-age=31536000, immutable",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
    "ETag": image.etag,
    "X-Storefront-Image-Cache": cacheStatus,
  };
}

function storefrontImageResponse(request: Request, image: CachedStorefrontImage, cacheStatus: "HIT" | "MISS") {
  const headers = storefrontImageHeaders(image, cacheStatus);
  if (request.headers.get("if-none-match") === image.etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return new NextResponse(responseBody(image.data), {
    headers: { ...headers, "Content-Length": String(image.data.byteLength) },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const { id, photoId } = await params;
  const storefrontProductId = id.trim();
  const selectedPhotoId = photoId.trim();
  const width = requestedImageWidth(request);
  const cacheKey = storefrontImageCacheKey(storefrontProductId, selectedPhotoId, width);
  const cached = getCachedStorefrontImage(cacheKey);
  if (cached) return storefrontImageResponse(request, cached, "HIT");

  const photo = await getSelectedPublicStorefrontImage(storefrontProductId, selectedPhotoId);
  if (!photo) {
    return NextResponse.json({ error: "Фото не найдено" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  let data: Buffer<ArrayBufferLike> = Buffer.from(photo.data);
  let contentType = photo.contentType;
  let fileName = photo.fileName || "product-photo";

  if (width) {
    try {
      data = await sharp(data)
        .rotate()
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 84, effort: 2 })
        .toBuffer();
      contentType = "image/webp";
      fileName = optimizedFileName(photo.fileName, width);
    } catch (error) {
      console.error("storefront image optimization failed", { photoId, width, error });
    }
  }

  const image = {
    data,
    contentType,
    fileName,
    etag: `"${selectedPhotoId}-${width ?? "original"}"`,
  };
  setCachedStorefrontImage(cacheKey, image);
  return storefrontImageResponse(request, image, "MISS");
}
