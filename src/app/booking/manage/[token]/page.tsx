import type { Metadata } from "next";
import ManageBookingClient from "./ManageBookingClient";

export const metadata: Metadata = {
  title: "Моя запись | Там где масло",
  description: "Просмотр, перенос и отмена записи в сервис.",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

export default async function ManageBookingPage({ params }: Props) {
  const { token } = await params;
  return <ManageBookingClient token={token} />;
}
