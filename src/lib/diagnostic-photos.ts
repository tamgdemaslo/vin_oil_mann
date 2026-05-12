import fs from "fs";
import path from "path";

export function getDiagnosticPhotosRoot(): string {
  const raw = process.env.DIAGNOSTIC_PHOTOS_PATH?.trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  return path.join(process.cwd(), ".data", "diagnostic-photos");
}

export function ensureDiagnosticPhotosDir(diagnosticId: string): string {
  const dir = path.join(getDiagnosticPhotosRoot(), diagnosticId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function buildPhotoDiskPath(diagnosticId: string, photoId: string, ext: string): string {
  return path.join(getDiagnosticPhotosRoot(), diagnosticId, `${photoId}.${ext}`);
}

export function safeExtFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

export function deletePhotoFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}
