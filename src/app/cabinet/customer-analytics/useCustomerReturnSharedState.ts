"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mergeCustomerReturnStates, type CustomerReturnSharedState } from "@/lib/customer-return-shared-types";

type Patch = {clientKey:string; expectedVersion:number; fingerprint:string; draftText?:string|null; skipped?:boolean};
export function useCustomerReturnSharedState(branchId:string,today:string) {
  const [states,setStates]=useState<Record<string,CustomerReturnSharedState>>({});
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [saving,setSaving]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    controller.current?.abort();
    const current=new AbortController();controller.current=current;
    try {
      const res=await fetch(`/api/analytics/customer-return?statesOnly=1&branchId=${encodeURIComponent(branchId)}`,{cache:"no-store",signal:current.signal});
      const data=await res.json();
      if(!res.ok) throw new Error(data.error||"Не удалось загрузить общие правки.");
      if(data.branchId!==branchId || data.today!==today) throw new Error("Филиал или дата подборки изменились. Скопируйте несохранённый текст и пересчитайте подборку.");
      setStates(previous=>mergeCustomerReturnStates(previous,data.states));setLoaded(true);setError(null);
    }catch(e){if(!current.signal.aborted)setError(e instanceof Error?e.message:"Не удалось загрузить общие правки.");}
  },[branchId,today]);
  useEffect(()=>{
    void refresh();
    const poll=()=>{if(document.visibilityState==="visible")void refresh();};
    const timer=setInterval(poll,15000);window.addEventListener("focus",poll);
    return()=>{clearInterval(timer);window.removeEventListener("focus",poll);controller.current?.abort();};
  },[refresh]);
  async function patch(change:Patch) {
    setSaving(true);
    try {
      const res=await fetch("/api/analytics/customer-return",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({branchId,serviceDate:today,...change})});
      const data=await res.json();
      if(data.state)setStates(previous=>mergeCustomerReturnStates(previous,[data.state]));
      if(!res.ok)return {ok:false,error:data.error||"Не удалось сохранить. Ваш текст остаётся в поле."};
      return {ok:true,error:null};
    }catch{return {ok:false,error:"Нет связи с сервером. Правки не сохранены; текст остаётся в поле и его можно скопировать."};}
    finally{setSaving(false);}
  }
  async function send(change:{clientKey:string;expectedVersion:number;fingerprint:string}) {
    setSaving(true);
    try {
      const res=await fetch("/api/analytics/customer-return/send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({branchId,serviceDate:today,...change})});
      const data=await res.json();
      if(data.state)setStates(previous=>mergeCustomerReturnStates(previous,[data.state]));
      if(!res.ok)return {ok:false,error:data.error||"Результат не подтверждён. Обновите общий статус."};
      return {ok:true,error:null};
    }catch{return {ok:false,error:"Связь прервалась. Результат не подтверждён; обновите общий статус перед повторным действием."};}
    finally{setSaving(false);void refresh();}
  }
  return {states,loaded,error,saving,refresh,patch,send};
}
