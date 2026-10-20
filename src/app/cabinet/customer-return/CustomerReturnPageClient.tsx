"use client";
import { useCallback,useEffect,useState } from "react";
import CustomerReturnQueue from "../customer-analytics/CustomerReturnQueue";
import type { ReturnCandidate } from "@/lib/customer-return-candidates";
export default function CustomerReturnPageClient({userLogin}:{userLogin:string}) {
  const [data,setData]=useState<{branchId:string;today:string;candidates:ReturnCandidate[]}|null>(null);
  const [error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{
    try{
      const res=await fetch("/api/analytics/customer-return",{cache:"no-store"});const payload=await res.json();
      if(!res.ok)throw new Error(payload.error||"Не удалось загрузить подборку");
      setData(payload);setError(null);
    }catch(e){setError(e instanceof Error?e.message:"Не удалось загрузить подборку");}
  },[]);
  useEffect(()=>{void load();},[load]);
  return <>{error&&<p role="alert">{error} <button type="button" className="eco-btn" onClick={()=>void load()}>Повторить</button></p>}{data?<CustomerReturnQueue key={`${data.branchId}:${data.today}`} candidates={data.candidates} branchId={data.branchId} today={data.today} scope={`${data.branchId}:${userLogin}`} onRefresh={()=>void load()}/>:!error&&<p role="status">Загружаем подборку…</p>}</>;
}
