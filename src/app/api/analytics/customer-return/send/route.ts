import { after,NextRequest,NextResponse } from "next/server";
import { z } from "zod";
import { requireBranchApi,runWithBranchApiContext } from "@/lib/branch-api";
import { canAccessCustomerReturnQueue } from "@/lib/customer-analytics-access";
import { getAnalyticsTodayYmd } from "@/lib/customer-analytics";
import { CustomerReturnDeliveryError } from "@/lib/customer-return-delivery";
import { enqueueCustomerReturnDelivery,processPendingCustomerReturnDeliveries } from "@/lib/customer-return-jobs";
import { runForBranch } from "@/lib/branch-workers";
export const dynamic="force-dynamic";
export const runtime="nodejs";
const schema=z.object({branchId:z.string().min(1).max(200),serviceDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),clientKey:z.string().min(1).max(400),expectedVersion:z.number().int().min(0).max(2147483645),fingerprint:z.string().min(1).max(200000),draftText:z.string().min(1).max(4096)}).strict();
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{"Cache-Control":"no-store"}});
export async function POST(request:NextRequest){
  const access=await requireBranchApi({allowAll:false,requireActive:true});if(!access.ok)return access.response;
  if(!canAccessCustomerReturnQueue(access.context.user.role))return json({error:"Нет доступа"},403);
  const text=await request.text();if(text.length>250000)return json({error:"Слишком большой запрос"},413);
  let body:unknown;try{body=JSON.parse(text);}catch{return json({error:"Некорректный JSON"},400);}
  const parsed=schema.safeParse(body);if(!parsed.success)return json({error:"Проверьте дату и сохранённую версию черновика."},400);
  if(parsed.data.branchId!==access.context.branchId)return json({error:"Активный филиал изменился."},409);
  try{return await runWithBranchApiContext(access.context,async()=>{
    if(parsed.data.serviceDate!==getAnalyticsTodayYmd())return json({error:"Начался новый день. Обновите подборку."},409);
    const state=await enqueueCustomerReturnDelivery(parsed.data,access.context.user);
    after(async()=>{try{await runForBranch(access.context.branchId!,()=>processPendingCustomerReturnDeliveries());}catch(error){console.error("[customer-return-worker-kick]",error instanceof Error?error.name:"unknown");}});
    return json({state},202);
  });}catch(error){
    if(error instanceof CustomerReturnDeliveryError)return json({error:error.message},error.status);
    console.error("[customer-return-send]",error instanceof Error?error.name:"unknown");
    return json({error:"Не удалось подтвердить результат. Обновите общий статус перед повторным действием."},500);
  }
}
