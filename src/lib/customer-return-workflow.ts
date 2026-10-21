import type { CustomerReturnSharedState } from "./customer-return-shared-types";

export const RETURN_TABS={ready:"Требуют отправки",processing:"В процессе",sent:"Отправленные",errors:"Ошибки",review:"Нужна проверка",skipped:"Пропущенные"} as const;
export type ReturnTab=keyof typeof RETURN_TABS;
export function customerReturnTab(candidate:{offerReady?:boolean},state?:CustomerReturnSharedState):ReturnTab{
  if(state?.deliveryStatus && state.deliveryStatus!=="none"){
    if(state.deliveryStatus==="sent")return "sent";
    if(["queued","sending"].includes(state.deliveryStatus))return "processing";
    return "errors";
  }
  if(state?.skipped)return "skipped";
  return candidate.offerReady===true?"ready":"review";
}
export function customerReturnStatus(state?:CustomerReturnSharedState){
  switch(state?.deliveryStatus){
    case "queued":return state.deliveryMessageId?"В очереди Telegram":"В очереди · проверяем предложение";
    case "sending":return "Проверяем и отправляем";
    case "sent":return "Отправлено в Telegram";
    case "failed":return "Не отправлено · ошибка";
    case "unknown":return "Результат не подтверждён";
    default:return null;
  }
}
