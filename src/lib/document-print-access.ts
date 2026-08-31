import { runWithRequestTenant } from "@/lib/request-tenant-store";
import { prisma } from "@/lib/db";
import type { BranchContext } from "@/lib/branch-context";

export type DocumentPrintAccess = {
  branchId: string;
  organizationId: string | null;
  businessGroupId: string | null;
  userId: string | null;
};

function allowedBranchIds(context: BranchContext): string[] {
  return context.branches.map((branch) => branch.id);
}

function tenantForLookup(context: BranchContext) {
  return {
    mode: "all" as const,
    branchId: null,
    organizationId: null,
    allowedBranchIds: allowedBranchIds(context),
    businessGroupId: context.businessGroupId,
    userId: context.userId,
    permissions: [context.groupRole, context.branchRole].filter((value): value is string => Boolean(value)),
  };
}

function accessFromContext(context: BranchContext, branchId: string): DocumentPrintAccess | null {
  const branch = context.branches.find((candidate) => candidate.id === branchId);
  if (!branch) return null;
  return {
    branchId: branch.id,
    organizationId: branch.legacyOrganizationId,
    businessGroupId: context.businessGroupId,
    userId: context.userId,
  };
}

export async function resolveShipmentPrintAccess(context: BranchContext, shipmentId: string): Promise<DocumentPrintAccess | null> {
  const ids = allowedBranchIds(context);
  if (!shipmentId.trim() || ids.length === 0) return null;
  const shipment = await runWithRequestTenant(tenantForLookup(context), () => prisma.localDemand.findFirst({
    where: { id: shipmentId, branchId: { in: ids } },
    select: { branchId: true },
  }));
  return shipment ? accessFromContext(context, shipment.branchId) : null;
}

export async function resolveClosingDocumentPrintAccess(context: BranchContext, documentId: string): Promise<DocumentPrintAccess | null> {
  const ids = allowedBranchIds(context);
  if (!documentId.trim() || ids.length === 0) return null;
  const document = await runWithRequestTenant(tenantForLookup(context), () => prisma.closingDocument.findFirst({
    where: { id: documentId, branchId: { in: ids } },
    select: { branchId: true },
  }));
  return document ? accessFromContext(context, document.branchId) : null;
}

/** Trusted renderer path: the caller has already checked the private render key. */
export async function resolveInternalShipmentPrintAccess(shipmentId: string): Promise<DocumentPrintAccess | null> {
  const shipment = await prisma.localDemand.findUnique({ where: { id: shipmentId }, select: { branchId: true } });
  if (!shipment) return null;
  const branch = await prisma.branch.findUnique({
    where: { id: shipment.branchId },
    select: { legacyOrganizationId: true, businessGroupId: true },
  });
  return branch ? { branchId: shipment.branchId, organizationId: branch.legacyOrganizationId, businessGroupId: branch.businessGroupId, userId: null } : null;
}

export async function resolveInternalClosingDocumentPrintAccess(documentId: string): Promise<DocumentPrintAccess | null> {
  const document = await prisma.closingDocument.findUnique({ where: { id: documentId }, select: { branchId: true } });
  if (!document) return null;
  const branch = await prisma.branch.findUnique({
    where: { id: document.branchId },
    select: { legacyOrganizationId: true, businessGroupId: true },
  });
  return branch ? { branchId: document.branchId, organizationId: branch.legacyOrganizationId, businessGroupId: branch.businessGroupId, userId: null } : null;
}

export function runWithDocumentPrintAccess<T>(access: DocumentPrintAccess, operation: () => T): T {
  return runWithRequestTenant({
    mode: "branch",
    branchId: access.branchId,
    organizationId: access.organizationId,
    allowedBranchIds: [access.branchId],
    businessGroupId: access.businessGroupId,
    userId: access.userId,
    permissions: ["documents.print"],
  }, operation);
}
