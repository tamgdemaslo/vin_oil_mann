import type { Metadata } from "next";
import BookingClient from "./BookingClient";

export const metadata: Metadata = {
  title: "Запись в автосервис | Там где масло",
  description: "Выберите филиал, услуги и свободное время визита.",
  robots: { index: true, follow: true },
};

export default function BookingPage() {
  return <BookingClient />;
}
