import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSessionWithCashShift } from "@/lib/api-session-cash-shift";
import {
  ALL_NODES,
  filterNodesForVehicle,
  tagLabelsForNode,
  type VehicleHints,
} from "@/data/diagnostic-catalog";
import { mimeFromDiagnosticPhotoPath } from "@/lib/diagnostic-photos";
import {
  seedDiagnosticPositionsIfEmpty,
  syncDiagnosticPositionsForVehicleHints,
} from "@/lib/diagnostic-seed-positions";

const VEHICLE_DEPENDENT_NODE_CODES = new Set(["atf", "mtf", "front_diff", "rear_diff", "transfer_case", "power_steering"]);

async function loadFull(diagnosticId: string) {
  return prisma.diagnostic.findUnique({
    where: { id: diagnosticId },
    include: {
      positions: {
        include: { photos: true },
        orderBy: [{ block: "asc" }, { node: "asc" }],
      },
      offers: { orderBy: { createdAt: "asc" } },
    },
  });
}

function inferVehicleHintsFromPositions(positions: Array<{ node: string }>): VehicleHints {
  const activeNodes = new Set(positions.map((position) => position.node));
  const hints: VehicleHints = {};
  if (activeNodes.has("atf")) hints.hasAtf = true;
  if (activeNodes.has("mtf")) hints.hasManualGearbox = true;
  if (activeNodes.has("front_diff") || activeNodes.has("rear_diff") || activeNodes.has("transfer_case")) hints.awd = true;
  if (!activeNodes.has("engine_oil") && !activeNodes.has("survey_sparks")) hints.electric = true;
  return hints;
}

function applicabilityReason(node: string, vehicleHints: VehicleHints): string | null {
  if (node === "atf" && vehicleHints.hasAtf !== true) return "АКПП не выбрана";
  if (node === "mtf" && vehicleHints.hasManualGearbox !== true) return "МКПП не выбрана";
  if ((node === "front_diff" || node === "rear_diff" || node === "transfer_case") && vehicleHints.awd !== true) {
    return "Полный привод не выбран";
  }
  if ((node === "engine_oil" || node === "survey_sparks") && vehicleHints.electric === true && vehicleHints.hybrid !== true) {
    return "Неактуально для электромобиля";
  }
  return null;
}

function serializeDiagnostic(row: Awaited<ReturnType<typeof loadFull>>) {
  if (!row) return null;
  const vehicleHints = inferVehicleHintsFromPositions(row.positions);
  const activeNodes = new Set(row.positions.map((position) => position.node));
  const applicableNodes = filterNodesForVehicle(vehicleHints);
  const applicableNodeCodes = new Set(applicableNodes.map((node) => node.node));
  const missingPhoto = row.positions.filter(
    (position) => (position.status === "YELLOW" || position.status === "RED") && position.photos.length < 1
  );
  const missingRequiredField = row.positions.filter((position) => position.status === "SKIPPED" && !position.notes?.trim());
  const unchecked = row.positions.filter((position) => position.status === "NOT_CHECKED");
  const problematic = row.positions.filter((position) => position.status === "YELLOW" || position.status === "RED");

  return {
    ...row,
    positions: row.positions.map((position) => ({
      ...position,
      tagLabels: tagLabelsForNode(position.node, position.tags),
      photos: position.photos.map((photo) => ({
        ...photo,
        thumbnailUrl: `/api/diagnostic/${row.id}/photo/${photo.id}`,
        url: `/api/diagnostic/${row.id}/photo/${photo.id}`,
        mimeType: mimeFromDiagnosticPhotoPath(photo.filePath),
      })),
    })),
    vehicleHints,
    applicability: {
      activeNodes: row.positions.map((position) => position.node),
      applicableNodes: applicableNodes.map((node) => node.node),
      inactiveNodes: ALL_NODES.filter((node) => !activeNodes.has(node.node)).map((node) => ({
        node: node.node,
        block: node.block,
        title: node.title,
        applicable: applicableNodeCodes.has(node.node),
        reason: applicabilityReason(node.node, vehicleHints),
      })),
    },
    availableQuickActions: {
      markAllNormal: row.positions.length > 0,
      markRemainingNormal: unchecked.length > 0,
      skipNotApplicable: unchecked.some((position) => VEHICLE_DEPENDENT_NODE_CODES.has(position.node)),
      nextUnchecked: unchecked.length > 0,
      collapseAll: row.positions.length > 0,
      expandProblematic: problematic.length > 0,
      filterIssues: problematic.length > 0,
      filterMissingPhotos: missingPhoto.length > 0,
      complete: missingPhoto.length === 0 && missingRequiredField.length === 0,
    },
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithCashShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  await seedDiagnosticPositionsIfEmpty(id);

  const row = await loadFull(id);
  if (!row) return NextResponse.json({ error: "Не найдено" }, { status: 404 });

  return NextResponse.json(serializeDiagnostic(row));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireApiSessionWithCashShift();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: {
    vin?: string | null;
    brand?: string | null;
    model?: string | null;
    year?: number | null;
    licensePlate?: string | null;
    mileage?: number | null;
    shipmentDraftId?: string | null;
    vehicleHints?: VehicleHints | null;
    clientWantsReminder?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.vin !== undefined) data.vin = body.vin?.trim() || null;
  if (body.brand !== undefined) data.brand = body.brand?.trim() || null;
  if (body.model !== undefined) data.model = body.model?.trim() || null;
  if (body.year !== undefined) data.year = typeof body.year === "number" ? body.year : null;
  if (body.licensePlate !== undefined) data.licensePlate = body.licensePlate?.trim() || null;
  if (body.mileage !== undefined) data.mileage = typeof body.mileage === "number" ? body.mileage : null;
  if (body.shipmentDraftId !== undefined) data.shipmentDraftId = body.shipmentDraftId?.trim() || null;
  if (typeof body.clientWantsReminder === "boolean") data.clientWantsReminder = body.clientWantsReminder;

  const hasVehicleHints = body.vehicleHints !== undefined && body.vehicleHints !== null;

  if (Object.keys(data).length === 0 && !hasVehicleHints) {
    return NextResponse.json({ error: "Нет полей для обновления" }, { status: 400 });
  }

  if (Object.keys(data).length > 0) {
    await prisma.diagnostic.update({
      where: { id },
      data: data as object,
    });
  }

  if (hasVehicleHints) {
    await syncDiagnosticPositionsForVehicleHints(id, body.vehicleHints as VehicleHints);
  }

  const row = await loadFull(id);
  return NextResponse.json(serializeDiagnostic(row));
}
