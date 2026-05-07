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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <CustomerAnalyticsClient userLogin={session.user.login} />
    </div>
  );
}
