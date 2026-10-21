import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { canAccessCustomerReturnQueue } from "@/lib/customer-analytics-access";
import { getAnalyticsTodayYmd, loadCustomerReturnQueue } from "@/lib/customer-analytics";
import { listCustomerReturnStates, patchCustomerReturnState } from "@/lib/customer-return-state";
import { returnCandidateFingerprint } from "@/lib/customer-return-shared-types";

import { processPendingCustomerReturnDeliveries } from "@/lib/customer-return-jobs";
import { runForBranch } from "@/lib/branch-workers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const json = (body: unknown,status=200) => NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
const patchSchema=z.object({
  branchId:z.string().min(1).max(200), serviceDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clientKey:z.string().min(1).max(400),expectedVersion:z.number().int().min(0).max(2147483646),
  fingerprint:z.string().min(1).max(200000),draftText:z.string().max(10000).nullable().optional(),skipped:z.boolean().optional(),
}).strict().refine(value=>value.draftText!==undefined || value.skipped!==undefined,"Нет изменений");
function failure(error: unknown) {
  const code=error && typeof error==="object" && "code" in error ? String(error.code):"";
  if (code==="P2021" || code==="P2022") return json({error:"Хранилище общей подборки ещё не подготовлено. Требуется отдельное применение миграции.",code:"migration_required"},503);
  console.error("[customer-return]",error instanceof Error ? error.name : "unknown");
  return json({error:"Не удалось загрузить или сохранить общую подборку. Ваш текст можно скопировать и повторить попытку."},500);
}
export async function GET(request:NextRequest) {
  const access=await requireBranchApi({allowAll:false,requireActive:true});
  if (!access.ok) return access.response;
  if (!canAccessCustomerReturnQueue(access.context.user.role)) return json({error:"Нет доступа"},403);
  const branchId=access.context.branchId!;
  const expectedBranch=request.nextUrl.searchParams.get("branchId");
  if(expectedBranch && expectedBranch!==branchId) return json({error:"Активный филиал изменился. Обновите страницу.",code:"branch_changed"},409);
  try {
    return await runWithBranchApiContext(access.context,async()=>{
      const today=getAnalyticsTodayYmd();
      const states=await listCustomerReturnStates(today);
      // Resume persisted jobs after a server restart, without delaying status polling.
      if(states.some(state=>state.deliveryStatus==="queued" && !state.deliveryMessageId))after(async()=>{try{await runForBranch(branchId,()=>processPendingCustomerReturnDeliveries());}catch(error){console.error("[customer-return-worker-resume]",error instanceof Error?error.name:"unknown");}});
      const candidates=request.nextUrl.searchParams.get("statesOnly")==="1"?undefined:await loadCustomerReturnQueue(today);
      return json({branchId,today,states,...(candidates?{candidates}:{})});
    });
  }catch(error){return failure(error);}
}
export async function PATCH(request:NextRequest) {
  const access=await requireBranchApi({allowAll:false,requireActive:true});
  if (!access.ok) return access.response;
  if (!canAccessCustomerReturnQueue(access.context.user.role)) return json({error:"Нет доступа"},403);
  const body=await request.text();
  if(body.length>250000) return json({error:"Слишком большой запрос"},413);
  let value:unknown;try{value=JSON.parse(body);}catch{return json({error:"Некорректный JSON"},400);}
  const parsed=patchSchema.safeParse(value);
  if(!parsed.success) return json({error:"Проверьте текст (до 10 000 символов), версию и дату подборки."},400);
  if(parsed.data.branchId!==access.context.branchId) return json({error:"Активный филиал изменился. Обновите страницу.",code:"branch_changed"},409);
  try {
    return await runWithBranchApiContext(access.context,async()=>{
      const today=getAnalyticsTodayYmd();
      if(parsed.data.serviceDate!==today) return json({error:"Начался новый день. Пересчитайте подборку; ваш текст остаётся в поле.",code:"day_changed"},409);
      const candidate=(await loadCustomerReturnQueue(today,parsed.data.clientKey)).find(c=>c.clientKey===parsed.data.clientKey);
      if(!candidate || returnCandidateFingerprint(candidate)!==parsed.data.fingerprint) return json({error:"История, цены, наличие или предложение изменились. Пересчитайте подборку и проверьте расчёт; ваш текст можно скопировать.",code:"candidate_changed"},409);
      const result=await patchCustomerReturnState(parsed.data,access.context.user);
      return result.status==="saved"?json(result):json({...result,error:"Другой сотрудник уже изменил эту запись. Сравните тексты перед сохранением.",code:"version_conflict"},409);
    });
  }catch(error){return failure(error);}
}
