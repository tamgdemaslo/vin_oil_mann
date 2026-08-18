import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { prisma } from "@/lib/db";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import { deletePhotoFile, mimeFromDiagnosticPhotoPath } from "@/lib/diagnostic-photos";
import { getScopedBranchId } from "@/lib/request-tenant-store";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const gate = await requireApiSessionWithCashShift();
  if (!gate.ok) return gate.response;

  const { id: diagnosticId, photoId } = await params;
  const photo = await prisma.diagnosticPhoto.findFirst({
    where: { id: photoId, branchId: getScopedBranchId(), position: { diagnosticId, branchId: getScopedBranchId() } },
  });
  if (!photo) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  try {
    const buf = await fs.readFile(photo.filePath);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": mimeFromDiagnosticPhotoPath(photo.filePath),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Файл недоступен" }, { status: 404 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
) {
  const gate = await requireApiSessionWithCashShift();
  if (!gate.ok) return gate.response;

  const { id: diagnosticId, photoId } = await params;
  const photo = await prisma.diagnosticPhoto.findFirst({
    where: { id: photoId, branchId: getScopedBranchId(), position: { diagnosticId, branchId: getScopedBranchId() } },
  });
  if (!photo) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  deletePhotoFile(photo.filePath);
  await prisma.diagnosticPhoto.delete({ where: { id: photoId } });

  return NextResponse.json({ ok: true });
}
