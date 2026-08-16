import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuthenticatedSession } from "@/lib/app-access";
import { canManageBookingSettings } from "@/lib/booking/access";
import { requireBranchContext } from "@/lib/branch-context";
import BookingSettingsClient from "./BookingSettingsClient";

export const metadata: Metadata = {
  title: "Настройки записи | Эко-платформа",
};

export default async function BookingSettingsPage() {
  await requireAuthenticatedSession("/management/booking");
  const context = await requireBranchContext({ allowAll: false, requireActive: true });
  if (!canManageBookingSettings(context)) redirect("/records");
  return <BookingSettingsClient />;
}
