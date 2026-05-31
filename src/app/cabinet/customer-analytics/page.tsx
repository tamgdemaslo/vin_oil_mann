import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canAccessCustomerAnalytics } from "@/lib/customer-analytics-access";
import CustomerAnalyticsClient from "./CustomerAnalyticsClient";

export default async function CustomerAnalyticsPage() {
  const session = await getSession();
  if (!session) {
    redirect("/login?from=/cabinet/customer-analytics");
  }
  if (!canAccessCustomerAnalytics(session.user.role)) {
    redirect("/");
  }

  return (
    <main className="eco-page eco-page--wide eco-customer-analytics-page">
      <CustomerAnalyticsClient userLogin={session.user.login} />
    </main>
  );
}
