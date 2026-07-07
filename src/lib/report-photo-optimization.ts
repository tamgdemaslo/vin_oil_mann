import sharp from "sharp";

export type ReportPhotoVariant = "diagnostic" | "reportHero" | "printHero" | "thumbnail";

type VariantConfig = {
  maxEdge: number;
  quality: number;
};

export type OptimizedReportPhoto = {
  data: Buffer;
  contentType: "image/jpeg";
  extension: "jpg";
  width: number | null;
  height: number | null;
  originalSizeBytes: number;
  sizeBytes: number;
};

const VARIANT_CONFIG: Record<ReportPhotoVariant, VariantConfig> = {
  diagnostic: { maxEdge: 1600, quality: 82 },
  reportHero: { maxEdge: 1600, quality: 84 },
  printHero: { maxEdge: 1400, quality: 82 },
  thumbnail: { maxEdge: 720, quality: 78 },
};

export async function optimizeReportImage(bytes: Buffer, variant: ReportPhotoVariant): Promise<OptimizedReportPhoto> {
  const config = VARIANT_CONFIG[variant];
  const data = await sharp(bytes, { failOn: "none" })
    .rotate()
    .resize({
      width: config.maxEdge,
      height: config.maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: { r: 245, g: 242, b: 237 } })
    .jpeg({
      quality: config.quality,
      mozjpeg: true,
    })
    .toBuffer();

  const metadata = await sharp(data).metadata().catch(() => null);
  return {
    data,
    contentType: "image/jpeg",
    extension: "jpg",
    width: metadata?.width ?? null,
    height: metadata?.height ?? null,
    originalSizeBytes: bytes.length,
    sizeBytes: data.length,
  };
}
