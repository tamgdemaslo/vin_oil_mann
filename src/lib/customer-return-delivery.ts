import { randomUUID,createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import type { User } from "@/lib/auth";
import { getContactStatus,startContactConversation } from "@/lib/messenger/messenger-contact-actions";
import { getConversation,sendMessage } from "@/lib/messenger/messenger-gateway";
import { getActiveTelegramUserAccount } from "@/lib/messenger/channels/telegram-user-session";
import { assertMessengerOutboundTextSafe } from "@/lib/messenger/messenger-security";
import { customerReturnStateSelect,serializeCustomerReturnState } from "./customer-return-state";
import { returnCandidateFingerprint } from "./customer-return-shared-types";
import type { ReturnCandidate } from "./customer-return-candidates";

export class CustomerReturnDeliveryError extends Error {
  constructor(message:string,public status=409){super(message);}
}
/** Explicit employee action only. Atomic branch/day/client claim prevents concurrent/repeated sends. */
export async function sendCustomerReturnDraft(candidate:ReturnCandidate,input:{serviceDate:string;expectedVersion:number;fingerprint:string},actor:User){
  if(!candidate.offerReady)throw new CustomerReturnDeliveryError("Предложение не рассчитано полностью. Проверьте состав, цены, наличие и работу.");
  const fingerprint=returnCandidateFingerprint(candidate);
  if(fingerprint!==input.fingerprint)throw new CustomerReturnDeliveryError("Цены, наличие или история изменились. Пересчитайте подборку.");
  const branchId=getScopedBranchId();
  const key={branchId,serviceDate:input.serviceDate,clientKey:candidate.clientKey};
  const where={branchId_serviceDate_clientKey:key};
  const saved=await prisma.customerReturnState.findUnique({where,select:customerReturnStateSelect});
  if(!saved)throw new CustomerReturnDeliveryError("Сначала сохраните черновик.");
  if(saved.deliveryStatus!=="none")return serializeCustomerReturnState(saved);
  if(saved.version!==input.expectedVersion || saved.draftFingerprint!==fingerprint || saved.skipped)throw new CustomerReturnDeliveryError("Черновик изменён коллегой или пропущен. Обновите общую подборку.");
  const text=saved.draftText?.trim();
  if(!text || text.length>4096)throw new CustomerReturnDeliveryError("Сообщение должно содержать от 1 до 4096 символов.",400);
  try{assertMessengerOutboundTextSafe(text);}catch(error){throw new CustomerReturnDeliveryError(error instanceof Error?error.message:"Проверьте текст сообщения.",400);}
  // Identity and phone come only from freshly recomputed branch history, never from request fields.
  const contact={entityType:"counterparty",counterpartyId:candidate.counterpartyId,phone:candidate.phone,displayName:candidate.displayName,preferredChannel:"telegram"};
  if(!candidate.counterpartyId && !candidate.phone)throw new CustomerReturnDeliveryError("У клиента нет телефона или привязанной карточки.",400);
  const status=await getContactStatus(contact);
  if(!status.canMessage)throw new CustomerReturnDeliveryError(status.telegramConnected?"Клиент недоступен для сообщения в Telegram.":"Telegram филиала не подключён.");
  const attempt=randomUUID();
  const claimed=await prisma.customerReturnState.updateMany({where:{...key,version:input.expectedVersion,deliveryStatus:"none",skipped:false},data:{deliveryStatus:"sending",deliveryAttemptId:attempt,deliveryError:null,version:{increment:1},updatedByLogin:actor.login,updatedByName:actor.name,updatedAt:new Date()}});
  if(!claimed.count){
    const current=await prisma.customerReturnState.findUniqueOrThrow({where,select:customerReturnStateSelect});
    if(current.deliveryStatus!=="none")return serializeCustomerReturnState(current);
    throw new CustomerReturnDeliveryError("Черновик изменён коллегой. Обновите общую подборку.");
  }
  let sendStarted=false;
  try{
    const start=await startContactConversation(contact,actor);
    const conversation=await getConversation(start.conversationId);
    const account=await getActiveTelegramUserAccount();
    if(!conversation || conversation.channel!=="telegram" || !account?.isActive || account.status!=="connected" || conversation.messengerAccountId!==account.id)throw new CustomerReturnDeliveryError("Диалог не связан с текущим Telegram-аккаунтом филиала. Проверьте привязку в сообщениях.");
    await prisma.customerReturnState.updateMany({where:{...key,deliveryAttemptId:attempt},data:{deliveryConversationId:start.conversationId,updatedAt:new Date()}});
    sendStarted=true;
    const result=await sendMessage({conversationId:start.conversationId,text,createdByLogin:actor.login,idempotencyKey:"customer-return:"+createHash("sha256").update(JSON.stringify(key)).digest("hex")});
    const deliveryStatus=result?.outbox?.status==="sent"||result?.message.status==="sent"?"sent":result?.outbox && ["queued","processing"].includes(result.outbox.status)?"queued":result?.outbox?.nextAttemptAt?"queued":result?.outbox?.status==="failed"?"failed":"unknown";
    await prisma.customerReturnState.updateMany({where:{...key,deliveryAttemptId:attempt},data:{deliveryStatus,deliveryMessageId:result?.message.id??null,deliveryAt:deliveryStatus==="sent"?new Date():null,deliveryError:["failed","unknown"].includes(deliveryStatus)?"Telegram не подтвердил отправку. Проверьте диалог перед повторными действиями.":null,version:{increment:1},updatedAt:new Date()}});
  }catch(error){
    await prisma.customerReturnState.updateMany({where:{...key,deliveryAttemptId:attempt},data:{deliveryStatus:sendStarted?"unknown":"none",deliveryError:sendStarted?"Результат отправки не подтверждён. Проверьте диалог; повторная отправка заблокирована.":"Отправка не началась. Проверьте подключение Telegram и привязку клиента.",version:{increment:1},updatedAt:new Date()}});
    if(!sendStarted)throw new CustomerReturnDeliveryError(error instanceof CustomerReturnDeliveryError?error.message:"Не удалось подготовить диалог Telegram. Сообщение не отправлялось.");
  }
  return serializeCustomerReturnState(await prisma.customerReturnState.findUniqueOrThrow({where,select:customerReturnStateSelect}));
}
