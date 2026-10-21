import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { getPublicUsers, type User } from "@/lib/auth";
import { loadCustomerReturnQueue } from "@/lib/customer-analytics";
import { CustomerReturnDeliveryError, sendCustomerReturnDraft } from "@/lib/customer-return-delivery";
import { customerReturnStateSelect as select, serializeCustomerReturnState } from "@/lib/customer-return-state";
import { assertMessengerOutboundTextSafe } from "@/lib/messenger/messenger-security";

export type ReturnDeliveryRequest = { serviceDate:string; clientKey:string; expectedVersion:number; fingerprint:string; draftText:string };

/** Persist the explicit employee instruction before acknowledging it. No catalog or Telegram calls here. */
export async function enqueueCustomerReturnDelivery(input:ReturnDeliveryRequest, actor:User) {
  const text=input.draftText.trim();
  if(!text || text.length>4096)throw new CustomerReturnDeliveryError("Сообщение должно содержать от 1 до 4096 символов.",400);
  try{assertMessengerOutboundTextSafe(text);}catch(error){throw new CustomerReturnDeliveryError(error instanceof Error?error.message:"Проверьте текст сообщения.",400);}
  const key={branchId:getScopedBranchId(),serviceDate:input.serviceDate,clientKey:input.clientKey};
  const where={branchId_serviceDate_clientKey:key};
  const change={draftText:text,draftFingerprint:input.fingerprint,deliveryStatus:"queued",deliveryAttemptId:randomUUID(),deliveryError:null,updatedByLogin:actor.login,updatedByName:actor.name,updatedAt:new Date()};
  try{
    const row=await prisma.$transaction(async tx=>{
      if(input.expectedVersion===0)return tx.customerReturnState.create({data:{...key,...change},select});
      const result=await tx.customerReturnState.updateMany({where:{...key,version:input.expectedVersion,deliveryStatus:"none",skipped:false},data:{...change,version:{increment:1}}});
      return result.count?tx.customerReturnState.findUniqueOrThrow({where,select}):null;
    });
    if(row)return serializeCustomerReturnState(row);
  }catch(error){
    if(!(error instanceof Prisma.PrismaClientKnownRequestError && error.code==="P2002"))throw error;
  }
  const current=await prisma.customerReturnState.findUnique({where,select});
  // Repeated clicks are reads, never new sends, even if the original response was lost.
  if(current && current.deliveryStatus!=="none")return serializeCustomerReturnState(current);
  throw new CustomerReturnDeliveryError("Черновик изменён коллегой или пропущен. Обновите общую подборку.");
}

/** Durable recovery: only explicitly queued, not-yet-submitted jobs. Never retry uncertain delivery. */
export async function processPendingCustomerReturnDeliveries(limit=3) {
  const branchId=getScopedBranchId();
  const pending=await prisma.customerReturnState.findMany({where:{branchId,deliveryStatus:"queued",deliveryMessageId:null},orderBy:{updatedAt:"asc"},take:limit});
  if(!pending.length)return {processed:0};
  const users=await getPublicUsers();
  let processed=0;
  await Promise.all(pending.map(async row=>{
    const key={branchId,serviceDate:row.serviceDate,clientKey:row.clientKey};
    const attempt=randomUUID();
    const claimed=await prisma.customerReturnState.updateMany({where:{...key,version:row.version,deliveryStatus:"queued",deliveryMessageId:null},data:{deliveryStatus:"sending",deliveryAttemptId:attempt,version:{increment:1},updatedAt:new Date()}});
    if(!claimed.count)return;
    processed++;
    try{
      const actor=users.find(user=>user.login===row.updatedByLogin);
      if(!actor)throw new CustomerReturnDeliveryError("Сотрудник, поставивший сообщение в очередь, больше не имеет доступа.");
      const candidate=(await loadCustomerReturnQueue(row.serviceDate,row.clientKey)).find(c=>c.clientKey===row.clientKey);
      if(!candidate)throw new CustomerReturnDeliveryError("Клиент больше не входит в подборку. Сообщение не отправлено.");
      await sendCustomerReturnDraft(candidate,{serviceDate:row.serviceDate,expectedVersion:row.version+1,fingerprint:row.draftFingerprint??""},actor,attempt);
    }catch(error){
      // A transport exception is already marked unknown by delivery.ts; do not turn it into a retryable job.
      await prisma.customerReturnState.updateMany({where:{...key,deliveryAttemptId:attempt,deliveryStatus:"sending",deliveryMessageId:null},data:{deliveryStatus:"failed",deliveryError:error instanceof CustomerReturnDeliveryError?error.message:"Не удалось подготовить предложение. Сообщение не отправлено; проверьте расчёт и подключение Telegram.",version:{increment:1},updatedAt:new Date()}});
      if(!(error instanceof CustomerReturnDeliveryError))console.error("[customer-return-worker]",error instanceof Error?error.name:"unknown");
    }
  }));
  return {processed};
}
