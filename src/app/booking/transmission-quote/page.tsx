import type { Metadata } from "next";
import TransmissionQuoteClient from "./TransmissionQuoteClient";

export const metadata: Metadata = {
  title: "Расчёт замены масла в АКПП | Там где масло",
  description: "Оставьте данные автомобиля — рассчитаем стоимость масла, расходников и работ по замене масла в АКПП.",
  robots: { index: false, follow: true },
};

export default function TransmissionQuotePage() {
  return <TransmissionQuoteClient />;
}
