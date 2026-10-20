import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import type { CustomerReturnSharedState, CustomerReturnStatePatch } from "./customer-return-shared-types";

const select = {
  clientKey:true, draftText:true, draftFingerprint:true, skipped:true, version:true,
  updatedByLogin:true, updatedByName:true, updatedAt:true,
} as const;
type Row = Omit<CustomerReturnSharedState, "updatedAt"> & { updatedAt: Date };
const serialize = (row: Row): CustomerReturnSharedState => ({ ...row, updatedAt: row.updatedAt.toISOString() });

export async function listCustomerReturnStates(serviceDate: string): Promise<CustomerReturnSharedState[]> {
  const rows = await prisma.customerReturnState.findMany({
    where:{branchId:getScopedBranchId(), serviceDate}, select,
  });
  return rows.map(serialize);
}

export async function patchCustomerReturnState(input: CustomerReturnStatePatch, actor: {login:string; name:string}) {
  const branchId = getScopedBranchId();
  const key = {branchId, serviceDate:input.serviceDate, clientKey:input.clientKey};
  const draft = Object.hasOwn(input,"draftText") ? {
    draftText:input.draftText ?? null,
    draftFingerprint:input.draftText == null ? null : input.fingerprint,
  } : {};
  const change = {
    ...draft, ...(input.skipped !== undefined ? {skipped:input.skipped}:{}),
    updatedByLogin:actor.login, updatedByName:actor.name, updatedAt:new Date(),
  };
  try {
    const state = await prisma.$transaction(async tx => {
      if (input.expectedVersion === 0) {
        return tx.customerReturnState.create({data:{...key,...change},select});
      }
      const updated = await tx.customerReturnState.updateMany({
        where:{...key,version:input.expectedVersion},data:{...change,version:{increment:1}},
      });
      if (!updated.count) return null;
      return tx.customerReturnState.findUniqueOrThrow({where:{branchId_serviceDate_clientKey:key},select});
    });
    if (state) return {status:"saved" as const,state:serialize(state)};
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
  }
  const current = await prisma.customerReturnState.findUnique({where:{branchId_serviceDate_clientKey:key},select});
  return {status:"conflict" as const,state:current?serialize(current):null};
}
