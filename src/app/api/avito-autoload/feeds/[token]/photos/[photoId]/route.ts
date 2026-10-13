import sharp from "sharp";
import { prisma } from "@/lib/db";
import { readAvitoValue, withAvitoPublicProfile, type AvitoSnapshot } from "@/lib/avito-autoload/storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string; photoId: string }> }) {
  try {
    const { token, photoId } = await params;
    const result = await withAvitoPublicProfile(token, async (_profile, scope) => {
      const snapshot = await readAvitoValue<AvitoSnapshot>(scope, "snapshot");
      if (!snapshot?.photoIds.includes(photoId)) return new Response("Not found", { status: 404 });
      const photo = await prisma.localProductPhoto.findFirst({
        where: { id: photoId, branchId: scope.branchId, purpose: "AVITO", productId: { in: snapshot.productIds }, product: { branchId: scope.branchId } },
        select: { data: true, contentType: true, sizeBytes: true },
      });
      if (!photo || !["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"].includes(photo.contentType) || photo.sizeBytes > 50 * 1024 * 1024) return new Response("Not found", { status: 404 });
      const image = await sharp(Buffer.from(photo.data), { limitInputPixels: 80_000_000 }).rotate().resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
      if (image.length > 25 * 1024 * 1024) return new Response("Image too large", { status: 413 });
      return new Response(new Uint8Array(image), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    });
    return result ?? new Response("Not found", { status: 404 });
  } catch { return new Response("Image temporarily unavailable", { status: 503 }); }
}
