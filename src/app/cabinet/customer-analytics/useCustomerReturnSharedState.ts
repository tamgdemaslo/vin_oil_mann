"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mergeCustomerReturnStates, type CustomerReturnSharedState } from "@/lib/customer-return-shared-types";

type Patch = {clientKey:string; expectedVersion:number; fingerprint:string; draftText?:string|null; skipped?:boolean};
export function useCustomerReturnSharedState(branchId:string,today:string) {
  const [states,setStates]=useState<Record<string,CustomerReturnSharedState>>({});
  const [pending,setPending]=useState<Record<string,CustomerReturnSharedState>>({});
  const pendingKeys=useRef(new Set<string>());
  const [busy,setBusy]=useState<Record<string,boolean>>({});
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const controller=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    controller.current?.abort();
    const current=new AbortController();controller.current=current;
    try {
      const res=await fetch(`/api/analytics/customer-return?statesOnly=1&branchId=${encodeURIComponent(branchId)}`,{cache:"no-store",signal:current.signal});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error||"Не удалось загрузить общие правки.");
      if(data.branchId!==branchId || data.today!==today) throw new Error("Филиал или дата подборки изменились. Скопируйте несохранённый текст и пересчитайте подборку.");
      setStates(previous=>mergeCustomerReturnStates(previous,data.states));
      setPending(previous=>{
        const next={...previous};
        for(const state of data.states as CustomerReturnSharedState[])if(state.deliveryStatus && state.deliveryStatus!=="none" && next[state.clientKey] && state.version>=next[state.clientKey].version){delete next[state.clientKey];pendingKeys.current.delete(state.clientKey);}
        return next;
      });
      setLoaded(true);setError(null);
    }catch(e){if(!current.signal.aborted)setError(e instanceof Error?e.message:"Не удалось загрузить общие правки.");}
  },[branchId,today]);
  const active=Object.values({...states,...pending}).some(state=>[state,state.previousDelivery].some(item=>["queued","sending"].includes(item?.deliveryStatus??"")));
  useEffect(()=>{setStates({});setPending({});pendingKeys.current.clear();setLoaded(false);setError(null);void refresh();return()=>controller.current?.abort();},[refresh]);
  useEffect(()=>{
    const poll=()=>{if(document.visibilityState==="visible")void refresh();};
    const timer=setInterval(poll,active?3000:15000);window.addEventListener("focus",poll);
    return()=>{clearInterval(timer);window.removeEventListener("focus",poll);};
  },[refresh,active]);
  async function patch(change:Patch) {
    setBusy(previous=>({...previous,[change.clientKey]:true}));
    try {
      const res=await fetch("/api/analytics/customer-return",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({branchId,serviceDate:today,...change})});
      const data=await res.json();
      if(data.state)setStates(previous=>mergeCustomerReturnStates(previous,[data.state]));
      if(!res.ok)return {ok:false,error:data.error||"Не удалось сохранить. Ваш текст остаётся в поле."};
      return {ok:true,error:null};
    }catch{return {ok:false,error:"Нет связи с сервером. Правки не сохранены; текст остаётся в поле и его можно скопировать."};}
    finally{setBusy(previous=>({...previous,[change.clientKey]:false}));}
  }
  async function send(change:{clientKey:string;expectedVersion:number;fingerprint:string;draftText:string}) {
    if(pendingKeys.current.has(change.clientKey))return {ok:false,error:"Сообщение уже обрабатывается."};
    pendingKeys.current.add(change.clientKey);
    const optimistic:CustomerReturnSharedState={serviceDate:today,clientKey:change.clientKey,draftText:change.draftText,draftFingerprint:change.fingerprint,version:change.expectedVersion,skipped:false,updatedByLogin:"",updatedByName:"",updatedAt:new Date().toISOString(),deliveryStatus:"queued"};
    setPending(previous=>({...previous,[change.clientKey]:optimistic}));
    let uncertain=false;
    try {
      const res=await fetch("/api/analytics/customer-return/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({branchId,serviceDate:today,...change})});
      const data=await res.json();
      if(data.state)setStates(previous=>mergeCustomerReturnStates(previous,[data.state]));
      if(!res.ok){uncertain=res.status>=500;return {ok:false,error:data.error||"Результат не подтверждён. Обновите общий статус."};}
      return {ok:true,error:null};
    }catch{uncertain=true;return {ok:false,error:"Связь прервалась. Проверьте вкладку «Ошибки» и диалог: повторная отправка заблокирована до выяснения результата."};}
    finally{
      if(uncertain)setPending(previous=>({...previous,[change.clientKey]:{...optimistic,deliveryStatus:"unknown",deliveryError:"Не удалось подтвердить постановку в очередь. Обновите статус и проверьте диалог перед повторной отправкой."}}));
      else{pendingKeys.current.delete(change.clientKey);setPending(previous=>{const next={...previous};delete next[change.clientKey];return next;});}
      void refresh();
    }
  }
  return {states:{...states,...pending},loaded,error,busy,saving:Object.values(busy).some(Boolean),refresh,patch,send};
}
