import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import type { CustomerReturnSharedState, CustomerReturnStatePatch } from "./customer-return-shared-types";

export const customerReturnStateSelect = {
  clientKey:true, draftText:true, draftFingerprint:true, skipped:true, version:true,
  updatedByLogin:true, updatedByName:true, updatedAt:true,
  deliveryStatus:true, deliveryConversationId:true,deliveryMessageId:true,deliveryAt:true,deliveryError:true,
} as const;
const select=customerReturnStateSelect;
type Row = Omit<CustomerReturnSharedState, "updatedAt"|"deliveryAt"> & { updatedAt: Date; deliveryAt: Date|null };
export const serializeCustomerReturnState = (row: Row): CustomerReturnSharedState => ({ ...row, updatedAt: row.updatedAt.toISOString(),deliveryAt:row.deliveryAt?.toISOString()??null });
const serialize=serializeCustomerReturnState;

export async function listCustomerReturnStates(serviceDate: string): Promise<CustomerReturnSharedState[]> {
  const rows = await prisma.customerReturnState.findMany({
    where:{branchId:getScopedBranchId(), serviceDate}, select,
  });
  const messageIds=rows.flatMap(row=>row.deliveryMessageId?[row.deliveryMessageId]:[]);
  const deliveries=messageIds.length?await prisma.messengerOutbox.findMany({where:{branchId:getScopedBranchId(),messageId:{in:messageIds}},select:{messageId:true,status:true,updatedAt:true,nextAttemptAt:true}}):[];
  return rows.map(row=>{
    const delivery=deliveries.find(d=>d.messageId===row.deliveryMessageId);
    const state=serialize(row);
    if(delivery && ["queued","sending","unknown","failed"].includes(state.deliveryStatus??"") && ["sent","failed","skipped"].includes(delivery.status)){
      state.deliveryStatus=delivery.status==="sent"?"sent":delivery.status==="skipped"?"unknown":delivery.nextAttemptAt?"queued":"failed";
      if(delivery.status==="sent")state.deliveryAt=delivery.updatedAt.toISOString();
    }else if(state.deliveryStatus==="sending" && Date.now()-row.updatedAt.getTime()>180000)state.deliveryStatus="unknown";
    return state;
  });
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
        where:{...key,version:input.expectedVersion,deliveryStatus:"none"},data:{...change,version:{increment:1}},
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
