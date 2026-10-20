import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessCustomerReturnQueue } from "@/lib/customer-analytics-access";
import CustomerReturnPageClient from "./CustomerReturnPageClient";
export default async function CustomerReturnPage() {
  const session=await getSession();
  if(!session)redirect("/login?from=/cabinet/customer-return");
  if(!canAccessCustomerReturnQueue(session.user.role))redirect("/");
  return <main className="eco-page eco-page--wide"><h1 className="eco-page-title">Кого вернуть сегодня</h1><CustomerReturnPageClient userLogin={session.user.login}/></main>;
}
