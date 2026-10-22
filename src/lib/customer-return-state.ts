import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { RETURN_CONTACT_STATUSES } from "./customer-return-contact-policy";
import type { CustomerReturnSharedState, CustomerReturnStatePatch } from "./customer-return-shared-types";

export const customerReturnStateSelect = {
  serviceDate:true, clientKey:true, draftText:true, draftFingerprint:true, skipped:true, version:true,
  updatedByLogin:true, updatedByName:true, updatedAt:true,
  deliveryStatus:true, deliveryConversationId:true,deliveryMessageId:true,deliveryAt:true,deliveryError:true,
} as const;
const select=customerReturnStateSelect;
type Row = Omit<CustomerReturnSharedState, "updatedAt"|"deliveryAt"> & { updatedAt: Date; deliveryAt: Date|null };
export const serializeCustomerReturnState = (row: Row): CustomerReturnSharedState => ({ ...row, updatedAt: row.updatedAt.toISOString(),deliveryAt:row.deliveryAt?.toISOString()??null });
const serialize=serializeCustomerReturnState;

type ContactDb=Pick<Prisma.TransactionClient,"customerReturnState"|"messengerOutbox">;
async function reconcileCustomerReturnRows(rows:Row[],db:ContactDb=prisma):Promise<CustomerReturnSharedState[]> {
  const messageIds=rows.flatMap(row=>row.deliveryMessageId?[row.deliveryMessageId]:[]);
  const deliveries=messageIds.length?await db.messengerOutbox.findMany({where:{branchId:getScopedBranchId(),messageId:{in:messageIds}},select:{messageId:true,status:true,updatedAt:true,nextAttemptAt:true}}):[];
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

export async function previousCustomerReturnDelivery(serviceDate:string,clientKey:string,db:ContactDb=prisma) {
  const rows=await db.customerReturnState.findMany({where:{branchId:getScopedBranchId(),clientKey,serviceDate:{not:serviceDate},deliveryStatus:{in:RETURN_CONTACT_STATUSES}},orderBy:[{serviceDate:"desc"},{updatedAt:"desc"}],select});
  const contacts=(await reconcileCustomerReturnRows(rows,db)).filter(row=>RETURN_CONTACT_STATUSES.includes(row.deliveryStatus??""));
  return contacts.find(row=>row.deliveryStatus!=="sent")??contacts[0];
}

export async function listCustomerReturnStates(serviceDate: string): Promise<CustomerReturnSharedState[]> {
  const branchId=getScopedBranchId();
  const [todayRows,previousRows]=await Promise.all([
    prisma.customerReturnState.findMany({where:{branchId,serviceDate},select}),
    prisma.customerReturnState.findMany({where:{branchId,serviceDate:{lt:serviceDate},deliveryStatus:{in:RETURN_CONTACT_STATUSES}},orderBy:[{serviceDate:"desc"},{updatedAt:"desc"}],select}),
  ]);
  const reconciled=await reconcileCustomerReturnRows([...todayRows,...previousRows]);
  const result=new Map(reconciled.filter(row=>row.serviceDate===serviceDate).map(row=>[row.clientKey,row]));
  const seen=new Set<string>();
  for(const previous of reconciled.filter(row=>row.serviceDate!==serviceDate && RETURN_CONTACT_STATUSES.includes(row.deliveryStatus??"")).sort((a,b)=>Number(a.deliveryStatus==="sent")-Number(b.deliveryStatus==="sent"))){
    if(seen.has(previous.clientKey))continue;seen.add(previous.clientKey);
    const current=result.get(previous.clientKey)??{clientKey:previous.clientKey,serviceDate,draftText:null,draftFingerprint:null,skipped:false,version:0,deliveryStatus:"none",updatedByLogin:"",updatedByName:"",updatedAt:previous.updatedAt};
    result.set(previous.clientKey,{...current,previousDelivery:previous});
  }
  return [...result.values()];
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
